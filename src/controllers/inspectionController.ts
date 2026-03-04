import { PrismaClient, JobStatus, JobType } from '@prisma/client';
import { Request, Response } from 'express';
import path from 'path';
import { sendEmailNow } from '../services/emailService';
import fs from 'fs';

const prisma = new PrismaClient();

function makeJobNo() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return `INSP-${y}${m}${da}-${rand}`;
}

// อ่าน field จาก multipart แบบ "case-insensitive" กันพลาด (เช่น Subject, subject )
function pickTextField(body: any, key: string): string {
  if (!body) return '';
  if (typeof body[key] === 'string') return body[key];
  const target = key.toLowerCase();
  for (const k of Object.keys(body)) {
    if (k.trim().toLowerCase() === target) {
      const v = (body as any)[k];
      if (typeof v === 'string') return v;
      if (Array.isArray(v)) return String(v[0] ?? '');
      return String(v ?? '');
    }
  }
  return '';
}

/**
 * GET /api/inspection/projects
 */
export async function listProjects(req: Request, res: Response) {
  const q = String(req.query.q ?? '').trim();
  const where: any = q
    ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { plantCode: { contains: q, mode: 'insensitive' } }] }
    : {};

  const page = Math.max(1, Number(req.query.page ?? 1));
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize ?? 1000)));
  const skip = (page - 1) * pageSize;

  const total = await prisma.site.count({ where });

  const sites = await prisma.site.findMany({
    where,
    skip,
    take: pageSize,
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      plantCode: true,
      address: true,
      capacityKWp: true,
      pvModuleCount: true,
      contactPhone: true,
      contactEmail: true,
    },
  });

  res.json({
    success: true,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
    data: sites.map((s) => ({
      siteId: s.id,
      plantCode: s.plantCode,
      projectName: s.name,
      address: s.address,
      systemSizeKWp: s.capacityKWp,
      pvModuleEA: s.pvModuleCount ?? null,
      contactPhone: s.contactPhone ?? null,
      contactEmail: s.contactEmail ?? null,
    })),
  });
}

/**
 * POST /api/inspection/step1
 */
export async function createDraftStep1(req: Request, res: Response) {
  const { jobId, siteId, projectType, contactPhone, contactEmail, workDate, workTimeText, customerName, note } =
    req.body ?? {};

  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const site = await prisma.site.findUnique({ where: { id: Number(siteId) } });
  if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

  const dt = workDate ? new Date(String(workDate)) : null;

  if (!jobId) {
    const created = await prisma.job.create({
      data: {
        jobNo: makeJobNo(),
        title: `Inspection - ${site.name}`,
        type: JobType.INSPECTION,
        status: JobStatus.DRAFT,
        scheduledDate: dt,
        siteId: site.id,
        createdById: 1, // TODO auth
      },
    });

    await prisma.inspectionJob.create({
      data: {
        jobId: created.id,
        projectName: site.name,
        systemSizeKWp: site.capacityKWp,
        pvModuleEA: null,
        locationText: site.address ?? null,
        projectType: projectType ?? null,
        contactPhone: contactPhone ?? null,
        contactEmail: contactEmail ?? null,
        workDate: dt,
        workTimeText: workTimeText ?? null,
        customerName: customerName ?? null,
        note: note ?? null,
      },
    });

    return res.json({ success: true, data: { jobId: created.id, jobNo: created.jobNo } });
  }

  const j = await prisma.job.findUnique({ where: { id: Number(jobId) } });
  if (!j) return res.status(404).json({ success: false, message: 'Job not found' });

  await prisma.job.update({
    where: { id: j.id },
    data: { scheduledDate: dt, siteId: site.id, title: `Inspection - ${site.name}` },
  });

  await prisma.inspectionJob.upsert({
    where: { jobId: j.id },
    create: {
      jobId: j.id,
      projectName: site.name,
      systemSizeKWp: site.capacityKWp,
      pvModuleEA: null,
      locationText: site.address ?? null,
      projectType: projectType ?? null,
      contactPhone: contactPhone ?? null,
      contactEmail: contactEmail ?? null,
      workDate: dt,
      workTimeText: workTimeText ?? null,
      customerName: customerName ?? null,
      note: note ?? null,
    },
    update: {
      projectName: site.name,
      systemSizeKWp: site.capacityKWp,
      locationText: site.address ?? null,
      projectType: projectType ?? null,
      contactPhone: contactPhone ?? null,
      contactEmail: contactEmail ?? null,
      workDate: dt,
      workTimeText: workTimeText ?? null,
      customerName: customerName ?? null,
      note: note ?? null,
    },
  });

  res.json({ success: true, data: { jobId: j.id, jobNo: j.jobNo } });
}

/** GET /api/inspection/job/:jobId */
export async function getInspectionJob(req: Request, res: Response) {
  const jobId = Number(req.params.jobId);
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { site: true, attachments: true },
  });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const inspection = await prisma.inspectionJob.findUnique({ where: { jobId } });
  res.json({ success: true, data: { job, inspection } });
}

/**
 * POST /api/inspection/step2/draft (multipart)
 * fields: jobId, to, subject, body
 * files: attachments
 */
export async function saveStep2Draft(req: Request, res: Response) {
  const jobId = Number(pickTextField(req.body, 'jobId'));
  const to = pickTextField(req.body, 'to').trim();
  const subject = pickTextField(req.body, 'subject').trim();
  const body = pickTextField(req.body, 'body'); // อย่า trim html มากไป

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
  if (!to || !subject || !body) {
    return res.status(400).json({
      success: false,
      message: 'Draft ต้องมี to / subject / body',
      debug: { to: !!to, subject: !!subject, body: !!body, keys: Object.keys(req.body ?? {}) },
    });
  }

  const files = (req.files as Express.Multer.File[]) ?? [];
  for (const f of files) {
    // NOTE: ถ้าเปลี่ยน multer storage ให้ตั้ง filename มีนามสกุลแล้ว Gmail จะเปิดได้
    await prisma.jobAttachment.create({
      data: {
        jobId,
        fileUrl: `/uploads/${path.basename(f.path)}`,
        fileType: 'INSP_STEP2_ATTACHMENT',
      },
    });
  }

  await prisma.inspectionJob.upsert({
    where: { jobId },
    create: {
      jobId,
      step2EmailTo: to,
      step2EmailSubject: subject,
      step2EmailBody: body,
    },
    update: {
      step2EmailTo: to,
      step2EmailSubject: subject,
      step2EmailBody: body,
    },
  });

  res.json({ success: true });
}

/**
 * POST /api/inspection/step2/send
 * body: { jobId }
 */
export async function sendStep2Email(req: Request, res: Response) {
  const id = Number(req.body?.jobId);
  if (!id) return res.status(400).json({ success: false, message: 'jobId is required' });

  const job = await prisma.job.findUnique({
    where: { id },
    include: { attachments: true, site: true },
  });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const inspection = await prisma.inspectionJob.findUnique({ where: { jobId: id } });
  if (!inspection?.step2EmailTo || !inspection.step2EmailSubject || !inspection.step2EmailBody) {
    return res.status(400).json({ success: false, message: 'Email draft incomplete (ต้องมี To/Subject/Body)' });
  }

  const missing: string[] = [];

  const att = (job.attachments ?? [])
    .filter((a) => a.fileType === 'INSP_STEP2_ATTACHMENT')
    .map((a) => {
      // ✅ sanitize fileUrl กันตัวแปลก ๆ เช่น * " '
      const safeUrl = String(a.fileUrl ?? '')
        .trim()
        .replace(/["']/g, '')
        .replace(/\*/g, '');

      // safeUrl เช่น /uploads/xxxx  -> uploads/xxxx
      const relPath = safeUrl.replace(/^\/+/, '').replace(/^uploads\//, 'uploads/');

      const absPath = path.join(process.cwd(), relPath);

      if (!fs.existsSync(absPath)) {
        missing.push(relPath);
        return null;
      }

      return {
        filename: path.basename(absPath), // อย่างน้อยให้มีชื่อไฟล์แนบ
        path: absPath,
      };
    })
    .filter(Boolean) as { filename: string; path: string }[];

  // ถ้าอยาก “บังคับว่าต้องมีไฟล์แนบ” ให้ return error ตรงนี้แทนการส่ง
  // ตอนนี้ผมทำแบบ "ส่งได้ แม้บางไฟล์หาย" แต่แจ้งรายการไฟล์ที่หายกลับไป
  const send = await sendEmailNow({
    jobId: id,
    step: 2,
    to: inspection.step2EmailTo,
    subject: inspection.step2EmailSubject,
    html: inspection.step2EmailBody,
    attachments: att,
  });

  if (!send.success) return res.status(500).json({ success: false, message: send.error });

  await prisma.inspectionJob.update({
    where: { jobId: id },
    data: { step2SentAt: new Date(), step2SentByUserId: 1 },
  });

  await prisma.job.update({
    where: { id },
    data: { status: JobStatus.ASSIGNED },
  });

  return res.json({
    success: true,
    warning: missing.length ? { message: 'บางไฟล์แนบไม่พบในโฟลเดอร์ uploads จึงไม่ถูกแนบ', missing } : undefined,
  });
}

/**
 * POST /api/inspection/step3/draft (multipart)
 * fields: jobId, to, subject, body
 * file: report
 */
export async function saveStep3Draft(req: Request, res: Response) {
  const jobId = Number(pickTextField(req.body, 'jobId'));
  const to = pickTextField(req.body, 'to').trim();
  const subject = pickTextField(req.body, 'subject').trim();
  const body = pickTextField(req.body, 'body');

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });
  if (!to || !subject || !body) {
    return res.status(400).json({ success: false, message: 'Draft ต้องมี to / subject / body' });
  }

  const file = (req.file as Express.Multer.File) ?? null;
  if (file) {
    const fileUrl = `/uploads/${path.basename(file.path)}`;

    await prisma.jobAttachment.create({
      data: { jobId, fileUrl, fileType: 'INSP_REPORT' },
    });

    await prisma.inspectionJob.upsert({
      where: { jobId },
      create: {
        jobId,
        reportFileUrl: fileUrl,
        reportCreatedAt: new Date(),
        step3EmailTo: to,
        step3EmailSubject: subject,
        step3EmailBody: body,
      },
      update: {
        reportFileUrl: fileUrl,
        reportCreatedAt: new Date(),
        step3EmailTo: to,
        step3EmailSubject: subject,
        step3EmailBody: body,
      },
    });

    return res.json({ success: true });
  }

  // ไม่มีไฟล์ ก็เซฟเฉพาะ draft
  await prisma.inspectionJob.upsert({
    where: { jobId },
    create: { jobId, step3EmailTo: to, step3EmailSubject: subject, step3EmailBody: body },
    update: { step3EmailTo: to, step3EmailSubject: subject, step3EmailBody: body },
  });

  res.json({ success: true });
}

/**
 * POST /api/inspection/step3/send
 * body: { jobId }
 */
export async function sendStep3Email(req: Request, res: Response) {
  const id = Number(req.body?.jobId);
  if (!id) return res.status(400).json({ success: false, message: 'jobId is required' });

  const job = await prisma.job.findUnique({ where: { id }, include: { site: true } });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const inspection = await prisma.inspectionJob.findUnique({ where: { jobId: id } });
  if (!inspection?.step3EmailTo || !inspection.step3EmailSubject || !inspection.step3EmailBody) {
    return res.status(400).json({ success: false, message: 'Email draft incomplete (ต้องมี To/Subject/Body)' });
  }
  if (!inspection.reportFileUrl) {
    return res.status(400).json({ success: false, message: 'Report not uploaded' });
  }

  const reportAbs = path.join(process.cwd(), inspection.reportFileUrl.replace('/uploads/', 'uploads/'));

  const send = await sendEmailNow({
    jobId: id,
    step: 3,
    to: inspection.step3EmailTo,
    subject: inspection.step3EmailSubject,
    html: inspection.step3EmailBody,
    attachments: [{ filename: path.basename(reportAbs), path: reportAbs }],
  });

  if (!send.success) return res.status(500).json({ success: false, message: send.error });

  await prisma.inspectionJob.update({
    where: { jobId: id },
    data: { step3SentAt: new Date(), step3SentByUserId: 1 },
  });

  await prisma.job.update({
    where: { id },
    data: { status: JobStatus.COMPLETED },
  });

  res.json({ success: true });
}
