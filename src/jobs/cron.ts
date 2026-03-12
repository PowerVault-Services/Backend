import cron from 'node-cron';
import { syncInverterData, syncSiteRealtimeTick } from '../services/syncService';
import { syncActiveAlarms } from '../services/alarmSyncService';
import { huaweiClients } from '../services/huaweiPool';

let isRunning = false;
let isAlarmRunning = false;
let cronInitialized = false;

export const startCronJobs = () => {
  if (cronInitialized) {
    console.warn('Cron already initialized. Skip duplicate start.');
    return;
  }
  cronInitialized = true;
  console.log('startCronJobs() called');

  //Solar Sync 
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) {
      console.log('⏭️ Previous sync still running. Skip this round.');
      return;
    }
    isRunning = true;
    try {
      huaweiClients.main.resetStats();
      huaweiClients.backup.resetStats();
      huaweiClients.ondemand.resetStats();

      console.log('⏰ Cron Job Triggered: Syncing Site Realtime + Device Detail');
      await syncSiteRealtimeTick();
      await syncInverterData();
    } finally {
      isRunning = false;
    }
  });

  //Alarm Sync
  const alarmSchedule = process.env.HUAWEI_ALARM_CRON ?? '*/5 * * * *';

  cron.schedule(alarmSchedule, async () => {
    if (isAlarmRunning) return;
    isAlarmRunning = true;
    try {
      console.log(`⏰ Cron: Syncing Active Alarms (schedule=${alarmSchedule})`);
      const r = await syncActiveAlarms();
      console.log('✅ Alarm sync result:', r);
    } finally {
      isAlarmRunning = false;
    }
  });

  console.log('🚀 Cron Jobs initialized');
};
