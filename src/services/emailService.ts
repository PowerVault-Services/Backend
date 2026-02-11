import nodemailer from 'nodemailer';
import prisma from '../config/prisma';

/**
 * ===== DEBUG: เช็ค ENV ตอนโหลดไฟล์ =====
 * ถ้าตรงนี้ยังเป็น 127.0.0.1 แปลว่า dotenv / restart มีปัญหา
 */
console.log('SMTP_ENV_DEBUG', {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: process.env.SMTP_SECURE,
  user: process.env.SMTP_USER,
  from: process.env.SMTP_FROM,
});

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT ?? 587),
  secure: String(process.env.SMTP_SECURE ?? 'false') === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

/**
 * ===== DEBUG: verify SMTP ตอน start =====
 * ถ้าตรงนี้ error แปลว่ายังไม่ผ่าน Gmail แน่นอน
 */
transporter.verify((err, success) => {
  if (err) {
    console.error('❌ SMTP VERIFY FAILED:', err.message);
  } else {
    console.log('✅ SMTP VERIFY SUCCESS: Gmail ready');
  }
});

export async function sendEmailNow(opts: {
  jobId?: number;
  step?: number;
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; path: string }[];
}) {
  console.log('📤 SEND_EMAIL_CALLED', {
    jobId: opts.jobId,
    step: opts.step,
    to: opts.to,
    subject: opts.subject,
    attachments: opts.attachments?.length ?? 0,
  });

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      attachments: opts.attachments ?? [],
      replyTo: process.env.SMTP_USER,
      headers: {
        'X-Entity-Ref-ID': String(opts.jobId ?? ''),
      },
    });

    /**
     * ===== DEBUG: ผลลัพธ์จาก Nodemailer =====
     * จุดนี้สำคัญที่สุด
     */
    console.log('📬 MAIL_SENT_DEBUG', {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
      pending: info.pending,
    });

    await prisma.emailLog.create({
      data: {
        jobId: opts.jobId,
        step: opts.step,
        to: opts.to,
        subject: opts.subject,
        bodyPreview: opts.html.slice(0, 500),
        status: 'SENT',
      },
    });

    return {
      success: true,
      messageId: info.messageId,
      accepted: info.accepted,
      rejected: info.rejected,
    };
  } catch (e: any) {
    console.error('❌ SEND_EMAIL_ERROR', {
      message: e?.message,
      code: e?.code,
      response: e?.response,
      stack: e?.stack,
    });

    await prisma.emailLog.create({
      data: {
        jobId: opts.jobId,
        step: opts.step,
        to: opts.to,
        subject: opts.subject,
        bodyPreview: opts.html.slice(0, 500),
        status: 'FAILED',
        errorMessage: e?.message ?? String(e),
      },
    });

    return { success: false, error: e?.message ?? String(e) };
  }
}
