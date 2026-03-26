import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import type { ReportJobData, EmailJobData } from './types';

// Queue names (also used by workers to register processors)
export const REPORT_QUEUE = 'report-generation';
export const EMAIL_QUEUE = 'email-sending';

let reportQueue: Queue<ReportJobData> | null = null;
let emailQueue: Queue<EmailJobData> | null = null;

/** Report-generation queue — used by API to enqueue, Worker to process */
export function getReportQueue(): Queue<ReportJobData> {
  if (!reportQueue) {
    reportQueue = new Queue<ReportJobData>(REPORT_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: { age: 24 * 3600 },  // keep 24h
        removeOnFail: { age: 7 * 24 * 3600 },  // keep 7d
      },
    });
  }
  return reportQueue;
}

/** Email-sending queue — used by API to enqueue, Worker to process */
export function getEmailQueue(): Queue<EmailJobData> {
  if (!emailQueue) {
    emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 3_000 },
        removeOnComplete: { age: 24 * 3600 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return emailQueue;
}

/** Graceful shutdown — close queue connections */
export async function closeQueues(): Promise<void> {
  await Promise.all([
    reportQueue?.close(),
    emailQueue?.close(),
  ]);
  reportQueue = null;
  emailQueue = null;
}
