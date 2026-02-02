"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronJobs = void 0;
// src/jobs/cron.ts
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_1 = require("../services/syncService");
let isRunning = false;
const startCronJobs = () => {
    // แนะนำเริ่มช้าหน่อยก่อน: ทุก 10 นาที (ตอนนี้ตั้ง 5 นาทีตามเดิม)
    node_cron_1.default.schedule('*/5 * * * *', async () => {
        // กัน job ซ้อนกัน (สำคัญมากเพื่อเลี่ยง rate limit)
        if (isRunning) {
            console.log('⏭️ Previous sync still running. Skip this round.');
            return;
        }
        isRunning = true;
        try {
            console.log('⏰ Cron Job Triggered: Syncing Solar Data');
            await (0, syncService_1.syncInverterData)();
        }
        finally {
            isRunning = false;
        }
    });
    console.log('🚀 Cron Jobs initialized');
};
exports.startCronJobs = startCronJobs;
