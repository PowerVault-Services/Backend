// ── BullMQ Job Data Types ──

export type ReportJobType = 'cleaning' | 'service';

export interface ReportJobData {
  /** Database job ID (cleaning_jobs.id or service_jobs.id) */
  jobId: number;
  /** Which report type to generate */
  jobType: ReportJobType;
}

export interface ReportJobResult {
  fileUrl: string;
}

// ──────────────────────────────────────────────

export type EmailJobSource = 'cleaning' | 'service' | 'inspection';

export interface EmailAttachment {
  filename: string;
  /** Local file path (when API and Worker are on the same machine) */
  path?: string;
  /** MinIO/storage fileUrl — Worker will resolve to local path before sending */
  fileUrl?: string;
  cid?: string;
}

export interface EmailJobData {
  /** Database job ID */
  jobId: number;
  /** Email step number (2, 3, 5, etc.) */
  step: number;
  /** Which controller triggered this */
  source: EmailJobSource;
  /** Recipient email */
  to: string;
  /** Email subject */
  subject: string;
  /** Email body (HTML) */
  html: string;
  /** Optional file attachments */
  attachments?: EmailAttachment[];
}

export interface EmailJobResult {
  success: boolean;
  messageId?: string;
  accepted?: (string | object)[];
  rejected?: (string | object)[];
  error?: string;
}
