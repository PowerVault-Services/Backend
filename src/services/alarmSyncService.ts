import prisma from '../config/prisma';
import { HuaweiService } from './huaweiService';
import {
  describeHuaweiClient,
  getKnownHuaweiStationCodes,
  getPreferredClientOrderForPurpose,
  getStationClientCandidates,
  hasKnownHuaweiStationInventory,
  noteStationFailure,
  registerStationAccess,
} from './huaweiPool';
import { getSyncStateSnapshot, markStations } from './syncStateService';

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function toDate(ms?: number): Date | null {
  if (!ms || !Number.isFinite(ms)) return null;
  return new Date(ms);
}

function summarizeTopPlants(items: any[], topN = 8) {
  const m = new Map<string, number>();
  for (const a of items) {
    const code = String(a?.stationCode ?? 'NA');
    m.set(code, (m.get(code) ?? 0) + 1);
  }
  const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
  return arr.map(([code, cnt]) => `${code}:${cnt}`).join(', ');
}

function makeHuaweiAlarmKey(a: any) {
  const alarmId = a?.alarmId ?? 'NA';
  const raiseTime = a?.raiseTime ?? '0';
  const esn = a?.esnCode ?? 'NA';
  return `${alarmId}:${raiseTime}:${esn}`;
}

function asObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, any>;
  }
  return {};
}

function extractSyncMeta(raw: unknown) {
  const obj = asObject(raw);
  return asObject(obj._sync);
}

function mergeAlarmRaw(existingRaw: unknown, incomingRaw: unknown, syncPatch: Record<string, any>) {
  const existing = asObject(existingRaw);
  const incoming = asObject(incomingRaw);
  const existingMeta = asObject(existing._meta);
  const incomingMeta = asObject(incoming._meta);
  const existingSync = asObject(existing._sync);
  const incomingSync = asObject(incoming._sync);

  const merged: Record<string, any> = {
    ...existing,
    ...incoming,
    _meta: { ...incomingMeta, ...existingMeta },
    _sync: { ...existingSync, ...incomingSync, ...syncPatch },
  };

  return merged;
}

function clampInt(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

const FULL_SWEEP_LOOKBACK_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_LOOKBACK_DAYS ?? 30), 1, 30);
const ONDEMAND_WINDOW_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_ONDEMAND_WINDOW_DAYS ?? 30), 1, 30);
const ONDEMAND_MAX_LOOKBACK_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_ONDEMAND_MAX_LOOKBACK_DAYS ?? 180), ONDEMAND_WINDOW_DAYS, 365);
const ALARM_BATCH_SIZE = clampInt(Number(process.env.HUAWEI_ALARM_BATCH_SIZE ?? 100), 1, 100);
const CLEAR_MISS_THRESHOLD = clampInt(Number(process.env.HUAWEI_ALARM_CLEAR_MISS_THRESHOLD ?? 2), 1, 10);

type AlarmWindow = { beginTime: number; endTime: number };

type SiteRef = {
  id: number;
  name: string;
  gridConnectionDate: Date | null;
};

type UpsertAlarmRowsResult = {
  fetched: number;
  upserted: number;
  keys: Set<string>;
  stationCodes: Set<string>;
};

type QueryAlarmStationsResult = UpsertAlarmRowsResult & {
  confirmedStationCodes: Set<string>;
};

function buildRollingWindows(now: number, maxLookbackDays: number, siteMap?: Map<string, SiteRef>, stationCodes?: string[]): AlarmWindow[] {
  const oldestAllowedFromLookback = now - maxLookbackDays * 24 * 60 * 60 * 1000;
  let oldestAllowed = oldestAllowedFromLookback;

  if (siteMap && stationCodes && stationCodes.length > 0) {
    for (const stationCode of stationCodes) {
      const gridConnectionDate = siteMap.get(stationCode)?.gridConnectionDate;
      if (!gridConnectionDate) continue;
      oldestAllowed = Math.max(oldestAllowed, gridConnectionDate.getTime());
    }
  }

  const windows: AlarmWindow[] = [];
  let cursorEnd = now;
  const windowMs = ONDEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  while (cursorEnd > oldestAllowed) {
    const beginTime = Math.max(oldestAllowed, cursorEnd - windowMs);
    windows.push({ beginTime, endTime: cursorEnd });
    if (beginTime <= oldestAllowed) break;
    cursorEnd = beginTime - 1;
  }

  return windows;
}

async function getActiveAlarmSiteCodes(): Promise<Set<string>> {
  const rows = (await prisma.alarm.findMany({
    where: { status: 'ACTIVE', clearedAt: null, siteId: { not: null } },
    select: { site: { select: { plantCode: true } } },
    take: 50000,
  } as any)) as any[];

  const out = new Set<string>();
  for (const row of rows) {
    const code = row?.site?.plantCode;
    if (code) out.add(String(code));
  }
  return out;
}

async function upsertAlarmRows(
  list: any[],
  siteMap: Map<string, SiteRef>,
  invBySn: Map<string, { id: number; siteId: number }>,
  client: HuaweiService,
  syncMode: 'full' | 'ondemand' | 'confirm',
  sweepToken: string
): Promise<UpsertAlarmRowsResult> {
  const keys = Array.from(new Set(list.map((a) => makeHuaweiAlarmKey(a))));
  const existingRows =
    keys.length > 0
      ? ((await prisma.alarm.findMany({
          where: { huaweiAlarmId: { in: keys } },
          select: { huaweiAlarmId: true, raw: true },
        } as any)) as any[])
      : [];
  const existingByKey = new Map(existingRows.map((row) => [String(row.huaweiAlarmId ?? ''), row.raw]));

  let upserted = 0;
  const stationCodes = new Set<string>();
  const keySet = new Set<string>();
  const nowIso = new Date().toISOString();

  for (const a of list) {
    const key = makeHuaweiAlarmKey(a);
    const stationCode = String(a?.stationCode ?? '');
    if (stationCode) stationCodes.add(stationCode);
    keySet.add(key);

    const site = siteMap.get(stationCode);
    const esn = a?.esnCode ? String(a.esnCode) : null;
    const inv = esn ? invBySn.get(esn) : null;
    const occurredAt = toDate(a?.raiseTime);
    const severity = a?.lev != null ? Number(a.lev) : null;
    const raw = mergeAlarmRaw(existingByKey.get(key), a, {
      lastSeenAt: nowIso,
      lastSweepToken: sweepToken,
      lastSourceAccount: describeHuaweiClient(client),
      lastSyncMode: syncMode,
      missCount: 0,
      lastConfirmedPresentAt: nowIso,
    });

    await prisma.alarm.upsert({
      where: { huaweiAlarmId: key },
      create: {
        huaweiAlarmId: key,
        siteId: site?.id,
        inverterId: inv?.id,
        name: a?.alarmName ?? null,
        severity: severity ?? null,
        status: 'ACTIVE',
        occurredAt,
        clearedAt: null,
        raw,
      },
      update: {
        siteId: site?.id ?? undefined,
        inverterId: inv?.id ?? undefined,
        name: a?.alarmName ?? undefined,
        severity: severity ?? undefined,
        status: 'ACTIVE',
        occurredAt: occurredAt ?? undefined,
        clearedAt: null,
        raw,
      },
    });

    upserted += 1;
    if (stationCode) registerStationAccess(stationCode, client);
  }

  return { fetched: list.length, upserted, keys: keySet, stationCodes };
}

async function fetchAlarmList(
  client: HuaweiService,
  stationCodes: string[],
  window: AlarmWindow,
  logContext: string
): Promise<any[] | null> {
  const res = await client.getAlarmList({
    stationCodes,
    beginTime: window.beginTime,
    endTime: window.endTime,
    language: 'en_US',
    levels: '1,2,3,4',
  });

  if (!res?.success) {
    console.warn(`⚠️ [ALARM] Huawei getAlarmList failed via ${describeHuaweiClient(client)} (${logContext})`, {
      failCode: (res as any)?.failCode,
      message: (res as any)?.message,
      batchSize: stationCodes.length,
    });
    stationCodes.forEach((code) => noteStationFailure(code, client));
    return null;
  }

  return Array.isArray(res?.data) ? (res.data as any[]) : [];
}

async function queryAlarmStations(
  stationCodes: string[],
  siteMap: Map<string, SiteRef>,
  invBySn: Map<string, { id: number; siteId: number }>,
  opts: {
    syncMode: 'full' | 'ondemand' | 'confirm';
    windows: AlarmWindow[];
    primaryClient?: HuaweiService | null;
    batchIndex?: number;
    expectedActiveSiteCodes?: Set<string>;
    logContext: string;
  }
): Promise<QueryAlarmStationsResult> {
  const collectedByKey = new Map<string, any>();
  const confirmedStationCodes = new Set<string>();
  let fetched = 0;
  let upserted = 0;
  const seenKeys = new Set<string>();
  const seenStations = new Set<string>();
  const sweepToken = `${opts.syncMode}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;

  for (let windowIndex = 0; windowIndex < opts.windows.length; windowIndex += 1) {
    const window = opts.windows[windowIndex];
    const candidates = Array.from(
      new Map(
        [
          ...(opts.primaryClient ? [opts.primaryClient] : []),
          ...getPreferredClientOrderForPurpose(opts.syncMode === 'ondemand' ? 'ondemand' : 'alarm', (opts.batchIndex ?? 0) + windowIndex),
        ].map((service) => [service.getAccountKey(), service])
      ).values()
    );

    let successfullyQueried = false;
    let needSecondaryForSites = new Set<string>();

    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
      const client = candidates[candidateIndex];
      const targetStationCodes = candidateIndex === 0 ? stationCodes : Array.from(needSecondaryForSites);
      if (targetStationCodes.length === 0) break;

      const list = await fetchAlarmList(client, targetStationCodes, window, `${opts.logContext} w${windowIndex + 1} c${candidateIndex + 1}`);
      if (list == null) continue;
      successfullyQueried = true;
      targetStationCodes.forEach((code) => confirmedStationCodes.add(code));
      markStations('alarm', targetStationCodes);

      fetched += list.length;
      const result = await upsertAlarmRows(list, siteMap, invBySn, client, opts.syncMode, sweepToken);
      upserted += result.upserted;
      result.keys.forEach((key) => seenKeys.add(key));
      result.stationCodes.forEach((code) => seenStations.add(code));
      for (const row of list) {
        collectedByKey.set(makeHuaweiAlarmKey(row), row);
      }

      if (candidateIndex === 0) {
        const returnedSites = result.stationCodes;
        needSecondaryForSites = new Set<string>();

        const expectedActive = opts.expectedActiveSiteCodes ?? new Set<string>();
        for (const code of targetStationCodes) {
          if (!returnedSites.has(code) && expectedActive.has(code)) {
            needSecondaryForSites.add(code);
          }
        }

        if (list.length === 0 && targetStationCodes.length > 0) {
          targetStationCodes.forEach((code) => needSecondaryForSites.add(code));
        }
      } else {
        needSecondaryForSites.clear();
      }
    }

    if (!successfullyQueried) {
      console.warn(`⚠️ [ALARM] No client could query alarms for batch (${opts.logContext}) window ${windowIndex + 1}/${opts.windows.length}`);
    }
  }

  return {
    fetched,
    upserted,
    keys: seenKeys,
    stationCodes: seenStations,
    confirmedStationCodes,
  };
}

async function confirmAndMaybeClearMissingActiveAlarms(
  seenKeys: Set<string>,
  siteMap: Map<string, SiteRef>,
  invBySn: Map<string, { id: number; siteId: number }>,
  reason: 'full' | 'ondemand',
  stationScope?: Set<string>
) {
  const where: any = {
    status: 'ACTIVE',
    clearedAt: null,
  };

  if (stationScope && stationScope.size > 0) {
    where.site = { is: { plantCode: { in: Array.from(stationScope) } } };
  }

  const candidates = (await prisma.alarm.findMany({
    where,
    select: {
      id: true,
      huaweiAlarmId: true,
      raw: true,
      site: { select: { plantCode: true } },
    },
    take: 50000,
  } as any)) as any[];

  const missingByStation = new Map<string, typeof candidates>();
  for (const alarm of candidates) {
    const key = String(alarm.huaweiAlarmId ?? '');
    if (!key || seenKeys.has(key)) continue;
    const stationCode = alarm?.site?.plantCode ? String(alarm.site.plantCode) : '';
    if (!stationCode) continue;
    if (!missingByStation.has(stationCode)) missingByStation.set(stationCode, []);
    missingByStation.get(stationCode)!.push(alarm);
  }

  if (missingByStation.size === 0) {
    return { cleared: 0, confirmed: 0, pending: 0 };
  }

  const stationCodes = Array.from(missingByStation.keys());
  const windows = buildRollingWindows(Date.now(), reason === 'ondemand' ? ONDEMAND_MAX_LOOKBACK_DAYS : Math.max(FULL_SWEEP_LOOKBACK_DAYS, ONDEMAND_WINDOW_DAYS), siteMap, stationCodes);
  const confirmationSeenKeys = new Set<string>();
  const confirmationConfirmedSites = new Set<string>();

  for (let i = 0; i < stationCodes.length; i += 1) {
    const stationCode = stationCodes[i];
    const result = await queryAlarmStations([stationCode], siteMap, invBySn, {
      syncMode: 'confirm',
      windows,
      batchIndex: i,
      logContext: `confirm-clear(${reason})`,
    });

    result.keys.forEach((key) => confirmationSeenKeys.add(key));
    result.confirmedStationCodes.forEach((code) => confirmationConfirmedSites.add(code));
  }

  let cleared = 0;
  let confirmed = 0;
  let pending = 0;
  const nowIso = new Date().toISOString();
  const updates: Promise<any>[] = [];

  for (const [stationCode, alarms] of missingByStation.entries()) {
    const siteWasConfirmed = confirmationConfirmedSites.has(stationCode);
    if (!siteWasConfirmed) {
      pending += alarms.length;
      continue;
    }

    confirmed += alarms.length;
    for (const alarm of alarms) {
      const key = String(alarm.huaweiAlarmId ?? '');
      if (!key) continue;
      if (confirmationSeenKeys.has(key)) continue;

      const syncMeta = extractSyncMeta(alarm.raw);
      const nextMissCount = Number(syncMeta.missCount ?? 0) + 1;
      const mergedRaw = mergeAlarmRaw(alarm.raw, {}, {
        missCount: nextMissCount,
        lastConfirmedAbsentAt: nowIso,
        lastConfirmationReason: reason,
      });

      if (nextMissCount >= CLEAR_MISS_THRESHOLD) {
        cleared += 1;
        updates.push(
          prisma.alarm.update({
            where: { id: alarm.id },
            data: {
              status: 'CLEARED',
              clearedAt: new Date(),
              raw: mergeAlarmRaw(mergedRaw, {}, {
                clearedBySyncAt: nowIso,
                clearedBySyncReason: reason,
              }),
            },
          })
        );
      } else {
        pending += 1;
        updates.push(
          prisma.alarm.update({
            where: { id: alarm.id },
            data: { raw: mergedRaw },
          })
        );
      }
    }
  }

  if (updates.length > 0) {
    await Promise.all(updates);
  }

  return { cleared, confirmed, pending };
}

export async function syncActiveAlarms() {
  const now = Date.now();
  const beginTime = now - FULL_SWEEP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
  const endTime = now;

  const knownStationCodes = hasKnownHuaweiStationInventory() ? getKnownHuaweiStationCodes() : [];
  const sites = await prisma.site.findMany({
    where: knownStationCodes.length > 0 ? { plantCode: { in: knownStationCodes } } : undefined,
    select: { id: true, plantCode: true, name: true, gridConnectionDate: true },
    take: 5000,
  });

  const stationCodes = sites.map((s) => s.plantCode).filter(Boolean);
  if (stationCodes.length === 0) return { ok: true, fetched: 0, upserted: 0, cleared: 0, confirmed: 0, pending: 0 };

  const siteMap = new Map<string, SiteRef>();
  for (const s of sites) siteMap.set(s.plantCode, { id: s.id, name: s.name, gridConnectionDate: s.gridConnectionDate ?? null });

  const inverters = await prisma.inverter.findMany({
    select: { id: true, serialNumber: true, siteId: true },
    take: 50000,
  });

  const invBySn = new Map<string, { id: number; siteId: number }>();
  for (const inv of inverters) invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });

  const expectedActiveSiteCodes = await getActiveAlarmSiteCodes();

  let totalFetched = 0;
  let totalUpserted = 0;
  const seenKeys = new Set<string>();

  const groupedByClient = new Map<string, { client: HuaweiService; stationCodes: string[] }>();
  for (let i = 0; i < stationCodes.length; i += 1) {
    const stationCode = stationCodes[i];
    const primary = getStationClientCandidates(stationCode, 'alarm', { batchIndex: i })[0] ?? getPreferredClientOrderForPurpose('alarm', i)[0];
    const key = primary.getAccountKey();
    if (!groupedByClient.has(key)) groupedByClient.set(key, { client: primary, stationCodes: [] });
    groupedByClient.get(key)!.stationCodes.push(stationCode);
  }

  let batchIndex = 0;
  for (const group of groupedByClient.values()) {
    const batches = chunk(group.stationCodes, ALARM_BATCH_SIZE);

    for (const batch of batches) {
      console.log(`🔁 [${describeHuaweiClient(group.client)}] Sync alarm batch: ${batch.length} plants (first=${batch[0]})`);
      const result = await queryAlarmStations(batch, siteMap, invBySn, {
        syncMode: 'full',
        windows: [{ beginTime, endTime }],
        primaryClient: group.client,
        batchIndex,
        expectedActiveSiteCodes,
        logContext: `full-batch-${batchIndex + 1}`,
      });

      totalFetched += result.fetched;
      totalUpserted += result.upserted;
      result.keys.forEach((key) => seenKeys.add(key));

      console.log(`📥 [ALARM] Batch alarms=${result.fetched}`);
      batchIndex += 1;
    }
  }

  const clearResult = await confirmAndMaybeClearMissingActiveAlarms(seenKeys, siteMap, invBySn, 'full');

  return {
    ok: true,
    fetched: totalFetched,
    upserted: totalUpserted,
    cleared: clearResult.cleared,
    confirmed: clearResult.confirmed,
    pending: clearResult.pending,
  };
}

/**
 * ON-DEMAND: sync alarms for specific plants using a deep rolling window.
 * The signature stays backward-compatible for frontend callers that pass lookbackHours.
 */
export async function syncAlarmsForStationsOnDemand(stationCodes: string[], lookbackHours = 24) {
  const requestedStationCodes = Array.from(new Set((stationCodes ?? []).filter(Boolean)));
  const knownStationCodeSet = hasKnownHuaweiStationInventory() ? new Set(getKnownHuaweiStationCodes()) : null;
  const uniqueStationCodes = knownStationCodeSet
    ? requestedStationCodes.filter((code) => knownStationCodeSet.has(code))
    : requestedStationCodes;
  const skippedStationCodes = knownStationCodeSet ? requestedStationCodes.filter((code) => !knownStationCodeSet.has(code)) : [];
  if (skippedStationCodes.length > 0) {
    console.warn(`🧹 [ONDEMAND] Skip alarm sync for ${skippedStationCodes.length} local-only/test sites not present in Huawei inventory: ${skippedStationCodes.slice(0, 10).join(', ')}`);
  }
  if (uniqueStationCodes.length === 0) return { ok: true, fetched: 0, upserted: 0, cleared: 0, confirmed: 0, pending: 0, skippedStationCodes };

  const sites = await prisma.site.findMany({
    where: { plantCode: { in: uniqueStationCodes } },
    select: { id: true, plantCode: true, name: true, gridConnectionDate: true },
  });

  const siteMap = new Map<string, SiteRef>();
  for (const s of sites) siteMap.set(s.plantCode, { id: s.id, name: s.name, gridConnectionDate: s.gridConnectionDate ?? null });

  const invs = await prisma.inverter.findMany({
    where: { stationCode: { in: uniqueStationCodes } },
    select: { id: true, serialNumber: true, siteId: true },
  });
  const invBySn = new Map<string, { id: number; siteId: number }>();
  for (const inv of invs) invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });

  const now = Date.now();
  const minimumLookbackDays = clampInt(Math.ceil(lookbackHours / 24), 1, ONDEMAND_MAX_LOOKBACK_DAYS);
  const maxLookbackDays = Math.max(minimumLookbackDays, ONDEMAND_MAX_LOOKBACK_DAYS);
  const windows = buildRollingWindows(now, maxLookbackDays, siteMap, uniqueStationCodes);

  let fetched = 0;
  let upserted = 0;
  const seenKeys = new Set<string>();

  console.log(`⚡ [ONDEMAND] Refresh alarms for plants=${uniqueStationCodes.length} (first=${uniqueStationCodes[0]}) windows=${windows.length}`);

  const batches = chunk(uniqueStationCodes, ALARM_BATCH_SIZE);
  for (let i = 0; i < batches.length; i += 1) {
    const batch = batches[i];
    const primaryClient = getStationClientCandidates(batch[0], 'ondemand', { batchIndex: i })[0];
    const result = await queryAlarmStations(batch, siteMap, invBySn, {
      syncMode: 'ondemand',
      windows,
      primaryClient,
      batchIndex: i,
      logContext: `ondemand-${i + 1}`,
    });

    fetched += result.fetched;
    upserted += result.upserted;
    result.keys.forEach((key) => seenKeys.add(key));
  }

  const clearResult = await confirmAndMaybeClearMissingActiveAlarms(seenKeys, siteMap, invBySn, 'ondemand', new Set(uniqueStationCodes));

  return { ok: true, fetched, upserted, cleared: clearResult.cleared, confirmed: clearResult.confirmed, pending: clearResult.pending, skippedStationCodes };
}


export async function getAlarmReconciliationSnapshot() {
  const syncState = getSyncStateSnapshot();
  const sites = (await prisma.site.findMany({
    select: { id: true, plantCode: true, name: true },
    orderBy: { plantCode: 'asc' },
    take: 5000,
  } as any)) as Array<{ id: number; plantCode: string; name: string }>;

  const alarms = (await prisma.alarm.findMany({
    where: { status: 'ACTIVE', clearedAt: null },
    select: {
      huaweiAlarmId: true,
      raw: true,
      site: { select: { plantCode: true, name: true } },
    },
    take: 50000,
  } as any)) as any[];

  const now = Date.now();
  const staleThresholdMs = Number(process.env.HUAWEI_ALARM_STALE_MS ?? 15 * 60_000);
  const bySite = new Map<string, { plantCode: string; name: string; activeCount: number; staleCount: number; lastAlarmSyncAt: string | null }>();

  for (const site of sites) {
    bySite.set(site.plantCode, {
      plantCode: site.plantCode,
      name: site.name,
      activeCount: 0,
      staleCount: 0,
      lastAlarmSyncAt: syncState.stations.alarm[site.plantCode] ?? null,
    });
  }

  let activeCount = 0;
  let staleActiveCount = 0;
  let pendingClearCount = 0;

  for (const alarm of alarms) {
    activeCount += 1;
    const stationCode = String(alarm?.site?.plantCode ?? '');
    const siteRow = bySite.get(stationCode);
    const syncMeta = extractSyncMeta(alarm.raw);
    const lastSeenAt = syncMeta.lastSeenAt ? new Date(String(syncMeta.lastSeenAt)).getTime() : null;
    const missCount = Number(syncMeta.missCount ?? 0);
    const isStale = lastSeenAt != null ? now - lastSeenAt > staleThresholdMs : true;

    if (isStale) staleActiveCount += 1;
    if (missCount > 0) pendingClearCount += 1;

    if (siteRow) {
      siteRow.activeCount += 1;
      if (isStale) siteRow.staleCount += 1;
    }
  }

  const topSites = Array.from(bySite.values())
    .filter((row) => row.activeCount > 0 || row.staleCount > 0)
    .sort((a, b) => b.activeCount - a.activeCount || b.staleCount - a.staleCount || a.plantCode.localeCompare(b.plantCode))
    .slice(0, 30)
    .map((row) => ({
      ...row,
      lastAlarmSyncAgeMs: row.lastAlarmSyncAt ? Math.max(0, now - new Date(row.lastAlarmSyncAt).getTime()) : null,
    }));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      sites: sites.length,
      activeCount,
      staleActiveCount,
      pendingClearCount,
      staleThresholdMs,
    },
    topSites,
  };
}
