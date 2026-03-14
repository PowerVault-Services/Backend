// src/app.ts
require('./config/loadEnv').loadEnv();

import express, { Request, Response } from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import { startCronJobs } from './jobs/cron';
import { huaweiService } from './services/huaweiService';
// import huaweiDebugRoutes from './routes/huaweiDebugRoutes';
import monitoringRoutes from './routes/monitoringRoutes';
import { homepageRoutes } from './routes/homepageRoutes';
import { stockRoutes } from './routes/stockRoutes';
import cleaningRoutes from './routes/cleaningRoutes';
import inspectionRoutes from './routes/inspectionRoutes';
import serviceRoutes from './routes/serviceRoutes';
import alarmRoutes from './routes/alarmRoutes';
import clientDataRoutes from './routes/clientDataRoutes';
import reportRoutes from './routes/reportRoutes';
import draftRoutes from './routes/draftRoutes';
import { getLoadedEnvPath } from './config/loadEnv';
import { projectRoot } from './config/runtimePaths';
import { serveFileUrlViaGateway, storageFlagsSummary, verifyObjectStorageAccess } from './services/storageService';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
// app.use('/api/huawei', huaweiDebugRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/homepage', homepageRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/cleaning', cleaningRoutes);

// Express/path-to-regexp รุ่นใหม่ต้องตั้งชื่อ wildcard parameter
app.get('/uploads/*filePath', async (req: Request, res: Response) => {
  return serveFileUrlViaGateway(req.path, req, res);
});

app.head('/uploads/*filePath', async (req: Request, res: Response) => {
  return serveFileUrlViaGateway(req.path, req, res);
});

app.use('/api/inspection', inspectionRoutes);
app.use('/api/service', serviceRoutes);
app.use('/api/alarms', alarmRoutes);
app.use('/api/client-data', clientDataRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/drafts', draftRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Hello! Solar Energy Backend is Running 🚀');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);
  console.log('📁 Project root:', projectRoot);
  console.log('🧪 Loaded env file:', getLoadedEnvPath() ?? 'not found (using process env / defaults)');
  const storageSummary = storageFlagsSummary();
  console.log('📦 Storage flags:', storageSummary);

  if (storageSummary.driver === 'minio') {
    const objectCheck = await verifyObjectStorageAccess();
    if (objectCheck.ok) {
      console.log('✅ Object storage auth check passed:', objectCheck.message);
    } else if ('skipped' in objectCheck && objectCheck.skipped) {
      console.log('⏭️ Object storage auth check skipped:', objectCheck.message);
    } else {
      console.error('❌ Object storage auth check failed:', objectCheck);
    }
  }

  try {
    await huaweiService.ensureLoggedIn();
  } catch (err) {
    console.error('❌ Huawei initial login failed:', err);
  }

  startCronJobs();
});
