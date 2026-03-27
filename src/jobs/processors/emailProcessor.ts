import { Job } from 'bullmq';
import { sendEmailNow } from '../../services/emailService';
import { tryEnsureLocalFilePath } from '../../services/storageService';
import type { EmailJobData, EmailJobResult } from '../types';

export async function processEmailJob(job: Job<EmailJobData>): Promise<EmailJobResult> {
  const { jobId, step, source, to, subject, html, attachments } = job.data;
  console.log(`[EmailProcessor] Sending email for ${source} jobId=${jobId} step=${step} to=${to}`);

  // Resolve fileUrl → local path on this machine (download from MinIO if needed)
  const resolvedAttachments = attachments
    ? await Promise.all(
        attachments.map(async (a) => {
          if (a.fileUrl && !a.path) {
            const localPath = await tryEnsureLocalFilePath(a.fileUrl);
            if (!localPath) {
              console.warn(`[EmailProcessor] Could not resolve attachment: ${a.fileUrl}`);
              return null;
            }
            return { filename: a.filename, path: localPath, cid: a.cid };
          }
          return { filename: a.filename, path: a.path!, cid: a.cid };
        }),
      ).then((arr) => arr.filter(Boolean) as { filename: string; path: string; cid?: string }[])
    : undefined;

  const result = await sendEmailNow({
    jobId,
    step,
    to,
    subject,
    html,
    attachments: resolvedAttachments,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Email sending failed');
  }

  console.log(`[EmailProcessor] Email sent for ${source} jobId=${jobId} step=${step}: ${result.messageId}`);
  return result;
}
