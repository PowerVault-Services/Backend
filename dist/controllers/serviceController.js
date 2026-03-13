"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjects = listProjects;
exports.listServiceJobs = listServiceJobs;
exports.createDraftStep1 = createDraftStep1;
exports.getServiceJob = getServiceJob;
exports.saveStep2Draft = saveStep2Draft;
exports.sendStep2Email = sendStep2Email;
exports.saveStep3Draft = saveStep3Draft;
exports.generateReport = generateReport;
exports.saveStep5Draft = saveStep5Draft;
exports.downloadReportRedirect = downloadReportRedirect;
exports.sendStep5Email = sendStep5Email;
exports.updateServiceJob = updateServiceJob;
exports.deleteServiceJob = deleteServiceJob;
exports.downloadServiceReportsZip = downloadServiceReportsZip;
const client_1 = require("@prisma/client");
const emailService_1 = require("../services/emailService");
const storageService_1 = require("../services/storageService");
const reportService_1 = require("../services/reportService");
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
 * GET /api/service/jobs
 * ใช้สำหรับหน้า HomeService เพื่อแสดงรายการ Service Job ที่ถูกสร้างแล้ว
 */
async function listServiceJobs(req, res) {
    try {
        const page = Math.max(1, Number(req.query.page ?? 1));
        const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
        const skip = (page - 1) * pageSize;
        const jobNo = String(req.query.jobNo ?? '').trim();
        const projectType = String(req.query.projectType ?? '').trim();
        const projectName = String(req.query.projectName ?? '').trim();
        const status = String(req.query.status ?? '').trim();
        const service = String(req.query.service ?? '').trim();
        const systemSizeKWp = Number.isFinite(Number(req.query.systemSizeKWp)) ? Number(req.query.systemSizeKWp) : null;
        const pvModuleEA = Number.isFinite(Number(req.query.pvModuleEA)) ? Number(req.query.pvModuleEA) : null;
        const dateStr = String(req.query.date ?? '').trim();
        const date = dateStr ? new Date(dateStr) : null;
        if (date)
            date.setHours(0, 0, 0, 0);
        const whereJob = { type: client_1.JobType.SERVICE };
        if (jobNo)
            whereJob.jobNo = { contains: jobNo, mode: 'insensitive' };
        if (projectType)
            whereJob.projectType = { contains: projectType, mode: 'insensitive' };
        if (status)
            whereJob.status = status;
        const whereSvc = {};
        if (projectName)
            whereSvc.projectName = { contains: projectName, mode: 'insensitive' };
        if (systemSizeKWp != null)
            whereSvc.systemSizeKWp = systemSizeKWp;
        if (pvModuleEA != null)
            whereSvc.pvModuleEA = pvModuleEA;
        if (date)
            whereSvc.workDate = date;
        if (service) {
            // step3Meta อาจเก็บ field serviceType/serviceName ได้หลายแบบ
            // ถ้าไม่มี ก็ปล่อยผ่าน
            whereSvc.OR = [
                { note: { contains: service, mode: 'insensitive' } },
            ];
        }
        const [total, rows] = await Promise.all([
            prisma.job.count({
                where: {
                    ...whereJob,
                    serviceJob: Object.keys(whereSvc).length ? { is: whereSvc } : undefined,
                },
            }),
            prisma.job.findMany({
                where: {
                    ...whereJob,
                    serviceJob: Object.keys(whereSvc).length ? { is: whereSvc } : undefined,
                },
                orderBy: [{ createdAt: 'desc' }],
                skip,
                take: pageSize,
                include: {
                    serviceJob: true,
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
                projectType: j.projectType ?? j.serviceJob?.projectType ?? null,
                projectName: j.serviceJob?.projectName ?? j.site?.name ?? null,
                systemSizeKWp: j.serviceJob?.systemSizeKWp ?? null,
                pvModuleEA: j.serviceJob?.pvModuleEA ?? null,
                date: j.serviceJob?.workDate ?? null,
                time: j.serviceJob?.workTimeText ?? null,
                status: j.status,
            })),
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
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
                step: 1,
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
            step: 1,
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
        include: {
            site: true,
            attachments: true,
            stockUsage: {
                include: {
                    product: { include: { category: true, unit: true } },
                },
                orderBy: { txDate: 'desc' },
            },
        },
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
        const stored = await (0, storageService_1.storeIncomingUserUpload)(f, {
            scopeParts: ['jobs', `job_${jobId}`, 'service-step2'],
        });
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: stored.fileUrl,
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
    await bumpJobStep(jobId, 2);
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
    const att = await Promise.all((job.attachments ?? [])
        .filter((a) => a.fileType === 'SERVICE_STEP2_ATTACHMENT')
        .map((a) => (0, storageService_1.resolveEmailAttachment)(a.fileUrl)));
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
        const stored = await (0, storageService_1.storeIncomingUserUpload)(formFile, {
            scopeParts: ['jobs', `job_${jobId}`, 'service-form'],
        });
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: stored.fileUrl,
                fileType: 'SERVICE_REPORT_FORM',
            },
        });
    }
    for (const f of evidenceFiles) {
        const stored = await (0, storageService_1.storeIncomingUserUpload)(f, {
            scopeParts: ['jobs', `job_${jobId}`, 'service-evidence'],
        });
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: stored.fileUrl,
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
    // --------- NEW: sync stock usage (OUT) from meta ---------
    // เราจะ tag note เพื่อแยกแยะว่าเป็นรายการจ่ายออกจาก Service step3
    const STOCK_USAGE_TAG = 'SERVICE_STEP3_STOCK_USAGE';
    // try to read items from various shapes to be resilient with frontend changes
    const readStockItems = (m) => {
        if (!m)
            return [];
        const candidates = [m.stockItems, m.stock, m.items, m.products, m.stockUsage, m.usedStock].filter(Boolean);
        const arr = Array.isArray(candidates[0]) ? candidates[0] : Array.isArray(m) ? m : null;
        const list = Array.isArray(arr) ? arr : [];
        return list
            .map((it) => ({
            productId: Number(it?.productId ?? it?.id ?? it?.product_id),
            quantity: Number(it?.quantity ?? it?.qty ?? it?.amount),
        }))
            .filter((it) => Number.isFinite(it.productId) && it.productId > 0 && Number.isFinite(it.quantity) && it.quantity > 0);
    };
    const stockItems = readStockItems(meta);
    // ลบรายการเดิมที่เคยสร้างจาก step3 เพื่อกันการซ้ำ (ไม่ยุ่งกับรายการที่สร้างจากเมนู Stock โดยตรง)
    await prisma.stockTransaction.deleteMany({
        where: {
            jobId,
            type: 'OUT',
            note: { startsWith: STOCK_USAGE_TAG },
        },
    });
    if (stockItems.length) {
        const svc = await prisma.serviceJob.findUnique({ where: { jobId } });
        const job = await prisma.job.findUnique({ where: { id: jobId }, include: { site: true } });
        for (const it of stockItems) {
            // onHand check (กันจ่ายออกเกินคงเหลือ)
            const inAgg = await prisma.stockTransaction.aggregate({
                where: { productId: it.productId, type: 'IN' },
                _sum: { quantity: true },
            });
            const outAgg = await prisma.stockTransaction.aggregate({
                where: { productId: it.productId, type: 'OUT' },
                _sum: { quantity: true },
            });
            const onHand = Number(inAgg._sum.quantity ?? 0) - Number(outAgg._sum.quantity ?? 0);
            if (it.quantity > onHand) {
                return res
                    .status(400)
                    .json({ success: false, message: `insufficient stock for productId=${it.productId}: onHand=${onHand}` });
            }
            await prisma.stockTransaction.create({
                data: {
                    type: 'OUT',
                    productId: it.productId,
                    quantity: it.quantity, // prisma decimal
                    txDate: new Date(),
                    project: svc?.projectName ?? job?.site?.name ?? null,
                    receiver: svc?.customerName ?? null,
                    note: `${STOCK_USAGE_TAG} jobId=${jobId}`,
                    jobId,
                },
            });
        }
    }
    await prisma.serviceJob.update({
        where: { jobId },
        data: {
            step3Meta: meta,
        },
    });
    await bumpJobStep(jobId, 3);
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
        include: {
            site: true,
            attachments: true,
            stockUsage: {
                include: { product: { include: { category: true, unit: true } } },
                orderBy: { txDate: 'desc' },
            },
        },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const service = await prisma.serviceJob.findUnique({ where: { jobId: id } });
    if (!service)
        return res.status(404).json({ success: false, message: 'ServiceJob not found' });
    const attachments = job.attachments ?? [];
    const formAttachment = attachments
        .filter((a) => a.fileType === 'SERVICE_REPORT_FORM')
        .slice(-1)[0];
    const form = formAttachment ? await (0, storageService_1.ensureLocalFilePath)(formAttachment.fileUrl) : undefined;
    const evidence = await Promise.all(attachments
        .filter((a) => a.fileType === 'SERVICE_EVIDENCE')
        .slice(0, 12)
        .map(async (a) => ({
        label: 'รูปภาพ',
        filePath: await (0, storageService_1.ensureLocalFilePath)(a.fileUrl),
    })));
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
        // include stock usage in the report
        stockUsage: (job.stockUsage ?? []).filter((t) => t.type === 'OUT'),
    });
    await prisma.serviceJob.update({
        where: { jobId: id },
        data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
    });
    await prisma.jobAttachment.create({
        data: { jobId: id, fileUrl: report.fileUrl, fileType: 'REPORT' },
    });
    await bumpJobStep(id, 4);
    res.json({
        success: true,
        data: { reportUrl: report.fileUrl, download: `/api/service/step4/download/${id}` },
    });
}
/**
 * POST /api/service/step5/draft
 * body: { jobId, to, subject, body }
 * เก็บข้อความอีเมล step5 ไว้ก่อน (ยังไม่ส่ง)
 */
async function saveStep5Draft(req, res) {
    const { jobId, to, subject, body } = req.body ?? {};
    const id = Number(jobId);
    if (!id)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    await prisma.serviceJob.update({
        where: { jobId: id },
        data: {
            step5EmailTo: to ? String(to) : null,
            step5EmailSubject: subject ? String(subject) : null,
            step5EmailBody: body ? String(body) : null,
        },
    });
    await bumpJobStep(id, 5);
    res.json({ success: true });
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
    const reportAbs = await (0, storageService_1.ensureLocalFilePath)(service.reportFileUrl);
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
/** PUT /api/service/job/:jobId */
async function updateServiceJob(req, res) {
    req.body = { ...(req.body ?? {}), jobId: Number(req.params.jobId) };
    return createDraftStep1(req, res);
}
/** DELETE /api/service/job/:jobId */
async function deleteServiceJob(req, res) {
    try {
        const jobId = Number(req.params.jobId);
        if (!jobId)
            return res.status(400).json({ success: false, message: 'jobId is required' });
        const result = await (0, jobManagement_1.deleteJobCascade)(prisma, jobId, client_1.JobType.SERVICE);
        if (!result.found)
            return res.status(404).json({ success: false, message: 'Service job not found' });
        return res.json({ success: true, message: `Deleted ${result.jobNo}` });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
/** GET/POST /api/service/jobs/download-zip */
async function downloadServiceReportsZip(req, res) {
    try {
        const jobIds = (0, jobManagement_1.parseJobIds)((req.method === 'GET' ? req.query.jobIds : req.body?.jobIds));
        if (!jobIds.length)
            return res.status(400).json({ success: false, message: 'jobIds is required' });
        const { files, skipped } = await (0, jobManagement_1.collectJobReportFiles)(prisma, client_1.JobType.SERVICE, jobIds);
        if (!files.length) {
            return res.status(404).json({ success: false, message: 'No report files found for selected service jobs', skipped });
        }
        const zip = await (0, jobManagement_1.createReportsZip)({ jobType: client_1.JobType.SERVICE, files, skipped });
        return res.download(zip.outPath, zip.downloadName, async () => {
            await zip.cleanup();
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
