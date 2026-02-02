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
// import huaweiDebugRoutes from './routes/huaweiDebugRoutes';
const monitoringRoutes_1 = __importDefault(require("./routes/monitoringRoutes"));
const homepageRoutes_1 = require("./routes/homepageRoutes");
const stockRoutes_1 = require("./routes/stockRoutes");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use('/api/auth', authRoutes_1.default);
// app.use('/api/huawei', huaweiDebugRoutes);
app.use('/api/monitoring', monitoringRoutes_1.default);
app.use('/api/homepage', homepageRoutes_1.homepageRoutes);
app.use('/api/stock', stockRoutes_1.stockRoutes);
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
