import prisma from '../config/prisma';
import { hasKnownHuaweiStationInventory, isKnownHuaweiStationCode, pickOnDemandClient } from './huaweiPool';
import { getCachedPlantKpi } from './huaweiKpiCache';
import { syncPlantOnDemand } from './syncService';

const AUX_DEVICE_META_CACHE_TTL_MS = Number(process.env.HUAWEI_AUX_DEVICE_META_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const AUX_DEVICE_REALTIME_CACHE_TTL_MS = Number(process.env.HUAWEI_AUX_DEVICE_REALTIME_CACHE_TTL_MS ?? 5 * 60 * 1000);
const SITE_STALE_MS = Number(process.env.HUAWEI_ONDEMAND_SITE_STALE_MS ?? 5 * 60 * 1000);

const DEV_TYPE_EMI = 10;
const DEV_TYPE_GRID_METER = 17;
const DEV_TYPE_RESIDENTIAL_BATTERY = 39;
const DEV_TYPE_ESS = 41;
const DEV_TYPE_POWER_SENSOR = 47;

const AUX_DEVICE_TYPES = [DEV_TYPE_EMI, DEV_TYPE_GRID_METER, DEV_TYPE_RESIDENTIAL_BATTERY, DEV_TYPE_ESS, DEV_TYPE_POWER_SENSOR] as const;
type AuxDeviceType = (typeof AUX_DEVICE_TYPES)[number];

type SiteRecord = {
  id: number;
  plantCode: string;
  name: string;
  currentPowerKW: number | null;
  lastPlantSyncAt: Date | null;
  gridConnectionDate: Date | null;
  siteRealtimeRaw: unknown;
};

type HuaweiDeviceLite = {
  id: number | string;
  devTypeId?: number | null;
  devName?: string | null;
  model?: string | null;
};

type HuaweiRealtimeRow = {
  devId?: number | string;
  sn?: string;
  dataItemMap?: Record<string, unknown>;
};

type AuxRealtimeBundle = {
  site: SiteRecord;
  siteRefresh: {
    attempted: boolean;
    reason: string | null;
    result?: unknown;
  };
  devices: HuaweiDeviceLite[];
  realtimeByType: Partial<Record<AuxDeviceType, HuaweiRealtimeRow[]>>;
  fetchedAt: string;
};

type MonitoringView = 'day' | 'month' | 'year' | 'lifetime';

type GraphPoint = {
  timestamp: string;
  label: string;
  pvOutput: number | null;
  powerOfGrid: number | null;
  gridImport: number | null;
  gridExport: number | null;
  consumptionPower: number | null;
  consumedFromPv: number | null;
  batteryCharge: number | null;
  batteryDischarge: number | null;
  irradiance: number | null;
};

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const auxDeviceMetaCache = new Map<string, CacheEntry<HuaweiDeviceLite[]>>();
const auxRealtimeCache = new Map<string, CacheEntry<AuxRealtimeBundle>>();
const auxRealtimeInflight = new Map<string, Promise<AuxRealtimeBundle>>();

function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundValue(value: number | null, digits = 3): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isFresh(lastSyncAt: Date | null | undefined, ttlMs: number): boolean {
  if (!lastSyncAt) return false;
  return Date.now() - lastSyncAt.getTime() < ttlMs;
}

function startOfDay(value: Date): Date {
  const out = new Date(value);
  out.setHours(0, 0, 0, 0);
  return out;
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);
}

function startOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function addHours(value: Date, hours: number): Date {
  const out = new Date(value);
  out.setHours(out.getHours() + hours);
  return out;
}

function addDays(value: Date, days: number): Date {
  const out = new Date(value);
  out.setDate(out.getDate() + days);
  return out;
}

function addMonths(value: Date, months: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + months, 1, 0, 0, 0, 0);
}

function addYears(value: Date, years: number): Date {
  return new Date(value.getFullYear() + years, 0, 1, 0, 0, 0, 0);
}

function formatHourLabel(value: Date): string {
  return `${String(value.getHours()).padStart(2, '0')}:00`;
}

function formatDayLabel(value: Date): string {
  return `${String(value.getDate()).padStart(2, '0')}/${String(value.getMonth() + 1).padStart(2, '0')}`;
}

function formatMonthLabel(value: Date): string {
  return `${String(value.getMonth() + 1).padStart(2, '0')}/${value.getFullYear()}`;
}

function parseRequestedAnchor(view: MonitoringView, raw?: string | null): Date {
  if (!raw) return new Date();

  if (view === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00`);
  }

  if (view === 'month' && /^\d{4}-\d{2}$/.test(raw)) {
    return new Date(`${raw}-15T12:00:00`);
  }

  if (view === 'year' && /^\d{4}$/.test(raw)) {
    return new Date(`${raw}-06-15T12:00:00`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return new Date();
  return parsed;
}

function mapGraphPoint(row: any): GraphPoint | null {
  const collectTime = parseNum(row?.collectTime);
  if (collectTime == null) return null;

  const map = (row?.dataItemMap ?? {}) as Record<string, unknown>;
  const date = new Date(collectTime);

  return {
    timestamp: toIso(date),
    label: toIso(date),
    pvOutput: roundValue(parseNum(map.PVYield) ?? parseNum(map.inverterYield) ?? parseNum(map.inverter_power), 3),
    powerOfGrid: roundValue(parseNum(map.buyPower) ?? parseNum(map.ongrid_power), 3),
    gridImport: roundValue(parseNum(map.buyPower), 3),
    gridExport: roundValue(parseNum(map.ongrid_power), 3),
    consumptionPower: roundValue(parseNum(map.use_power), 3),
    consumedFromPv: roundValue(parseNum(map.selfProvide) ?? parseNum(map.selfUsePower), 3),
    batteryCharge: roundValue(parseNum(map.chargeCap), 3),
    batteryDischarge: roundValue(parseNum(map.dischargeCap), 3),
    irradiance: roundValue(parseNum(map.radiation_intensity), 3),
  };
}

function withLabel(point: GraphPoint, view: MonitoringView): GraphPoint {
  const date = new Date(point.timestamp);
  const label =
    view === 'day'
      ? formatHourLabel(date)
      : view === 'month'
        ? formatDayLabel(date)
        : view === 'year'
          ? formatMonthLabel(date)
          : String(date.getFullYear());

  return { ...point, label };
}

function buildDaySkeleton(start: Date): GraphPoint[] {
  return Array.from({ length: 24 }, (_, idx) => {
    const slot = addHours(start, idx);
    return {
      timestamp: toIso(slot),
      label: formatHourLabel(slot),
      pvOutput: null,
      powerOfGrid: null,
      gridImport: null,
      gridExport: null,
      consumptionPower: null,
      consumedFromPv: null,
      batteryCharge: null,
      batteryDischarge: null,
      irradiance: null,
    };
  });
}

function bucketKey(view: MonitoringView, value: Date): string {
  if (view === 'day') return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}-${value.getHours()}`;
  if (view === 'month') return `${value.getFullYear()}-${value.getMonth()}-${value.getDate()}`;
  if (view === 'year') return `${value.getFullYear()}-${value.getMonth()}`;
  return `${value.getFullYear()}`;
}

async function getSiteOrThrow(siteId: number): Promise<SiteRecord> {
  const site = (await prisma.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      plantCode: true,
      name: true,
      currentPowerKW: true,
      lastPlantSyncAt: true,
      gridConnectionDate: true,
      siteRealtimeRaw: true,
    },
  } as any)) as SiteRecord | null;

  if (!site) {
    throw Object.assign(new Error('Site not found'), { statusCode: 404 });
  }

  if (!site.plantCode) {
    throw Object.assign(new Error('Site plantCode is missing'), { statusCode: 400 });
  }

  return site;
}

async function maybeRefreshSiteRealtime(site: SiteRecord, refreshMode: 'auto' | 'force') {
  const shouldRefresh = refreshMode === 'force' || !isFresh(site.lastPlantSyncAt, SITE_STALE_MS) || site.currentPowerKW == null;
  if (!shouldRefresh) {
    return {
      site,
      refresh: { attempted: false, reason: null as string | null },
    };
  }

  const result = await (syncPlantOnDemand as any) (site.plantCode, {
    forceSiteRealtime: refreshMode === 'force',
    includeDeviceDetail: site.currentPowerKW == null,
    forceDeviceDetail: false,
  });

  const refreshedSite = await getSiteOrThrow(site.id);
  return {
    site: refreshedSite,
    refresh: {
      attempted: true,
      reason: refreshMode === 'force' ? 'force' : site.currentPowerKW == null ? 'missing_current_power' : 'stale_site_realtime',
      result,
    },
  };
}

async function getAuxDevices(site: SiteRecord): Promise<HuaweiDeviceLite[]> {
  const cached = auxDeviceMetaCache.get(site.plantCode);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  if (hasKnownHuaweiStationInventory() && !isKnownHuaweiStationCode(site.plantCode)) {
    return [];
  }

  try {
    const client = pickOnDemandClient();
    const response: any = await client.getDevList(site.plantCode);
    const devices = Array.isArray(response?.data)
      ? (response.data as HuaweiDeviceLite[]).filter((device) => AUX_DEVICE_TYPES.includes(Number(device.devTypeId) as AuxDeviceType))
      : [];

    // Only cache non-empty results or if response was explicitly successful
    if (devices.length > 0 || response?.success === true) {
      auxDeviceMetaCache.set(site.plantCode, {
        expiresAt: Date.now() + AUX_DEVICE_META_CACHE_TTL_MS,
        value: devices,
      });
    } else if (cached) {
      // API returned empty/failed but we have stale cache — keep using it
      console.warn(`⚠️ [HomeRealtime] getDevList returned empty for plant=${site.plantCode}, using stale device cache`);
      return cached.value;
    }

    return devices;
  } catch (err: any) {
    console.warn(`⚠️ [HomeRealtime] getDevList error for plant=${site.plantCode}:`, err?.message ?? err);
    // Return stale cache on error
    if (cached) return cached.value;
    return [];
  }
}

async function fetchAuxRealtimeInner(site: SiteRecord, refreshMode: 'auto' | 'force'): Promise<AuxRealtimeBundle> {
  const refreshed = await maybeRefreshSiteRealtime(site, refreshMode);
  const devices = await getAuxDevices(refreshed.site);
  const client = pickOnDemandClient();
  const realtimeByType: Partial<Record<AuxDeviceType, HuaweiRealtimeRow[]>> = {};
  let fetchFailed = false;

  for (const devTypeId of AUX_DEVICE_TYPES) {
    const ids = devices
      .filter((device) => Number(device.devTypeId) === devTypeId)
      .map((device) => String(device.id))
      .filter(Boolean);

    if (ids.length === 0) continue;

    try {
      const response: any = await client.getDevRealKpi({ devTypeId, devIds: ids });
      if (response?.success && Array.isArray(response?.data)) {
        realtimeByType[devTypeId] = response.data as HuaweiRealtimeRow[];
      } else {
        const failCode = response?.failCode ?? 'unknown';
        console.warn(`⚠️ [HomeRealtime] getDevRealKpi failed for devType=${devTypeId} plant=${site.plantCode} failCode=${failCode}`);
        fetchFailed = true;
      }
    } catch (err: any) {
      console.warn(`⚠️ [HomeRealtime] getDevRealKpi error for devType=${devTypeId} plant=${site.plantCode}:`, err?.message ?? err);
      fetchFailed = true;
    }
  }

  const bundle: AuxRealtimeBundle = {
    site: refreshed.site,
    siteRefresh: refreshed.refresh,
    devices,
    realtimeByType,
    fetchedAt: new Date().toISOString(),
  };

  // If some device fetches failed, check if we have a richer stale cache to prefer
  if (fetchFailed) {
    const stale = auxRealtimeCache.get(site.plantCode);
    if (stale) {
      const staleTypeCount = Object.keys(stale.value.realtimeByType).length;
      const freshTypeCount = Object.keys(realtimeByType).length;
      if (staleTypeCount > freshTypeCount) {
        // Merge: keep stale data for device types that failed, use fresh for those that succeeded
        const merged: Partial<Record<AuxDeviceType, HuaweiRealtimeRow[]>> = { ...stale.value.realtimeByType };
        for (const [key, val] of Object.entries(realtimeByType)) {
          merged[Number(key) as AuxDeviceType] = val;
        }
        bundle.realtimeByType = merged;
        console.log(`[HomeRealtime] Merged stale cache (${staleTypeCount} types) with fresh data (${freshTypeCount} types) for plant=${site.plantCode}`);
      }
    }
  }

  auxRealtimeCache.set(site.plantCode, {
    expiresAt: Date.now() + AUX_DEVICE_REALTIME_CACHE_TTL_MS,
    value: bundle,
  });

  return bundle;
}

async function fetchAuxRealtime(site: SiteRecord, refreshMode: 'auto' | 'force'): Promise<AuxRealtimeBundle> {
  const cached = auxRealtimeCache.get(site.plantCode);
  if (refreshMode !== 'force' && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  // Coalesce concurrent requests for the same site (use plantCode only to avoid duplicate fetches)
  const inflightKey = site.plantCode;
  const pending = auxRealtimeInflight.get(inflightKey);
  if (pending) return pending;

  const task = fetchAuxRealtimeInner(site, refreshMode)
    .catch((err) => {
      // On total failure, return stale cache if available
      if (cached) {
        console.warn(`⚠️ [HomeRealtime] fetchAuxRealtime failed for plant=${site.plantCode}, returning stale cache:`, err?.message ?? err);
        return cached.value;
      }
      throw err;
    })
    .finally(() => {
      auxRealtimeInflight.delete(inflightKey);
    });

  auxRealtimeInflight.set(inflightKey, task);
  return task;
}

function firstRealtime(bundle: AuxRealtimeBundle, devTypeId: AuxDeviceType): HuaweiRealtimeRow | null {
  const rows = bundle.realtimeByType[devTypeId];
  return rows && rows.length > 0 ? rows[0] : null;
}

function toSignedGridPowerKw(activePowerW: number | null): number | null {
  if (activePowerW == null) return null;
  return roundValue(activePowerW / 1000, 3);
}

function toSignedBatteryPowerKw(row: HuaweiRealtimeRow | null): { powerKw: number | null; direction: 'charge' | 'discharge' | 'idle'; statusText: string | null } {
  if (!row) return { powerKw: null, direction: 'idle', statusText: null };

  const map = row.dataItemMap ?? {};
  const rawPowerW = parseNum(map.ch_discharge_power);
  const batteryStatus = parseNum(map.battery_status);

  let signedPowerKw = rawPowerW != null ? rawPowerW / 1000 : null;
  let direction: 'charge' | 'discharge' | 'idle' = 'idle';

  if (batteryStatus === 4) {
    direction = 'discharge';
    signedPowerKw = rawPowerW != null ? Math.abs(rawPowerW) / 1000 : null;
  } else if (batteryStatus === 5) {
    direction = 'charge';
    signedPowerKw = rawPowerW != null ? -Math.abs(rawPowerW) / 1000 : null;
  } else if (rawPowerW != null) {
    if (rawPowerW > 0) direction = 'discharge';
    if (rawPowerW < 0) direction = 'charge';
    signedPowerKw = rawPowerW / 1000;
  }

  const statusText =
    batteryStatus === 0
      ? 'Offline'
      : batteryStatus === 1
        ? 'Standby'
        : batteryStatus === 2
          ? 'Running'
          : batteryStatus === 3
            ? 'Fault'
            : batteryStatus === 4
              ? 'Discharge'
              : batteryStatus === 5
                ? 'Charge'
                : null;

  return {
    powerKw: roundValue(signedPowerKw, 3),
    direction,
    statusText,
  };
}

function connectionText(runState: number | null): string {
  if (runState == null) return 'Unknown';
  return runState === 0 ? 'Disconnected' : 'Connect';
}

export async function getEnergyManagementSeries(siteId: number, opts?: { view?: MonitoringView; date?: string | null }) {
  const site = await getSiteOrThrow(siteId);
  const view: MonitoringView = opts?.view ?? 'day';
  const anchor = parseRequestedAnchor(view, opts?.date ?? null);
  let endpoint = '/thirdData/getKpiStationHour';
  let start = startOfDay(anchor);
  let end = addDays(start, 1);
  let collectTime = new Date(start);
  collectTime.setHours(12, 0, 0, 0);

  if (view === 'month') {
    start = startOfMonth(anchor);
    end = addMonths(start, 1);
    endpoint = '/thirdData/getKpiStationDay';
    collectTime = new Date(anchor.getFullYear(), anchor.getMonth(), 15, 12, 0, 0, 0);
  }

  if (view === 'year') {
    start = startOfYear(anchor);
    end = addYears(start, 1);
    endpoint = '/thirdData/getKpiStationMonth';
    collectTime = new Date(anchor.getFullYear(), 5, 15, 12, 0, 0, 0);
  }

  if (view === 'lifetime') {
    const baseline = site.gridConnectionDate ?? anchor;
    start = startOfYear(baseline);
    end = addYears(startOfYear(anchor), 1);
    endpoint = '/thirdData/getKpiStationYear';
    collectTime = new Date(anchor.getFullYear(), 5, 15, 12, 0, 0, 0);
  }

  const response: any = await getCachedPlantKpi({
    endpoint,
    stationCodes: site.plantCode,
    collectTime: collectTime.getTime(),
  });

  const failCode = Number(response?.failCode);
  if (Number.isFinite(failCode) && failCode !== 0) {
    console.warn(`⚠️ [EnergyManagement] Huawei ${endpoint} failCode=${failCode} for station ${site.plantCode}`);
  }

  const rawRows: any[] = Array.isArray(response?.data) ? response.data : [];
  const mapped = rawRows.map(mapGraphPoint).filter(Boolean) as GraphPoint[];

  let points: GraphPoint[];
  if (view === 'day') {
    const skeleton = buildDaySkeleton(start);
    const byKey = new Map(mapped.map((point) => [bucketKey(view, new Date(point.timestamp)), withLabel(point, view)] as const));
    points = skeleton.map((point) => byKey.get(bucketKey(view, new Date(point.timestamp))) ?? point);
  } else {
    points = mapped
      .map((point) => withLabel(point, view))
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  return {
    siteId: site.id,
    plantCode: site.plantCode,
    plantName: site.name,
    view,
    endpoint,
    collectTime: collectTime.getTime(),
    range: {
      start: toIso(start),
      end: toIso(end),
      requestedDate: opts?.date ?? null,
    },
    units: {
      pvOutput: view === 'day' ? 'kWh per hour (~avg kW)' : 'kWh',
      powerOfGrid: view === 'day' ? 'kWh per hour (~avg kW)' : 'kWh',
      consumptionPower: view === 'day' ? 'kWh per hour (~avg kW)' : 'kWh',
      consumedFromPv: view === 'day' ? 'kWh per hour (~avg kW)' : 'kWh',
      batteryCharge: 'kWh',
      batteryDischarge: 'kWh',
      irradiance: view === 'day' ? 'kWh/m²' : 'kWh/m²',
    },
    points,
    _debug: {
      huaweiFailCode: Number.isFinite(Number(response?.failCode)) ? Number(response.failCode) : null,
      huaweiRowCount: rawRows.length,
      mappedPointCount: mapped.length,
    },
  };
}

export async function getMonitoringHomeRealtime(siteId: number, opts?: { refresh?: 'auto' | 'force' }) {
  const site = await getSiteOrThrow(siteId);
  const bundle = await fetchAuxRealtime(site, opts?.refresh ?? 'auto');

  const meter = firstRealtime(bundle, DEV_TYPE_GRID_METER) ?? firstRealtime(bundle, DEV_TYPE_POWER_SENSOR);
  const emi = firstRealtime(bundle, DEV_TYPE_EMI);
  const battery = firstRealtime(bundle, DEV_TYPE_RESIDENTIAL_BATTERY) ?? firstRealtime(bundle, DEV_TYPE_ESS);

  const meterMap = (meter?.dataItemMap ?? {}) as Record<string, unknown>;
  const emiMap = (emi?.dataItemMap ?? {}) as Record<string, unknown>;
  const batteryMap = (battery?.dataItemMap ?? {}) as Record<string, unknown>;
  const siteRealtimeMap = ((bundle.site.siteRealtimeRaw as any)?.dataItemMap ?? {}) as Record<string, unknown>;

  const pvPowerKw = roundValue(bundle.site.currentPowerKW ?? 0, 3) ?? 0;
  const gridSignedPowerKw = toSignedGridPowerKw(parseNum(meterMap.active_power));
  const batterySigned = toSignedBatteryPowerKw(battery);
  const loadPowerKw = roundValue(Math.max(0, pvPowerKw + (gridSignedPowerKw ?? 0) + (batterySigned.powerKw ?? 0)), 3);

  const meterVoltage = roundValue(parseNum(meterMap.a_u) ?? parseNum(meterMap.meter_u), 2);
  const meterCurrent = roundValue(parseNum(meterMap.a_i) ?? parseNum(meterMap.meter_i), 2);
  const meterPowerKw = roundValue((parseNum(meterMap.active_power) ?? 0) / 1000, 3);
  const meterRunState = parseNum(meterMap.run_state) ?? parseNum(meterMap.meter_status);

  const batterySoc = roundValue(parseNum(batteryMap.battery_soc), 2);
  const batteryTemp = roundValue(parseNum(emiMap.temperature) ?? parseNum(emiMap.pv_temperature), 1);

  const irradianceWm2 = roundValue(parseNum(meterMap.radiant_line), 2);
  const irradianceTempC = roundValue(parseNum(emiMap.pv_temperature) ?? parseNum(emiMap.temperature), 1);

  const weatherWind = roundValue(parseNum(meterMap.wind_speed), 2);
  const weatherTemp = roundValue(parseNum(emiMap.temperature), 1);
  const weatherHumidity = roundValue(parseNum(emiMap.humidity) ?? parseNum(meterMap.humidity), 1);

  return {
    siteId: bundle.site.id,
    plantCode: bundle.site.plantCode,
    plantName: bundle.site.name,
    fetchedAt: bundle.fetchedAt,
    siteRefresh: bundle.siteRefresh,
    energyFlow: {
      pv: {
        powerKw: pvPowerKw,
      },
      grid: {
        powerKw: roundValue(Math.abs(gridSignedPowerKw ?? 0), 3) ?? 0,
        signedPowerKw: gridSignedPowerKw,
        direction: gridSignedPowerKw == null ? 'idle' : gridSignedPowerKw >= 0 ? 'import' : 'export',
      },
      battery: {
        powerKw: roundValue(Math.abs(batterySigned.powerKw ?? 0), 3) ?? 0,
        signedPowerKw: batterySigned.powerKw,
        direction: batterySigned.direction,
        socPct: batterySoc,
      },
      load: {
        powerKw: loadPowerKw,
      },
      balanceKw: roundValue((pvPowerKw ?? 0) + (gridSignedPowerKw ?? 0) + (batterySigned.powerKw ?? 0) - (loadPowerKw ?? 0), 3),
    },
    summaryCards: {
      meterMain: {
        voltageV: meterVoltage,
        currentA: meterCurrent,
        powerKw: meterPowerKw,
        status: connectionText(meterRunState),
      },
      battery: {
        socPct: batterySoc,
        tempC: batteryTemp,
        powerKw: roundValue(Math.abs(batterySigned.powerKw ?? 0), 3),
        direction: batterySigned.direction,
        status: batterySigned.statusText ?? (battery ? 'Normal' : 'No data'),
      },
      solarIrradiance: {
        irradianceWm2: irradianceWm2,
        tempC: irradianceTempC,
        status: meter || emi ? 'Online' : 'No data',
      },
      weatherStation: {
        windSpeedMs: weatherWind,
        tempC: weatherTemp,
        humidityRh: weatherHumidity,
        status: meter || emi ? 'Normal' : 'No data',
      },
    },
    supportingData: {
      siteRealtime: {
        dayEnergyKWh: roundValue(parseNum(siteRealtimeMap.day_power), 3),
        dayUseEnergyKWh: roundValue(parseNum(siteRealtimeMap.day_use_energy), 3),
        dayOnGridEnergyKWh: roundValue(parseNum(siteRealtimeMap.day_on_grid_energy), 3),
      },
      deviceAvailability: {
        meter: !!meter,
        emi: !!emi,
        battery: !!battery,
      },
    },
  };
}
