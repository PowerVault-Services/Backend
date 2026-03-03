"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startCronJobs = void 0;
const node_cron_1 = __importDefault(require("node-cron"));
const syncService_1 = require("../services/syncService");
const alarmSyncService_1 = require("../services/alarmSyncService");
let isRunning = false;
let isAlarmRunning = false;
let cronInitialized = false;
const startCronJobs = () => {
    if (cronInitialized) {
        console.warn('⚠️ Cron already initialized. Skip duplicate start.');
        return;
    }
    cronInitialized = true;
    console.log('🧠 startCronJobs() called');
    // ---------------- Solar Sync ----------------
    node_cron_1.default.schedule('*/5 * * * *', async () => {
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
    // ---------------- Alarm Sync ----------------
    const alarmSchedule = process.env.HUAWEI_ALARM_CRON ?? '*/5 * * * *';
    node_cron_1.default.schedule(alarmSchedule, async () => {
        if (isAlarmRunning)
            return;
        isAlarmRunning = true;
        try {
            console.log(`⏰ Cron: Syncing Active Alarms (schedule=${alarmSchedule})`);
            const r = await (0, alarmSyncService_1.syncActiveAlarms)();
            console.log('✅ Alarm sync result:', r);
        }
        finally {
            isAlarmRunning = false;
        }
    });
    console.log('🚀 Cron Jobs initialized');
};
exports.startCronJobs = startCronJobs;
