import { Job } from 'bullmq';
import { PrismaClient, JobStatus } from '@prisma/client';
import { generateCleaningReportPdf } from '../../services/reportService';
import { generateServiceReportPdf } from '../../services/reportService';
import { tryEnsureLocalFilePath } from '../../services/storageService';
import type { ReportJobData, ReportJobResult } from '../types';

const prisma = new PrismaClient();

export async function processReportJob(job: Job<ReportJobData>): Promise<ReportJobResult> {
  const { jobId, jobType } = job.data;
  console.log(`[ReportProcessor] Starting ${jobType} report for jobId=${jobId}`);

  if (jobType === 'cleaning') {
    return processCleaningReport(job, jobId);
  } else if (jobType === 'service') {
    return processServiceReport(job, jobId);
  }

  throw new Error(`Unknown jobType: ${jobType}`);
}

// ── Cleaning report ──────────────────────────────────────────

async function processCleaningReport(job: Job<ReportJobData>, jobId: number): Promise<ReportJobResult> {
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: { site: { include: { layouts: true } }, attachments: true },
  });
  if (!dbJob) throw new Error(`Job ${jobId} not found`);

  const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId } });
  if (!cleaning) throw new Error(`CleaningJob for jobId=${jobId} not found`);

  await job.updateProgress(10);

  const attachments = dbJob.attachments ?? [];

  // Certificate images
  const certImgResolved = await Promise.all(
    attachments
      .filter((a) => a.fileType === 'STEP3_CERTIFICATE')
      .map(async (a) => {
        const filePath = await tryEnsureLocalFilePath(a.fileUrl);
        if (!filePath) console.warn(`[ReportProcessor] Skipped certificate image for jobId=${jobId}: ${a.fileUrl}`);
        return filePath ? { filePath } : null;
      }),
  );
  const certificateImages = certImgResolved.filter(Boolean) as { filePath: string }[];

  // Layout documents
  const layoutResolved = await Promise.all(
    attachments
      .filter((a) => a.fileType === 'STEP3_LAYOUT')
      .map(async (a) => {
        const filePath = await tryEnsureLocalFilePath(a.fileUrl);
        if (!filePath) console.warn(`[ReportProcessor] Skipped layout for jobId=${jobId}: ${a.fileUrl}`);
        return filePath ? { title: 'Layout', filePath } : null;
      }),
  );
  const layout = layoutResolved.filter(Boolean) as { title: string; filePath: string }[];

  await job.updateProgress(20);

  // Evidence groups
  const evidenceLabelMap: Record<string, { groupTitle: string; label: string; order: number }> = {
    STEP3_BEFORE_PANEL:    { groupTitle: 'ก่อนทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 0 },
    STEP3_DURING_PANEL:    { groupTitle: 'ขณะทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 1 },
    STEP3_AFTER_PANEL:     { groupTitle: 'หลังทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 2 },
    STEP3_BEFORE_INVERTER: { groupTitle: 'ก่อนทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 3 },
    STEP3_DURING_INVERTER: { groupTitle: 'ขณะทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 4 },
    STEP3_AFTER_INVERTER:  { groupTitle: 'หลังทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 5 },
    STEP3_ZONE_WORK:       { groupTitle: 'รูปโซนของการทำงาน', label: '', order: 6 },
    STEP3_ZONE_CHECKLIST:  { groupTitle: 'รูปโซนของการทำ Check List', label: '', order: 7 },
    STEP3_BEFORE:          { groupTitle: 'ก่อนทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 0 },
    STEP3_AFTER:           { groupTitle: 'หลังทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 2 },
    STEP3_BEFOREPANEL:     { groupTitle: 'ก่อนทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 0 },
    STEP3_DURINGPANEL:     { groupTitle: 'ขณะทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 1 },
    STEP3_AFTERPANEL:      { groupTitle: 'หลังทำความสะอาดแผงโซลาร์เซลล์', label: '', order: 2 },
    STEP3_BEFOREINVERTER:  { groupTitle: 'ก่อนทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 3 },
    STEP3_DURINGINVERTER:  { groupTitle: 'ขณะทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 4 },
    STEP3_AFTERINVERTER:   { groupTitle: 'หลังทำความสะอาดห้องอินเวอร์เตอร์', label: '', order: 5 },
    STEP3_ZONEWORK:        { groupTitle: 'รูปโซนของการทำงาน', label: '', order: 6 },
    STEP3_ZONECHECKLIST:   { groupTitle: 'รูปโซนของการทำ Check List', label: '', order: 7 },
  };

  function lookupEvidence(ft: string) {
    if (evidenceLabelMap[ft]) return evidenceLabelMap[ft];
    const norm = ft.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (evidenceLabelMap[norm]) return evidenceLabelMap[norm];
    return null;
  }

  type Img = { label?: string; filePath: string };
  const grouped = new Map<string, { images: Img[]; order: number }>();

  for (const a of attachments) {
    const ft = String(a.fileType ?? '');
    if (!ft.startsWith('STEP3_')) continue;
    if (['STEP3_CERTIFICATE', 'STEP3_LAYOUT'].includes(ft)) continue;

    const mapped = lookupEvidence(ft);
    const groupTitle = mapped?.groupTitle ?? 'รูปภาพ/หลักฐานอื่นๆ';
    const order = mapped?.order ?? 999;
    const label = mapped?.label ?? ft.replace(/^STEP3_/, '').split('_').join(' ');

    if (!grouped.has(groupTitle)) grouped.set(groupTitle, { images: [], order });
    const filePath = await tryEnsureLocalFilePath(a.fileUrl);
    if (!filePath) {
      console.warn(`[ReportProcessor] Skipped evidence image for jobId=${jobId}: ${a.fileUrl}`);
      continue;
    }
    grouped.get(groupTitle)!.images.push({ label, filePath });
  }

  const evidenceGroups = Array.from(grouped.entries())
    .map(([title, { images, order }]) => ({ title, images, order }))
    .sort((a, b) => a.order - b.order)
    .map(({ title, images }) => ({ title, images }));

  // PV Layout
  let siteLayoutPath: string | null = null;
  const pvLayout = (dbJob.site.layouts ?? []).find((l) => l.type === 'PV_LAYOUT');
  if (pvLayout?.fileUrl) {
    siteLayoutPath = await tryEnsureLocalFilePath(pvLayout.fileUrl);
    if (!siteLayoutPath) console.warn(`[ReportProcessor] Skipped PV layout for jobId=${jobId}: ${pvLayout.fileUrl}`);
  }

  await job.updateProgress(40);

  // Generate PDF
  const report = await generateCleaningReportPdf({
    jobNo: dbJob.jobNo,
    projectName: cleaning.projectName ?? dbJob.site.name,
    address: cleaning.locationText ?? dbJob.site.address,
    workDate: cleaning.workDate,
    workTime: cleaning.workTimeText,
    systemSizeKWp: cleaning.systemSizeKWp,
    pvModuleEA: cleaning.pvModuleEA,
    note: cleaning.note,
    checklist: cleaning.checklist,
    fullPageDocs: [...layout],
    evidenceGroups,
    siteLayoutPath,
    certificateImages,
  });

  await job.updateProgress(90);

  // Save to DB
  await prisma.cleaningJob.update({
    where: { jobId },
    data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
  });

  await prisma.jobAttachment.create({
    data: { jobId, fileUrl: report.fileUrl, fileType: 'REPORT' },
  });

  await bumpJobStep(jobId, 4);
  await job.updateProgress(100);

  console.log(`[ReportProcessor] Cleaning report done for jobId=${jobId}: ${report.fileUrl}`);
  return { fileUrl: report.fileUrl };
}

// ── Service report ───────────────────────────────────────────

async function processServiceReport(job: Job<ReportJobData>, jobId: number): Promise<ReportJobResult> {
  const dbJob = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      site: true,
      attachments: true,
      stockUsage: {
        include: { product: { include: { category: true, unit: true } } },
        orderBy: { txDate: 'desc' },
      },
    },
  });
  if (!dbJob) throw new Error(`Job ${jobId} not found`);

  const service = await prisma.serviceJob.findUnique({ where: { jobId } });
  if (!service) throw new Error(`ServiceJob for jobId=${jobId} not found`);

  await job.updateProgress(10);

  const attachments = dbJob.attachments ?? [];

  // Service report form images
  const formImgResolved = await Promise.all(
    attachments
      .filter((a) => a.fileType === 'SERVICE_REPORT_FORM')
      .map(async (a) => {
        const filePath = await tryEnsureLocalFilePath(a.fileUrl);
        if (!filePath) console.warn(`[ReportProcessor] Skipped report form image for jobId=${jobId}: ${a.fileUrl}`);
        return filePath ? { filePath } : null;
      }),
  );
  const serviceReportImages = formImgResolved.filter(Boolean) as { filePath: string }[];

  // Evidence photos
  const evidenceResolved = await Promise.all(
    attachments
      .filter((a) => a.fileType === 'SERVICE_EVIDENCE')
      .slice(0, 12)
      .map(async (a) => {
        const filePath = await tryEnsureLocalFilePath(a.fileUrl);
        if (!filePath) console.warn(`[ReportProcessor] Skipped evidence photo for jobId=${jobId}: ${a.fileUrl}`);
        return filePath ? { label: '', filePath } : null;
      }),
  );
  const evidence = evidenceResolved.filter(Boolean) as { label: string; filePath: string }[];

  await job.updateProgress(30);

  // Generate PDF
  const report = await generateServiceReportPdf({
    jobNo: dbJob.jobNo,
    projectName: service.projectName ?? dbJob.site.name,
    address: service.locationText ?? dbJob.site.address,
    workDate: service.workDate,
    workTime: service.workTimeText,
    systemSizeKWp: service.systemSizeKWp,
    pvModuleEA: service.pvModuleEA,
    note: service.note,
    serviceReportImages,
    evidencePhotos: evidence,
    meta: service.step3Meta,
    stockUsage: (dbJob.stockUsage ?? []).filter((t: any) => t.type === ('OUT' as any)),
  });

  await job.updateProgress(90);

  // Save to DB
  await prisma.serviceJob.update({
    where: { jobId },
    data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
  });

  await prisma.jobAttachment.create({
    data: { jobId, fileUrl: report.fileUrl, fileType: 'REPORT' },
  });

  await bumpJobStep(jobId, 4);
  await job.updateProgress(100);

  console.log(`[ReportProcessor] Service report done for jobId=${jobId}: ${report.fileUrl}`);
  return { fileUrl: report.fileUrl };
}

// ── Shared helper ────────────────────────────────────────────

async function bumpJobStep(jobId: number, next: number) {
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { step: true, status: true } });
  if (!job) return;
  const step = Math.max(job.step ?? 1, next);
  const data: { step: number; status?: JobStatus } = { step };
  if (job.status !== JobStatus.COMPLETED && job.status !== JobStatus.ASSIGNED) {
    data.status = JobStatus.DRAFT;
  }
  await prisma.job.update({ where: { id: jobId }, data });
}
