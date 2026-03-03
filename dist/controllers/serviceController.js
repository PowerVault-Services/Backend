"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjects = listProjects;
exports.createDraftStep1 = createDraftStep1;
exports.getServiceJob = getServiceJob;
exports.saveStep2Draft = saveStep2Draft;
exports.sendStep2Email = sendStep2Email;
exports.saveStep3Draft = saveStep3Draft;
exports.generateReport = generateReport;
exports.downloadReportRedirect = downloadReportRedirect;
exports.sendStep5Email = sendStep5Email;
const client_1 = require("@prisma/client");
const path_1 = __importDefault(require("path"));
const emailService_1 = require("../services/emailService");
const reportService_1 = require("../services/reportService");
const prisma = new client_1.PrismaClient();
function makeJobNo() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return `SRV-${y}${m}${da}-${rand}`;
}
/**
 * GET /api/service/projects
 * - ใช้ dropdown "Project Name" และเอาไป auto-fill ช่องสีเทาใน Step1
 */
async function listProjects(req, res) {
    const q = String(req.query.q ?? '').trim();
    const where = q
        ? {
            OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { plantCode: { contains: q, mode: 'insensitive' } },
            ],
        }
        : {};
    const sites = await prisma.site.findMany({
        where,
        take: 50,
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
 * POST /api/service/step1
 * body: { jobId?, siteId, projectType?, contactPhone?, contactEmail?, workDate?, workTimeText?, customerName?, note? }
 */
async function createDraftStep1(req, res) {
    const { jobId, siteId, projectType, contactPhone, contactEmail, workDate, workTimeText, customerName, note, } = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    const site = await prisma.site.findUnique({ where: { id: Number(siteId) } });
    if (!site)
        return res.status(404).json({ success: false, message: 'Site not found' });
    const dt = workDate ? new Date(String(workDate)) : null;
    // create new draft
    if (!jobId) {
        const created = await prisma.job.create({
            data: {
                jobNo: makeJobNo(),
                title: `Service - ${site.name}`,
                type: client_1.JobType.SERVICE,
                status: client_1.JobStatus.DRAFT,
                scheduledDate: dt,
                siteId: site.id,
                createdById: 1, // TODO: auth
            },
        });
        await prisma.serviceJob.create({
            data: {
                jobId: created.id,
                projectName: site.name,
                systemSizeKWp: site.capacityKWp,
                pvModuleEA: site.pvModuleCount ?? null,
                locationText: site.address ?? null,
                projectType: projectType ?? null,
                contactPhone: contactPhone ?? site.contactPhone ?? null,
                contactEmail: contactEmail ?? site.contactEmail ?? null,
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
    if (!j)
        return res.status(404).json({ success: false, message: 'Job not found' });
    await prisma.job.update({
        where: { id: j.id },
        data: {
            scheduledDate: dt,
            siteId: site.id,
            title: `Service - ${site.name}`,
        },
    });
    await prisma.serviceJob.upsert({
        where: { jobId: j.id },
        create: {
            jobId: j.id,
            projectName: site.name,
            systemSizeKWp: site.capacityKWp,
            pvModuleEA: site.pvModuleCount ?? null,
            locationText: site.address ?? null,
            projectType: projectType ?? null,
            contactPhone: contactPhone ?? site.contactPhone ?? null,
            contactEmail: contactEmail ?? site.contactEmail ?? null,
            workDate: dt,
            workTimeText: workTimeText ?? null,
            customerName: customerName ?? null,
            note: note ?? null,
        },
        update: {
            projectName: site.name,
            systemSizeKWp: site.capacityKWp,
            pvModuleEA: site.pvModuleCount ?? null,
            locationText: site.address ?? null,
            projectType: projectType ?? null,
            contactPhone: contactPhone ?? site.contactPhone ?? null,
            contactEmail: contactEmail ?? site.contactEmail ?? null,
            workDate: dt,
            workTimeText: workTimeText ?? null,
            customerName: customerName ?? null,
            note: note ?? null,
        },
    });
    res.json({ success: true, data: { jobId: j.id, jobNo: j.jobNo } });
}
/** GET /api/service/job/:jobId */
async function getServiceJob(req, res) {
    const jobId = Number(req.params.jobId);
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { site: true, attachments: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const service = await prisma.serviceJob.findUnique({ where: { jobId } });
    res.json({ success: true, data: { job, service } });
}
/**
 * POST /api/service/step2/draft (multipart)
 * fields: jobId, to, subject, body
 * files: attachments
 */
async function saveStep2Draft(req, res) {
    const jobId = Number(req.body.jobId);
    const to = String(req.body.to ?? '').trim();
    const subject = String(req.body.subject ?? '').trim();
    const body = String(req.body.body ?? '').trim();
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const files = req.files ?? [];
    for (const f of files) {
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: `/uploads/${path_1.default.basename(f.path)}`,
                fileType: 'SERVICE_STEP2_ATTACHMENT',
            },
        });
    }
    await prisma.serviceJob.update({
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
 * POST /api/service/step2/send
 * body: { jobId }
 */
async function sendStep2Email(req, res) {
    const { jobId } = req.body ?? {};
    const id = Number(jobId);
    const job = await prisma.job.findUnique({
        where: { id },
        include: { attachments: true, site: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const service = await prisma.serviceJob.findUnique({ where: { jobId: id } });
    if (!service?.step2EmailTo || !service.step2EmailSubject || !service.step2EmailBody) {
        return res.status(400).json({ success: false, message: 'Email draft incomplete (ต้องมี To/Subject/Body)' });
    }
    const att = (job.attachments ?? [])
        .filter((a) => a.fileType === 'SERVICE_STEP2_ATTACHMENT')
        .map((a) => ({
        filename: a.fileUrl.split('/').pop() || 'file',
        path: path_1.default.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 2,
        to: service.step2EmailTo,
        subject: service.step2EmailSubject,
        html: service.step2EmailBody,
        attachments: att,
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.serviceJob.update({
        where: { jobId: id },
        data: {
            step2SentAt: new Date(),
            step2SentByUserId: 1,
        },
    });
    await prisma.job.update({
        where: { id },
        data: { status: client_1.JobStatus.ASSIGNED },
    });
    res.json({ success: true });
}
/**
 * POST /api/service/step3/draft (multipart)
 * fields: jobId, metaJson? (optional)
 * files:
 *  - serviceReport (single): รูปฟอร์ม Service Report (แนะนำ jpg/png)
 *  - evidence (multi): รูปหลักฐานอื่น ๆ
 */
async function saveStep3Draft(req, res) {
    const jobId = Number(req.body.jobId);
    const metaJson = req.body.metaJson;
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const files = req.files ?? {};
    const formFile = files.serviceReport?.[0] ?? undefined;
    const evidenceFiles = files.evidence ?? [];
    if (formFile) {
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: `/uploads/${path_1.default.basename(formFile.path)}`,
                fileType: 'SERVICE_REPORT_FORM',
            },
        });
    }
    for (const f of evidenceFiles) {
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: `/uploads/${path_1.default.basename(f.path)}`,
                fileType: 'SERVICE_EVIDENCE',
            },
        });
    }
    let meta = null;
    if (metaJson) {
        try {
            meta = typeof metaJson === 'string' ? JSON.parse(metaJson) : metaJson;
        }
        catch {
            // ignore
        }
    }
    await prisma.serviceJob.update({
        where: { jobId },
        data: {
            step3Meta: meta,
        },
    });
    res.json({ success: true });
}
/**
 * POST /api/service/step4/generate  body: { jobId }
 */
async function generateReport(req, res) {
    const { jobId } = req.body ?? {};
    const id = Number(jobId);
    const job = await prisma.job.findUnique({
        where: { id },
        include: { site: true, attachments: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const service = await prisma.serviceJob.findUnique({ where: { jobId: id } });
    if (!service)
        return res.status(404).json({ success: false, message: 'ServiceJob not found' });
    const attachments = job.attachments ?? [];
    const form = attachments
        .filter((a) => a.fileType === 'SERVICE_REPORT_FORM')
        .slice(-1)
        .map((a) => path_1.default.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')))[0];
    const evidence = attachments
        .filter((a) => a.fileType === 'SERVICE_EVIDENCE')
        .slice(0, 12)
        .map((a) => ({
        label: 'รูปภาพ',
        filePath: path_1.default.join(process.cwd(), a.fileUrl.replace('/uploads/', 'uploads/')),
    }));
    const report = await (0, reportService_1.generateServiceReportPdf)({
        jobNo: job.jobNo,
        projectName: service.projectName ?? job.site.name,
        address: service.locationText ?? job.site.address,
        workDate: service.workDate,
        workTime: service.workTimeText,
        systemSizeKWp: service.systemSizeKWp,
        pvModuleEA: service.pvModuleEA,
        note: service.note,
        serviceReportFormPath: form ?? null,
        evidencePhotos: evidence,
        meta: service.step3Meta,
    });
    await prisma.serviceJob.update({
        where: { jobId: id },
        data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
    });
    await prisma.jobAttachment.create({
        data: { jobId: id, fileUrl: report.fileUrl, fileType: 'REPORT' },
    });
    res.json({
        success: true,
        data: { reportUrl: report.fileUrl, download: `/api/service/step4/download/${id}` },
    });
}
/** GET /api/service/step4/download/:jobId */
async function downloadReportRedirect(req, res) {
    const jobId = Number(req.params.jobId);
    const service = await prisma.serviceJob.findUnique({ where: { jobId } });
    if (!service?.reportFileUrl)
        return res.status(404).send('Report not found');
    res.redirect(service.reportFileUrl);
}
/**
 * POST /api/service/step5/send
 * body: { jobId, to, subject, body }
 */
async function sendStep5Email(req, res) {
    const { jobId, to, subject, body } = req.body ?? {};
    const id = Number(jobId);
    const job = await prisma.job.findUnique({ where: { id }, include: { site: true } });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const service = await prisma.serviceJob.findUnique({ where: { jobId: id } });
    if (!service?.reportFileUrl)
        return res.status(400).json({ success: false, message: 'Report not generated' });
    const reportAbs = path_1.default.join(process.cwd(), service.reportFileUrl.replace('/uploads/', 'uploads/'));
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 5,
        to: String(to),
        subject: String(subject),
        html: String(body),
        attachments: [{ filename: `Service-Report-${job.jobNo}.pdf`, path: reportAbs }],
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.serviceJob.update({
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
        data: { status: client_1.JobStatus.COMPLETED },
    });
    res.json({ success: true });
}
