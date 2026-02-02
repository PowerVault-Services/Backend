"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncInverterData = exports.syncMonitoringTick = void 0;
// src/services/syncService.ts
const client_1 = require("@prisma/client");
const huaweiService_1 = require("./huaweiService");
const prisma = new client_1.PrismaClient();
// ---------------- Utils ----------------
function pickStationCode(s) {
    return (s.plantCode ?? s.stationCode)?.toString() ?? null;
}
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
function deriveStringStatus(voltage, current) {
    if (voltage == null && current == null)
        return 'Disconnected';
    const v = voltage ?? 0;
    const i = current ?? 0;
    if (v > 50 && i < 0.05)
        return 'Lost';
    return 'Normal';
}
// Inverter status mapping (Huawei run_state -> UI status)
// หมายเหตุ: run_state ของ Huawei มีหลายค่าและต่างกันตาม tenant
// เราใช้ชุด FAULT_RUN_STATES ที่ปรับได้ผ่าน env เพื่อไม่เดาแบบ 0/อื่นๆ แล้วเพี้ยน
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
// ---------------- Config ----------------
const MAX_PLANTS_PER_TICK = Number(process.env.HUAWEI_MAX_PLANTS_PER_TICK ?? 1);
const DEV_BATCH_SIZE = Number(process.env.HUAWEI_DEV_BATCH_SIZE ?? 100);
// กัน cron ตั้งถี่เกิน (cron ยิงถี่ได้ แต่ระบบจะ skip เอง)
const MIN_TICK_INTERVAL_MS = Number(process.env.HUAWEI_MIN_TICK_INTERVAL_MS ?? 60000);
let lastTickAt = 0;
// snapshot time-slot (แนะนำ 5 นาที เพื่อ match rate limit)
const SNAPSHOT_SLOT_MS = Number(process.env.HUAWEI_SNAPSHOT_SLOT_MS ?? 5 * 60000);
// station cache
const STATION_CACHE_TTL_MS = Number(process.env.HUAWEI_STATION_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
let stationCache = null;
// เอกสาร: 407 = personal rate limit -> ต้อง throttle / pause
const PERSONAL_RATE_LIMIT_PAUSE_MS = Number(process.env.HUAWEI_PERSONAL_RATE_LIMIT_PAUSE_MS ?? 5 * 60000);
const SYSTEM_BUSY_PAUSE_MS = Number(process.env.HUAWEI_SYSTEM_BUSY_PAUSE_MS ?? 60000);
let syncPauseUntil = 0;
function isPaused() {
    return Date.now() < syncPauseUntil;
}
function pause(ms, reason) {
    syncPauseUntil = Math.max(syncPauseUntil, Date.now() + ms);
    console.warn(`🧊 Sync paused for ${Math.ceil(ms / 1000)}s (${reason})`);
}
// retry queue: plant ไหน fail ให้ดันเข้าคิว แล้ว tick ถัดไปจะหยิบก่อน
const retryQueue = [];
function enqueueRetry(stationCode) {
    if (!retryQueue.includes(stationCode))
        retryQueue.unshift(stationCode);
}
// Inverter devTypeId ต่างกันตาม tenant (คุณเจอ 351)
// ปรับผ่าน env: HUAWEI_INVERTER_DEV_TYPE_IDS="351,1"
const INVERTER_DEV_TYPE_IDS = new Set(String(process.env.HUAWEI_INVERTER_DEV_TYPE_IDS ?? '351,1')
    .split(',')
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x)));
const DEBUG = String(process.env.SYNC_DEBUG ?? '').trim() === '1';
// ---------------- Rate limit handler (body-level) ----------------
function handleFailCode(failCode, context, stationCode) {
    const code = Number(failCode);
    if (!Number.isFinite(code))
        return false;
    if (code === 407) {
        console.warn(`🚫 ${context} rate-limited (407) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        huaweiService_1.huaweiService.notifyRateLimit({
            kind: 'personal',
            delayMs: PERSONAL_RATE_LIMIT_PAUSE_MS,
            reason: `${context} failCode=407`,
        });
        pause(PERSONAL_RATE_LIMIT_PAUSE_MS, `${context} 407`);
        return true;
    }
    if (code === 403 || code === 429) {
        console.warn(`⛔ ${context} system busy (${code}) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        huaweiService_1.huaweiService.notifyRateLimit({
            kind: 'system',
            delayMs: SYSTEM_BUSY_PAUSE_MS,
            reason: `${context} failCode=${code}`,
        });
        pause(SYSTEM_BUSY_PAUSE_MS, `${context} ${code}`);
        return true;
    }
    // บาง tenant ใช้ 305 = token expired
    if (code === 305) {
        console.warn(`🔑 ${context} token expired (305) ${stationCode ? `station=${stationCode}` : ''}`);
        if (stationCode)
            enqueueRetry(stationCode);
        // force relogin แบบ “ครั้งเดียว” แล้วให้ tick ถัดไปลองใหม่
        huaweiService_1.huaweiService.ensureLoggedIn({ force: true }).catch(() => undefined);
        pause(10000, `${context} token refresh`);
        return true;
    }
    return false;
}
// ---------------- Stations cache ----------------
async function refreshStationsIfNeeded() {
    const now = Date.now();
    if (stationCache && now < stationCache.expiresAt && stationCache.stationCodes.length > 0) {
        return stationCache.stationCodes;
    }
    // ถ้าถูก pause จาก rate limit -> อย่าไปยิง stations เพิ่ม
    if (isPaused()) {
        const sites = await prisma.site.findMany({ select: { plantCode: true }, orderBy: [{ createdAt: 'asc' }], take: 5000 });
        const codes = sites.map((s) => s.plantCode).filter(Boolean);
        stationCache = { expiresAt: now + 10 * 60000, stationCodes: codes };
        return codes;
    }
    try {
        const stationCodes = [];
        let pageNo = 1;
        const pageSize = Number(process.env.HUAWEI_STATION_PAGE_SIZE ?? 100);
        while (true) {
            const res = await huaweiService_1.huaweiService.stations({ pageNo, pageSize });
            if (!res?.success) {
                if (handleFailCode(res?.failCode, 'stations'))
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
                await prisma.site.upsert({
                    where: { plantCode: code },
                    create: {
                        plantCode: code,
                        name: (st.plantName ?? st.stationName ?? code).toString(),
                        address: (st.plantAddress ?? st.stationAddr ?? undefined),
                        latitude: st.latitude != null ? Number(st.latitude) : undefined,
                        longitude: st.longitude != null ? Number(st.longitude) : undefined,
                        capacityKWp: st.capacity != null ? Number(st.capacity) : 0,
                    },
                    update: {
                        name: (st.plantName ?? st.stationName ?? code).toString(),
                        address: (st.plantAddress ?? st.stationAddr ?? undefined),
                        latitude: st.latitude != null ? Number(st.latitude) : undefined,
                        longitude: st.longitude != null ? Number(st.longitude) : undefined,
                        capacityKWp: st.capacity != null ? Number(st.capacity) : undefined,
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
        const sites = await prisma.site.findMany({ select: { plantCode: true }, orderBy: [{ createdAt: 'asc' }], take: 5000 });
        const codes = sites.map((s) => s.plantCode).filter(Boolean);
        stationCache = { expiresAt: now + 10 * 60000, stationCodes: codes };
        console.log(`✅ Using DB fallback station codes: ${codes.length} stations (short ttl=10min)`);
        return codes;
    }
}
// ---------------- Main tick ----------------
const syncMonitoringTick = async () => {
    console.log('⏳ Starting Sync Monitoring Tick...');
    // reset counter ต่อ tick
    huaweiService_1.huaweiService.resetStats();
    // สถิติ run_state ต่อ tick (ช่วยจูน HUAWEI_FAULT_RUN_STATES ให้แม่น)
    const runStateCount = new Map();
    const now = Date.now();
    if (lastTickAt && now - lastTickAt < MIN_TICK_INTERVAL_MS) {
        console.log(`⏭️ Skip sync tick (min interval ${MIN_TICK_INTERVAL_MS}ms not reached)`);
        return;
    }
    lastTickAt = now;
    if (isPaused()) {
        console.log('🧊 Skip sync tick (paused due to rate limit)');
        return;
    }
    try {
        // preload stations (cache)
        await refreshStationsIfNeeded();
        // decide which plants to sync
        const plantCodes = [];
        while (plantCodes.length < MAX_PLANTS_PER_TICK && retryQueue.length > 0) {
            const code = retryQueue.shift();
            if (code)
                plantCodes.push(code);
        }
        if (plantCodes.length < MAX_PLANTS_PER_TICK) {
            const more = await prisma.site.findMany({
                orderBy: [{ updatedAt: 'asc' }, { createdAt: 'asc' }],
                take: MAX_PLANTS_PER_TICK - plantCodes.length,
            });
            plantCodes.push(...more.map((s) => s.plantCode));
        }
        if (plantCodes.length === 0) {
            console.log('⚠️ No sites to sync.');
            return;
        }
        const ts = snapTsNow(SNAPSHOT_SLOT_MS);
        // สำหรับ debug: นับ run_state ที่เจอใน tick นี้
        const runStateCount = new Map();
        for (const stationCode of plantCodes) {
            if (isPaused())
                break;
            const site = await prisma.site.findUnique({ where: { plantCode: stationCode } });
            if (!site)
                continue;
            console.log(`🔁 Sync plant ${stationCode} (${site.name ?? ''})`);
            // (A) getDevList
            const end4 = await huaweiService_1.huaweiService.getDevList(stationCode);
            if (!end4?.success) {
                const stopped = handleFailCode(end4?.failCode, 'getDevList', stationCode);
                if (stopped)
                    break;
                console.warn('⚠️ getDevList failed:', { failCode: end4?.failCode, message: end4?.message });
                enqueueRetry(stationCode);
                continue;
            }
            const devices = end4?.data ?? [];
            const inverterDevices = devices.filter((d) => INVERTER_DEV_TYPE_IDS.has(Number(d.devTypeId)));
            // upsert inverters
            for (const inv of inverterDevices) {
                const devIdStr = String(inv.id);
                const sn = inv.esnCode ? String(inv.esnCode) : `DEV-${devIdStr}`;
                await prisma.inverter.upsert({
                    where: { serialNumber: sn },
                    create: {
                        serialNumber: sn,
                        name: (inv.devName ?? devIdStr).toString(),
                        model: (inv.model ?? inv.invType ?? 'UNKNOWN').toString(),
                        siteId: site.id,
                        huaweiDevId: devIdStr,
                        stationCode: stationCode,
                    },
                    update: {
                        name: (inv.devName ?? devIdStr).toString(),
                        model: (inv.model ?? inv.invType ?? 'UNKNOWN').toString(),
                        siteId: site.id,
                        huaweiDevId: devIdStr,
                        stationCode: stationCode,
                    },
                });
            }
            console.log(`✅ Seeded/updated ${inverterDevices.length} inverters for plant ${stationCode}`);
            // (B) getDevRealKpi: ยิงแยกตาม devTypeId
            const groups = new Map();
            for (const d of inverterDevices) {
                const t = Number(d.devTypeId);
                if (!groups.has(t))
                    groups.set(t, []);
                groups.get(t).push(String(d.id));
            }
            for (const [devTypeId, devIds] of groups.entries()) {
                if (isPaused())
                    break;
                const batches = chunk(devIds, DEV_BATCH_SIZE);
                for (const batchIds of batches) {
                    if (isPaused())
                        break;
                    const end5 = await huaweiService_1.huaweiService.getDevRealKpi({ devTypeId, devIds: batchIds });
                    if (!end5?.success || !Array.isArray(end5?.data)) {
                        const stopped = handleFailCode(end5?.failCode, 'getDevRealKpi', stationCode);
                        if (stopped)
                            break;
                        console.warn('⚠️ getDevRealKpi failed:', { failCode: end5?.failCode, message: end5?.message });
                        enqueueRetry(stationCode);
                        continue;
                    }
                    for (const item of end5.data) {
                        const devId = String(item.devId ?? '');
                        const map = item.dataItemMap ?? {};
                        // active_power: ถ้า field ไม่มา ให้ "ไม่เขียนทับ" ค่าเดิม (กัน 0 หลอก)
                        const activePowerRaw = map.active_power;
                        const activePowerVal = activePowerRaw != null && Number.isFinite(Number(activePowerRaw)) ? Number(activePowerRaw) : null;
                        const dayEnergy = map.day_cap != null ? Number(map.day_cap) : null;
                        const runState = map.run_state != null && Number.isFinite(Number(map.run_state)) ? Number(map.run_state) : null;
                        const totalEnergy = map.total_cap != null ? Number(map.total_cap) : null;
                        const temperature = map.temperature != null ? Number(map.temperature) : null;
                        const powerFactor = map.power_factor != null ? Number(map.power_factor) : null;
                        if (runState != null) {
                            runStateCount.set(runState, (runStateCount.get(runState) ?? 0) + 1);
                        }
                        const inv = await prisma.inverter.findFirst({ where: { huaweiDevId: devId, siteId: site.id } });
                        if (!inv)
                            continue;
                        const derivedStatus = deriveInverterStatus(runState);
                        await prisma.inverter.update({
                            where: { id: inv.id },
                            // NOTE: cast to any so code compiles even if Prisma Client hasn't been regenerated yet.
                            // After running `prisma migrate` + `prisma generate`, this remains valid.
                            data: {
                                // เขียนเฉพาะเมื่อมีค่าใหม่จริง
                                ...(activePowerVal != null ? { activePower: activePowerVal } : {}),
                                lastDailyEnergy: dayEnergy ?? inv.lastDailyEnergy,
                                status: derivedStatus,
                                runState: runState,
                                lastSyncAt: new Date(),
                            },
                        });
                        const snap = await prisma.inverterKpiSnapshot.upsert({
                            where: { inverterId_ts: { inverterId: inv.id, ts } },
                            create: {
                                inverterId: inv.id,
                                ts,
                                activePower: activePowerVal != null ? activePowerVal : 0,
                                dayEnergy: dayEnergy != null && Number.isFinite(dayEnergy) ? dayEnergy : 0,
                                totalEnergy: totalEnergy != null && Number.isFinite(totalEnergy) ? totalEnergy : null,
                                runState: runState != null && Number.isFinite(runState) ? runState : null,
                                temperature: temperature != null && Number.isFinite(temperature) ? temperature : null,
                                powerFactor: powerFactor != null && Number.isFinite(powerFactor) ? powerFactor : null,
                                raw: item,
                            },
                            update: {
                                activePower: activePowerVal != null ? activePowerVal : 0,
                                dayEnergy: dayEnergy != null && Number.isFinite(dayEnergy) ? dayEnergy : 0,
                                totalEnergy: totalEnergy != null && Number.isFinite(totalEnergy) ? totalEnergy : null,
                                runState: runState != null && Number.isFinite(runState) ? runState : null,
                                temperature: temperature != null && Number.isFinite(temperature) ? temperature : null,
                                powerFactor: powerFactor != null && Number.isFinite(powerFactor) ? powerFactor : null,
                                raw: item,
                            },
                        });
                        const rows = [];
                        for (let n = 1; n <= 20; n++) {
                            const uKey = `pv${n}_u`;
                            const iKey = `pv${n}_i`;
                            const vRaw = map[uKey] != null ? Number(map[uKey]) : null;
                            const cRaw = map[iKey] != null ? Number(map[iKey]) : null;
                            const v = vRaw != null && Number.isFinite(vRaw) ? vRaw : null;
                            const c = cRaw != null && Number.isFinite(cRaw) ? cRaw : null;
                            rows.push({
                                snapshotId: snap.id,
                                stringNo: n,
                                voltage: v,
                                current: c,
                                status: deriveStringStatus(v, c),
                            });
                        }
                        await prisma.$transaction([
                            prisma.inverterStringSnapshot.deleteMany({ where: { snapshotId: snap.id } }),
                            prisma.inverterStringSnapshot.createMany({ data: rows }),
                        ]);
                    }
                }
            }
            console.log(`✅ Sync done for plant ${stationCode}`);
            await prisma.site.update({ where: { id: site.id }, data: { updatedAt: new Date() } });
        }
        console.log('✅ Sync tick done.');
    }
    catch (error) {
        console.error('❌ Sync Job Failed:', error?.message ?? error);
    }
    finally {
        // สรุปว่ารอบนี้ยิงอะไรไปกี่ครั้ง (ช่วย debug จุดที่โดน rate limit)
        const stats = huaweiService_1.huaweiService.getStats();
        console.log('📊 Huawei API call summary:', stats);
        if (runStateCount.size > 0) {
            const top = Array.from(runStateCount.entries())
                .sort((a, b) => b[1] - a[1])
                .slice(0, 20)
                .map(([k, v]) => `${k}:${v}`)
                .join(', ');
            console.log(`📈 run_state distribution (top): ${top}`);
            console.log(`ℹ️ Tune fault mapping via env: HUAWEI_FAULT_RUN_STATES="..."`);
        }
        // สรุป run_state ที่เจอ (ช่วยปรับ HUAWEI_FAULT_RUN_STATES ให้แม่น)
        // (ถ้าไม่มีจะไม่พิมพ์)
        // NOTE: runStateCount อยู่ใน scope try; ถ้าเกิด error ก่อนประกาศจะไม่พิมพ์
        if (DEBUG) {
            console.log('📌 retryQueue size:', retryQueue.length, retryQueue.slice(0, 10));
            if (syncPauseUntil)
                console.log('📌 pausedUntil:', new Date(syncPauseUntil).toISOString());
        }
    }
};
exports.syncMonitoringTick = syncMonitoringTick;
exports.syncInverterData = exports.syncMonitoringTick;
