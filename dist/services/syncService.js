"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInverterData = exports.syncMonitoringTick = void 0;
exports.syncSiteRealtimeTick = syncSiteRealtimeTick;
exports.syncPlantOnDemand = syncPlantOnDemand;
const prisma_1 = __importDefault(require("../config/prisma"));
const huaweiService_1 = require("./huaweiService");
const huaweiPool_1 = require("./huaweiPool");
function chunk(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size)
        out.push(arr.slice(i, i + size));
    return out;
}
function snapTsNow(slotMs) {
    const t = Date.now();
    const slot = Math.floor(t / slotMs) * slotMs;
    return new Date(slot);
}
function startOfLocalDay(d = new Date()) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}
function parseNum(value) {
    if (value == null || value === '')
        return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}
function parseDate(value) {
    if (value == null || value === '')
        return null;
    const d = new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
}
function deriveStringStatus(voltage, current) {
    if (voltage == null && current == null)
        return 'Disconnected';
    const v = voltage ?? 0;
    const i = current ?? 0;
    if (v > 50 && i < 0.05)
        return 'Lost';
    return 'Normal';
}
const FAULT_RUN_STATES = new Set(String(process.env.HUAWEI_FAULT_RUN_STATES ?? '3,4,5,6,7,8,9,10')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x)));
function deriveInverterStatus(runState) {
    if (runState == null)
        return 'Disconnected';
    if (FAULT_RUN_STATES.has(Number(runState)))
        return 'Fault';
    return 'Normal';
}
const MAX_DEVICE_PLANTS_PER_TICK = Number(process.env.HUAWEI_MAX_DEVICE_PLANTS_PER_TICK ?? process.env.HUAWEI_MAX_PLANTS_PER_TICK ?? 2);
const DEV_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_DEV_BATCH_SIZE ?? 100)));
const SITE_REALTIME_BATCH_SIZE = Math.min(100, Math.max(1, Number(process.env.HUAWEI_SITE_REALTIME_BATCH_SIZE ?? 100)));
const MIN_TICK_INTERVAL_MS = Number(process.env.HUAWEI_MIN_TICK_INTERVAL_MS ?? 60000);
const SNAPSHOT_SLOT_MS = Number(process.env.HUAWEI_SNAPSHOT_SLOT_MS ?? 5 * 60000);
const STATION_CACHE_TTL_MS = Number(process.env.HUAWEI_STATION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const DEVICE_META_TTL_MS = Number(process.env.HUAWEI_DEVICE_META_TTL_MS ?? 24 * 60 * 60 * 1000);
const STRING_SLOT_COUNT = Math.min(36, Math.max(1, Number(process.env.HUAWEI_STRING_SLOT_COUNT ?? 36)));
const PERSONAL_RATE_LIMIT_PAUSE_MS = Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 5 * 60000);
const SYSTEM_BUSY_PAUSE_MS = Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60000);
const INVERTER_DEV_TYPE_IDS = new Set(String(process.env.HUAWEI_INVERTER_DEV_TYPE_IDS ?? '351,1')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x)));
const DEBUG = String(process.env.SYNC_DEBUG ?? '').trim() === '1';
let lastTickAt = 0;
let deviceSyncCursor = 0;
let stationCache = null;
const retryQueue = [];
const onDemandSyncInflight = new Map();
function enqueueRetry(stationCode) {
    if (!retryQueue.includes(stationCode))
        retryQueue.unshift(stationCode);
}
function normalizeOnDemandOptions(opts) {
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
    };
}
function makeOnDemandInflightKey(plantCode, opts) {
    const normalized = normalizeOnDemandOptions(opts);
    return `${plantCode}::${JSON.stringify(normalized)}`;
}
function pickStationCode(input) {
    return (input?.plantCode ?? input?.stationCode)?.toString() ?? null;
}
function handleFailCode(client, failCode, context, stationCode) {
    const code = Number(failCode);
    if (!Number.isFinite(code))
        return false;
    if (code === 407) {
        console.warn(`🚫 ${context} rate-limited (407) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        client.notifyRateLimit({ kind: 'personal', delayMs: PERSONAL_RATE_LIMIT_PAUSE_MS, reason: `${context} failCode=407` });
        return true;
    }
    if (code === 403 || code === 429) {
        console.warn(`⛔ ${context} system busy (${code}) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        client.notifyRateLimit({ kind: 'system', delayMs: SYSTEM_BUSY_PAUSE_MS, reason: `${context} failCode=${code}` });
        return true;
    }
    if (code === 305) {
        console.warn(`🔑 ${context} token expired (305) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        client.ensureLoggedIn({ force: true }).catch(() => undefined);
        return true;
    }
    return false;
}
async function refreshStationsIfNeeded() {
    const now = Date.now();
    if (stationCache && now < stationCache.expiresAt && stationCache.stationCodes.length > 0) {
        return stationCache.stationCodes;
    }
    const stationClient = huaweiPool_1.huaweiClients.backup;
    try {
        const stationCodes = [];
        let pageNo = 1;
        const pageSize = Math.min(100, Math.max(1, Number(process.env.HUAWEI_STATION_PAGE_SIZE ?? 100)));
        while (true) {
            const res = await stationClient.stations({ pageNo, pageSize });
            if (!res?.success) {
                if (handleFailCode(stationClient, res?.failCode, 'stations'))
                    break;
                throw new Error(`stations failed (failCode=${res?.failCode}): ${res?.message ?? 'unknown'}`);
            }
            const list = res?.data?.list ?? [];
            const pageCount = Number(res?.data?.pageCount ?? 0);
            if (list.length === 0)
                break;
            for (const st of list) {
                const code = pickStationCode(st);
                if (!code)
                    continue;
                stationCodes.push(code);
                await prisma_1.default.site.upsert({
                    where: { plantCode: code },
                    create: {
                        plantCode: code,
                        name: (st.plantName ?? st.stationName ?? code).toString(),
                        address: (st.plantAddress ?? st.stationAddr ?? undefined),
                        latitude: st.latitude != null ? Number(st.latitude) : undefined,
                        longitude: st.longitude != null ? Number(st.longitude) : undefined,
                        capacityKWp: st.capacity != null ? Number(st.capacity) : 0,
                        gridConnectionDate: parseDate(st.gridConnectionDate) ?? undefined,
                        siteMetaSyncedAt: new Date(),
                    },
                    update: {
                        name: (st.plantName ?? st.stationName ?? code).toString(),
                        address: (st.plantAddress ?? st.stationAddr ?? undefined),
                        latitude: st.latitude != null ? Number(st.latitude) : undefined,
                        longitude: st.longitude != null ? Number(st.longitude) : undefined,
                        capacityKWp: st.capacity != null ? Number(st.capacity) : undefined,
                        gridConnectionDate: parseDate(st.gridConnectionDate) ?? undefined,
                        siteMetaSyncedAt: new Date(),
                    },
                });
            }
            if (pageCount > 0) {
                if (pageNo >= pageCount)
                    break;
                pageNo += 1;
            }
            else {
                if (list.length < pageSize)
                    break;
                pageNo += 1;
            }
        }
        const uniq = Array.from(new Set(stationCodes));
        stationCache = { expiresAt: now + STATION_CACHE_TTL_MS, stationCodes: uniq };
        console.log(`✅ Station cache refreshed: ${uniq.length} stations (ttl=${STATION_CACHE_TTL_MS}ms)`);
        return uniq;
    }
    catch (e) {
        console.warn('⚠️ Cannot refresh stations from Huawei (will fallback to DB):', e?.message ?? e);
        const sites = (await prisma_1.default.site.findMany({ select: { plantCode: true }, orderBy: [{ createdAt: 'asc' }], take: 5000 }));
        const codes = sites.map((s) => s.plantCode).filter(Boolean);
        stationCache = { expiresAt: now + 10 * 60000, stationCodes: codes };
        console.log(`✅ Using DB fallback station codes: ${codes.length} stations (short ttl=10min)`);
        return codes;
    }
}
function normalizeDeviceTarget(inv) {
    const devId = inv.id != null ? String(inv.id) : '';
    const devTypeId = Number(inv.devTypeId);
    if (!devId || !Number.isFinite(devTypeId))
        return null;
    return {
        devId,
        devTypeId,
        serialNumber: inv.esnCode ? String(inv.esnCode) : `DEV-${devId}`,
        devName: (inv.devName ?? devId).toString(),
        model: (inv.model ?? inv.invType ?? 'UNKNOWN').toString(),
        softwareVersion: inv.softwareVersion ?? null,
    };
}
async function getCachedDeviceTargets(siteId) {
    const rows = (await prisma_1.default.inverter.findMany({
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
    }));
    return rows
        .map((row) => {
        const devId = row.huaweiDevId ? String(row.huaweiDevId) : '';
        const devTypeId = row.huaweiDevTypeId != null ? Number(row.huaweiDevTypeId) : NaN;
        if (!devId || !Number.isFinite(devTypeId))
            return null;
        return {
            devId,
            devTypeId,
            serialNumber: row.serialNumber,
            devName: row.name,
            model: row.model,
            softwareVersion: row.softwareVersion,
        };
    })
        .filter(Boolean);
}
async function ensurePlantDeviceMetadata(site, client, opts) {
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
    const devices = end4?.data ?? [];
    const inverterTargets = devices
        .filter((d) => INVERTER_DEV_TYPE_IDS.has(Number(d.devTypeId)))
        .map(normalizeDeviceTarget)
        .filter(Boolean);
    for (const inv of inverterTargets) {
        await prisma_1.default.inverter.upsert({
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
        });
    }
    await prisma_1.default.site.update({
        where: { id: site.id },
        data: { deviceMetaSyncedAt: new Date() },
    });
    if (DEBUG) {
        console.log(`🧰 Refreshed device metadata for ${site.plantCode}: ${inverterTargets.length} inverter targets`);
    }
    return inverterTargets.length > 0 ? inverterTargets : cached;
}
async function syncSiteRealtimeBatch(plantCodes, batchIndex) {
    if (plantCodes.length === 0)
        return { synced: 0 };
    const primary = batchIndex % 2 === 0 ? huaweiPool_1.huaweiClients.main : huaweiPool_1.huaweiClients.backup;
    const secondary = batchIndex % 2 === 0 ? huaweiPool_1.huaweiClients.backup : huaweiPool_1.huaweiClients.main;
    const res = await (0, huaweiService_1.callWithFailover)(primary, secondary, (svc) => svc.getStationRealKpi(plantCodes), {
        tag: `getStationRealKpi batch=${batchIndex + 1}`,
    });
    if (!res?.success || !Array.isArray(res?.data)) {
        handleFailCode(primary, res?.failCode, 'getStationRealKpi(batch)');
        throw new Error(`getStationRealKpi failed (failCode=${res?.failCode})`);
    }
    const sites = (await prisma_1.default.site.findMany({
        where: { plantCode: { in: plantCodes } },
        select: { id: true, plantCode: true },
    }));
    const byCode = new Map(sites.map((s) => [s.plantCode, s.id]));
    for (const row of res.data) {
        const stationCode = String(row?.stationCode ?? '');
        const siteId = byCode.get(stationCode);
        if (!siteId)
            continue;
        const map = row?.dataItemMap ?? {};
        const dayEnergyKWh = parseNum(map.day_power);
        const monthEnergyKWh = parseNum(map.month_power);
        const totalEnergyKWh = parseNum(map.total_power);
        const dayIncome = parseNum(map.day_income);
        const totalIncome = parseNum(map.total_income);
        const dayOnGridEnergyKWh = parseNum(map.day_on_grid_energy);
        const dayUseEnergyKWh = parseNum(map.day_use_energy);
        const plantHealthState = parseNum(map.real_health_state);
        const currentPowerKW = parseNum(map.current_power) ??
            (() => {
                const maybe = parseNum(map.active_power);
                return maybe != null && Math.abs(maybe) <= 10000 ? maybe : null;
            })();
        await prisma_1.default.site.update({
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
        });
        if (dayEnergyKWh != null) {
            await prisma_1.default.siteDailyEnergy.upsert({
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
async function syncPlantDevices(site, client, runStateCount, opts) {
    const includeInventory = opts?.includeInventory ?? true;
    const includeDeviceDetail = opts?.includeDeviceDetail ?? true;
    const forceInventory = opts?.forceInventory ?? false;
    const forceDeviceDetail = opts?.forceDeviceDetail ?? false;
    const deviceTargets = includeInventory
        ? await ensurePlantDeviceMetadata(site, client, { force: forceInventory })
        : await getCachedDeviceTargets(site.id);
    if (deviceTargets.length === 0) {
        return { ok: true, inverters: 0, currentPowerKW: null, usedCachedInventory: !includeInventory };
    }
    if (!includeDeviceDetail && !forceDeviceDetail) {
        return {
            ok: true,
            inverters: deviceTargets.length,
            currentPowerKW: null,
            skippedDeviceDetail: true,
            usedCachedInventory: !includeInventory,
        };
    }
    const groups = new Map();
    for (const d of deviceTargets) {
        if (!groups.has(d.devTypeId))
            groups.set(d.devTypeId, []);
        groups.get(d.devTypeId).push(d.devId);
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
                const inv = await prisma_1.default.inverter.findFirst({ where: { huaweiDevId: devId, siteId: site.id } });
                if (!inv)
                    continue;
                const derivedStatus = deriveInverterStatus(runState);
                await prisma_1.default.inverter.update({
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
                const snap = await prisma_1.default.inverterKpiSnapshot.upsert({
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
                    },
                    update: {
                        activePower: activePowerVal ?? 0,
                        dayEnergy: dayEnergy ?? 0,
                        totalEnergy,
                        runState: runState != null ? Math.trunc(runState) : null,
                        temperature,
                        powerFactor,
                        raw: item,
                    },
                });
                const rows = [];
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
                await prisma_1.default.$transaction([
                    prisma_1.default.inverterStringSnapshot.deleteMany({ where: { snapshotId: snap.id } }),
                    prisma_1.default.inverterStringSnapshot.createMany({ data: rows }),
                ]);
            }
        }
    }
    if (hasCurrentPower) {
        await prisma_1.default.site.update({ where: { id: site.id }, data: { currentPowerKW: siteCurrentPowerKW } });
    }
    return { ok: true, inverters: deviceTargets.length, currentPowerKW: hasCurrentPower ? siteCurrentPowerKW : null };
}
async function syncSiteRealtimeTick() {
    console.log('⏳ Starting Site Realtime Sync Tick...');
    try {
        await refreshStationsIfNeeded();
        const sites = (await prisma_1.default.site.findMany({
            where: { plantCode: { not: '' } },
            select: { plantCode: true },
            orderBy: { plantCode: 'asc' },
            take: 5000,
        }));
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
    }
    catch (error) {
        console.error('❌ Site realtime sync failed:', error?.message ?? error);
    }
}
const syncMonitoringTick = async () => {
    console.log('⏳ Starting Device Sync Tick...');
    const now = Date.now();
    if (lastTickAt && now - lastTickAt < MIN_TICK_INTERVAL_MS) {
        console.log(`⏭️ Skip device sync tick (min interval ${MIN_TICK_INTERVAL_MS}ms not reached)`);
        return;
    }
    lastTickAt = now;
    const runStateCount = new Map();
    try {
        const stationCodes = await refreshStationsIfNeeded();
        if (stationCodes.length === 0) {
            console.log('⚠️ No station codes available for device sync.');
            return;
        }
        const picked = new Set();
        while (picked.size < MAX_DEVICE_PLANTS_PER_TICK && retryQueue.length > 0) {
            const code = retryQueue.shift();
            if (code)
                picked.add(code);
        }
        while (picked.size < MAX_DEVICE_PLANTS_PER_TICK && stationCodes.length > 0) {
            const code = stationCodes[deviceSyncCursor % stationCodes.length];
            deviceSyncCursor = (deviceSyncCursor + 1) % Math.max(stationCodes.length, 1);
            picked.add(code);
            if (picked.size >= stationCodes.length)
                break;
        }
        if (picked.size === 0) {
            console.log('⚠️ No sites selected for device sync.');
            return;
        }
        const sites = (await prisma_1.default.site.findMany({
            where: { plantCode: { in: Array.from(picked) } },
            select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
            orderBy: { plantCode: 'asc' },
        }));
        for (const site of sites) {
            const client = (0, huaweiPool_1.pickBulkClient)(site.plantCode);
            console.log(`🔁 [${client.label ?? 'BULK'}] Sync device detail for ${site.plantCode} (${site.name ?? ''})`);
            try {
                const r = await syncPlantDevices(site, client, runStateCount, {
                    includeInventory: true,
                    includeDeviceDetail: true,
                });
                console.log(`✅ Device sync done for ${site.plantCode}: ${r.inverters} inverter targets`);
            }
            catch (e) {
                enqueueRetry(site.plantCode);
                console.warn(`⚠️ Device sync failed for ${site.plantCode}:`, e?.message ?? e);
            }
        }
    }
    catch (error) {
        console.error('❌ Device Sync Tick Failed:', error?.message ?? error);
    }
    finally {
        console.log('📊 Huawei API call summary:', {
            MAIN: huaweiPool_1.huaweiClients.main.getStats(),
            BACKUP: huaweiPool_1.huaweiClients.backup.getStats(),
            ALARM: huaweiPool_1.huaweiClients.alarm.getStats(),
            ONDEMAND: huaweiPool_1.huaweiClients.ondemand.getStats(),
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
exports.syncMonitoringTick = syncMonitoringTick;
exports.syncInverterData = exports.syncMonitoringTick;
async function syncPlantOnDemand(plantCode, opts) {
    const normalized = normalizeOnDemandOptions(opts);
    const inflightKey = makeOnDemandInflightKey(plantCode, normalized);
    const existing = onDemandSyncInflight.get(inflightKey);
    if (existing)
        return existing;
    const task = (async () => {
        const client = (0, huaweiPool_1.pickOnDemandClient)();
        const site = (await prisma_1.default.site.findUnique({
            where: { plantCode },
            select: { id: true, plantCode: true, name: true, deviceMetaSyncedAt: true },
        }));
        if (!site)
            throw new Error(`Site not found for plantCode=${plantCode}`);
        console.log(`⚡ [ONDEMAND] Refresh plant ${plantCode} (${site.name ?? ''})`, normalized);
        let siteRealtimeRefreshed = false;
        if (normalized.includeSiteRealtime) {
            try {
                await syncSiteRealtimeBatch([plantCode], 0);
                siteRealtimeRefreshed = true;
            }
            catch (e) {
                console.warn(`⚠️ [ONDEMAND] Site realtime refresh failed for ${plantCode}:`, e?.message ?? e);
            }
        }
        const shouldTouchDevices = normalized.includeInventory || normalized.includeDeviceDetail;
        const runStateCount = new Map();
        const result = shouldTouchDevices
            ? await syncPlantDevices(site, client, runStateCount, {
                includeInventory: normalized.includeInventory,
                forceInventory: normalized.forceInventory || normalized.forceDeviceDetail,
                includeDeviceDetail: normalized.includeDeviceDetail,
                forceDeviceDetail: normalized.forceDeviceDetail,
            })
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
        };
    })();
    onDemandSyncInflight.set(inflightKey, task);
    try {
        return await task;
    }
    finally {
        onDemandSyncInflight.delete(inflightKey);
    }
}
