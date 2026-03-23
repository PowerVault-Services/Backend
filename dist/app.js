"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
require('./config/loadEnv').loadEnv();
const env_1 = require("./config/env");
(0, env_1.validateEnv)();
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const cron_1 = require("./jobs/cron");
const huaweiService_1 = require("./services/huaweiService");
// import huaweiDebugRoutes from './routes/huaweiDebugRoutes';
const monitoringRoutes_1 = __importDefault(require("./routes/monitoringRoutes"));
const homepageRoutes_1 = require("./routes/homepageRoutes");
const stockRoutes_1 = require("./routes/stockRoutes");
const cleaningRoutes_1 = __importDefault(require("./routes/cleaningRoutes"));
const inspectionRoutes_1 = __importDefault(require("./routes/inspectionRoutes"));
const serviceRoutes_1 = __importDefault(require("./routes/serviceRoutes"));
const alarmRoutes_1 = __importDefault(require("./routes/alarmRoutes"));
const clientDataRoutes_1 = __importDefault(require("./routes/clientDataRoutes"));
const reportRoutes_1 = __importDefault(require("./routes/reportRoutes"));
const draftRoutes_1 = __importDefault(require("./routes/draftRoutes"));
const adminRoutes_1 = __importDefault(require("./routes/adminRoutes"));
const loadEnv_1 = require("./config/loadEnv");
const runtimePaths_1 = require("./config/runtimePaths");
const storageService_1 = require("./services/storageService");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', authRoutes_1.default);
// app.use('/api/huawei', huaweiDebugRoutes);
app.use('/api/monitoring', monitoringRoutes_1.default);
app.use('/api/homepage', homepageRoutes_1.homepageRoutes);
app.use('/api/stock', stockRoutes_1.stockRoutes);
app.use('/api/cleaning', cleaningRoutes_1.default);
// Express/path-to-regexp รุ่นใหม่ต้องตั้งชื่อ wildcard parameter
app.get('/uploads/*filePath', async (req, res) => {
    return (0, storageService_1.serveFileUrlViaGateway)(req.path, req, res);
});
app.head('/uploads/*filePath', async (req, res) => {
    return (0, storageService_1.serveFileUrlViaGateway)(req.path, req, res);
});
app.use('/api/inspection', inspectionRoutes_1.default);
app.use('/api/service', serviceRoutes_1.default);
app.use('/api/alarms', alarmRoutes_1.default);
app.use('/api/client-data', clientDataRoutes_1.default);
app.use('/api/reports', reportRoutes_1.default);
app.use('/api/drafts', draftRoutes_1.default);
app.use('/api/admin', adminRoutes_1.default);
app.get('/', (req, res) => {
    res.send('Hello! Solar Energy Backend is Running 🚀');
});
app.get('/healthz', async (_req, res) => {
    const cronStatus = (0, cron_1.getCronStatus)();
    const now = Date.now();
    const maxLagMs = Number(process.env.HUAWEI_SYNC_HEALTH_MAX_LAG_MS ?? 20 * 60000);
    const jobEntries = Object.entries(cronStatus.jobs).map(([jobName, job]) => ({
        jobName,
        running: job.running,
        lastAttemptAt: job.lastAttemptAt,
        lastSuccessAt: job.lastSuccessAt,
        lagMs: job.lastSuccessAt ? Math.max(0, now - job.lastSuccessAt) : null,
    }));
    const unhealthyJobs = jobEntries.filter((job) => job.lagMs == null || job.lagMs > maxLagMs);
    const ok = unhealthyJobs.length === 0;
    return res.status(ok ? 200 : 503).json({
        ok,
        now,
        maxLagMs,
        jobs: jobEntries,
        unhealthyJobs,
    });
});
app.get('/readyz', async (_req, res) => {
    try {
        await huaweiService_1.huaweiService.ensureLoggedIn();
        return res.json({ ok: true });
    }
    catch (error) {
        return res.status(503).json({ ok: false, error: error?.message ?? String(error) });
    }
});
const PORT = process.env.PORT || 3000;
app.listen(Number(PORT), '0.0.0.0', async () => {
    console.log(`Server is running on port ${PORT}`);
    console.log('📁 Project root:', runtimePaths_1.projectRoot);
    console.log('🧪 Loaded env file:', (0, loadEnv_1.getLoadedEnvPath)() ?? 'not found (using process env / defaults)');
    const storageSummary = (0, storageService_1.storageFlagsSummary)();
    console.log('📦 Storage flags:', storageSummary);
    if (storageSummary.driver === 'minio') {
        const objectCheck = await (0, storageService_1.verifyObjectStorageAccess)();
        if (objectCheck.ok) {
            console.log('✅ Object storage auth check passed:', objectCheck.message);
        }
        else if ('skipped' in objectCheck && objectCheck.skipped) {
            console.log('⏭️ Object storage auth check skipped:', objectCheck.message);
        }
        else {
            console.error('❌ Object storage auth check failed:', objectCheck);
        }
    }
    try {
        await huaweiService_1.huaweiService.ensureLoggedIn();
    }
    catch (err) {
        console.error('❌ Huawei initial login failed:', err);
    }
    void (0, cron_1.startCronJobs)();
});
