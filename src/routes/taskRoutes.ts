import { Router, Request, Response } from 'express';
import { getReportQueue, getEmailQueue } from '../jobs/queues';
import { REPORT_QUEUE, EMAIL_QUEUE } from '../jobs/queues';

const router = Router();

/**
 * GET /api/tasks/:taskId?queue=report-generation|email-sending
 * Frontend polls this after getting taskId from enqueue response
 */
router.get('/:taskId', async (req: Request, res: Response) => {
  const taskId = String(req.params.taskId);
  const rawQueue = req.query.queue;
  const queueName: string = typeof rawQueue === 'string' ? rawQueue : REPORT_QUEUE;

  const queue = queueName === EMAIL_QUEUE ? getEmailQueue() : getReportQueue();
  const job = await queue.getJob(taskId);

  if (!job) {
    return res.status(404).json({ success: false, message: 'Task not found' });
  }

  const state = await job.getState();

  return res.json({
    success: true,
    data: {
      taskId: job.id,
      queue: queueName,
      state,           // waiting | active | completed | failed | delayed
      progress: job.progress,
      result: state === 'completed' ? job.returnvalue : undefined,
      failedReason: state === 'failed' ? job.failedReason : undefined,
    },
  });
});

export default router;
