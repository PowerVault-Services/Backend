import { PrismaClient, JobStatus, JobType } from '@prisma/client';
import { Request, Response } from 'express';
import path from 'path';
import { sendEmailNow } from '../services/emailService';
import { generateCleaningReportPdf } from '../services/reportService';

const prisma = new PrismaClient();

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeJobNo() {
  // ตัวอย่าง: CLN-20260208-123456 (คุณจะปรับให้เหมือนของเดิมก็ได้)
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return `CLN-${y}${m}${da}-${rand}`;
}

/**
 * GET /api/cleaning/projects
 * ใช้สำหรับ dropdown "Project Name" แล้ว FE จะเลือก -> call detail
 * ดึงจาก DB (Site) ซึ่งถูก sync มาจาก Huawei อยู่แล้ว (ลด rate limit)
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

  // NOTE: Cleaning ใช้ข้อมูลจาก Site เป็นหลัก (auto-fill ช่องสีเทา)
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
 * POST /api/cleaning/step1
 * body: { siteId, projectType, ... }
 * สร้าง Job (DRAFT) + CleaningJob หรือ update ถ้ามี jobId ส่งมา
 */
export async function createDraftStep1(req: Request, res: Response) {
  const {
    jobId,
    siteId,
    projectType,
    contactPhone,
    contactEmail,
    workDate,      // "2026-02-08"
    workTimeText,  // "10:00"
    customerName,
    note,
  } = req.body ?? {};

  if (!siteId) return res.status(400).json({ success: false, message: 'siteId is required' });

  const site = await prisma.site.findUnique({ where: { id: Number(siteId) } });
  if (!site) return res.status(404).json({ success: false, message: 'Site not found' });

  const dt = workDate ? new Date(String(workDate)) : null;

  // create new draft
  if (!jobId) {
    const created = await prisma.job.create({
      data: {
        jobNo: makeJobNo(),
        title: `Cleaning - ${site.name}`,
        type: JobType.CLEANING,
        status: JobStatus.DRAFT,
        scheduledDate: dt,
        siteId: site.id,
        createdById: 1, // TODO: ต่อ auth แล้วเอาจาก token
      },
    });

    await prisma.cleaningJob.create({
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

  // update existing
  const j = await prisma.job.findUnique({ where: { id: Number(jobId) } });
  if (!j) return res.status(404).json({ success: false, message: 'Job not found' });

  await prisma.job.update({
    where: { id: j.id },
    data: {
      scheduledDate: dt,
      siteId: site.id,
      title: `Cleaning - ${site.name}`,
    },
  });

  await prisma.cleaningJob.upsert({
    where: { jobId: j.id },
    create: {
      jobId: j.id,
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

/** GET /api/cleaning/job/:jobId */
export async function getCleaningJob(req: Request, res: Response) {
  const jobId = Number(req.params.jobId);
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      site: true,
      attachments: true,
    },
  });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId } });
  res.json({ success: true, data: { job, cleaning } });
}

/**
 * POST /api/cleaning/step2/draft  (multipart)
 * fields: jobId, to, subject, body
 * files: attachments
 */
export async function saveStep2Draft(req: Request, res: Response) {
  const jobId = Number((req.body as any).jobId);
  const to = String((req.body as any).to ?? '');
  const subject = String((req.body as any).subject ?? '');
  const body = String((req.body as any).body ?? '');

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });

  // save files to JobAttachment
  const files = (req.files as Express.Multer.File[]) ?? [];
  for (const f of files) {
    await prisma.jobAttachment.create({
      data: {
        jobId,
        fileUrl: `/uploads/${path.basename(f.path)}`,
        fileType: 'STEP2_ATTACHMENT',
      },
    });
  }

  await prisma.cleaningJob.update({
    where: { jobId },
    data: {
      step2EmailTo: to || null,
      step2EmailSubject: subject || null,
      step2EmailBody: body || null,
    },
  });

  res.json({ success: true });
}

/**
 * POST /api/cleaning/step2/send
 * body: { jobId }
 * -> ส่งทันที + set job.status = ASSIGNED หรือ IN_PROGRESS (แล้วแต่ flow)
 */
export async function sendStep2Email(req: Request, res: Response) {
  const { jobId } = req.body ?? {};
  const id = Number(jobId);
  const job = await prisma.job.findUnique({
    where: { id },
    include: { attachments: true, site: true },
  });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
  if (!cleaning?.step2EmailTo || !cleaning.step2EmailSubject || !cleaning.step2EmailBody) {
    return res.status(400).json({ success: false, message: 'Email draft incomplete' });
  }

  const att = job.attachments
    .filter(a => a.fileType === 'STEP2_ATTACHMENT')
    .map(a => ({
      filename: a.fileUrl.split('/').pop() || 'file',
      path: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  const send = await sendEmailNow({
    jobId: id,
    step: 2,
    to: cleaning.step2EmailTo,
    subject: cleaning.step2EmailSubject,
    html: cleaning.step2EmailBody,
    attachments: att,
  });

  if (!send.success) return res.status(500).json({ success: false, message: send.error });

  await prisma.cleaningJob.update({
    where: { jobId: id },
    data: {
      step2SentAt: new Date(),
      step2SentByUserId: 1, // TODO auth
    },
  });

  await prisma.job.update({
    where: { id },
    data: { status: JobStatus.ASSIGNED },
  });

  res.json({ success: true });
}

/**
 * POST /api/cleaning/step3/evidence (multipart)
 * fields: jobId, labelType (BEFORE/AFTER/ETC)
 */
export async function uploadEvidence(req: Request, res: Response) {
  const jobId = Number((req.body as any).jobId);
  const labelType = String((req.body as any).labelType ?? 'EVIDENCE');

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId is required' });

  const files = (req.files as Express.Multer.File[]) ?? [];
  for (const f of files) {
    await prisma.jobAttachment.create({
      data: {
        jobId,
        fileUrl: `/uploads/${path.basename(f.path)}`,
        fileType: `STEP3_${labelType}`,
      },
    });
  }
  res.json({ success: true });
}

/** POST /api/cleaning/step3/checklist  body: { jobId, checklistJson } */
export async function saveChecklist(req: Request, res: Response) {
  const { jobId, checklistJson, step3SummaryNote } = req.body ?? {};
  const id = Number(jobId);
  if (!id) return res.status(400).json({ success: false, message: 'jobId is required' });

  await prisma.cleaningJob.update({
    where: { jobId: id },
    data: {
      checklist: checklistJson ?? null,
      step3SummaryNote: step3SummaryNote ?? null,
    },
  });

  res.json({ success: true });
}

/**
 * POST /api/cleaning/step4/generate  body: { jobId }
 * -> สร้าง report pdf, เก็บ url ลง cleaningJob.reportFileUrl
 */
export async function generateReport(req: Request, res: Response) {
  const { jobId } = req.body ?? {};
  const id = Number(jobId);

  const job = await prisma.job.findUnique({
    where: { id },
    include: { site: true, attachments: true },
  });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
  if (!cleaning) return res.status(404).json({ success: false, message: 'CleaningJob not found' });

  // เปลี่ยนจาก photos -> fullPageDocs + evidenceGroups
  const attachments = job.attachments ?? [];

  // 1) Full page docs (แนบเป็นหน้าเต็ม) — แนะนำให้อัปโหลดเป็นรูป (jpg/png)
  const cert = attachments
    .filter(a => a.fileType === 'STEP3_CERTIFICATE')
    .map(a => ({
      title: 'เอกสารส่งมอบงาน',
      filePath: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  const layout = attachments
    .filter(a => a.fileType === 'STEP3_LAYOUT')
    .map(a => ({
      title: 'Layout',
      filePath: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  // 2) Evidence groups (รูปก่อน/หลัง)
  const beforeImgs = attachments
    .filter(a => a.fileType === 'STEP3_BEFORE')
    .map(a => ({
      label: 'ก่อนทำความสะอาด',
      filePath: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  const afterImgs = attachments
    .filter(a => a.fileType === 'STEP3_AFTER')
    .map(a => ({
      label: 'หลังทำความสะอาด',
      filePath: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  // อื่นๆ
  const otherImgs = attachments
    .filter(a => String(a.fileType ?? '').startsWith('STEP3_') && !['STEP3_BEFORE', 'STEP3_AFTER', 'STEP3_CERTIFICATE', 'STEP3_LAYOUT'].includes(String(a.fileType)))
    .map(a => ({
      label: a.fileType ?? 'EVIDENCE',
      filePath: path.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));

  const evidenceGroups = [
    ...(beforeImgs.length ? [{ title: 'รูปภาพก่อนทำความสะอาด', images: beforeImgs }] : []),
    ...(afterImgs.length ? [{ title: 'รูปภาพหลังทำความสะอาด', images: afterImgs }] : []),
    ...(otherImgs.length ? [{ title: 'รูปภาพ/หลักฐานอื่นๆ', images: otherImgs }] : []),
  ];

  const report = await generateCleaningReportPdf({
    jobNo: job.jobNo,
    projectName: cleaning.projectName ?? job.site.name,
    address: cleaning.locationText ?? job.site.address,
    workDate: cleaning.workDate,
    workTime: cleaning.workTimeText,
    systemSizeKWp: cleaning.systemSizeKWp,
    pvModuleEA: cleaning.pvModuleEA,
    note: cleaning.note,
    checklist: cleaning.checklist,
    fullPageDocs: [...cert, ...layout],
    evidenceGroups,
  });

  await prisma.cleaningJob.update({
    where: { jobId: id },
    data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
  });

  // แนบเป็น JobAttachment ด้วย (optional)
  await prisma.jobAttachment.create({
    data: { jobId: id, fileUrl: report.fileUrl, fileType: 'REPORT' },
  });

  res.json({ success: true, data: { reportUrl: report.fileUrl, download: `/api/cleaning/step4/download/${id}` } });
}

/** GET /api/cleaning/step4/download/:jobId -> redirect ไปไฟล์ report */
export async function downloadReportRedirect(req: Request, res: Response) {
  const jobId = Number(req.params.jobId);
  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId } });
  if (!cleaning?.reportFileUrl) return res.status(404).send('Report not found');
  res.redirect(cleaning.reportFileUrl);
}

/**
 * POST /api/cleaning/step5/send
 * body: { jobId, to, subject, body }
 * แนบ report และส่งทันที
 */
export async function sendStep5Email(req: Request, res: Response) {
  const { jobId, to, subject, body } = req.body ?? {};
  const id = Number(jobId);

  const job = await prisma.job.findUnique({ where: { id }, include: { site: true } });
  if (!job) return res.status(404).json({ success: false, message: 'Job not found' });

  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
  if (!cleaning?.reportFileUrl) return res.status(400).json({ success: false, message: 'Report not generated' });

  const reportAbs = path.join(process.cwd(), cleaning.reportFileUrl.replace('/uploads/', 'uploads/'));

  const send = await sendEmailNow({
    jobId: id,
    step: 5,
    to: String(to),
    subject: String(subject),
    html: String(body),
    attachments: [{ filename: `Cleaning-Report-${job.jobNo}.pdf`, path: reportAbs }],
  });

  if (!send.success) return res.status(500).json({ success: false, message: send.error });

  await prisma.cleaningJob.update({
    where: { jobId: id },
    data: {
      step5EmailTo: String(to),
      step5EmailSubject: String(subject),
      step5EmailBody: String(body),
      step5SentAt: new Date(),
      step5SentByUserId: 1,
    },
  });

  await prisma.job.update({
    where: { id },
    data: { status: JobStatus.COMPLETED },
  });

  res.json({ success: true });
}
