// src/worker.ts  --  Standalone worker process (cron sync + BullMQ job processing)
require('./config/loadEnv').loadEnv();

import { validateEnv, getEnv } from './config/env';
validateEnv();

import express, { Request, Response } from 'express';
import { Worker as BullWorker } from 'bullmq';
import { getCronStatus, startCronJobs } from './jobs/cron';
import { REPORT_QUEUE, EMAIL_QUEUE } from './jobs/queues';
import { processReportJob } from './jobs/processors/reportProcessor';
import { processEmailJob } from './jobs/processors/emailProcessor';
import { createRedisConnection } from './config/redis';
import { huaweiService } from './services/huaweiService';
import { getLoadedEnvPath } from './config/loadEnv';
import { projectRoot } from './config/runtimePaths';

const app = express();

// Minimal health endpoints for monitoring
app.get('/healthz', async (_req: Request, res: Response) => {
  const cronStatus = getCronStatus();
  const now = Date.now();
  const maxLagMs = Number(process.env.HUAWEI_SYNC_HEALTH_MAX_LAG_MS ?? 20 * 60_000);
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
    role: 'worker',
    now,
    maxLagMs,
    jobs: jobEntries,
    unhealthyJobs,
  });
});

app.get('/readyz', async (_req: Request, res: Response) => {
  try {
    await huaweiService.ensureLoggedIn();
    return res.json({ ok: true, role: 'worker' });
  } catch (error: any) {
    return res.status(503).json({ ok: false, role: 'worker', error: error?.message ?? String(error) });
  }
});

app.get('/', (_req: Request, res: Response) => {
  res.json({ role: 'worker', status: 'running', cron: getCronStatus() });
});

const PORT = process.env.WORKER_PORT || process.env.PORT || 3001;

// ── BullMQ Workers (only when USE_QUEUE is enabled) ──
function startQueueWorkers() {
  const env = getEnv();
  if (!env.USE_QUEUE) {
    console.log('[Worker] USE_QUEUE is off — skipping BullMQ workers');
    return;
  }

  console.log('[Worker] Starting BullMQ workers...');

  const reportWorker = new BullWorker(REPORT_QUEUE, processReportJob, {
    connection: createRedisConnection(),
    concurrency: 1, // Puppeteer is resource-heavy
  });
  reportWorker.on('completed', (job) => {
    console.log(`[Worker] Report job ${job.id} completed`);
  });
  reportWorker.on('failed', (job, err) => {
    console.error(`[Worker] Report job ${job?.id} failed:`, err.message);
  });

  const emailWorker = new BullWorker(EMAIL_QUEUE, processEmailJob, {
    connection: createRedisConnection(),
    concurrency: 3,
  });
  emailWorker.on('completed', (job) => {
    console.log(`[Worker] Email job ${job.id} completed`);
  });
  emailWorker.on('failed', (job, err) => {
    console.error(`[Worker] Email job ${job?.id} failed:`, err.message);
  });

  console.log('[Worker] BullMQ workers started: report (concurrency=1), email (concurrency=3)');
}

app.listen(Number(PORT), '0.0.0.0', async () => {
  console.log(`[Worker] Running on port ${PORT}`);
  console.log('[Worker] Project root:', projectRoot);
  console.log('[Worker] Loaded env file:', getLoadedEnvPath() ?? 'not found (using process env / defaults)');

  try {
    await huaweiService.ensureLoggedIn();
  } catch (err) {
    console.error('[Worker] Huawei initial login failed:', err);
  }

  void startCronJobs();
  startQueueWorkers();
});
