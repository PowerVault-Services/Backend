import cron from 'node-cron';
import { syncInverterData, syncSiteRealtimeTick, restoreRetryQueue } from '../services/syncService';
import { syncActiveAlarms } from '../services/alarmSyncService';
import { huaweiClients } from '../services/huaweiPool';
import { getBudgetSnapshot } from '../services/huaweiBudget';
import { ensureSyncStateHydrated, getSyncStateSnapshot, markJobFailure, markJobStart, markJobSuccess } from '../services/syncStateService';

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
const WATCHDOG_INTERVAL_MS = Math.max(60_000, Number(process.env.HUAWEI_SYNC_WATCHDOG_INTERVAL_MS ?? 60_000));
const WATCHDOG_STALE_MS = Math.max(5 * 60_000, Number(process.env.HUAWEI_SYNC_WATCHDOG_STALE_MS ?? 15 * 60_000));

async function runSiteRealtimeJob(reason: string) {
  if (siteRealtimeRunning) {
    console.log(`⏭️ Skip site realtime sync (${reason}) because previous run is still active.`);
    return;
  }

  siteRealtimeRunning = true;
  lastSiteRealtimeAttemptAt = Date.now();
  markJobStart('siteRealtime');
  try {
    huaweiClients.main.resetStats();
    huaweiClients.backup.resetStats();
    huaweiClients.alarm.resetStats();
    huaweiClients.ondemand.resetStats();

    console.log(`⏰ Site realtime sync triggered (${reason})`);
    await syncSiteRealtimeTick();
    lastSiteRealtimeSuccessAt = Date.now();
    markJobSuccess('siteRealtime', { reason, lastSiteRealtimeSuccessAt });
  } catch (error: any) {
    console.error(`❌ Site realtime sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('siteRealtime', error, { reason });
  } finally {
    siteRealtimeRunning = false;
  }
}

async function runDeviceJob(reason: string) {
  if (deviceRunning) {
    console.log(`⏭️ Skip device sync (${reason}) because previous run is still active.`);
    return;
  }

  deviceRunning = true;
  lastDeviceAttemptAt = Date.now();
  markJobStart('device');
  try {
    console.log(`⏰ Device sync triggered (${reason})`);
    await syncInverterData();
    lastDeviceSuccessAt = Date.now();
    markJobSuccess('device', { reason, lastDeviceSuccessAt });
  } catch (error: any) {
    console.error(`❌ Device sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('device', error, { reason });
  } finally {
    deviceRunning = false;
  }
}

async function runAlarmJob(reason: string) {
  if (alarmRunning) {
    console.log(`⏭️ Skip alarm sync (${reason}) because previous run is still active.`);
    return;
  }

  alarmRunning = true;
  lastAlarmAttemptAt = Date.now();
  markJobStart('alarm');
  try {
    console.log(`⏰ Alarm sync triggered (${reason})`);
    const result = await syncActiveAlarms();
    console.log('✅ Alarm sync result:', result);
    lastAlarmSuccessAt = Date.now();
    markJobSuccess('alarm', { reason, ...result, lastAlarmSuccessAt });
  } catch (error: any) {
    console.error(`❌ Alarm sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('alarm', error, { reason });
  } finally {
    alarmRunning = false;
  }
}

function startWatchdog() {
  if (watchdogStarted) return;
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

export function getCronStatus() {
  return {
    cronInitialized,
    watchdogStarted,
    jobs: {
      siteRealtime: { running: siteRealtimeRunning, lastAttemptAt: lastSiteRealtimeAttemptAt, lastSuccessAt: lastSiteRealtimeSuccessAt },
      device: { running: deviceRunning, lastAttemptAt: lastDeviceAttemptAt, lastSuccessAt: lastDeviceSuccessAt },
      alarm: { running: alarmRunning, lastAttemptAt: lastAlarmAttemptAt, lastSuccessAt: lastAlarmSuccessAt },
    },
    syncState: getSyncStateSnapshot(),
    huaweiClients: {
      main: huaweiClients.main.getRuntimeStatus(),
      backup: huaweiClients.backup.getRuntimeStatus(),
      alarm: huaweiClients.alarm.getRuntimeStatus(),
      ondemand: huaweiClients.ondemand.getRuntimeStatus(),
    },
    schedules: {
      siteRealtime: SITE_REALTIME_SCHEDULE,
      device: DEVICE_SCHEDULE,
      alarm: ALARM_SCHEDULE,
      watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
      watchdogStaleMs: WATCHDOG_STALE_MS,
    },
    budget: getBudgetSnapshot(),
  };
}

export const startCronJobs = async () => {
  if (cronInitialized) {
    console.warn('Cron already initialized. Skip duplicate start.');
    return;
  }
  cronInitialized = true;

  if (process.env.DISABLE_CRON === '1' || process.env.DISABLE_CRON === 'true') {
    console.log('⏸️  DISABLE_CRON=1 — skipping all Huawei sync jobs (frontend-only mode)');
    return;
  }

  await ensureSyncStateHydrated();
  await restoreRetryQueue();
  console.log('startCronJobs() called');

  cron.schedule(SITE_REALTIME_SCHEDULE, () => {
    void runSiteRealtimeJob(`cron:${SITE_REALTIME_SCHEDULE}`);
  });

  cron.schedule(DEVICE_SCHEDULE, () => {
    void runDeviceJob(`cron:${DEVICE_SCHEDULE}`);
  });

  cron.schedule(ALARM_SCHEDULE, () => {
    void runAlarmJob(`cron:${ALARM_SCHEDULE}`);
  });

  setTimeout(() => void runSiteRealtimeJob('startup-warmup'), 5_000).unref();
  setTimeout(() => void runAlarmJob('startup-warmup'), 20_000).unref();
  setTimeout(() => void runDeviceJob('startup-warmup'), 40_000).unref();

  startWatchdog();
  console.log('🚀 Cron Jobs initialized', {
    siteRealtime: SITE_REALTIME_SCHEDULE,
    device: DEVICE_SCHEDULE,
    alarm: ALARM_SCHEDULE,
    watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
    watchdogStaleMs: WATCHDOG_STALE_MS,
  });
};
