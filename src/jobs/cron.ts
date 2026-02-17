// src/jobs/cron.ts
import cron from 'node-cron';
import { syncInverterData } from '../services/syncService';

let isRunning = false;

export const startCronJobs = () => {
  // แนะนำเริ่มช้าหน่อยก่อน: ทุก 10 นาที (ตอนนี้ตั้ง 5 นาทีตามเดิม)
  cron.schedule('*/5 * * * *', async () => {
    // กัน job ซ้อนกัน (สำคัญมากเพื่อเลี่ยง rate limit)
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

  console.log('🚀 Cron Jobs initialized');
};