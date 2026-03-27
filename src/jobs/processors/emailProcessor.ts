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
              throw new Error(`[EmailProcessor] Failed to resolve attachment: ${a.fileUrl}`);
            }
            return { filename: a.filename, path: localPath, cid: a.cid };
          }
          if (!a.path) {
            throw new Error(`[EmailProcessor] Attachment has no path or fileUrl: ${a.filename}`);
          }
          return { filename: a.filename, path: a.path, cid: a.cid };
        }),
      )
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
