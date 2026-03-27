import cron from 'node-cron';
import { syncInverterData, syncSiteRealtimeTick, syncDailyKpiTick, syncHourlyKpiTick, syncAuxRealtimeTick, syncMonthlyKpiTick, restoreRetryQueue } from '../services/syncService';
import { syncActiveAlarms } from '../services/alarmSyncService';
import { huaweiClients } from '../services/huaweiPool';
import { getBudgetSnapshot } from '../services/huaweiBudget';
import { ensureSyncStateHydrated, getSyncStateSnapshot, markJobFailure, markJobStart, markJobSuccess } from '../services/syncStateService';

let siteRealtimeRunning = false;
let deviceRunning = false;
let alarmRunning = false;
let dailyKpiRunning = false;
let hourlyKpiRunning = false;
let auxRealtimeRunning = false;
let monthlyKpiRunning = false;
let cronInitialized = false;
let watchdogStarted = false;

let lastSiteRealtimeAttemptAt = 0;
let lastSiteRealtimeSuccessAt = 0;
let lastDeviceAttemptAt = 0;
let lastDeviceSuccessAt = 0;
let lastAlarmAttemptAt = 0;
let lastAlarmSuccessAt = 0;
let lastDailyKpiAttemptAt = 0;
let lastDailyKpiSuccessAt = 0;
let lastHourlyKpiAttemptAt = 0;
let lastHourlyKpiSuccessAt = 0;
let lastAuxRealtimeAttemptAt = 0;
let lastAuxRealtimeSuccessAt = 0;
let lastMonthlyKpiAttemptAt = 0;
let lastMonthlyKpiSuccessAt = 0;

const SITE_REALTIME_SCHEDULE = process.env.HUAWEI_SITE_REALTIME_CRON ?? '*/5 * * * *';
const DEVICE_SCHEDULE = process.env.HUAWEI_DEVICE_CRON ?? '2-59/5 * * * *';
const ALARM_SCHEDULE = process.env.HUAWEI_ALARM_CRON ?? '1-59/5 * * * *';
const DAILY_KPI_SCHEDULE = process.env.HUAWEI_DAILY_KPI_CRON ?? '15 * * * *'; // every hour at :15
const HOURLY_KPI_SCHEDULE = process.env.HUAWEI_HOURLY_KPI_CRON ?? '10 * * * *'; // every 60 min at :10 — getKpiStationHour quota = 27/day, 24 runs/day fits within limit
const AUX_REALTIME_SCHEDULE = process.env.HUAWEI_AUX_REALTIME_CRON ?? '3-59/5 * * * *'; // every 5 min at :03
const MONTHLY_KPI_SCHEDULE = process.env.HUAWEI_MONTHLY_KPI_CRON ?? '20 */4 * * *'; // every 4 hours at :20
const WATCHDOG_INTERVAL_MS = Math.max(60_000, Number(process.env.HUAWEI_SYNC_WATCHDOG_INTERVAL_MS ?? 60_000));
const WATCHDOG_STALE_MS = Math.max(5 * 60_000, Number(process.env.HUAWEI_SYNC_WATCHDOG_STALE_MS ?? 15 * 60_000));

function resetAllClientStats() {
  for (const client of Object.values(huaweiClients)) {
    client.resetStats();
  }
}

async function runSiteRealtimeJob(reason: string) {
  if (siteRealtimeRunning) {
    console.log(`⏭️ Skip site realtime sync (${reason}) because previous run is still active.`);
    return;
  }

  siteRealtimeRunning = true;
  lastSiteRealtimeAttemptAt = Date.now();
  markJobStart('siteRealtime');
  try {
    resetAllClientStats();

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

async function runDailyKpiJob(reason: string) {
  if (dailyKpiRunning) {
    console.log(`⏭️ Skip daily KPI sync (${reason}) because previous run is still active.`);
    return;
  }

  dailyKpiRunning = true;
  lastDailyKpiAttemptAt = Date.now();
  markJobStart('dailyKpi');
  try {
    console.log(`⏰ Daily KPI sync triggered (${reason})`);
    await syncDailyKpiTick();
    lastDailyKpiSuccessAt = Date.now();
    markJobSuccess('dailyKpi', { reason, lastDailyKpiSuccessAt });
  } catch (error: any) {
    console.error(`❌ Daily KPI sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('dailyKpi', error, { reason });
  } finally {
    dailyKpiRunning = false;
  }
}

async function runHourlyKpiJob(reason: string) {
  if (hourlyKpiRunning) {
    console.log(`⏭️ Skip hourly KPI sync (${reason}) because previous run is still active.`);
    return;
  }

  hourlyKpiRunning = true;
  lastHourlyKpiAttemptAt = Date.now();
  markJobStart('hourlyKpi');
  try {
    console.log(`⏰ Hourly KPI sync triggered (${reason})`);
    await syncHourlyKpiTick();
    lastHourlyKpiSuccessAt = Date.now();
    markJobSuccess('hourlyKpi', { reason, lastHourlyKpiSuccessAt });
  } catch (error: any) {
    console.error(`❌ Hourly KPI sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('hourlyKpi', error, { reason });
  } finally {
    hourlyKpiRunning = false;
  }
}

async function runAuxRealtimeJob(reason: string) {
  if (auxRealtimeRunning) {
    console.log(`⏭️ Skip aux realtime sync (${reason}) because previous run is still active.`);
    return;
  }

  auxRealtimeRunning = true;
  lastAuxRealtimeAttemptAt = Date.now();
  markJobStart('auxRealtime');
  try {
    console.log(`⏰ Aux realtime sync triggered (${reason})`);
    await syncAuxRealtimeTick();
    lastAuxRealtimeSuccessAt = Date.now();
    markJobSuccess('auxRealtime', { reason, lastAuxRealtimeSuccessAt });
  } catch (error: any) {
    console.error(`❌ Aux realtime sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('auxRealtime', error, { reason });
  } finally {
    auxRealtimeRunning = false;
  }
}

async function runMonthlyKpiJob(reason: string) {
  if (monthlyKpiRunning) {
    console.log(`⏭️ Skip monthly KPI sync (${reason}) because previous run is still active.`);
    return;
  }

  monthlyKpiRunning = true;
  lastMonthlyKpiAttemptAt = Date.now();
  markJobStart('monthlyKpi');
  try {
    console.log(`⏰ Monthly KPI sync triggered (${reason})`);
    await syncMonthlyKpiTick();
    lastMonthlyKpiSuccessAt = Date.now();
    markJobSuccess('monthlyKpi', { reason, lastMonthlyKpiSuccessAt });
  } catch (error: any) {
    console.error(`❌ Monthly KPI sync failed (${reason}):`, error?.message ?? error);
    markJobFailure('monthlyKpi', error, { reason });
  } finally {
    monthlyKpiRunning = false;
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
      dailyKpi: { running: dailyKpiRunning, lastAttemptAt: lastDailyKpiAttemptAt, lastSuccessAt: lastDailyKpiSuccessAt },
      hourlyKpi: { running: hourlyKpiRunning, lastAttemptAt: lastHourlyKpiAttemptAt, lastSuccessAt: lastHourlyKpiSuccessAt },
      auxRealtime: { running: auxRealtimeRunning, lastAttemptAt: lastAuxRealtimeAttemptAt, lastSuccessAt: lastAuxRealtimeSuccessAt },
      monthlyKpi: { running: monthlyKpiRunning, lastAttemptAt: lastMonthlyKpiAttemptAt, lastSuccessAt: lastMonthlyKpiSuccessAt },
    },
    syncState: getSyncStateSnapshot(),
    huaweiClients: Object.fromEntries(
      Object.entries(huaweiClients).map(([k, c]) => [k, c.getRuntimeStatus()]),
    ),
    schedules: {
      siteRealtime: SITE_REALTIME_SCHEDULE,
      device: DEVICE_SCHEDULE,
      alarm: ALARM_SCHEDULE,
      dailyKpi: DAILY_KPI_SCHEDULE,
      hourlyKpi: HOURLY_KPI_SCHEDULE,
      auxRealtime: AUX_REALTIME_SCHEDULE,
      monthlyKpi: MONTHLY_KPI_SCHEDULE,
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

  cron.schedule(DAILY_KPI_SCHEDULE, () => {
    void runDailyKpiJob(`cron:${DAILY_KPI_SCHEDULE}`);
  });

  cron.schedule(HOURLY_KPI_SCHEDULE, () => {
    void runHourlyKpiJob(`cron:${HOURLY_KPI_SCHEDULE}`);
  });

  cron.schedule(AUX_REALTIME_SCHEDULE, () => {
    void runAuxRealtimeJob(`cron:${AUX_REALTIME_SCHEDULE}`);
  });

  cron.schedule(MONTHLY_KPI_SCHEDULE, () => {
    void runMonthlyKpiJob(`cron:${MONTHLY_KPI_SCHEDULE}`);
  });

  // Startup warmup — stagger jobs to avoid 407 burst
  // Critical jobs first (realtime), slower jobs later
  setTimeout(() => void runSiteRealtimeJob('startup-warmup'),   5_000).unref();   // +5s
  setTimeout(() => void runAlarmJob('startup-warmup'),          30_000).unref();   // +30s
  setTimeout(() => void runDeviceJob('startup-warmup'),         60_000).unref();   // +60s
  setTimeout(() => void runHourlyKpiJob('startup-warmup'),      90_000).unref();   // +90s (1.5 min)
  setTimeout(() => void runAuxRealtimeJob('startup-warmup'),   120_000).unref();   // +120s (2 min)
  setTimeout(() => void runDailyKpiJob('startup-warmup'),      180_000).unref();   // +180s (3 min)
  setTimeout(() => void runMonthlyKpiJob('startup-warmup'),    240_000).unref();   // +240s (4 min)

  startWatchdog();
  console.log('🚀 Cron Jobs initialized', {
    siteRealtime: SITE_REALTIME_SCHEDULE,
    device: DEVICE_SCHEDULE,
    alarm: ALARM_SCHEDULE,
    dailyKpi: DAILY_KPI_SCHEDULE,
    hourlyKpi: HOURLY_KPI_SCHEDULE,
    auxRealtime: AUX_REALTIME_SCHEDULE,
    monthlyKpi: MONTHLY_KPI_SCHEDULE,
    watchdogIntervalMs: WATCHDOG_INTERVAL_MS,
    watchdogStaleMs: WATCHDOG_STALE_MS,
  });
};
