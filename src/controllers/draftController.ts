import { PrismaClient, JobStatus, JobType } from '@prisma/client';
import { Request, Response } from 'express';
import { getEmailSignaturePresets } from '../services/emailSignatureService';

const prisma = new PrismaClient();

// จำนวน step สูงสุดของแต่ละประเภท job (ตาม requirement)
const MAX_STEP_BY_TYPE: Record<JobType, number> = {
  [JobType.CLEANING]: 5,
  [JobType.SERVICE]: 5,
  [JobType.INSPECTION]: 3,
  // เผื่อระบบอื่นในอนาคต
  [JobType.OM]: 5,
};

function clampStep(type: JobType, step: number) {
  const max = MAX_STEP_BY_TYPE[type] ?? 5;
  if (!Number.isFinite(step) || step < 1) return 1;
  if (step > max) return max;
  return Math.floor(step);
}

/**
 * POST /api/drafts/save
 * body: { jobId, step }
 *
 * ใช้สำหรับปุ่ม "Save Draft" มุมขวาบนของทุก step
 * - ไม่บังคับว่าข้อมูลใน step นั้น ๆ ต้องครบ (ปล่อยให้ endpoint ของแต่ละ step เก็บรายละเอียด)
 * - ทำหน้าที่อัปเดต job.step / job.status ให้ระบบรู้ว่า draft ค้างอยู่ถึงขั้นตอนไหน
 */
export async function saveDraftProgress(req: Request, res: Response) {
  const jobId = Number(req.body?.jobId);
  const stepIn = Number(req.body?.step);

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const step = clampStep(job.type, stepIn);

  // update step แบบไม่ถอยหลัง (เก็บ progress ที่ไกลสุด)
  const nextStep = Math.max(job.step ?? 1, step);

  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.DRAFT,
      step: nextStep,
    },
    select: { id: true, jobNo: true, type: true, status: true, step: true, updatedAt: true },
  });

  res.json({ success: true, data: updated });
}

/**
 * GET /api/drafts
 * query: jobType?=CLEANING|SERVICE|INSPECTION
 *
 * ใช้ดึงรายการ draft (status=DRAFT) เพื่อ resume งานที่ค้าง
 */
export async function listDrafts(req: Request, res: Response) {
  const jobType = String(req.query.jobType ?? '').trim();
  const where: any = { status: JobStatus.DRAFT };
  if (jobType) where.type = jobType as any;

  const rows = await prisma.job.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      site: { select: { id: true, name: true } },
    },
  });

  res.json({
    success: true,
    data: rows.map((j) => ({
      jobId: j.id,
      jobNo: j.jobNo,
      jobType: j.type,
      step: j.step,
      siteId: j.siteId,
      projectName: j.site?.name ?? null,
      updatedAt: j.updatedAt,
    })),
  });
}


/**
 * GET /api/drafts/email-signatures
 * ใช้สำหรับ dropdown เลือกลายเซ็นท้ายอีเมล
 */
export async function listEmailSignatures(_req: Request, res: Response) {
  res.json({
    success: true,
    data: {
      supportsCustomName: true,
      defaultKey: 'palm',
      defaultName: 'palm',
      items: getEmailSignaturePresets(),
    },
  });
}
