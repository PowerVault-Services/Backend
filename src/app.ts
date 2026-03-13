// src/app.ts
import 'dotenv/config';

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
import { serveFileUrlViaGateway, storageFlagsSummary } from './services/storageService';

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
  console.log('📦 Storage flags:', storageFlagsSummary());

  try {
    await huaweiService.ensureLoggedIn();
  } catch (err) {
    console.error('❌ Huawei initial login failed:', err);
  }

  startCronJobs();
});