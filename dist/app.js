"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// src/app.ts
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const authRoutes_1 = __importDefault(require("./routes/authRoutes"));
const cron_1 = require("./jobs/cron");
const huaweiService_1 = require("./services/huaweiService");
const path_1 = __importDefault(require("path"));
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
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', authRoutes_1.default);
// app.use('/api/huawei', huaweiDebugRoutes);
app.use('/api/monitoring', monitoringRoutes_1.default);
app.use('/api/homepage', homepageRoutes_1.homepageRoutes);
app.use('/api/stock', stockRoutes_1.stockRoutes);
app.use('/api/cleaning', cleaningRoutes_1.default);
app.use('/uploads', express_1.default.static(path_1.default.join(process.cwd(), 'uploads')));
app.use('/api/inspection', inspectionRoutes_1.default);
app.use('/api/service', serviceRoutes_1.default);
app.use('/api/alarms', alarmRoutes_1.default);
app.use('/api/client-data', clientDataRoutes_1.default);
app.use('/api/reports', reportRoutes_1.default);
app.use('/api/drafts', draftRoutes_1.default);
app.get('/', (req, res) => {
    res.send('Hello! Solar Energy Backend is Running 🚀');
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    try {
        await huaweiService_1.huaweiService.ensureLoggedIn();
    }
    catch (err) {
        console.error('❌ Huawei initial login failed:', err);
    }
    (0, cron_1.startCronJobs)();
});
