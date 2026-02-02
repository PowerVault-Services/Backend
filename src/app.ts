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

const app = express();

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
// app.use('/api/huawei', huaweiDebugRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/homepage', homepageRoutes);
app.use('/api/stock', stockRoutes);

app.get('/', (req: Request, res: Response) => {
  res.send('Hello! Solar Energy Backend is Running 🚀');
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`Server is running on port ${PORT}`);

  try {
    await huaweiService.ensureLoggedIn();
  } catch (err) {
    console.error('❌ Huawei initial login failed:', err);
  }

  startCronJobs();
});
