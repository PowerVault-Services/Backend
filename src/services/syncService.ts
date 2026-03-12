import prisma from '../config/prisma';
import { callWithFailover, HuaweiDevice, HuaweiService } from './huaweiService';
import { huaweiClients, pickBulkClient, pickOnDemandClient } from './huaweiPool';

type SiteLite = {
  id: number;
  plantCode: string;
  name: string;
  deviceMetaSyncedAt: Date | null;
};

type DeviceTarget = {
  devId: string;
  devTypeId: number;
  serialNumber: string;
  devName: string;
  model: string;
  softwareVersion?: string | null;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function snapTsNow(slotMs: number): Date {
  const t = Date.now();
  const slot = Math.floor(t / slotMs) * slotMs;
  return new Date(slot);
}

function startOfLocalDay(d = new Date()): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function parseNum(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function deriveStringStatus(voltage: number | null, current: number | null): 'Normal' | 'Lost' | 'Disconnected' {
  if (voltage == null && current == null) return 'Disconnected';
  const v = voltage ?? 0;
  const i = current ?? 0;
  if (v > 50 && i < 0.05) return 'Lost';
  return 'Normal';
}

const FAULT_RUN_STATES = new Set(
  String(process.env.HUAWEI_FAULT_RUN_STATES ?? '3,4,5,6,7,8,9,10')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
);

function deriveInverterStatus(runState: number | null | undefined): 'Normal' | 'Fault' | 'Disconnected' {
  if (runState == null) return 'Disconnected';
  if (FAULT_RUN_STATES.has(Number(runState))) return 'Fault';
  return 'Normal';
}

const MAX_DEVICE_PLANTS_PER_TICK = Number(
  process.env.HUAWEI_MAX_DEVICE_PLANTS_PER_TICK ?? process.env.HUAWEI_MAX_PLANTS_PER_TICK ?? 2
);
const DEV_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_DEV_BATCH_SIZE ?? 100)));
const SITE_REALTIME_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_SITE_REALTIME_BATCH_SIZE ?? 100)));
const MIN_TICK_INTERVAL_MS = Number(process.env.HUAWEI_MIN_TICK_INTERVAL_MS ?? 60_000);
const SNAPSHOT_SLOT_MS = Number(process.env.HUAWEI_SNAPSHOT_SLOT_MS ?? 5 * 60_000);
const STATION_CACHE_TTL_MS = Number(process.env.HUAWEI_STATION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const DEVICE_META_TTL_MS = Number(process.env.HUAWEI_DEVICE_META_TTL_MS ?? 24 * 60 * 60 * 1000);
const STRING_SLOT_COUNT = Math.min(36, Math.max(1, Number(process.env.HUAWEI_STRING_SLOT_COUNT ?? 36)));

const PERSONAL_RATE_LIMIT_PAUSE_MS = Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 5 * 60_000);
const SYSTEM_BUSY_PAUSE_MS = Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60_000);

const INVERTER_DEV_TYPE_IDS = new Set(
  String(process.env.HUAWEI_INVERTER_DEV_TYPE_IDS ?? '351,1')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
);

const DEBUG = String(process.env.SYNC_DEBUG ?? '').trim() === '1';

let lastTickAt = 0;
let deviceSyncCursor = 0;
let stationCache: { expiresAt: number; stationCodes: string[] } | null = null;
const retryQueue: string[] = [];

function enqueueRetry(stationCode: string) {
  if (!retryQueue.includes(stationCode)) retryQueue.unshift(stationCode);
}

function pickStationCode(input: any): string | null {
  return (input?.plantCode ?? input?.stationCode)?.toString() ?? null;
}

function handleFailCode(client: HuaweiService, failCode: any, context: string, stationCode?: string): boolean {
  const code = Number(failCode);
  if (!Number.isFinite(code)) return false;

  if (code === 407) {
    console.warn(`🚫 ${context} rate-limited (407) ${stationCode ? `station=${stationCode}` : ''}`);
    if (stationCode) enqueueRetry(stationCode);
    client.notifyRateLimit({ kind: 'personal', delayMs: PERSONAL_RATE_LIMIT_PAUSE_MS, reason: `${context} failCode=407` });
    return true;
  }

  if (code === 403 || code === 429) {
    console.warn(`⛔ ${context} system busy (${code}) ${stationCode ? `station=${stationCode}` : ''}`);
    if (stationCode) enqueueRetry(stationCode);
    client.notifyRateLimit({ kind: 'system', delayMs: SYSTEM_BUSY_PAUSE_MS, reason: `${context} failCode=${code}` });
    return true;
  }

  if (code === 305) {
    console.warn(`🔑 ${context} token expired (305) ${stationCode ? `station=${stationCode}` : ''}`);
    if (stationCode) enqueueRetry(stationCode);
    client.ensureLoggedIn({ force: true }).catch(() => undefined);
    return true;
  }

  return false;
}

async function refreshStationsIfNeeded(): Promise<string[]> {
  const now = Date.now();
  if (stationCache && now < stationCache.expiresAt && stationCache.stationCodes.length > 0) {
    return stationCache.stationCodes;
  }

  const stationClient = huaweiClients.backup;

  try {
    const stationCodes: string[] = [];
    let pageNo = 1;
    const pageSize = Math.min(100, Math.max(1, Number(process.env.HUAWEI_STATION_PAGE_SIZE ?? 100)));

    while (true) {
      const res = await stationClient.stations({ pageNo, pageSize });
      if (!res?.success) {
        if (handleFailCode(stationClient, res?.failCode, 'stations')) break;
        throw new Error(`stations failed (failCode=${res?.failCode}): ${res?.message ?? 'unknown'}`);
      }

      const list: any[] = res?.data?.list ?? [];
      const pageCount = Number(res?.data?.pageCount ?? 0);
      if (list.length === 0) break;

      for (const st of list) {
        const code = pickStationCode(st);
        if (!code) continue;
        stationCodes.push(code);

        await prisma.site.upsert({
          where: { plantCode: code },
          create: {
            plantCode: code,
            name: (st.plantName ?? st.stationName ?? code).toString(),
            address: (st.plantAddress ?? st.stationAddr ?? undefined) as any,
            latitude: st.latitude != null ? Number(st.latitude) : undefined,
            longitude: st.longitude != null ? Number(st.longitude) : undefined,
            capacityKWp: st.capacity != null ? Number(st.capacity) : 0,
            gridConnectionDate: parseDate(st.gridConnectionDate) ?? undefined,
            siteMetaSyncedAt: new Date(),
          },
          update: {
            name: (st.plantName ?? st.stationName ?? code).toString(),
            address: (st.plantAddress ?? st.stationAddr ?? undefined) as any,
            latitude: st.latitude != null ? Number(st.latitude) : undefined,
            longitude: st.longitude != null ? Number(st.longitude) : undefined,
            capacityKWp: st.capacity != null ? Number(st.capacity) : undefined,
            gridConnectionDate: parseDate(st.gridConnectionDate) ?? undefined,
            siteMetaSyncedAt: new Date(),
          },
        } as any);
      }

      if (pageCount > 0) {
        if (pageNo >= pageCount) break;
        pageNo += 1;
      } else {
        if (list.length < pageSize) break;
        pageNo += 1;
      }
    }

    const uniq = Array.from(new Set(stationCodes));
    stationCache = { expiresAt: now + STATION_CACHE_TTL_MS, stationCodes: uniq };
    console.log(`✅ Station cache refreshed: ${uniq.length} stations (ttl=${STATION_CACHE_TTL_MS}ms)`);
    return uniq;
  } catch (e: any) {
    console.warn('⚠️ Cannot refresh stations from Huawei (will fallback to DB):', e?.message ?? e);
    const sites = (await prisma.site.findMany({ select: { plantCode: true }, orderBy: [{ createdAt: 'asc' }], take: 5000 } as any)) as any[];
    const codes = sites.map((s) => s.plantCode).filter(Boolean);
    stationCache = { expiresAt: now + 10 * 60_000, stationCodes: codes };
    console.log(`✅ Using DB fallback station codes: ${codes.length} stations (short ttl=10min)`);
    return codes;
  }
}

function normalizeDeviceTarget(inv: HuaweiDevice): DeviceTarget | null {
  const devId = inv.id != null ? String(inv.id) : '';
  const devTypeId = Number(inv.devTypeId);
  if (!devId || !Number.isFinite(devTypeId)) return null;
  return {
    devId,
    devTypeId,
    serialNumber: inv.esnCode ? String(inv.esnCode) : `DEV-${devId}`,
    devName: (inv.devName ?? devId).toString(),
    model: (inv.model ?? inv.invType ?? 'UNKNOWN').toString(),
    softwareVersion: inv.softwareVersion ?? null,
  };
}

async function getCachedDeviceTargets(siteId: number): Promise<DeviceTarget[]> {
  const rows = (await prisma.inverter.findMany({
    where: { siteId, huaweiDevId: { not: null }, huaweiDevTypeId: { not: null } },
    select: {
      huaweiDevId: true,
      huaweiDevTypeId: true,
      serialNumber: true,
      name: true,
      model: true,
      softwareVersion: true,
    },
    orderBy: { id: 'asc' },
  } as any)) as any[];

  return rows
    .map((row) => {
      const devId = row.huaweiDevId ? String(row.huaweiDevId) : '';
      const devTypeId = row.huaweiDevTypeId != null ? Number(row.huaweiDevTypeId) : NaN;
      if (!devId || !Number.isFinite(devTypeId)) return null;
      return {
        devId,
        devTypeId,
        serialNumber: row.serialNumber,
        devName: row.name,
        model: row.model,
        softwareVersion: row.softwareVersion,
      } satisfies DeviceTarget;
    })
    .filter(Boolean) as DeviceTarget[];
}

async function ensurePlantDeviceMetadata(site: SiteLite, client: HuaweiService, opts?: { force?: boolean }): Promise<DeviceTarget[]> {
  const force = opts?.force ?? false;
  const now = Date.now();

  const cached = await getCachedDeviceTargets(site.id);
  const isFresh = !!site.deviceMetaSyncedAt && now - site.deviceMetaSyncedAt.getTime() < DEVICE_META_TTL_MS;
  if (!force && isFresh && cached.length > 0) {
    return cached;
  }

  const end4 = await client.getDevList(site.plantCode);
  if (!end4?.success) {
    handleFailCode(client, end4?.failCode, 'getDevList', site.plantCode);
    if (cached.length > 0) {
      console.warn(`⚠️ Falling back to cached device metadata for ${site.plantCode}`);
      return cached;
    }
    throw new Error(`getDevList failed (failCode=${end4?.failCode})`);
  }

  const devices: HuaweiDevice[] = end4?.data ?? [];
  const inverterTargets = devices
    .filter((d) => INVERTER_DEV_TYPE_IDS.has(Number(d.devTypeId)))
    .map(normalizeDeviceTarget)
    .filter(Boolean) as DeviceTarget[];

  for (const inv of inverterTargets) {
    await prisma.inverter.upsert({
      where: { serialNumber: inv.serialNumber },
      create: {
        serialNumber: inv.serialNumber,
        name: inv.devName,
        model: inv.model,
        siteId: site.id,
        huaweiDevId: inv.devId,
        huaweiDevTypeId: inv.devTypeId,
        stationCode: site.plantCode,
        softwareVersion: inv.softwareVersion ?? undefined,
      },
      update: {
        name: inv.devName,
        model: inv.model,
        siteId: site.id,
        huaweiDevId: inv.devId,
        huaweiDevTypeId: inv.devTypeId,
        stationCode: site.plantCode,
        softwareVersion: inv.softwareVersion ?? undefined,
      },
    } as any);
  }

  await prisma.site.update({
    where: { id: site.id },
    data: { deviceMetaSyncedAt: new Date() },
  } as any);

  if (DEBUG) {
    console.log(`🧰 Refreshed device metadata for ${site.plantCode}: ${inverterTargets.length} inverter targets`);
  }

  return inverterTargets.length > 0 ? inverterTargets : cached;
}

async function syncSiteRealtimeBatch(plantCodes: string[], batchIndex: number) {
  if (plantCodes.length === 0) return { synced: 0 };

  const primary = batchIndex % 2 === 0 ? huaweiClients.main : huaweiClients.backup;
  const secondary = batchIndex % 2 === 0 ? huaweiClients.backup : huaweiClients.main;

  const res: any = await callWithFailover(primary, secondary, (svc) => svc.getStationRealKpi(plantCodes), {
    tag: `getStationRealKpi batch=${batchIndex + 1}`,
  });

  if (!res?.success || !Array.isArray(res?.data)) {
    handleFailCode(primary, res?.failCode, 'getStationRealKpi(batch)');
    throw new Error(`getStationRealKpi failed (failCode=${res?.failCode})`);
  }

  const sites = (await prisma.site.findMany({
    where: { plantCode: { in: plantCodes } },
    select: { id: true, plantCode: true },
  } as any)) as any[];
  const byCode = new Map(sites.map((s) => [s.plantCode, s.id] as const));

  for (const row of res.data) {
    const stationCode = String(row?.stationCode ?? '');
    const siteId = byCode.get(stationCode);
    if (!siteId) continue;

    const map = row?.dataItemMap ?? {};
    const dayEnergyKWh = parseNum(map.day_power);
    const monthEnergyKWh = parseNum(map.month_power);
    const totalEnergyKWh = parseNum(map.total_power);
    const dayIncome = parseNum(map.day_income);
    const totalIncome = parseNum(map.total_income);
    const dayOnGridEnergyKWh = parseNum(map.day_on_grid_energy);
    const dayUseEnergyKWh = parseNum(map.day_use_energy);
    const plantHealthState = parseNum(map.real_health_state);
    const currentPowerKW =
      parseNum(map.current_power) ??
      (() => {
        const maybe = parseNum(map.active_power);
        return maybe != null && Math.abs(maybe) <= 10_000 ? maybe : null;
      })();

    await prisma.site.update({
      where: { id: siteId },
      data: {
        ...(currentPowerKW != null ? { currentPowerKW } : {}),
        ...(dayEnergyKWh != null ? { dayEnergyKWh } : {}),
        ...(monthEnergyKWh != null ? { monthEnergyKWh } : {}),
        ...(totalEnergyKWh != null ? { totalEnergyKWh } : {}),
        ...(dayIncome != null ? { dayIncome } : {}),
        ...(totalIncome != null ? { totalIncome } : {}),
        ...(dayOnGridEnergyKWh != null ? { dayOnGridEnergyKWh } : {}),
        ...(dayUseEnergyKWh != null ? { dayUseEnergyKWh } : {}),
        ...(plantHealthState != null ? { plantHealthState } : {}),
        siteRealtimeRaw: row,
        lastPlantSyncAt: new Date(),
      },
    } as any);

    if (dayEnergyKWh != null) {
      await prisma.siteDailyEnergy.upsert({
        where: { siteId_date: { siteId, date: startOfLocalDay() } },
        create: {
          siteId,
          date: startOfLocalDay(),
          energyKWh: dayEnergyKWh,
          raw: row,
        },
        update: {
          energyKWh: dayEnergyKWh,
          raw: row,
        },
      });
    }
  }

  return { synced: res.data.length };
}

async function syncPlantDevices(site: SiteLite, client: HuaweiService, runStateCount: Map<number, number>) {
  const deviceTargets = await ensurePlantDeviceMetadata(site, client);
  if (deviceTargets.length === 0) return { ok: true, inverters: 0, currentPowerKW: null as number | null };

  const groups = new Map<number, string[]>();
  for (const d of deviceTargets) {
    if (!groups.has(d.devTypeId)) groups.set(d.devTypeId, []);
    groups.get(d.devTypeId)!.push(d.devId);
  }

  const ts = snapTsNow(SNAPSHOT_SLOT_MS);
  let siteCurrentPowerKW = 0;
  let hasCurrentPower = false;

  for (const [devTypeId, devIds] of groups.entries()) {
    const batches = chunk(devIds, DEV_BATCH_SIZE);

    for (const batchIds of batches) {
      const end5 = await client.getDevRealKpi({ devTypeId, devIds: batchIds });
      if (!end5?.success || !Array.isArray(end5?.data)) {
        handleFailCode(client, end5?.failCode, 'getDevRealKpi', site.plantCode);
        enqueueRetry(site.plantCode);
        continue;
      }

      for (const item of end5.data) {
        const devId = String(item.devId ?? '');
        const map = item.dataItemMap ?? {};

        const activePowerVal = parseNum(map.active_power);
        const dayEnergy = parseNum(map.day_cap);
        const runState = parseNum(map.run_state);
        const totalEnergy = parseNum(map.total_cap);
        const temperature = parseNum(map.temperature);
        const powerFactor = parseNum(map.power_factor);

        if (runState != null) {
          runStateCount.set(runState, (runStateCount.get(runState) ?? 0) + 1);
        }

        const inv = await prisma.inverter.findFirst({ where: { huaweiDevId: devId, siteId: site.id } });
        if (!inv) continue;

        const derivedStatus = deriveInverterStatus(runState);
        await prisma.inverter.update({
          where: { id: inv.id },
          data: {
            ...(activePowerVal != null ? { activePower: activePowerVal } : {}),
            lastDailyEnergy: dayEnergy ?? inv.lastDailyEnergy,
            status: derivedStatus,
            runState: runState != null ? Math.trunc(runState) : null,
            lastSyncAt: new Date(),
          },
        });

        if (activePowerVal != null) {
          siteCurrentPowerKW += activePowerVal;
          hasCurrentPower = true;
        }

        const snap = await prisma.inverterKpiSnapshot.upsert({
          where: { inverterId_ts: { inverterId: inv.id, ts } },
          create: {
            inverterId: inv.id,
            ts,
            activePower: activePowerVal ?? 0,
            dayEnergy: dayEnergy ?? 0,
            totalEnergy,
            runState: runState != null ? Math.trunc(runState) : null,
            temperature,
            powerFactor,
            raw: item,
          } as any,
          update: {
            activePower: activePowerVal ?? 0,
            dayEnergy: dayEnergy ?? 0,
            totalEnergy,
            runState: runState != null ? Math.trunc(runState) : null,
            temperature,
            powerFactor,
            raw: item,
          } as any,
        });

        const rows: any[] = [];
        for (let n = 1; n <= STRING_SLOT_COUNT; n++) {
          const voltage = parseNum(map[`pv${n}_u`]);
          const current = parseNum(map[`pv${n}_i`]);
          rows.push({
            snapshotId: snap.id,
            stringNo: n,
            voltage,
            current,
            status: deriveStringStatus(voltage, current),
          });
        }

        await prisma.$transaction([
          prisma.inverterStringSnapshot.deleteMany({ where: { snapshotId: snap.id } }),
          prisma.inverterStringSnapshot.createMany({ data: rows }),
        ]);
      }
    }
  }

  if (hasCurrentPower) {
    await prisma.site.update({ where: { id: site.id }, data: { currentPowerKW: siteCurrentPowerKW } } as any);
  }

  return { ok: true, inverters: deviceTargets.length, currentPowerKW: hasCurrentPower ? siteCurrentPowerKW : null };
}

export async function syncSiteRealtimeTick() {
  console.log('⏳ Starting Site Realtime Sync Tick...');
  try {
    await refreshStationsIfNeeded();
    const sites = (await prisma.site.findMany({
      where: { plantCode: { not: '' } },
      select: { plantCode: true },
      orderBy: { plantCode: 'asc' },
      take: 5000,
    } as any)) as any[];

    const plantCodes = sites.map((s) => s.plantCode).filter(Boolean);
    if (plantCodes.length === 0) {
      console.log('⚠️ No sites to sync for site realtime.');
      return;
    }

    const batches = chunk(plantCodes, SITE_REALTIME_BATCH_SIZE);
    let totalSynced = 0;
    for (let i = 0; i < batches.length; i++) {
      const result = await syncSiteRealtimeBatch(batches[i], i);
      totalSynced += result.synced;
    }

    console.log(`✅ Site realtime sync done: ${totalSynced} rows across ${batches.length} batches`);
  } catch (error: any) {
    console.error('❌ Site realtime sync failed:', error?.message ?? error);
  }
}

export const syncMonitoringTick = async () => {
  console.log('⏳ Starting Device Sync Tick...');

  const now = Date.now();
  if (lastTickAt && now - lastTickAt < MIN_TICK_INTERVAL_MS) {
    console.log(`⏭️ Skip device sync tick (min interval ${MIN_TICK_INTERVAL_MS}ms not reached)`);
    return;
  }
  lastTickAt = now;

  const runStateCount = new Map<number, number>();

  try {
    const stationCodes = await refreshStationsIfNeeded();
    if (stationCodes.length === 0) {
      console.log('⚠️ No station codes available for device sync.');
      return;
    }

    const picked = new Set<string>();
    while (picked.size < MAX_DEVICE_PLANTS_PER_TICK && retryQueue.length > 0) {
      const code = retryQueue.shift();
      if (code) picked.add(code);
    }

    while (picked.size < MAX_DEVICE_PLANTS_PER_TICK && stationCodes.length > 0) {
      const code = stationCodes[deviceSyncCursor % stationCodes.length];
      deviceSyncCursor = (deviceSyncCursor + 1) % Math.max(stationCodes.length, 1);
      picked.add(code);
      if (picked.size >= stationCodes.length) break;
    }

    if (picked.size === 0) {
      console.log('⚠️ No sites selected for device sync.');
      return;
    }

    const sites = ((await prisma.site.findMany({
      where: { plantCode: { in: Array.from(picked) } },
      select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
      orderBy: { plantCode: 'asc' },
    } as any)) as unknown) as SiteLite[];

    for (const site of sites) {
      const client = pickBulkClient(site.plantCode);
      console.log(`🔁 [${(client as any).label ?? 'BULK'}] Sync device detail for ${site.plantCode} (${site.name ?? ''})`);
      try {
        const r = await syncPlantDevices(site, client, runStateCount);
        console.log(`✅ Device sync done for ${site.plantCode}: ${r.inverters} inverter targets`);
      } catch (e: any) {
        enqueueRetry(site.plantCode);
        console.warn(`⚠️ Device sync failed for ${site.plantCode}:`, e?.message ?? e);
      }
    }
  } catch (error: any) {
    console.error('❌ Device Sync Tick Failed:', error?.message ?? error);
  } finally {
    console.log('📊 Huawei API call summary:', {
      MAIN: huaweiClients.main.getStats(),
      BACKUP: huaweiClients.backup.getStats(),
      ALARM: huaweiClients.alarm.getStats(),
      ONDEMAND: huaweiClients.ondemand.getStats(),
    });

    if (runStateCount.size > 0) {
      const top = Array.from(runStateCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      console.log(`📈 run_state distribution (top): ${top}`);
      console.log(`ℹ️ Tune fault mapping via env: HUAWEI_FAULT_RUN_STATES=\"...\"`);
    }

    if (DEBUG) {
      console.log('📌 retryQueue size:', retryQueue.length, retryQueue.slice(0, 10));
    }
  }
};

export const syncInverterData = syncMonitoringTick;

export async function syncPlantOnDemand(plantCode: string) {
  const client = pickOnDemandClient();
  const site = (await prisma.site.findUnique({
    where: { plantCode },
    select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
  } as any)) as SiteLite | null;
  if (!site) throw new Error(`Site not found for plantCode=${plantCode}`);

  console.log(`⚡ [ONDEMAND] Refresh plant ${plantCode} (${site.name ?? ''})`);

  try {
    await syncSiteRealtimeBatch([plantCode], 0);
  } catch (e: any) {
    console.warn(`⚠️ [ONDEMAND] Site realtime refresh failed for ${plantCode}:`, e?.message ?? e);
  }

  const runStateCount = new Map<number, number>();
  const result = await syncPlantDevices(site, client, runStateCount);
  return { ok: true, plantCode, inverters: result.inverters, currentPowerKW: result.currentPowerKW };
}
