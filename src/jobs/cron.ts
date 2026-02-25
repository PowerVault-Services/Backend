import cron from 'node-cron';
import { syncInverterData } from '../services/syncService';
import { syncActiveAlarms } from '../services/alarmSyncService';

let isRunning = false;
let isAlarmRunning = false;

export const startCronJobs = () => {
  cron.schedule('*/5 * * * *', async () => {
    if (isRunning) {
      console.log('⏭️ Previous sync still running. Skip this round.');
      return;
    }
    isRunning = true;
    try {
      console.log('⏰ Cron Job Triggered: Syncing Solar Data');
      await syncInverterData();
    } finally {
      isRunning = false;
    }
  });

  // ✅ Alarm sync ทุก 2 นาที (ปรับได้)
  cron.schedule('*/2 * * * *', async () => {
    if (isAlarmRunning) return;
    isAlarmRunning = true;
    try {
      console.log('⏰ Cron: Syncing Active Alarms');
      const r = await syncActiveAlarms();
      console.log('✅ Alarm sync result:', r);
    } finally {
      isAlarmRunning = false;
    }
  });

  console.log('🚀 Cron Jobs initialized');
};