"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjects = listProjects;
exports.listInspectionJobs = listInspectionJobs;
exports.createDraftStep1 = createDraftStep1;
exports.getInspectionJob = getInspectionJob;
exports.saveStep2Draft = saveStep2Draft;
exports.sendStep2Email = sendStep2Email;
exports.saveStep3Draft = saveStep3Draft;
exports.sendStep3Email = sendStep3Email;
exports.updateInspectionJob = updateInspectionJob;
exports.deleteInspectionJob = deleteInspectionJob;
exports.downloadInspectionReportsZip = downloadInspectionReportsZip;
const client_1 = require("@prisma/client");
const path_1 = __importDefault(require("path"));
const emailService_1 = require("../services/emailService");
const fs_1 = __importDefault(require("fs"));
const jobManagement_1 = require("../utils/jobManagement");
const prisma = new client_1.PrismaClient();
async function bumpJobStep(jobId, next) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { step: true } });
    if (!job)
        return;
    const step = Math.max(job.step ?? 1, next);
    await prisma.job.update({ where: { id: jobId }, data: { step, status: client_1.JobStatus.DRAFT } });
}
function makeJobNo() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return `INSP-${y}${m}${da}-${rand}`;
}
// อ่าน field จาก multipart แบบ "case-insensitive" กันพลาด (เช่น Subject, subject )
function pickTextField(body, key) {
    if (!body)
        return '';
    if (typeof body[key] === 'string')
        return body[key];
    const target = key.toLowerCase();
    for (const k of Object.keys(body)) {
        if (k.trim().toLowerCase() === target) {
            const v = body[k];
            if (typeof v === 'string')
                return v;
            if (Array.isArray(v))
                return String(v[0] ?? '');
            return String(v ?? '');
        }
    }
    return '';
}
/**
 * GET /api/inspection/projects
 */
async function listProjects(req, res) {
    const q = String(req.query.q ?? '').trim();
    const where = q
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
 * GET /api/inspection/jobs
 * ใช้สำหรับหน้า HomeInspection เพื่อแสดงรายการ Inspection Job ที่ถูกสร้างแล้ว
 */
async function listInspectionJobs(req, res) {
    try {
        const page = Math.max(1, Number(req.query.page ?? 1));
        const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
        const skip = (page - 1) * pageSize;
        const jobNo = String(req.query.jobNo ?? '').trim();
        const projectType = String(req.query.projectType ?? '').trim();
        const projectName = String(req.query.projectName ?? '').trim();
        const status = String(req.query.status ?? '').trim();
        const systemSizeKWp = Number.isFinite(Number(req.query.systemSizeKWp)) ? Number(req.query.systemSizeKWp) : null;
        const pvModuleEA = Number.isFinite(Number(req.query.pvModuleEA)) ? Number(req.query.pvModuleEA) : null;
        const dateStr = String(req.query.date ?? '').trim();
        const date = dateStr ? new Date(dateStr) : null;
        if (date)
            date.setHours(0, 0, 0, 0);
        const whereJob = { type: client_1.JobType.INSPECTION };
        if (jobNo)
            whereJob.jobNo = { contains: jobNo, mode: 'insensitive' };
        if (projectType)
            whereJob.projectType = { contains: projectType, mode: 'insensitive' };
        if (status)
            whereJob.status = status;
        const whereIns = {};
        if (projectName)
            whereIns.projectName = { contains: projectName, mode: 'insensitive' };
        if (systemSizeKWp != null)
            whereIns.systemSizeKWp = systemSizeKWp;
        if (pvModuleEA != null)
            whereIns.pvModuleEA = pvModuleEA;
        if (date)
            whereIns.workDate = date;
        const [total, rows] = await Promise.all([
            prisma.job.count({
                where: {
                    ...whereJob,
                    inspectionJob: Object.keys(whereIns).length ? { is: whereIns } : undefined,
                },
            }),
            prisma.job.findMany({
                where: {
                    ...whereJob,
                    inspectionJob: Object.keys(whereIns).length ? { is: whereIns } : undefined,
                },
                orderBy: [{ createdAt: 'desc' }],
                skip,
                take: pageSize,
                include: {
                    inspectionJob: true,
                    site: { select: { name: true } },
                },
            }),
        ]);
        res.json({
            success: true,
            pagination: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
            data: rows.map((j) => ({
                jobId: j.id,
                jobNo: j.jobNo,
                projectType: j.projectType ?? j.inspectionJob?.projectType ?? null,
                projectName: j.inspectionJob?.projectName ?? j.site?.name ?? null,
                systemSizeKWp: j.inspectionJob?.systemSizeKWp ?? null,
                pvModuleEA: j.inspectionJob?.pvModuleEA ?? null,
                date: j.inspectionJob?.workDate ?? null,
                time: j.inspectionJob?.workTimeText ?? null,
                status: j.status,
            })),
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
/**
 * POST /api/inspection/step1
 */
async function createDraftStep1(req, res) {
    const { jobId, siteId, projectType, contactPhone, contactEmail, workDate, workTimeText, customerName, note } = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    const site = await prisma.site.findUnique({ where: { id: Number(siteId) } });
    if (!site)
        return res.status(404).json({ success: false, message: 'Site not found' });
    const dt = workDate ? new Date(String(workDate)) : null;
    if (!jobId) {
        const created = await prisma.job.create({
            data: {
                jobNo: makeJobNo(),
                title: `Inspection - ${site.name}`,
                type: client_1.JobType.INSPECTION,
                status: client_1.JobStatus.DRAFT,
                step: 1,
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
    if (!j)
        return res.status(404).json({ success: false, message: 'Job not found' });
    await prisma.job.update({
        where: { id: j.id },
        data: { scheduledDate: dt, siteId: site.id, title: `Inspection - ${site.name}`, step: 1 },
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
async function getInspectionJob(req, res) {
    const jobId = Number(req.params.jobId);
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { site: true, attachments: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const inspection = await prisma.inspectionJob.findUnique({ where: { jobId } });
    res.json({ success: true, data: { job, inspection } });
}
/**
 * POST /api/inspection/step2/draft (multipart)
 * fields: jobId, to, subject, body
 * files: attachments
 */
async function saveStep2Draft(req, res) {
    const jobId = Number(pickTextField(req.body, 'jobId'));
    const to = pickTextField(req.body, 'to').trim();
    const subject = pickTextField(req.body, 'subject').trim();
    const body = pickTextField(req.body, 'body'); // อย่า trim html มากไป
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const files = req.files ?? [];
    for (const f of files) {
        // NOTE: ถ้าเปลี่ยน multer storage ให้ตั้ง filename มีนามสกุลแล้ว Gmail จะเปิดได้
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: `/uploads/${path_1.default.basename(f.path)}`,
                fileType: 'INSP_STEP2_ATTACHMENT',
            },
        });
    }
    await prisma.inspectionJob.upsert({
        where: { jobId },
        create: {
            jobId,
            step2EmailTo: to || null,
            step2EmailSubject: subject || null,
            step2EmailBody: body || null,
        },
        update: {
            step2EmailTo: to || null,
            step2EmailSubject: subject || null,
            step2EmailBody: body || null,
        },
    });
    await bumpJobStep(jobId, 2);
    res.json({ success: true });
}
/**
 * POST /api/inspection/step2/send
 * body: { jobId }
 */
async function sendStep2Email(req, res) {
    const id = Number(req.body?.jobId);
    if (!id)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const job = await prisma.job.findUnique({
        where: { id },
        include: { attachments: true, site: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const inspection = await prisma.inspectionJob.findUnique({ where: { jobId: id } });
    if (!inspection?.step2EmailTo || !inspection.step2EmailSubject || !inspection.step2EmailBody) {
        return res.status(400).json({ success: false, message: 'Email draft incomplete (ต้องมี To/Subject/Body)' });
    }
    const missing = [];
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
        const absPath = path_1.default.join(process.cwd(), relPath);
        if (!fs_1.default.existsSync(absPath)) {
            missing.push(relPath);
            return null;
        }
        return {
            filename: path_1.default.basename(absPath), // อย่างน้อยให้มีชื่อไฟล์แนบ
            path: absPath,
        };
    })
        .filter(Boolean);
    // ถ้าอยาก “บังคับว่าต้องมีไฟล์แนบ” ให้ return error ตรงนี้แทนการส่ง
    // ตอนนี้ผมทำแบบ "ส่งได้ แม้บางไฟล์หาย" แต่แจ้งรายการไฟล์ที่หายกลับไป
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 2,
        to: inspection.step2EmailTo,
        subject: inspection.step2EmailSubject,
        html: inspection.step2EmailBody,
        attachments: att,
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.inspectionJob.update({
        where: { jobId: id },
        data: { step2SentAt: new Date(), step2SentByUserId: 1 },
    });
    await prisma.job.update({
        where: { id },
        data: { status: client_1.JobStatus.ASSIGNED },
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
async function saveStep3Draft(req, res) {
    const jobId = Number(pickTextField(req.body, 'jobId'));
    const to = pickTextField(req.body, 'to').trim();
    const subject = pickTextField(req.body, 'subject').trim();
    const body = pickTextField(req.body, 'body');
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const file = req.file ?? null;
    if (file) {
        const fileUrl = `/uploads/${path_1.default.basename(file.path)}`;
        await prisma.jobAttachment.create({
            data: { jobId, fileUrl, fileType: 'INSP_REPORT' },
        });
        await prisma.inspectionJob.upsert({
            where: { jobId },
            create: {
                jobId,
                reportFileUrl: fileUrl,
                reportCreatedAt: new Date(),
                step3EmailTo: to || null,
                step3EmailSubject: subject || null,
                step3EmailBody: body || null,
            },
            update: {
                reportFileUrl: fileUrl,
                reportCreatedAt: new Date(),
                step3EmailTo: to || null,
                step3EmailSubject: subject || null,
                step3EmailBody: body || null,
            },
        });
        await bumpJobStep(jobId, 3);
        return res.json({ success: true });
    }
    // ไม่มีไฟล์ ก็เซฟเฉพาะ draft
    await prisma.inspectionJob.upsert({
        where: { jobId },
        create: { jobId, step3EmailTo: to || null, step3EmailSubject: subject || null, step3EmailBody: body || null },
        update: { step3EmailTo: to || null, step3EmailSubject: subject || null, step3EmailBody: body || null },
    });
    await bumpJobStep(jobId, 3);
    res.json({ success: true });
}
/**
 * POST /api/inspection/step3/send
 * body: { jobId }
 */
async function sendStep3Email(req, res) {
    const id = Number(req.body?.jobId);
    if (!id)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const job = await prisma.job.findUnique({ where: { id }, include: { site: true } });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const inspection = await prisma.inspectionJob.findUnique({ where: { jobId: id } });
    if (!inspection?.step3EmailTo || !inspection.step3EmailSubject || !inspection.step3EmailBody) {
        return res.status(400).json({ success: false, message: 'Email draft incomplete (ต้องมี To/Subject/Body)' });
    }
    if (!inspection.reportFileUrl) {
        return res.status(400).json({ success: false, message: 'Report not uploaded' });
    }
    const reportAbs = path_1.default.join(process.cwd(), inspection.reportFileUrl.replace('/uploads/', 'uploads/'));
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 3,
        to: inspection.step3EmailTo,
        subject: inspection.step3EmailSubject,
        html: inspection.step3EmailBody,
        attachments: [{ filename: path_1.default.basename(reportAbs), path: reportAbs }],
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.inspectionJob.update({
        where: { jobId: id },
        data: { step3SentAt: new Date(), step3SentByUserId: 1 },
    });
    await prisma.job.update({
        where: { id },
        data: { status: client_1.JobStatus.COMPLETED },
    });
    res.json({ success: true });
}
/** PUT /api/inspection/job/:jobId */
async function updateInspectionJob(req, res) {
    req.body = { ...(req.body ?? {}), jobId: Number(req.params.jobId) };
    return createDraftStep1(req, res);
}
/** DELETE /api/inspection/job/:jobId */
async function deleteInspectionJob(req, res) {
    try {
        const jobId = Number(req.params.jobId);
        if (!jobId)
            return res.status(400).json({ success: false, message: 'jobId is required' });
        const result = await (0, jobManagement_1.deleteJobCascade)(prisma, jobId, client_1.JobType.INSPECTION);
        if (!result.found)
            return res.status(404).json({ success: false, message: 'Inspection job not found' });
        return res.json({ success: true, message: `Deleted ${result.jobNo}` });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
/** GET/POST /api/inspection/jobs/download-zip */
async function downloadInspectionReportsZip(req, res) {
    try {
        const jobIds = (0, jobManagement_1.parseJobIds)((req.method === 'GET' ? req.query.jobIds : req.body?.jobIds));
        if (!jobIds.length)
            return res.status(400).json({ success: false, message: 'jobIds is required' });
        const { files, skipped } = await (0, jobManagement_1.collectJobReportFiles)(prisma, client_1.JobType.INSPECTION, jobIds);
        if (!files.length) {
            return res.status(404).json({ success: false, message: 'No report files found for selected inspection jobs', skipped });
        }
        const zip = await (0, jobManagement_1.createReportsZip)({ jobType: client_1.JobType.INSPECTION, files, skipped });
        return res.download(zip.outPath, zip.downloadName, async () => {
            await zip.cleanup();
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
