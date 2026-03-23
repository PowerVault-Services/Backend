"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.__testUtils = exports.alarmSyncDeps = void 0;
exports.syncActiveAlarms = syncActiveAlarms;
exports.syncAlarmsForStationsOnDemand = syncAlarmsForStationsOnDemand;
exports.getAlarmReconciliationSnapshot = getAlarmReconciliationSnapshot;
const prisma_1 = __importDefault(require("../config/prisma"));
const logger_1 = require("../config/logger");
const log = (0, logger_1.createLogger)('alarm');
exports.alarmSyncDeps = { prisma: prisma_1.default, log };
const huaweiPool_1 = require("./huaweiPool");
const syncStateService_1 = require("./syncStateService");
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
function toDate(ms) {
    if (!ms || !Number.isFinite(ms))
        return null;
    return new Date(ms);
}
function summarizeTopPlants(items, topN = 8) {
    const m = new Map();
    for (const a of items) {
        const code = String(a?.stationCode ?? 'NA');
        m.set(code, (m.get(code) ?? 0) + 1);
    }
    const arr = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
    return arr.map(([code, cnt]) => `${code}:${cnt}`).join(', ');
}
function makeHuaweiAlarmKey(a) {
    const alarmId = a?.alarmId ?? 'NA';
    const raiseTime = a?.raiseTime ?? '0';
    const esn = a?.esnCode ?? 'NA';
    return `${alarmId}:${raiseTime}:${esn}`;
}
function asObject(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return value;
    }
    return {};
}
function extractSyncMeta(raw) {
    const obj = asObject(raw);
    return asObject(obj._sync);
}
function mergeAlarmRaw(existingRaw, incomingRaw, syncPatch) {
    const existing = asObject(existingRaw);
    const incoming = asObject(incomingRaw);
    const existingMeta = asObject(existing._meta);
    const incomingMeta = asObject(incoming._meta);
    const existingSync = asObject(existing._sync);
    const incomingSync = asObject(incoming._sync);
    const merged = {
        ...existing,
        ...incoming,
        _meta: { ...incomingMeta, ...existingMeta },
        _sync: { ...existingSync, ...incomingSync, ...syncPatch },
    };
    return merged;
}
function clampInt(value, min, max) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, Math.trunc(value)));
}
// ── Alarm State Machine ──
// Defines valid alarm states and their allowed transitions.
// Prevents illegal state changes (e.g. CLEARED → ACTIVE without re-raise).
const ALARM_STATES = ['ACTIVE', 'CLEARED'];
const ALARM_TRANSITIONS = {
    ACTIVE: ['CLEARED'], // Active alarms can only be cleared
    CLEARED: ['ACTIVE'], // Cleared alarms can be re-raised if Huawei reports them again
};
function isValidAlarmTransition(from, to) {
    if (!from)
        return to === 'ACTIVE'; // New alarm must start as ACTIVE
    if (from === to)
        return true; // Idempotent (no-op transition)
    const allowed = ALARM_TRANSITIONS[from];
    return !!allowed && allowed.includes(to);
}
function assertAlarmTransition(from, to, context) {
    if (!isValidAlarmTransition(from, to)) {
        log.warn('Invalid alarm state transition blocked', { from, to, context });
        throw new Error(`Invalid alarm transition: ${from ?? 'NULL'} → ${to} (${context})`);
    }
}
const FULL_SWEEP_LOOKBACK_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_LOOKBACK_DAYS ?? 30), 1, 30);
const INCREMENTAL_LOOKBACK_HOURS = clampInt(Number(process.env.HUAWEI_ALARM_INCREMENTAL_LOOKBACK_HOURS ?? 6), 1, 72);
const FULL_SWEEP_INTERVAL_MS = Math.max(60000, Number(process.env.HUAWEI_ALARM_FULL_SWEEP_INTERVAL_MS ?? 6 * 60 * 60000));
let lastFullSweepAt = 0;
const ONDEMAND_WINDOW_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_ONDEMAND_WINDOW_DAYS ?? 30), 1, 30);
const ONDEMAND_MAX_LOOKBACK_DAYS = clampInt(Number(process.env.HUAWEI_ALARM_ONDEMAND_MAX_LOOKBACK_DAYS ?? 180), ONDEMAND_WINDOW_DAYS, 365);
const ALARM_BATCH_SIZE = clampInt(Number(process.env.HUAWEI_ALARM_BATCH_SIZE ?? 100), 1, 100);
const CLEAR_MISS_THRESHOLD = clampInt(Number(process.env.HUAWEI_ALARM_CLEAR_MISS_THRESHOLD ?? 2), 1, 10);
const CLEAR_MIN_ABSENCE_MS = Math.max(0, Number(process.env.HUAWEI_ALARM_CLEAR_MIN_ABSENCE_MS ?? 60 * 60000)); // default 1 hour
function buildRollingWindows(now, maxLookbackDays, siteMap, stationCodes) {
    const oldestAllowedFromLookback = now - maxLookbackDays * 24 * 60 * 60 * 1000;
    let oldestAllowed = oldestAllowedFromLookback;
    if (siteMap && stationCodes && stationCodes.length > 0) {
        for (const stationCode of stationCodes) {
            const gridConnectionDate = siteMap.get(stationCode)?.gridConnectionDate;
            if (!gridConnectionDate)
                continue;
            oldestAllowed = Math.max(oldestAllowed, gridConnectionDate.getTime());
        }
    }
    const windows = [];
    let cursorEnd = now;
    const windowMs = ONDEMAND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    while (cursorEnd > oldestAllowed) {
        const beginTime = Math.max(oldestAllowed, cursorEnd - windowMs);
        windows.push({ beginTime, endTime: cursorEnd });
        if (beginTime <= oldestAllowed)
            break;
        cursorEnd = beginTime - 1;
    }
    return windows;
}
async function getActiveAlarmSiteCodes() {
    const rows = (await prisma_1.default.alarm.findMany({
        where: { status: 'ACTIVE', clearedAt: null, siteId: { not: null } },
        select: { site: { select: { plantCode: true } } },
        take: 50000,
    }));
    const out = new Set();
    for (const row of rows) {
        const code = row?.site?.plantCode;
        if (code)
            out.add(String(code));
    }
    return out;
}
async function upsertAlarmRows(list, siteMap, invBySn, client, syncMode, sweepToken) {
    const keys = Array.from(new Set(list.map((a) => makeHuaweiAlarmKey(a))));
    const existingRows = keys.length > 0
        ? (await prisma_1.default.alarm.findMany({
            where: { huaweiAlarmId: { in: keys } },
            select: { huaweiAlarmId: true, raw: true },
        }))
        : [];
    const existingByKey = new Map(existingRows.map((row) => [String(row.huaweiAlarmId ?? ''), row.raw]));
    const stationCodes = new Set();
    const keySet = new Set();
    const nowIso = new Date().toISOString();
    const upsertOps = [];
    const accessCodes = [];
    for (const a of list) {
        const key = makeHuaweiAlarmKey(a);
        const stationCode = String(a?.stationCode ?? '');
        if (stationCode)
            stationCodes.add(stationCode);
        keySet.add(key);
        const site = siteMap.get(stationCode);
        const esn = a?.esnCode ? String(a.esnCode) : null;
        const inv = esn ? invBySn.get(esn) : null;
        const occurredAt = toDate(a?.raiseTime);
        const severity = a?.lev != null ? Number(a.lev) : null;
        const raw = mergeAlarmRaw(existingByKey.get(key), a, {
            lastSeenAt: nowIso,
            lastSweepToken: sweepToken,
            lastSourceAccount: (0, huaweiPool_1.describeHuaweiClient)(client),
            lastSyncMode: syncMode,
            missCount: 0,
            lastConfirmedPresentAt: nowIso,
        });
        // Validate state transition: new alarms → ACTIVE, existing CLEARED → re-ACTIVE
        const existingStatus = existingByKey.has(key) ? 'ACTIVE' : null; // existing rows in scope are ACTIVE (we only upsert seen alarms)
        assertAlarmTransition(existingStatus, 'ACTIVE', `upsert:${key}`);
        upsertOps.push(prisma_1.default.alarm.upsert({
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
        }));
        if (stationCode)
            accessCodes.push(stationCode);
    }
    // Batch all alarm upserts in chunks of 50 to avoid oversized transactions
    for (let i = 0; i < upsertOps.length; i += 50) {
        await prisma_1.default.$transaction(upsertOps.slice(i, i + 50));
    }
    for (const code of accessCodes)
        (0, huaweiPool_1.registerStationAccess)(code, client);
    return { fetched: list.length, upserted: upsertOps.length, keys: keySet, stationCodes };
}
async function fetchAlarmList(client, stationCodes, window, logContext) {
    const res = await client.getAlarmList({
        stationCodes,
        beginTime: window.beginTime,
        endTime: window.endTime,
        language: 'en_US',
        levels: '1,2,3,4',
    });
    if (!res?.success) {
        log.warn('Huawei getAlarmList failed', {
            client: (0, huaweiPool_1.describeHuaweiClient)(client),
            context: logContext,
            failCode: res?.failCode,
            message: res?.message,
            batchSize: stationCodes.length,
        });
        stationCodes.forEach((code) => (0, huaweiPool_1.noteStationFailure)(code, client));
        return null;
    }
    return Array.isArray(res?.data) ? res.data : [];
}
async function queryAlarmStations(stationCodes, siteMap, invBySn, opts) {
    const collectedByKey = new Map();
    const confirmedStationCodes = new Set();
    let fetched = 0;
    let upserted = 0;
    const seenKeys = new Set();
    const seenStations = new Set();
    const sweepToken = `${opts.syncMode}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    for (let windowIndex = 0; windowIndex < opts.windows.length; windowIndex += 1) {
        const window = opts.windows[windowIndex];
        const candidates = Array.from(new Map([
            ...(opts.primaryClient ? [opts.primaryClient] : []),
            ...(0, huaweiPool_1.getPreferredClientOrderForPurpose)(opts.syncMode === 'ondemand' ? 'ondemand' : 'alarm', (opts.batchIndex ?? 0) + windowIndex),
        ].map((service) => [service.getAccountKey(), service])).values());
        let successfullyQueried = false;
        let needSecondaryForSites = new Set();
        for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
            const client = candidates[candidateIndex];
            const targetStationCodes = candidateIndex === 0 ? stationCodes : Array.from(needSecondaryForSites);
            if (targetStationCodes.length === 0)
                break;
            const list = await fetchAlarmList(client, targetStationCodes, window, `${opts.logContext} w${windowIndex + 1} c${candidateIndex + 1}`);
            if (list == null)
                continue;
            successfullyQueried = true;
            targetStationCodes.forEach((code) => confirmedStationCodes.add(code));
            (0, syncStateService_1.markStations)('alarm', targetStationCodes);
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
                needSecondaryForSites = new Set();
                const expectedActive = opts.expectedActiveSiteCodes ?? new Set();
                for (const code of targetStationCodes) {
                    if (!returnedSites.has(code) && expectedActive.has(code)) {
                        needSecondaryForSites.add(code);
                    }
                }
                if (list.length === 0 && targetStationCodes.length > 0) {
                    targetStationCodes.forEach((code) => needSecondaryForSites.add(code));
                }
            }
            else {
                needSecondaryForSites.clear();
            }
        }
        if (!successfullyQueried) {
            log.warn('No client could query alarms for batch', { context: opts.logContext, window: `${windowIndex + 1}/${opts.windows.length}` });
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
async function confirmAndMaybeClearMissingActiveAlarms(seenKeys, siteMap, invBySn, reason, stationScope) {
    const where = {
        status: 'ACTIVE',
        clearedAt: null,
    };
    if (stationScope && stationScope.size > 0) {
        where.site = { is: { plantCode: { in: Array.from(stationScope) } } };
    }
    const candidates = (await prisma_1.default.alarm.findMany({
        where,
        select: {
            id: true,
            huaweiAlarmId: true,
            raw: true,
            site: { select: { plantCode: true } },
        },
        take: 50000,
    }));
    const missingByStation = new Map();
    for (const alarm of candidates) {
        const key = String(alarm.huaweiAlarmId ?? '');
        if (!key || seenKeys.has(key))
            continue;
        const stationCode = alarm?.site?.plantCode ? String(alarm.site.plantCode) : '';
        if (!stationCode)
            continue;
        if (!missingByStation.has(stationCode))
            missingByStation.set(stationCode, []);
        missingByStation.get(stationCode).push(alarm);
    }
    if (missingByStation.size === 0) {
        return { cleared: 0, confirmed: 0, pending: 0 };
    }
    const stationCodes = Array.from(missingByStation.keys());
    const windows = buildRollingWindows(Date.now(), reason === 'ondemand' ? ONDEMAND_MAX_LOOKBACK_DAYS : Math.max(FULL_SWEEP_LOOKBACK_DAYS, ONDEMAND_WINDOW_DAYS), siteMap, stationCodes);
    const confirmationSeenKeys = new Set();
    const confirmationConfirmedSites = new Set();
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
    const updates = [];
    for (const [stationCode, alarms] of missingByStation.entries()) {
        const siteWasConfirmed = confirmationConfirmedSites.has(stationCode);
        if (!siteWasConfirmed) {
            pending += alarms.length;
            continue;
        }
        confirmed += alarms.length;
        for (const alarm of alarms) {
            const key = String(alarm.huaweiAlarmId ?? '');
            if (!key)
                continue;
            if (confirmationSeenKeys.has(key))
                continue;
            const syncMeta = extractSyncMeta(alarm.raw);
            const nextMissCount = Number(syncMeta.missCount ?? 0) + 1;
            const mergedRaw = mergeAlarmRaw(alarm.raw, {}, {
                missCount: nextMissCount,
                lastConfirmedAbsentAt: nowIso,
                lastConfirmationReason: reason,
            });
            if (nextMissCount >= CLEAR_MISS_THRESHOLD) {
                // Guard: don't clear if last confirmed present too recently (API may have returned partial data)
                const lastPresentAt = syncMeta.lastConfirmedPresentAt ? new Date(String(syncMeta.lastConfirmedPresentAt)).getTime() : 0;
                const absenceMs = Date.now() - lastPresentAt;
                if (CLEAR_MIN_ABSENCE_MS > 0 && lastPresentAt > 0 && absenceMs < CLEAR_MIN_ABSENCE_MS) {
                    pending += 1;
                    updates.push(prisma_1.default.alarm.update({
                        where: { id: alarm.id },
                        data: { raw: mergedRaw },
                    }));
                    continue;
                }
                assertAlarmTransition('ACTIVE', 'CLEARED', `clear:${key}`);
                cleared += 1;
                updates.push(prisma_1.default.alarm.update({
                    where: { id: alarm.id },
                    data: {
                        status: 'CLEARED',
                        clearedAt: new Date(),
                        raw: mergeAlarmRaw(mergedRaw, {}, {
                            clearedBySyncAt: nowIso,
                            clearedBySyncReason: reason,
                        }),
                    },
                }));
            }
            else {
                pending += 1;
                updates.push(prisma_1.default.alarm.update({
                    where: { id: alarm.id },
                    data: { raw: mergedRaw },
                }));
            }
        }
    }
    if (updates.length > 0) {
        await Promise.all(updates);
    }
    return { cleared, confirmed, pending };
}
async function syncActiveAlarms() {
    const now = Date.now();
    const isFullSweep = lastFullSweepAt === 0 || now - lastFullSweepAt >= FULL_SWEEP_INTERVAL_MS;
    const lookbackMs = isFullSweep
        ? FULL_SWEEP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000
        : INCREMENTAL_LOOKBACK_HOURS * 60 * 60 * 1000;
    const beginTime = now - lookbackMs;
    const endTime = now;
    if (isFullSweep) {
        log.info('Alarm full sweep', { lookbackDays: FULL_SWEEP_LOOKBACK_DAYS });
        lastFullSweepAt = now;
    }
    else {
        log.info('Alarm incremental sweep', { lookbackHours: INCREMENTAL_LOOKBACK_HOURS });
    }
    const knownStationCodes = (0, huaweiPool_1.hasKnownHuaweiStationInventory)() ? (0, huaweiPool_1.getKnownHuaweiStationCodes)() : [];
    const sites = await prisma_1.default.site.findMany({
        where: knownStationCodes.length > 0 ? { plantCode: { in: knownStationCodes } } : undefined,
        select: { id: true, plantCode: true, name: true, gridConnectionDate: true },
        take: 5000,
    });
    const stationCodes = sites.map((s) => s.plantCode).filter(Boolean);
    if (stationCodes.length === 0)
        return { ok: true, fetched: 0, upserted: 0, cleared: 0, confirmed: 0, pending: 0 };
    const siteMap = new Map();
    for (const s of sites)
        siteMap.set(s.plantCode, { id: s.id, name: s.name, gridConnectionDate: s.gridConnectionDate ?? null });
    const inverters = await prisma_1.default.inverter.findMany({
        select: { id: true, serialNumber: true, siteId: true },
        take: 50000,
    });
    const invBySn = new Map();
    for (const inv of inverters)
        invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });
    const expectedActiveSiteCodes = await getActiveAlarmSiteCodes();
    let totalFetched = 0;
    let totalUpserted = 0;
    const seenKeys = new Set();
    const groupedByClient = new Map();
    for (let i = 0; i < stationCodes.length; i += 1) {
        const stationCode = stationCodes[i];
        const primary = (0, huaweiPool_1.getStationClientCandidates)(stationCode, 'alarm', { batchIndex: i })[0] ?? (0, huaweiPool_1.getPreferredClientOrderForPurpose)('alarm', i)[0];
        const key = primary.getAccountKey();
        if (!groupedByClient.has(key))
            groupedByClient.set(key, { client: primary, stationCodes: [] });
        groupedByClient.get(key).stationCodes.push(stationCode);
    }
    let batchIndex = 0;
    for (const group of groupedByClient.values()) {
        const batches = chunk(group.stationCodes, ALARM_BATCH_SIZE);
        for (const batch of batches) {
            log.info('Sync alarm batch', { client: (0, huaweiPool_1.describeHuaweiClient)(group.client), batchSize: batch.length, first: batch[0] });
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
            log.info('Alarm batch result', { fetched: result.fetched });
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
async function syncAlarmsForStationsOnDemand(stationCodes, lookbackHours = 24) {
    const requestedStationCodes = Array.from(new Set((stationCodes ?? []).filter(Boolean)));
    const knownStationCodeSet = (0, huaweiPool_1.hasKnownHuaweiStationInventory)() ? new Set((0, huaweiPool_1.getKnownHuaweiStationCodes)()) : null;
    const uniqueStationCodes = knownStationCodeSet
        ? requestedStationCodes.filter((code) => knownStationCodeSet.has(code))
        : requestedStationCodes;
    const skippedStationCodes = knownStationCodeSet ? requestedStationCodes.filter((code) => !knownStationCodeSet.has(code)) : [];
    if (skippedStationCodes.length > 0) {
        log.warn('ONDEMAND: skip alarm sync for sites not in Huawei inventory', { count: skippedStationCodes.length, sample: skippedStationCodes.slice(0, 10) });
    }
    if (uniqueStationCodes.length === 0)
        return { ok: true, fetched: 0, upserted: 0, cleared: 0, confirmed: 0, pending: 0, skippedStationCodes };
    const sites = await prisma_1.default.site.findMany({
        where: { plantCode: { in: uniqueStationCodes } },
        select: { id: true, plantCode: true, name: true, gridConnectionDate: true },
    });
    const siteMap = new Map();
    for (const s of sites)
        siteMap.set(s.plantCode, { id: s.id, name: s.name, gridConnectionDate: s.gridConnectionDate ?? null });
    const invs = await prisma_1.default.inverter.findMany({
        where: { stationCode: { in: uniqueStationCodes } },
        select: { id: true, serialNumber: true, siteId: true },
    });
    const invBySn = new Map();
    for (const inv of invs)
        invBySn.set(inv.serialNumber, { id: inv.id, siteId: inv.siteId });
    const now = Date.now();
    const minimumLookbackDays = clampInt(Math.ceil(lookbackHours / 24), 1, ONDEMAND_MAX_LOOKBACK_DAYS);
    const maxLookbackDays = Math.max(minimumLookbackDays, ONDEMAND_MAX_LOOKBACK_DAYS);
    const windows = buildRollingWindows(now, maxLookbackDays, siteMap, uniqueStationCodes);
    let fetched = 0;
    let upserted = 0;
    const seenKeys = new Set();
    log.info('ONDEMAND: refresh alarms', { plants: uniqueStationCodes.length, first: uniqueStationCodes[0], windows: windows.length });
    const batches = chunk(uniqueStationCodes, ALARM_BATCH_SIZE);
    for (let i = 0; i < batches.length; i += 1) {
        const batch = batches[i];
        const primaryClient = (0, huaweiPool_1.getStationClientCandidates)(batch[0], 'ondemand', { batchIndex: i })[0];
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
async function getAlarmReconciliationSnapshot() {
    const syncState = (0, syncStateService_1.getSyncStateSnapshot)();
    const sites = (await prisma_1.default.site.findMany({
        select: { id: true, plantCode: true, name: true },
        orderBy: { plantCode: 'asc' },
        take: 5000,
    }));
    const alarms = (await prisma_1.default.alarm.findMany({
        where: { status: 'ACTIVE', clearedAt: null },
        select: {
            huaweiAlarmId: true,
            raw: true,
            site: { select: { plantCode: true, name: true } },
        },
        take: 50000,
    }));
    const now = Date.now();
    const staleThresholdMs = Number(process.env.HUAWEI_ALARM_STALE_MS ?? 15 * 60000);
    const bySite = new Map();
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
        if (isStale)
            staleActiveCount += 1;
        if (missCount > 0)
            pendingClearCount += 1;
        if (siteRow) {
            siteRow.activeCount += 1;
            if (isStale)
                siteRow.staleCount += 1;
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
// ── Exported for unit testing only ──
exports.__testUtils = {
    chunk,
    toDate,
    summarizeTopPlants,
    makeHuaweiAlarmKey,
    asObject,
    extractSyncMeta,
    mergeAlarmRaw,
    clampInt,
    buildRollingWindows,
    ALARM_STATES,
    ALARM_TRANSITIONS,
    isValidAlarmTransition,
    assertAlarmTransition,
    alarmSyncDeps: exports.alarmSyncDeps,
};
