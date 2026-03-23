"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronJobs = void 0;
exports.getCronStatus = getCronStatus;
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_1 = require("../services/syncService");
const alarmSyncService_1 = require("../services/alarmSyncService");
const huaweiPool_1 = require("../services/huaweiPool");
const huaweiBudget_1 = require("../services/huaweiBudget");
const syncStateService_1 = require("../services/syncStateService");
let siteRealtimeRunning = false;
let deviceRunning = false;
let alarmRunning = false;
let cronInitialized = false;
let watchdogStarted = false;
let lastSiteRealtimeAttemptAt = 0;
let lastSiteRealtimeSuccessAt = 0;
let lastDeviceAttemptAt = 0;
let lastDeviceSuccessAt = 0;
let lastAlarmAttemptAt = 0;
let lastAlarmSuccessAt = 0;
const SITE_REALTIME_SCHEDULE = process.env.HUAWEI_SITE_REALTIME_CRON ?? '*/5 * * * *';
const DEVICE_SCHEDULE = process.env.HUAWEI_DEVICE_CRON ?? '2-59/5 * * * *';
const ALARM_SCHEDULE = process.env.HUAWEI_ALARM_CRON ?? '1-59/5 * * * *';
const WATCHDOG_INTERVAL_MS = Math.max(60000, Number(process.env.HUAWEI_SYNC_WATCHDOG_INTERVAL_MS ?? 60000));
const WATCHDOG_STALE_MS = Math.max(5 * 60000, Number(process.env.HUAWEI_SYNC_WATCHDOG_STALE_MS ?? 15 * 60000));
async function runSiteRealtimeJob(reason) {
    if (siteRealtimeRunning) {
        console.log(`⏭️ Skip site realtime sync (${reason}) because previous run is still active.`);
        return;
    }
    siteRealtimeRunning = true;
    lastSiteRealtimeAttemptAt = Date.now();
    (0, syncStateService_1.markJobStart)('siteRealtime');
    try {
        huaweiPool_1.huaweiClients.main.resetStats();
        huaweiPool_1.huaweiClients.backup.resetStats();
        huaweiPool_1.huaweiClients.alarm.resetStats();
        huaweiPool_1.huaweiClients.ondemand.resetStats();
        console.log(`⏰ Site realtime sync triggered (${reason})`);
        await (0, syncService_1.syncSiteRealtimeTick)();
        lastSiteRealtimeSuccessAt = Date.now();
        (0, syncStateService_1.markJobSuccess)('siteRealtime', { reason, lastSiteRealtimeSuccessAt });
    }
    catch (error) {
        console.error(`❌ Site realtime sync failed (${reason}):`, error?.message ?? error);
        (0, syncStateService_1.markJobFailure)('siteRealtime', error, { reason });
    }
    finally {
        siteRealtimeRunning = false;
    }
}
async function runDeviceJob(reason) {
    if (deviceRunning) {
        console.log(`⏭️ Skip device sync (${reason}) because previous run is still active.`);
        return;
    }
    deviceRunning = true;
    lastDeviceAttemptAt = Date.now();
    (0, syncStateService_1.markJobStart)('device');
    try {
        console.log(`⏰ Device sync triggered (${reason})`);
        await (0, syncService_1.syncInverterData)();
        lastDeviceSuccessAt = Date.now();
        (0, syncStateService_1.markJobSuccess)('device', { reason, lastDeviceSuccessAt });
    }
    catch (error) {
        console.error(`❌ Device sync failed (${reason}):`, error?.message ?? error);
        (0, syncStateService_1.markJobFailure)('device', error, { reason });
    }
    finally {
        deviceRunning = false;
    }
}
async function runAlarmJob(reason) {
    if (alarmRunning) {
        console.log(`⏭️ Skip alarm sync (${reason}) because previous run is still active.`);
        return;
    }
    alarmRunning = true;
    lastAlarmAttemptAt = Date.now();
    (0, syncStateService_1.markJobStart)('alarm');
    try {
        console.log(`⏰ Alarm sync triggered (${reason})`);
        const result = await (0, alarmSyncService_1.syncActiveAlarms)();
        console.log('✅ Alarm sync result:', result);
        lastAlarmSuccessAt = Date.now();
        (0, syncStateService_1.markJobSuccess)('alarm', { reason, ...result, lastAlarmSuccessAt });
    }
    catch (error) {
        console.error(`❌ Alarm sync failed (${reason}):`, error?.message ?? error);
        (0, syncStateService_1.markJobFailure)('alarm', error, { reason });
    }
    finally {
        alarmRunning = false;
    }
}
function startWatchdog() {
    if (watchdogStarted)
        return;
    watchdogStarted = true;
    setInterval(() => {
        const now = Date.now();
        if (!siteRealtimeRunning && now - Math.max(lastSiteRealtimeSuccessAt, lastSiteRealtimeAttemptAt) > WATCHDOG_STALE_MS) {
            void runSiteRealtimeJob('watchdog');
        }
        if (!deviceRunning && now - Math.max(lastDeviceSuccessAt, lastDeviceAttemptAt) > WATCHDOG_STALE_MS) {
            void runDeviceJob('watchdog');
        }
        if (!alarmRunning && now - Math.max(lastAlarmSuccessAt, lastAlarmAttemptAt) > WATCHDOG_STALE_MS) {
            void runAlarmJob('watchdog');
        }
    }, WATCHDOG_INTERVAL_MS).unref();
}
function getCronStatus() {
    return {
        cronInitialized,
        watchdogStarted,
        jobs: {
            siteRealtime: { running: siteRealtimeRunning, lastAttemptAt: lastSiteRealtimeAttemptAt, lastSuccessAt: lastSiteRealtimeSuccessAt },
            device: { running: deviceRunning, lastAttemptAt: lastDeviceAttemptAt, lastSuccessAt: lastDeviceSuccessAt },
            alarm: { running: alarmRunning, lastAttemptAt: lastAlarmAttemptAt, lastSuccessAt: lastAlarmSuccessAt },
        },
        syncState: (0, syncStateService_1.getSyncStateSnapshot)(),
        huaweiClients: {
            main: huaweiPool_1.huaweiClients.main.getRuntimeStatus(),
            backup: huaweiPool_1.huaweiClients.backup.getRuntimeStatus(),
            alarm: huaweiPool_1.huaweiClients.alarm.getRuntimeStatus(),
            ondemand: huaweiPool_1.huaweiClients.ondemand.getRuntimeStatus(),
        },
        schedules: {
            siteRealtime: SITE_REALTIME_SCHEDULE,
            device: DEVICE_SCHEDULE,
            alarm: ALARM_SCHEDULE,
            watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
            watchdogStaleMs: WATCHDOG_STALE_MS,
        },
        budget: (0, huaweiBudget_1.getBudgetSnapshot)(),
    };
}
const startCronJobs = async () => {
    if (cronInitialized) {
        console.warn('Cron already initialized. Skip duplicate start.');
        return;
    }
    cronInitialized = true;
    await (0, syncStateService_1.ensureSyncStateHydrated)();
    await (0, syncService_1.restoreRetryQueue)();
    console.log('startCronJobs() called');
    node_cron_1.default.schedule(SITE_REALTIME_SCHEDULE, () => {
        void runSiteRealtimeJob(`cron:${SITE_REALTIME_SCHEDULE}`);
    });
    node_cron_1.default.schedule(DEVICE_SCHEDULE, () => {
        void runDeviceJob(`cron:${DEVICE_SCHEDULE}`);
    });
    node_cron_1.default.schedule(ALARM_SCHEDULE, () => {
        void runAlarmJob(`cron:${ALARM_SCHEDULE}`);
    });
    setTimeout(() => void runSiteRealtimeJob('startup-warmup'), 5000).unref();
    setTimeout(() => void runAlarmJob('startup-warmup'), 20000).unref();
    setTimeout(() => void runDeviceJob('startup-warmup'), 40000).unref();
    startWatchdog();
    console.log('🚀 Cron Jobs initialized', {
        siteRealtime: SITE_REALTIME_SCHEDULE,
        device: DEVICE_SCHEDULE,
        alarm: ALARM_SCHEDULE,
        watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
        watchdogStaleMs: WATCHDOG_STALE_MS,
    });
};
exports.startCronJobs = startCronJobs;
