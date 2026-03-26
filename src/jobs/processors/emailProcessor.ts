import { Job } from 'bullmq';
import { sendEmailNow } from '../../services/emailService';
import type { EmailJobData, EmailJobResult } from '../types';

export async function processEmailJob(job: Job<EmailJobData>): Promise<EmailJobResult> {
  const { jobId, step, source, to, subject, html, attachments } = job.data;
  console.log(`[EmailProcessor] Sending email for ${source} jobId=${jobId} step=${step} to=${to}`);

  const result = await sendEmailNow({
    jobId,
    step,
    to,
    subject,
    html,
    attachments,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Email sending failed');
  }

  console.log(`[EmailProcessor] Email sent for ${source} jobId=${jobId} step=${step}: ${result.messageId}`);
  return result;
}
