import prisma from '../config/prisma';
import { createLogger } from '../config/logger';
import { HuaweiDevice, HuaweiService } from './huaweiService';

const log = createLogger('sync');

export interface SyncDeps {
  prisma: typeof prisma;
  log: ReturnType<typeof createLogger>;
}

export const syncDeps: SyncDeps = { prisma, log };
import {
  describeHuaweiClient,
  getPreferredClientOrderForPurpose,
  getStationClientCandidates,
  getStationInventoryClients,
  hasKnownHuaweiStationInventory,
  isKnownHuaweiStationCode,
  huaweiClients,
  noteStationFailure,
  pickOnDemandClient,
  registerStationAccess,
  registerStationBatchAccess,
  replaceKnownHuaweiStationCodes,
  resolveDynamicDevicePlantsPerTick,
} from './huaweiPool';
import { getStalestStationCodes, getStationLastSeenMs, getSyncStateSnapshot, markStations } from './syncStateService';

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

export type SyncPlantOnDemandOptions = {
  includeSiteRealtime?: boolean;
  forceSiteRealtime?: boolean;
  includeInventory?: boolean;
  forceInventory?: boolean;
  includeDeviceDetail?: boolean;
  forceDeviceDetail?: boolean;
};

type SyncPlantDevicesOptions = {
  includeInventory?: boolean;
  forceInventory?: boolean;
  includeDeviceDetail?: boolean;
  forceDeviceDetail?: boolean;
};

type SyncPlantDevicesResult = {
  ok: boolean;
  inverters: number;
  currentPowerKW: number | null;
  usedCachedInventory?: boolean;
  skippedDeviceDetail?: boolean;
  clientLabel?: string;
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

const SYNC_TIMEZONE = process.env.HUAWEI_SYNC_TIMEZONE ?? 'Asia/Bangkok';

function startOfLocalDay(d = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SYNC_TIMEZONE,
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(d);
  const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const s = Number(parts.find((p) => p.type === 'second')?.value ?? 0);
  return new Date(d.getTime() - (h * 3_600_000 + m * 60_000 + s * 1_000 + d.getMilliseconds()));
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

const DEV_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_DEV_BATCH_SIZE ?? 100)));
const SITE_REALTIME_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_SITE_REALTIME_BATCH_SIZE ?? 100)));
const SITE_REALTIME_CONCURRENCY = Math.max(1, Math.min(4, Number(process.env.HUAWEI_SITE_REALTIME_CONCURRENCY ?? 2)));
const MIN_TICK_INTERVAL_MS = Number(process.env.HUAWEI_MIN_TICK_INTERVAL_MS ?? 60_000);
const SNAPSHOT_SLOT_MS = Number(process.env.HUAWEI_SNAPSHOT_SLOT_MS ?? 5 * 60_000);
const STATION_CACHE_TTL_MS = Number(process.env.HUAWEI_STATION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const DEVICE_META_TTL_MS = Number(process.env.HUAWEI_DEVICE_META_TTL_MS ?? 24 * 60 * 60 * 1000);
const STRING_SLOT_COUNT = Math.min(36, Math.max(1, Number(process.env.HUAWEI_STRING_SLOT_COUNT ?? 36)));

const PERSONAL_RATE_LIMIT_PAUSE_MS = Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 5 * 60_000);
const SYSTEM_BUSY_PAUSE_MS = Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60_000);
const DEVICE_SYNC_CONCURRENCY = Math.max(1, Number(process.env.HUAWEI_DEVICE_SYNC_CONCURRENCY ?? getPreferredClientOrderForPurpose('device').length));

const INVERTER_DEV_TYPE_IDS = new Set(
  String(process.env.HUAWEI_INVERTER_DEV_TYPE_IDS ?? '351,1')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x))
);

// ── Backpressure: tracks recent error rate to adaptively throttle sync ──

type BackpressureLevel = 'none' | 'light' | 'heavy' | 'critical';

const BACKPRESSURE_WINDOW_MS = 5 * 60_000; // 5-min sliding window
const recentErrors: number[] = [];          // timestamps of recent errors
let recentRequests = 0;                     // total requests in current window

function recordSyncOutcome(success: boolean) {
  const now = Date.now();
  recentRequests++;
  if (!success) recentErrors.push(now);
  // Prune old entries outside window
  const cutoff = now - BACKPRESSURE_WINDOW_MS;
  while (recentErrors.length > 0 && recentErrors[0] < cutoff) recentErrors.shift();
}

function getBackpressureLevel(): BackpressureLevel {
  const errorCount = recentErrors.length;
  const queueRatio = retryQueue.size / RETRY_QUEUE_MAX;
  const errorRate = recentRequests > 0 ? errorCount / Math.max(recentRequests, 1) : 0;

  // Critical: queue > 80% full OR error rate > 50%
  if (queueRatio > 0.8 || errorRate > 0.5) return 'critical';
  // Heavy: queue > 50% full OR error rate > 30%
  if (queueRatio > 0.5 || errorRate > 0.3) return 'heavy';
  // Light: queue > 20% full OR error rate > 10%
  if (queueRatio > 0.2 || errorRate > 0.1) return 'light';
  return 'none';
}

function getBackpressureMultiplier(): number {
  switch (getBackpressureLevel()) {
    case 'critical': return 0.25;  // 25% of normal throughput
    case 'heavy':    return 0.5;   // 50%
    case 'light':    return 0.75;  // 75%
    case 'none':     return 1.0;   // full speed
  }
}

function resetBackpressureWindow() {
  recentErrors.length = 0;
  recentRequests = 0;
}

let lastTickAt = 0;
let deviceSyncCursor = 0;
let tickRunning = false; // Guard against overlapping syncMonitoringTick calls
let stationCache: { expiresAt: number; stationCodes: string[] } | null = null;
const RETRY_QUEUE_MAX = Math.max(10, Math.min(5000, Number(process.env.HUAWEI_RETRY_QUEUE_MAX ?? 500)));
const retryQueue = new Set<string>();
const onDemandSyncInflight = new Map<string, Promise<any>>();

function enqueueRetry(stationCode: string) {
  // Re-add to move to end (Set preserves insertion order)
  retryQueue.delete(stationCode);
  retryQueue.add(stationCode);
  // Evict oldest if over limit
  if (retryQueue.size > RETRY_QUEUE_MAX) {
    const oldest = retryQueue.values().next().value;
    if (oldest) retryQueue.delete(oldest);
  }
  markRetryQueueDirty();
}

// ── Retry queue DB persistence (survives process restart) ──

const RETRY_QUEUE_JOB_NAME = 'retryQueue';
let retryQueueDirty = false;

function markRetryQueueDirty() { retryQueueDirty = true; }

async function persistRetryQueue(): Promise<void> {
  if (!retryQueueDirty && retryQueue.size === 0) return;
  try {
    const payload = Array.from(retryQueue);
    await prisma.huaweiSyncJob.upsert({
      where: { jobName: RETRY_QUEUE_JOB_NAME },
      create: { jobName: RETRY_QUEUE_JOB_NAME, lastResult: { queue: payload, savedAt: new Date().toISOString() } },
      update: { lastResult: { queue: payload, savedAt: new Date().toISOString() } },
    });
    retryQueueDirty = false;
    log.debug('Retry queue persisted', { size: payload.length });
  } catch (e: any) {
    log.warn('Failed to persist retry queue', { error: e?.message ?? e });
  }
}

async function restoreRetryQueue(): Promise<void> {
  try {
    const row = await prisma.huaweiSyncJob.findUnique({ where: { jobName: RETRY_QUEUE_JOB_NAME } }) as any;
    const saved: string[] = Array.isArray((row?.lastResult as any)?.queue) ? (row.lastResult as any).queue : [];
    if (saved.length === 0) return;
    for (const code of saved) {
      if (typeof code === 'string' && code) retryQueue.add(code);
    }
    log.info('Retry queue restored from DB', { size: retryQueue.size });
  } catch (e: any) {
    log.warn('Failed to restore retry queue', { error: e?.message ?? e });
  }
}

function normalizeOnDemandOptions(opts?: SyncPlantOnDemandOptions) {
  const includeSiteRealtime = opts?.includeSiteRealtime ?? true;
  const includeInventory = opts?.includeInventory ?? true;
  const includeDeviceDetail = opts?.includeDeviceDetail ?? true;

  return {
    includeSiteRealtime,
    forceSiteRealtime: opts?.forceSiteRealtime ?? false,
    includeInventory,
    forceInventory: opts?.forceInventory ?? false,
    includeDeviceDetail,
    forceDeviceDetail: opts?.forceDeviceDetail ?? false,
  } satisfies Required<SyncPlantOnDemandOptions>;
}

function makeOnDemandInflightKey(plantCode: string, opts?: SyncPlantOnDemandOptions) {
  const normalized = normalizeOnDemandOptions(opts);
  return `${plantCode}::${JSON.stringify(normalized)}`;
}

function pickStationCode(input: any): string | null {
  return (input?.plantCode ?? input?.stationCode)?.toString() ?? null;
}

function handleFailCode(client: HuaweiService, failCode: any, context: string, stationCode?: string): boolean {
  const code = Number(failCode);
  if (!Number.isFinite(code)) return false;

  if (code === 407) {
    log.warn(`${context} rate-limited (407)`, { stationCode, failCode: 407 });
    if (stationCode) enqueueRetry(stationCode);
    client.notifyRateLimit({ kind: 'personal', delayMs: PERSONAL_RATE_LIMIT_PAUSE_MS, reason: `${context} failCode=407` });
    return true;
  }

  if (code === 403 || code === 429) {
    log.warn(`${context} system busy`, { stationCode, failCode: code });
    if (stationCode) enqueueRetry(stationCode);
    client.notifyRateLimit({ kind: 'system', delayMs: SYSTEM_BUSY_PAUSE_MS, reason: `${context} failCode=${code}` });
    return true;
  }

  if (code === 305) {
    log.warn(`${context} token expired (305)`, { stationCode });
    if (stationCode) enqueueRetry(stationCode);
    client.ensureLoggedIn({ force: true }).catch(() => undefined);
    return true;
  }

  return false;
}

async function refreshStationsIfNeeded(force = false): Promise<string[]> {
  const now = Date.now();
  if (!force && stationCache && now < stationCache.expiresAt && stationCache.stationCodes.length > 0) {
    replaceKnownHuaweiStationCodes(stationCache.stationCodes);
    return stationCache.stationCodes;
  }

  const stationClients = getStationInventoryClients();
  const stationCodes = new Set<string>();
  const pageSize = Math.min(100, Math.max(1, Number(process.env.HUAWEI_STATION_PAGE_SIZE ?? 100)));
  let successfulClients = 0;

  for (const stationClient of stationClients) {
    let pageNo = 1;
    let fetchedForClient = 0;

    try {
      while (true) {
        const res = await stationClient.stations({ pageNo, pageSize });
        if (!res?.success) {
          handleFailCode(stationClient, res?.failCode, 'stations');
          throw new Error(`stations failed (failCode=${res?.failCode}): ${res?.message ?? 'unknown'}`);
        }

        const list: any[] = res?.data?.list ?? [];
        const pageCount = Number(res?.data?.pageCount ?? 0);
        if (list.length === 0) break;

        const validStations = list
          .map((st) => ({ st, code: pickStationCode(st) }))
          .filter((x): x is { st: any; code: string } => !!x.code);

        if (validStations.length > 0) {
          await prisma.$transaction(
            validStations.map(({ st, code }) =>
              prisma.site.upsert({
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
              } as any)
            )
          );

          for (const { code } of validStations) {
            stationCodes.add(code);
            registerStationAccess(code, stationClient);
          }
          fetchedForClient += validStations.length;
        }

        if (pageCount > 0) {
          if (pageNo >= pageCount) break;
          pageNo += 1;
        } else {
          if (list.length < pageSize) break;
          pageNo += 1;
        }
      }

      if (fetchedForClient > 0) {
        successfulClients += 1;
      }
      log.info('Station inventory fetched', { client: describeHuaweiClient(stationClient), rows: fetchedForClient });
    } catch (e: any) {
      log.warn('Cannot refresh stations', { client: describeHuaweiClient(stationClient), error: e?.message ?? e });
    }
  }

  // เติม station codes จาก DB เสมอ — กรณี API ได้ไม่ครบ (407 ก่อนดึงทุก page)
  const dbSites = (await prisma.site.findMany({ where: { isClientOnly: false }, select: { plantCode: true }, orderBy: [{ createdAt: 'asc' }], take: 5000 } as any)) as any[];
  const dbCodes = dbSites.map((s: any) => s.plantCode).filter(Boolean) as string[];
  for (const code of dbCodes) stationCodes.add(code);

  const uniq = Array.from(stationCodes);
  if (uniq.length > 0) {
    const allFromApi = successfulClients === stationClients.length;
    const ttl = allFromApi ? STATION_CACHE_TTL_MS : Math.min(STATION_CACHE_TTL_MS, 30 * 60 * 1000);
    stationCache = { expiresAt: now + ttl, stationCodes: uniq };
    replaceKnownHuaweiStationCodes(uniq);
    log.info('Station cache refreshed', { count: uniq.length, fromApi: uniq.length - dbCodes.length + stationCodes.size, fromDb: dbCodes.length, successfulClients, totalClients: stationClients.length, ttlMs: ttl });
    return uniq;
  }

  log.warn('No stations found from API or DB');
  return [];
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
    noteStationFailure(site.plantCode, client);
    if (cached.length > 0) {
      log.warn('Falling back to cached device metadata', { plantCode: site.plantCode });
      return cached;
    }
    throw new Error(`getDevList failed (failCode=${end4?.failCode})`);
  }

  const devices: HuaweiDevice[] = end4?.data ?? [];
  const inverterTargets = devices
    .filter((d) => INVERTER_DEV_TYPE_IDS.has(Number(d.devTypeId)))
    .map(normalizeDeviceTarget)
    .filter(Boolean) as DeviceTarget[];

  if (inverterTargets.length > 0) {
    await prisma.$transaction(
      inverterTargets.map((inv) =>
        prisma.inverter.upsert({
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
        } as any)
      )
    );
  }

  // Persist aux devices (EMI, meter, battery, ESS, power sensor) to DB
  const AUX_DEV_TYPE_IDS = new Set([10, 17, 39, 41, 47]);
  const auxDevices = devices.filter((d) => AUX_DEV_TYPE_IDS.has(Number(d.devTypeId)));
  if (auxDevices.length > 0) {
    try {
      await prisma.$transaction(
        auxDevices.map((d) =>
          (prisma as any).auxDevice.upsert({
            where: { siteId_huaweiDevId: { siteId: site.id, huaweiDevId: String(d.id) } },
            create: {
              siteId: site.id,
              plantCode: site.plantCode,
              huaweiDevId: String(d.id),
              huaweiDevTypeId: Number(d.devTypeId),
              devName: (d as any).devName ?? null,
              model: (d as any).invType ?? (d as any).model ?? null,
            },
            update: {
              huaweiDevTypeId: Number(d.devTypeId),
              devName: (d as any).devName ?? null,
              model: (d as any).invType ?? (d as any).model ?? null,
            },
          }),
        ),
      );
    } catch (err: any) {
      log.warn('Failed to persist aux devices', { plantCode: site.plantCode, error: err?.message ?? err });
    }
  }

  await prisma.site.update({
    where: { id: site.id },
    data: { deviceMetaSyncedAt: new Date() },
  } as any);

  registerStationAccess(site.plantCode, client);

  log.debug('Refreshed device metadata', { plantCode: site.plantCode, client: describeHuaweiClient(client), inverterCount: inverterTargets.length, auxDeviceCount: auxDevices.length });

  return inverterTargets.length > 0 ? inverterTargets : cached;
}

async function upsertSiteRealtimeRows(rows: any[]) {
  if (rows.length === 0) return { synced: 0, stationCodes: [] as string[] };

  const requestedCodes = Array.from(
    new Set(
      rows
        .map((row) => String(row?.stationCode ?? ''))
        .filter(Boolean)
    )
  );

  const sites = (await prisma.site.findMany({
    where: { plantCode: { in: requestedCodes } },
    select: { id: true, plantCode: true },
  } as any)) as any[];
  const byCode = new Map(sites.map((s) => [s.plantCode, s.id] as const));

  for (const row of rows) {
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

  markStations('siteRealtime', requestedCodes);

  return { synced: rows.length, stationCodes: requestedCodes };
}

async function syncSiteRealtimeBatch(plantCodes: string[], batchIndex: number) {
  if (plantCodes.length === 0) return { synced: 0, missing: 0 };

  let remaining = Array.from(new Set(plantCodes.filter(Boolean)));
  let totalSynced = 0;
  const candidateClients = getPreferredClientOrderForPurpose('siteRealtime', batchIndex);

  for (const client of candidateClients) {
    if (remaining.length === 0) break;

    try {
      const res: any = await client.getStationRealKpi(remaining);
      if (!res?.success || !Array.isArray(res?.data)) {
        handleFailCode(client, res?.failCode, 'getStationRealKpi(batch)');
        remaining.forEach((code) => noteStationFailure(code, client));
        continue;
      }

      const rows = (res.data as any[]).filter((row) => {
        const code = String(row?.stationCode ?? '');
        return !!code && remaining.includes(code);
      });

      if (rows.length === 0) {
        remaining.forEach((code) => noteStationFailure(code, client));
        continue;
      }

      const upsertResult = await upsertSiteRealtimeRows(rows);
      totalSynced += upsertResult.synced;
      registerStationBatchAccess(upsertResult.stationCodes, client);

      const answered = new Set(upsertResult.stationCodes);
      remaining = remaining.filter((code) => {
        const isMissing = !answered.has(code);
        if (isMissing) noteStationFailure(code, client);
        return isMissing;
      });
    } catch (error: any) {
      log.warn('getStationRealKpi failed', { client: describeHuaweiClient(client), error: error?.message ?? error });
      remaining.forEach((code) => noteStationFailure(code, client));
    }
  }

  if (remaining.length > 0) {
    remaining.forEach((code) => enqueueRetry(code));
    log.warn('Site realtime batch incomplete', { missing: remaining.length, total: plantCodes.length });
  }

  return { synced: totalSynced, missing: remaining.length };
}

async function syncPlantDevices(
  site: SiteLite,
  client: HuaweiService,
  runStateCount: Map<number, number>,
  opts?: SyncPlantDevicesOptions
): Promise<SyncPlantDevicesResult> {
  const includeInventory = opts?.includeInventory ?? true;
  const includeDeviceDetail = opts?.includeDeviceDetail ?? true;
  const forceInventory = opts?.forceInventory ?? false;
  const forceDeviceDetail = opts?.forceDeviceDetail ?? false;

  const deviceTargets = includeInventory
    ? await ensurePlantDeviceMetadata(site, client, { force: forceInventory })
    : await getCachedDeviceTargets(site.id);

  if (deviceTargets.length === 0) {
    return { ok: true, inverters: 0, currentPowerKW: null, usedCachedInventory: !includeInventory, clientLabel: describeHuaweiClient(client) };
  }

  if (!includeDeviceDetail && !forceDeviceDetail) {
    return {
      ok: true,
      inverters: deviceTargets.length,
      currentPowerKW: null,
      skippedDeviceDetail: true,
      usedCachedInventory: !includeInventory,
      clientLabel: describeHuaweiClient(client),
    };
  }

  const groups = new Map<number, string[]>();
  for (const d of deviceTargets) {
    if (!groups.has(d.devTypeId)) groups.set(d.devTypeId, []);
    groups.get(d.devTypeId)!.push(d.devId);
  }

  const inverterRows = (await prisma.inverter.findMany({
    where: { siteId: site.id, huaweiDevId: { in: deviceTargets.map((d) => d.devId) } },
    select: { id: true, huaweiDevId: true, lastDailyEnergy: true },
  } as any)) as any[];
  const inverterByHuaweiDevId = new Map<string, { id: number; lastDailyEnergy: number | null }>();
  for (const row of inverterRows) {
    if (!row?.huaweiDevId) continue;
    inverterByHuaweiDevId.set(String(row.huaweiDevId), { id: row.id, lastDailyEnergy: row.lastDailyEnergy });
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
        noteStationFailure(site.plantCode, client);
        continue;
      }

      registerStationAccess(site.plantCode, client);

      // Collect all parsed data first, then batch DB writes
      const parsedItems: Array<{
        devId: string;
        inv: { id: number; lastDailyEnergy: number | null };
        activePowerVal: number | null;
        dayEnergy: number | null;
        runState: number | null;
        totalEnergy: number | null;
        temperature: number | null;
        powerFactor: number | null;
        item: any;
        map: any;
      }> = [];

      for (const item of end5.data) {
        const devId = String(item.devId ?? '');
        const map = item.dataItemMap ?? {};
        const runState = parseNum(map.run_state);

        if (runState != null) {
          runStateCount.set(runState, (runStateCount.get(runState) ?? 0) + 1);
        }

        const inv = inverterByHuaweiDevId.get(devId);
        if (!inv) continue;

        parsedItems.push({
          devId,
          inv,
          activePowerVal: parseNum(map.active_power),
          dayEnergy: parseNum(map.day_cap),
          runState,
          totalEnergy: parseNum(map.total_cap),
          temperature: parseNum(map.temperature),
          powerFactor: parseNum(map.power_factor),
          item,
          map,
        });
      }

      // Batch: update inverters + upsert snapshots in a single transaction
      const txOps: any[] = [];
      for (const p of parsedItems) {
        const derivedStatus = deriveInverterStatus(p.runState);
        txOps.push(
          prisma.inverter.update({
            where: { id: p.inv.id },
            data: {
              ...(p.activePowerVal != null ? { activePower: p.activePowerVal } : {}),
              lastDailyEnergy: p.dayEnergy ?? p.inv.lastDailyEnergy,
              status: derivedStatus,
              runState: p.runState != null ? Math.trunc(p.runState) : null,
              lastSyncAt: new Date(),
            },
          })
        );

        if (p.activePowerVal != null) {
          siteCurrentPowerKW += p.activePowerVal;
          hasCurrentPower = true;
        }
      }

      if (txOps.length > 0) {
        await prisma.$transaction(txOps);
      }

      // Batch upsert all KPI snapshots in one transaction
      const snapResults = parsedItems.length > 0
        ? await prisma.$transaction(
            parsedItems.map((p) =>
              prisma.inverterKpiSnapshot.upsert({
                where: { inverterId_ts: { inverterId: p.inv.id, ts } },
                create: {
                  inverterId: p.inv.id,
                  ts,
                  activePower: p.activePowerVal ?? 0,
                  dayEnergy: p.dayEnergy ?? 0,
                  totalEnergy: p.totalEnergy,
                  runState: p.runState != null ? Math.trunc(p.runState) : null,
                  temperature: p.temperature,
                  powerFactor: p.powerFactor,
                  raw: p.item,
                } as any,
                update: {
                  activePower: p.activePowerVal ?? 0,
                  dayEnergy: p.dayEnergy ?? 0,
                  totalEnergy: p.totalEnergy,
                  runState: p.runState != null ? Math.trunc(p.runState) : null,
                  temperature: p.temperature,
                  powerFactor: p.powerFactor,
                  raw: p.item,
                } as any,
              })
            )
          )
        : [];

      // Batch all string snapshot operations: collect deletes + rows, then execute together
      const stringDeleteOps: any[] = [];
      const allStringRows: any[] = [];
      for (let idx = 0; idx < parsedItems.length; idx++) {
        const snap = snapResults[idx];
        const p = parsedItems[idx];
        stringDeleteOps.push(prisma.inverterStringSnapshot.deleteMany({ where: { snapshotId: snap.id } }));
        for (let n = 1; n <= STRING_SLOT_COUNT; n++) {
          const voltage = parseNum(p.map[`pv${n}_u`]);
          const current = parseNum(p.map[`pv${n}_i`]);
          if (voltage == null && current == null) continue; // skip disconnected strings to reduce writes
          allStringRows.push({
            snapshotId: snap.id,
            stringNo: n,
            voltage,
            current,
            status: deriveStringStatus(voltage, current),
          });
        }
      }
      if (stringDeleteOps.length > 0) {
        await prisma.$transaction(stringDeleteOps);
      }
      if (allStringRows.length > 0) {
        await prisma.inverterStringSnapshot.createMany({ data: allStringRows });
      }
    }
  }

  if (hasCurrentPower) {
    await prisma.site.update({ where: { id: site.id }, data: { currentPowerKW: siteCurrentPowerKW } } as any);
  }

  return {
    ok: true,
    inverters: deviceTargets.length,
    currentPowerKW: hasCurrentPower ? siteCurrentPowerKW : null,
    clientLabel: describeHuaweiClient(client),
  };
}

async function syncPlantDevicesWithFailover(
  site: SiteLite,
  runStateCount: Map<number, number>,
  opts?: SyncPlantDevicesOptions,
  purpose: 'device' | 'ondemand' = 'device',
  batchIndex?: number
): Promise<SyncPlantDevicesResult> {
  const clients = getStationClientCandidates(site.plantCode, purpose === 'ondemand' ? 'ondemand' : 'device', { batchIndex });
  const cachedTargets = await getCachedDeviceTargets(site.id);
  let lastError: unknown = null;
  let lastResult: SyncPlantDevicesResult | null = null;

  for (const client of clients) {
    try {
      const result = await syncPlantDevices(site, client, runStateCount, opts);
      lastResult = result;

      const shouldAccept =
        result.inverters > 0 ||
        result.usedCachedInventory ||
        cachedTargets.length > 0 ||
        result.currentPowerKW != null ||
        result.skippedDeviceDetail;

      if (shouldAccept) {
        registerStationAccess(site.plantCode, client);
        markStations(purpose === 'ondemand' ? 'device' : 'device', [site.plantCode]);
        return result;
      }

      noteStationFailure(site.plantCode, client);
    } catch (error: any) {
      lastError = error;
      noteStationFailure(site.plantCode, client);
      log.warn('Device sync failed', { plantCode: site.plantCode, client: describeHuaweiClient(client), error: error?.message ?? error });
    }
  }

  if (lastResult) return lastResult;
  throw lastError instanceof Error ? lastError : new Error(`No Huawei client could sync devices for ${site.plantCode}`);
}

function shouldSkipRemoteSyncForPlant(plantCode: string) {
  return hasKnownHuaweiStationInventory() && !isKnownHuaweiStationCode(plantCode);
}

const SITE_REALTIME_STALE_MS = Number(process.env.HUAWEI_SITE_REALTIME_STALE_MS ?? 4 * 60_000);
const SITE_REALTIME_MAX_PER_TICK = Math.max(1, Number(process.env.HUAWEI_SITE_REALTIME_MAX_PER_TICK ?? 0));

export async function syncSiteRealtimeTick() {
  log.info('Starting Site Realtime Sync Tick');
  try {
    const stationCodes = await refreshStationsIfNeeded();
    const plantCodes = stationCodes.filter((code): code is string => !!code);
    if (plantCodes.length === 0) {
      log.warn('No Huawei inventory sites to sync for site realtime');
      return;
    }

    const skippedLocalOnlySites = await prisma.site.count({
      where: {
        plantCode: { not: '', notIn: plantCodes },
      },
    } as any);
    if (skippedLocalOnlySites > 0) {
      log.info('Skipping local-only/test sites from site realtime sync', { count: skippedLocalOnlySites });
    }

    // Staleness filter: only sync stations not synced within SITE_REALTIME_STALE_MS
    const maxPerTick = SITE_REALTIME_MAX_PER_TICK > 0 ? SITE_REALTIME_MAX_PER_TICK : plantCodes.length;
    const staleCodes = getStalestStationCodes('siteRealtime', plantCodes, maxPerTick);
    const now = Date.now();
    const staleFiltered = staleCodes.filter((code) => {
      const lastSeen = getStationLastSeenMs('siteRealtime', code);
      return lastSeen == null || now - lastSeen >= SITE_REALTIME_STALE_MS;
    });

    if (staleFiltered.length === 0) {
      log.info('Site realtime sync: all stations fresh, skipping', { total: plantCodes.length, staleMs: SITE_REALTIME_STALE_MS });
      return;
    }

    log.info('Site realtime stale stations', { stale: staleFiltered.length, total: plantCodes.length, thresholdMs: SITE_REALTIME_STALE_MS });

    const batches = chunk(staleFiltered, SITE_REALTIME_BATCH_SIZE);
    let totalSynced = 0;
    let totalMissing = 0;
    // Work-stealing pattern: each worker atomically claims the next batch index.
    // Safe in single-threaded JS because takeNext() runs synchronously before any await.
    let batchCursor = 0;
    const takeNextBatch = () => batchCursor < batches.length ? batchCursor++ : -1;
    const workers = Array.from({ length: Math.min(SITE_REALTIME_CONCURRENCY, batches.length) }, async () => {
      let i: number;
      while ((i = takeNextBatch()) >= 0) {
        const result = await syncSiteRealtimeBatch(batches[i], i);
        totalSynced += result.synced;
        totalMissing += result.missing;
      }
    });
    await Promise.all(workers);

    log.info('Site realtime sync done', { synced: totalSynced, batches: batches.length, missing: totalMissing, total: plantCodes.length });
  } catch (error: any) {
    log.error('Site realtime sync failed', { error: error?.message ?? error });
  }
}

export const syncMonitoringTick = async () => {
  // Mutex: prevent overlapping ticks from concurrent cron/watchdog triggers
  if (tickRunning) {
    log.info('Skip device sync tick, previous tick still running');
    return;
  }
  tickRunning = true;

  try {
  return await _syncMonitoringTickInner();
  } finally {
    tickRunning = false;
  }
};

const _syncMonitoringTickInner = async () => {
  log.info('Starting Device Sync Tick');

  const now = Date.now();
  if (lastTickAt && now - lastTickAt < MIN_TICK_INTERVAL_MS) {
    log.info('Skip device sync tick, min interval not reached', { minIntervalMs: MIN_TICK_INTERVAL_MS });
    return;
  }
  lastTickAt = now;

  const runStateCount = new Map<number, number>();

  try {
    const stationCodes = await refreshStationsIfNeeded();
    if (stationCodes.length === 0) {
      log.warn('No station codes available for device sync');
      return;
    }

    const skippedLocalOnlySites = await prisma.site.count({
      where: {
        plantCode: { not: '', notIn: stationCodes },
      },
    } as any);
    if (skippedLocalOnlySites > 0) {
      log.info('Skipping local-only/test sites from device sync', { count: skippedLocalOnlySites });
    }

    const bpLevel = getBackpressureLevel();
    const bpMultiplier = getBackpressureMultiplier();
    const rawMaxPlants = resolveDynamicDevicePlantsPerTick();
    const maxPlantsPerTick = Math.max(1, Math.floor(rawMaxPlants * bpMultiplier));
    if (bpLevel !== 'none') {
      log.warn('Backpressure active', { level: bpLevel, multiplier: bpMultiplier, maxPlantsPerTick, rawMax: rawMaxPlants, retryQueueSize: retryQueue.size, recentErrors: recentErrors.length });
    }
    const picked = new Set<string>();

    // Priority 0: sites ที่ยังไม่เคย sync device inventory เลย → ต้องครบก่อน
    const unsyncedSites = await prisma.site.findMany({
      where: { deviceMetaSyncedAt: null, plantCode: { in: stationCodes, not: '' } },
      select: { plantCode: true },
      take: maxPlantsPerTick,
    } as any) as { plantCode: string }[];
    for (const s of unsyncedSites) {
      if (picked.size >= maxPlantsPerTick) break;
      picked.add(s.plantCode);
    }
    if (unsyncedSites.length > 0) {
      log.info('Prioritizing unsynced sites for inventory', { unsynced: unsyncedSites.length, picked: picked.size });
    }

    // Priority 1: retry queue
    for (const code of retryQueue) {
      if (picked.size >= maxPlantsPerTick) break;
      picked.add(code);
    }
    for (const code of picked) retryQueue.delete(code);

    // Priority 2: stalest stations
    const staleCandidates = getStalestStationCodes('device', stationCodes, maxPlantsPerTick * 2, { exclude: picked });
    for (const code of staleCandidates) {
      if (picked.size >= maxPlantsPerTick) break;
      picked.add(code);
    }

    // Priority 3: round-robin
    while (picked.size < maxPlantsPerTick && stationCodes.length > 0) {
      const code = stationCodes[deviceSyncCursor % stationCodes.length];
      deviceSyncCursor = (deviceSyncCursor + 1) % Math.max(stationCodes.length, 1);
      picked.add(code);
      if (picked.size >= stationCodes.length) break;
    }

    if (picked.size === 0) {
      log.warn('No sites selected for device sync');
      return;
    }

    const sites = ((await prisma.site.findMany({
      where: { plantCode: { in: Array.from(picked) } },
      select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
      orderBy: { plantCode: 'asc' },
    } as any)) as unknown) as SiteLite[];

    // --- getDevList daily quota guard ---
    // getDevList has a daily limit (27/day/account). Only refresh inventory for
    // sites that have never synced or whose metadata TTL has expired.
    // ถ้ายังมี site ที่ไม่เคย sync เลย → ปล่อยให้เรียก getDevList ได้เต็ม tick
    // ถ้าครบหมดแล้ว → จำกัดตาม INVENTORY_PER_TICK เพื่อกระจาย quota สำหรับ TTL refresh
    const baseInventoryPerTick = Math.max(1, Number(process.env.HUAWEI_INVENTORY_PER_TICK ?? 2));
    const hasUnsyncedSites = unsyncedSites.length > 0;
    const INVENTORY_PER_TICK = hasUnsyncedSites ? maxPlantsPerTick : baseInventoryPerTick;
    const now = Date.now();
    const needsInventorySet = new Set(
      sites
        .filter(s => !s.deviceMetaSyncedAt || (now - s.deviceMetaSyncedAt.getTime() >= DEVICE_META_TTL_MS))
        .sort((a, b) => {
          // nulls first (never synced), then oldest first
          if (!a.deviceMetaSyncedAt && b.deviceMetaSyncedAt) return -1;
          if (a.deviceMetaSyncedAt && !b.deviceMetaSyncedAt) return 1;
          return (a.deviceMetaSyncedAt?.getTime() ?? 0) - (b.deviceMetaSyncedAt?.getTime() ?? 0);
        })
        .slice(0, INVENTORY_PER_TICK)
        .map(s => s.plantCode),
    );
    log.info('Inventory budget', { eligible: sites.filter(s => !s.deviceMetaSyncedAt || (now - s.deviceMetaSyncedAt.getTime() >= DEVICE_META_TTL_MS)).length, granted: needsInventorySet.size, cap: INVENTORY_PER_TICK });

    // Work-stealing: each worker atomically claims the next site index
    let siteCursor = 0;
    const takeNextSite = () => siteCursor < sites.length ? siteCursor++ : -1;
    const workers = Array.from({ length: Math.min(Math.max(1, DEVICE_SYNC_CONCURRENCY), sites.length) }, async () => {
      let index: number;
      while ((index = takeNextSite()) >= 0) {
        const site = sites[index];
        try {
          const result = await syncPlantDevicesWithFailover(site, runStateCount, {
            includeInventory: needsInventorySet.has(site.plantCode),
            includeDeviceDetail: true,
          }, 'device', index);
          recordSyncOutcome(true);
          log.info('Device sync done', { plantCode: site.plantCode, inventory: needsInventorySet.has(site.plantCode), client: result.clientLabel ?? 'UNKNOWN', inverters: result.inverters });
        } catch (e: any) {
          recordSyncOutcome(false);
          enqueueRetry(site.plantCode);
          log.warn('Device sync failed', { plantCode: site.plantCode, error: e?.message ?? e });
        }
      }
    });

    await Promise.all(workers);
  } catch (error: any) {
    log.error('Device Sync Tick Failed', { error: error?.message ?? error });
  } finally {
    log.info('Huawei API call summary', {
      main: huaweiClients.main.getStats(),
      backup: huaweiClients.backup.getStats(),
      alarm: huaweiClients.alarm.getStats(),
      ondemand: huaweiClients.ondemand.getStats(),
    });

    if (runStateCount.size > 0) {
      const top = Array.from(runStateCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 20)
        .map(([k, v]) => `${k}:${v}`)
        .join(', ');
      log.info('run_state distribution', { top });
      log.info('Tune fault mapping via env HUAWEI_FAULT_RUN_STATES');
    }

    log.debug('retryQueue snapshot', { size: retryQueue.size, sample: Array.from(retryQueue).slice(0, 10) });
    await persistRetryQueue();
  }
};

export { restoreRetryQueue };
export const syncInverterData = syncMonitoringTick;

export async function syncPlantOnDemand(plantCode: string, opts?: SyncPlantOnDemandOptions) {
  // API-only mode: still attempt on-demand refresh if Huawei credentials exist,
  // but fall back gracefully to DB-only if no credentials or API fails.
  const disableCron = process.env.DISABLE_CRON;
  const isApiOnlyMode = disableCron === '1' || disableCron === 'true';
  const hasHuaweiCreds = !!(process.env.HUAWEI_USER && process.env.HUAWEI_PASSWORD);

  if (isApiOnlyMode && !hasHuaweiCreds) {
    return {
      ok: true,
      plantCode,
      skippedRemoteSync: true,
      reason: 'api_only_mode_no_credentials',
      siteRealtimeRefreshed: false,
      deviceSync: {
        ok: true,
        inverters: 0,
        currentPowerKW: null,
        skippedDeviceDetail: true,
        usedCachedInventory: false,
      },
    };
  }

  if (isApiOnlyMode) {
    log.info('ONDEMAND: api_only_mode but credentials available, attempting on-demand refresh', { plantCode });
  }

  const normalized = normalizeOnDemandOptions(opts);
  const inflightKey = makeOnDemandInflightKey(plantCode, normalized);
  const existing = onDemandSyncInflight.get(inflightKey);
  if (existing) return existing;

  const task = (async () => {
    const client = pickOnDemandClient();
    const site = (await prisma.site.findUnique({
      where: { plantCode },
      select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
    } as any)) as SiteLite | null;
    if (!site) throw new Error(`Site not found for plantCode=${plantCode}`);

    if (shouldSkipRemoteSyncForPlant(plantCode)) {
      log.warn('ONDEMAND: skip remote sync, plant not in Huawei inventory', { plantCode });
      return {
        ok: true,
        plantCode,
        skippedRemoteSync: true,
        reason: 'plant_not_in_huawei_inventory',
        siteRealtimeRefreshed: false,
        deviceSync: {
          ok: true,
          inverters: 0,
          currentPowerKW: null,
          skippedDeviceDetail: true,
          usedCachedInventory: false,
        },
      };
    }

    log.info('ONDEMAND: refresh plant', { plantCode, siteName: site.name ?? '', client: describeHuaweiClient(client), ...normalized });

    let siteRealtimeRefreshed = false;
    if (normalized.includeSiteRealtime) {
      try {
        const siteRealtimeResult = await syncSiteRealtimeBatch([plantCode], 0);
        siteRealtimeRefreshed = siteRealtimeResult.synced > 0;
      } catch (e: any) {
        log.warn('ONDEMAND: site realtime refresh failed', { plantCode, error: e?.message ?? e });
      }
    }

    const shouldTouchDevices = normalized.includeInventory || normalized.includeDeviceDetail;
    const runStateCount = new Map<number, number>();
    const result = shouldTouchDevices
      ? await syncPlantDevicesWithFailover(
          site,
          runStateCount,
          {
            includeInventory: normalized.includeInventory,
            forceInventory: normalized.forceInventory || normalized.forceDeviceDetail,
            includeDeviceDetail: normalized.includeDeviceDetail,
            forceDeviceDetail: normalized.forceDeviceDetail,
          },
          'ondemand'
        )
      : { ok: true, inverters: 0, currentPowerKW: null, skippedDeviceDetail: true, usedCachedInventory: false };

    return {
      ok: true,
      plantCode,
      options: normalized,
      siteRealtimeRefreshed,
      inverters: result.inverters,
      currentPowerKW: result.currentPowerKW,
      skippedDeviceDetail: result.skippedDeviceDetail ?? false,
      usedCachedInventory: result.usedCachedInventory ?? false,
      clientLabel: result.clientLabel ?? describeHuaweiClient(client),
    };
  })();

  onDemandSyncInflight.set(inflightKey, task);
  try {
    return await task;
  } finally {
    onDemandSyncInflight.delete(inflightKey);
  }
}


export async function getFleetSyncCoverageSnapshot() {
  const sites = (await prisma.site.findMany({
    select: { id: true, plantCode: true, name: true, lastPlantSyncAt: true, deviceMetaSyncedAt: true },
    orderBy: { plantCode: 'asc' },
    take: 5000,
  } as any)) as Array<{ id: number; plantCode: string; name: string; lastPlantSyncAt: Date | null; deviceMetaSyncedAt: Date | null }>;

  const syncState = getSyncStateSnapshot();
  const now = Date.now();
  const siteRealtimeFreshMs = Number(process.env.HUAWEI_SITE_REALTIME_FRESH_MS ?? 10 * 60_000);
  const deviceFreshMs = Number(process.env.HUAWEI_DEVICE_FRESH_MS ?? 4 * 60 * 60_000);

  let siteRealtimeFresh = 0;
  let deviceFresh = 0;

  const decorated = sites.map((site) => {
    const siteRealtimeLastSeen = syncState.stations.siteRealtime[site.plantCode] ?? site.lastPlantSyncAt?.toISOString() ?? null;
    const deviceLastSeen = syncState.stations.device[site.plantCode] ?? site.deviceMetaSyncedAt?.toISOString() ?? null;
    const siteRealtimeAgeMs = siteRealtimeLastSeen ? Math.max(0, now - new Date(siteRealtimeLastSeen).getTime()) : null;
    const deviceAgeMs = deviceLastSeen ? Math.max(0, now - new Date(deviceLastSeen).getTime()) : null;

    if (siteRealtimeAgeMs != null && siteRealtimeAgeMs <= siteRealtimeFreshMs) siteRealtimeFresh += 1;
    if (deviceAgeMs != null && deviceAgeMs <= deviceFreshMs) deviceFresh += 1;

    return {
      plantCode: site.plantCode,
      name: site.name,
      siteRealtimeLastSeen,
      siteRealtimeAgeMs,
      deviceLastSeen,
      deviceAgeMs,
    };
  });

  const sample = decorated.slice(0, 50);

  const totalSites = sites.length;
  return {
    generatedAt: new Date().toISOString(),
    totalSites,
    thresholds: {
      siteRealtimeFreshMs,
      deviceFreshMs,
    },
    coverage: {
      siteRealtimeFreshSites: siteRealtimeFresh,
      deviceFreshSites: deviceFresh,
      siteRealtimeFreshPct: totalSites > 0 ? Number(((siteRealtimeFresh / totalSites) * 100).toFixed(2)) : 0,
      deviceFreshPct: totalSites > 0 ? Number(((deviceFresh / totalSites) * 100).toFixed(2)) : 0,
    },
    stalestDeviceSites: getStalestStationCodes('device', sites.map((site) => site.plantCode), 20).map((plantCode) => {
      const site = sites.find((row) => row.plantCode === plantCode);
      const lastSeen = syncState.stations.device[plantCode] ?? site?.deviceMetaSyncedAt?.toISOString() ?? null;
      return {
        plantCode,
        name: site?.name ?? plantCode,
        lastSeen,
        ageMs: lastSeen ? Math.max(0, now - new Date(lastSeen).getTime()) : null,
      };
    }),
    sample,
  };
}

// ── Daily KPI Sync (populates SiteDailyKpi for month view + PR day) ──

const DAILY_KPI_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_DAILY_KPI_BATCH_SIZE ?? 100)));

export async function syncDailyKpiTick() {
  log.info('Starting Daily KPI Sync');
  try {
    const stationCodes = await refreshStationsIfNeeded();
    const plantCodes = stationCodes.filter((code): code is string => !!code);
    if (plantCodes.length === 0) {
      log.warn('No sites for daily KPI sync');
      return;
    }

    // Get siteId mapping
    const sites = await prisma.site.findMany({
      where: { plantCode: { in: plantCodes } },
      select: { id: true, plantCode: true },
    });
    const siteIdByPlantCode = new Map(sites.map((s) => [s.plantCode, s.id]));

    // Sync current month's daily KPI
    const now = new Date();
    const HUAWEI_TZ = process.env.HUAWEI_SYNC_TIMEZONE ?? 'Asia/Bangkok';
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: HUAWEI_TZ,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour12: false,
    });
    const parts = Object.fromEntries(tzFmt.formatToParts(now).map((x) => [x.type, x.value]));
    const year = Number(parts.year);
    const month = Number(parts.month);
    const collectTime = new Date(year, month - 1, 15, 12, 0, 0, 0).getTime();

    let totalUpserted = 0;
    const batches = chunk(plantCodes, DAILY_KPI_BATCH_SIZE);
    const clients = getPreferredClientOrderForPurpose('siteRealtime', 0);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const stationCodesStr = batch.join(',');
      const client = clients[bi % clients.length];

      try {
        const res: any = await client.postRaw('/thirdData/getKpiStationDay', {
          stationCodes: stationCodesStr,
          collectTime,
        });

        if (!res?.success && res?.failCode) {
          handleFailCode(client, res.failCode, 'getKpiStationDay(dailySync)');
          continue;
        }

        const rows: any[] = Array.isArray(res?.data) ? res.data : [];
        const upserts: Promise<any>[] = [];

        for (const row of rows) {
          const plantCode = String(row?.stationCode ?? '').trim();
          const siteId = siteIdByPlantCode.get(plantCode);
          if (!siteId) continue;

          const ct = parseNum(row?.collectTime);
          if (ct == null) continue;

          const map = (row?.dataItemMap ?? {}) as Record<string, unknown>;
          const dateObj = new Date(ct);
          // Normalize to midnight for unique key
          const dateKey = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate(), 0, 0, 0, 0);

          upserts.push(
            (prisma as any).siteDailyKpi.upsert({
              where: { siteId_date: { siteId, date: dateKey } },
              create: {
                siteId,
                plantCode,
                date: dateKey,
                collectTime: ct,
                production: parseNum(map.PVYield) ?? parseNum(map.inverterYield) ?? parseNum(map.inverter_power),
                irradiation: parseNum(map.radiation_intensity),
                gridImport: parseNum(map.buyPower),
                gridExport: parseNum(map.ongrid_power),
                consumption: parseNum(map.use_power),
                revenue: parseNum(map.power_profit),
                selfProvide: parseNum(map.selfProvide) ?? parseNum(map.selfUsePower),
                batteryCharge: parseNum(map.chargeCap),
                batteryDischarge: parseNum(map.dischargeCap),
                moduleTempC: parseNum(map.module_temp) ?? parseNum(map.temperature),
                downTimeClientHours: parseNum(map.down_time_client) ?? parseNum(map.downTimeClient),
                pr: parseNum(map.performance_ratio),
              },
              update: {
                collectTime: ct,
                production: parseNum(map.PVYield) ?? parseNum(map.inverterYield) ?? parseNum(map.inverter_power),
                irradiation: parseNum(map.radiation_intensity),
                gridImport: parseNum(map.buyPower),
                gridExport: parseNum(map.ongrid_power),
                consumption: parseNum(map.use_power),
                revenue: parseNum(map.power_profit),
                selfProvide: parseNum(map.selfProvide) ?? parseNum(map.selfUsePower),
                batteryCharge: parseNum(map.chargeCap),
                batteryDischarge: parseNum(map.dischargeCap),
                moduleTempC: parseNum(map.module_temp) ?? parseNum(map.temperature),
                downTimeClientHours: parseNum(map.down_time_client) ?? parseNum(map.downTimeClient),
                pr: parseNum(map.performance_ratio),
              },
            }),
          );
        }

        if (upserts.length > 0) {
          await Promise.all(upserts);
          totalUpserted += upserts.length;
        }
      } catch (err: any) {
        log.warn('Daily KPI batch failed', { batch: bi, error: err?.message ?? err });
      }
    }

    log.info('Daily KPI Sync complete', { totalUpserted, batches: batches.length, sites: plantCodes.length });
  } catch (err: any) {
    log.error('Daily KPI Sync tick failed', { error: err?.message ?? err });
    throw err;
  }
}

// ── Hourly KPI Sync (for DB-first day view) ──
const HOURLY_KPI_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_HOURLY_KPI_BATCH_SIZE ?? 100)));

export async function syncHourlyKpiTick() {
  log.info('Starting Hourly KPI Sync');
  try {
    const stationCodes = await refreshStationsIfNeeded();
    const plantCodes = stationCodes.filter((code): code is string => !!code);
    if (plantCodes.length === 0) {
      log.warn('No sites for hourly KPI sync');
      return;
    }

    const sites = await prisma.site.findMany({
      where: { plantCode: { in: plantCodes } },
      select: { id: true, plantCode: true },
    });
    const siteIdByPlantCode = new Map(sites.map((s) => [s.plantCode, s.id]));

    // collectTime = noon of today in configured timezone
    const now = new Date();
    const HUAWEI_TZ = process.env.HUAWEI_SYNC_TIMEZONE ?? 'Asia/Bangkok';
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: HUAWEI_TZ,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour12: false,
    });
    const parts = Object.fromEntries(tzFmt.formatToParts(now).map((x) => [x.type, x.value]));
    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const collectTime = new Date(year, month - 1, day, 12, 0, 0, 0).getTime();

    let totalUpserted = 0;
    const batches = chunk(plantCodes, HOURLY_KPI_BATCH_SIZE);
    const clients = getPreferredClientOrderForPurpose('siteRealtime', 0);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const stationCodesStr = batch.join(',');
      const client = clients[bi % clients.length];

      try {
        const res: any = await client.postRaw('/thirdData/getKpiStationHour', {
          stationCodes: stationCodesStr,
          collectTime,
        });

        if (!res?.success && res?.failCode) {
          handleFailCode(client, res.failCode, 'getKpiStationHour(hourlySync)');
          continue;
        }

        const rows: any[] = Array.isArray(res?.data) ? res.data : [];
        const upserts: Promise<any>[] = [];

        for (const row of rows) {
          const plantCode = String(row?.stationCode ?? '').trim();
          const siteId = siteIdByPlantCode.get(plantCode);
          if (!siteId) continue;

          const ct = parseNum(row?.collectTime);
          if (ct == null) continue;

          const map = (row?.dataItemMap ?? {}) as Record<string, unknown>;
          const ts = new Date(ct);

          const data = {
            plantCode,
            collectTime: ct,
            production: parseNum(map.PVYield) ?? parseNum(map.inverterYield) ?? parseNum(map.inverter_power),
            irradiation: parseNum(map.radiation_intensity),
            gridImport: parseNum(map.buyPower),
            gridExport: parseNum(map.ongrid_power),
            consumption: parseNum(map.use_power),
            consumedFromPv: parseNum(map.selfProvide) ?? parseNum(map.selfUsePower),
            batteryCharge: parseNum(map.chargeCap),
            batteryDischarge: parseNum(map.dischargeCap),
          };

          upserts.push(
            (prisma as any).siteHourlyKpi.upsert({
              where: { siteId_ts: { siteId, ts } },
              create: { siteId, ts, ...data },
              update: data,
            }),
          );
        }

        if (upserts.length > 0) {
          await Promise.all(upserts);
          totalUpserted += upserts.length;
        }
      } catch (err: any) {
        log.warn('Hourly KPI batch failed', { batch: bi, error: err?.message ?? err });
      }
    }

    log.info('Hourly KPI Sync complete', { totalUpserted, batches: batches.length, sites: plantCodes.length });
  } catch (err: any) {
    log.error('Hourly KPI Sync tick failed', { error: err?.message ?? err });
    throw err;
  }
}

// ── Aux Device Realtime Sync (for DB-first home realtime) ──

export async function syncAuxRealtimeTick() {
  log.info('Starting Aux Device Realtime Sync');
  try {
    const stationCodes = await refreshStationsIfNeeded();
    const plantCodes = stationCodes.filter((code): code is string => !!code);
    if (plantCodes.length === 0) {
      log.warn('No sites for aux realtime sync');
      return;
    }

    // Get all aux devices from DB grouped by devTypeId
    const auxDevices = await (prisma as any).auxDevice.findMany({
      where: { plantCode: { in: plantCodes } },
      select: { id: true, siteId: true, plantCode: true, huaweiDevId: true, huaweiDevTypeId: true },
    }) as { id: number; siteId: number; plantCode: string; huaweiDevId: string; huaweiDevTypeId: number }[];

    if (auxDevices.length === 0) {
      log.info('No aux devices in DB to sync');
      return;
    }

    // Group by devTypeId
    const byType = new Map<number, typeof auxDevices>();
    for (const dev of auxDevices) {
      let arr = byType.get(dev.huaweiDevTypeId);
      if (!arr) { arr = []; byType.set(dev.huaweiDevTypeId, arr); }
      arr.push(dev);
    }

    const clients = getPreferredClientOrderForPurpose('device', 0);
    let totalUpserted = 0;
    let clientIdx = 0;

    for (const [devTypeId, devices] of byType) {
      // Batch device IDs (max 100 per call as per Huawei API)
      const devIdBatches = chunk(devices.map(d => d.huaweiDevId), 100);

      for (const devIdBatch of devIdBatches) {
        const client = clients[clientIdx % clients.length];
        clientIdx++;

        try {
          const res: any = await client.getDevRealKpi({ devTypeId, devIds: devIdBatch });

          if (!res?.success) {
            handleFailCode(client, res?.failCode, `getDevRealKpi(auxSync:${devTypeId})`);
            continue;
          }

          const rows: any[] = Array.isArray(res?.data) ? res.data : [];
          if (rows.length === 0) continue;

          // Build a lookup from huaweiDevId -> siteId
          const devLookup = new Map(devices.map(d => [String(d.huaweiDevId), d]));
          const upserts: Promise<any>[] = [];
          const fetchedAt = new Date();

          for (const row of rows) {
            const devId = String(row?.devId ?? '');
            const dev = devLookup.get(devId);
            if (!dev) continue;

            upserts.push(
              (prisma as any).auxDeviceSnapshot.upsert({
                where: { siteId_huaweiDevId: { siteId: dev.siteId, huaweiDevId: devId } },
                create: {
                  siteId: dev.siteId,
                  plantCode: dev.plantCode,
                  huaweiDevId: devId,
                  huaweiDevTypeId: devTypeId,
                  dataItemMap: row?.dataItemMap ?? null,
                  fetchedAt,
                },
                update: {
                  dataItemMap: row?.dataItemMap ?? null,
                  fetchedAt,
                },
              }),
            );
          }

          if (upserts.length > 0) {
            await Promise.all(upserts);
            totalUpserted += upserts.length;
          }
        } catch (err: any) {
          log.warn('Aux realtime batch failed', { devTypeId, error: err?.message ?? err });
        }
      }
    }

    log.info('Aux Device Realtime Sync complete', { totalUpserted, deviceTypes: byType.size, totalDevices: auxDevices.length });
  } catch (err: any) {
    log.error('Aux Realtime Sync tick failed', { error: err?.message ?? err });
    throw err;
  }
}

// ── Monthly KPI Sync (populates SiteMonthlyActual for year/lifetime view) ──
const MONTHLY_KPI_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_MONTHLY_KPI_BATCH_SIZE ?? 100)));

export async function syncMonthlyKpiTick() {
  log.info('Starting Monthly KPI Sync');
  try {
    const stationCodes = await refreshStationsIfNeeded();
    const plantCodes = stationCodes.filter((code): code is string => !!code);
    if (plantCodes.length === 0) {
      log.warn('No sites for monthly KPI sync');
      return;
    }

    const sites = await prisma.site.findMany({
      where: { plantCode: { in: plantCodes } },
      select: { id: true, plantCode: true },
    });
    const siteIdByPlantCode = new Map(sites.map((s) => [s.plantCode, s.id]));

    // Sync current year's monthly KPI
    const now = new Date();
    const HUAWEI_TZ = process.env.HUAWEI_SYNC_TIMEZONE ?? 'Asia/Bangkok';
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: HUAWEI_TZ,
      year: 'numeric',
      hour12: false,
    });
    const parts = Object.fromEntries(tzFmt.formatToParts(now).map((x) => [x.type, x.value]));
    const year = Number(parts.year);
    // collectTime = end of year (Huawei returns all months for the year)
    const collectTime = new Date(year, 11, 31, 12, 0, 0, 0).getTime();

    let totalUpserted = 0;
    const batches = chunk(plantCodes, MONTHLY_KPI_BATCH_SIZE);
    const clients = getPreferredClientOrderForPurpose('siteRealtime', 0);

    for (let bi = 0; bi < batches.length; bi++) {
      const batch = batches[bi];
      const stationCodesStr = batch.join(',');
      const client = clients[bi % clients.length];

      try {
        const res: any = await client.postRaw('/thirdData/getKpiStationMonth', {
          stationCodes: stationCodesStr,
          collectTime,
        });

        if (!res?.success && res?.failCode) {
          handleFailCode(client, res.failCode, 'getKpiStationMonth(monthlySync)');
          continue;
        }

        const rows: any[] = Array.isArray(res?.data) ? res.data : [];
        const upserts: Promise<any>[] = [];

        for (const row of rows) {
          const plantCode = String(row?.stationCode ?? '').trim();
          const siteId = siteIdByPlantCode.get(plantCode);
          if (!siteId) continue;

          const ct = parseNum(row?.collectTime);
          if (ct == null) continue;

          const map = (row?.dataItemMap ?? {}) as Record<string, unknown>;
          const dateObj = new Date(ct);
          const m = dateObj.getMonth() + 1;
          const y = dateObj.getFullYear();
          const key = `${y}-${String(m).padStart(2, '0')}`;

          const data = {
            plantCode,
            key,
            collectTime: ct,
            irradiation: parseNum(map.radiation_intensity),
            production: parseNum(map.PVYield) ?? parseNum(map.inverterYield) ?? parseNum(map.inverter_power),
            pr: parseNum(map.performance_ratio),
            gridImport: parseNum(map.buyPower),
            gridExport: parseNum(map.ongrid_power),
            consumption: parseNum(map.use_power),
            revenue: parseNum(map.power_profit),
            selfProvide: parseNum(map.selfProvide) ?? parseNum(map.selfUsePower),
          };

          upserts.push(
            prisma.siteMonthlyActual.upsert({
              where: { siteId_year_month: { siteId, year: y, month: m } },
              create: { siteId, year: y, month: m, ...data },
              update: data,
            }),
          );
        }

        if (upserts.length > 0) {
          await Promise.all(upserts);
          totalUpserted += upserts.length;
        }
      } catch (err: any) {
        log.warn('Monthly KPI batch failed', { batch: bi, error: err?.message ?? err });
      }
    }

    log.info('Monthly KPI Sync complete', { totalUpserted, batches: batches.length, sites: plantCodes.length });
  } catch (err: any) {
    log.error('Monthly KPI Sync tick failed', { error: err?.message ?? err });
    throw err;
  }
}

// ── Exported for unit testing only ──
export const __testUtils = {
  chunk,
  snapTsNow,
  startOfLocalDay,
  parseNum,
  parseDate,
  deriveStringStatus,
  deriveInverterStatus,
  enqueueRetry,
  retryQueue,
  normalizeOnDemandOptions,
  makeOnDemandInflightKey,
  pickStationCode,
  normalizeDeviceTarget,
  recordSyncOutcome,
  getBackpressureLevel,
  getBackpressureMultiplier,
  resetBackpressureWindow,
  syncDeps,
};
