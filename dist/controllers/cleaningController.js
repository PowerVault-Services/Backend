"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listProjects = listProjects;
exports.listCleaningJobs = listCleaningJobs;
exports.createDraftStep1 = createDraftStep1;
exports.getCleaningJob = getCleaningJob;
exports.saveStep2Draft = saveStep2Draft;
exports.sendStep2Email = sendStep2Email;
exports.uploadEvidence = uploadEvidence;
exports.saveChecklist = saveChecklist;
exports.generateReport = generateReport;
exports.saveStep5Draft = saveStep5Draft;
exports.downloadReportRedirect = downloadReportRedirect;
exports.sendStep5Email = sendStep5Email;
exports.updateCleaningJob = updateCleaningJob;
exports.deleteCleaningJob = deleteCleaningJob;
exports.downloadCleaningReportsZip = downloadCleaningReportsZip;
const client_1 = require("@prisma/client");
const emailService_1 = require("../services/emailService");
const emailSignatureService_1 = require("../services/emailSignatureService");
const storageService_1 = require("../services/storageService");
const reportService_1 = require("../services/reportService");
const jobManagement_1 = require("../utils/jobManagement");
const prisma = new client_1.PrismaClient();
async function bumpJobStep(jobId, next) {
    const job = await prisma.job.findUnique({ where: { id: jobId }, select: { step: true, status: true } });
    if (!job)
        return;
    const step = Math.max(job.step ?? 1, next);
    const data = { step };
    if (job.status !== client_1.JobStatus.COMPLETED && job.status !== client_1.JobStatus.ASSIGNED) {
        data.status = client_1.JobStatus.DRAFT;
    }
    await prisma.job.update({ where: { id: jobId }, data });
}
function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}
function normalizeWorkTimeText(input) {
    const start = String(input.startTime ?? '').trim();
    const end = String(input.endTime ?? '').trim();
    if (start && end)
        return `${start}-${end}`;
    const workTimeText = String(input.workTimeText ?? '').trim();
    return workTimeText || null;
}
function splitWorkTimeText(workTimeText) {
    const raw = String(workTimeText ?? '').trim();
    const match = raw.match(/^([^\-]+)\s*-\s*([^\-]+)$/);
    return {
        startTime: match ? match[1].trim() : null,
        endTime: match ? match[2].trim() : null,
        workTimeText: raw || null,
    };
}
function makeJobNo() {
    // ตัวอย่าง: CLN-20260208-123456 (คุณจะปรับให้เหมือนของเดิมก็ได้)
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const rand = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    return `CLN-${y}${m}${da}-${rand}`;
}
/**
 * GET /api/cleaning/projects
 * ใช้สำหรับ dropdown "Project Name" แล้ว FE จะเลือก -> call detail
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
 * GET /api/cleaning/jobs
 * ใช้สำหรับหน้า HomeCleaning เพื่อแสดงรายการ Cleaning Job ที่ถูกสร้างแล้วทั้งหมด
 * รองรับ filter/pagination เบื้องต้น (ให้ FE เอาไปผูกกับช่อง Search ได้)
 */
async function listCleaningJobs(req, res) {
    try {
        const page = Math.max(1, Number(req.query.page ?? 1));
        const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize ?? 20)));
        const skip = (page - 1) * pageSize;
        const jobNo = String(req.query.jobNo ?? '').trim();
        const projectType = String(req.query.projectType ?? '').trim();
        const projectName = String(req.query.projectName ?? '').trim();
        const status = String(req.query.status ?? '').trim();
        const contractor = String(req.query.contractor ?? '').trim();
        const problem = String(req.query.problem ?? '').trim();
        const systemSizeKWp = toNum(req.query.systemSizeKWp);
        const pvModuleEA = toNum(req.query.pvModuleEA);
        // date อาจส่งมาเป็น YYYY-MM-DD
        const dateStr = String(req.query.date ?? '').trim();
        const date = dateStr ? new Date(dateStr) : null;
        if (date)
            date.setHours(0, 0, 0, 0);
        const whereJob = { type: client_1.JobType.CLEANING };
        if (jobNo)
            whereJob.jobNo = { contains: jobNo, mode: 'insensitive' };
        if (projectType)
            whereJob.projectType = { contains: projectType, mode: 'insensitive' };
        if (contractor)
            whereJob.contractor = { contains: contractor, mode: 'insensitive' };
        if (problem)
            whereJob.details = { contains: problem, mode: 'insensitive' };
        if (status)
            whereJob.status = status;
        const whereCleaning = {};
        if (projectName)
            whereCleaning.projectName = { contains: projectName, mode: 'insensitive' };
        if (systemSizeKWp != null)
            whereCleaning.systemSizeKWp = systemSizeKWp;
        if (pvModuleEA != null)
            whereCleaning.pvModuleEA = pvModuleEA;
        if (date)
            whereCleaning.workDate = date;
        const [total, rows] = await Promise.all([
            prisma.job.count({
                where: {
                    ...whereJob,
                    cleaningJob: Object.keys(whereCleaning).length ? { is: whereCleaning } : undefined,
                },
            }),
            prisma.job.findMany({
                where: {
                    ...whereJob,
                    cleaningJob: Object.keys(whereCleaning).length ? { is: whereCleaning } : undefined,
                },
                orderBy: [{ createdAt: 'desc' }],
                skip,
                take: pageSize,
                include: {
                    cleaningJob: true,
                    site: { select: { name: true, pvModuleCount: true } },
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
                projectType: j.projectType ?? j.cleaningJob?.projectType ?? null,
                projectName: j.cleaningJob?.projectName ?? j.site?.name ?? null,
                systemSizeKWp: j.cleaningJob?.systemSizeKWp ?? null,
                pvModuleEA: j.cleaningJob?.pvModuleEA ?? null,
                date: j.cleaningJob?.workDate ?? null,
                time: j.cleaningJob?.workTimeText ?? null,
                ...splitWorkTimeText(j.cleaningJob?.workTimeText ?? null),
                contractor: j.contractor ?? null,
                problem: j.details ?? null,
                status: j.status,
            })),
        });
    }
    catch (e) {
        res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
/**
 * POST /api/cleaning/step1
 * body: { siteId, projectType, ... }
 * สร้าง Job (DRAFT) + CleaningJob หรือ update ถ้ามี jobId ส่งมา
 */
async function createDraftStep1(req, res) {
    const { jobId, siteId, projectType, contactPhone, contactEmail, workDate, // "2026-02-08"
    workTimeText, // "10:00"
    startTime, endTime, contractor, customerName, note, problem, } = req.body ?? {};
    if (!siteId)
        return res.status(400).json({ success: false, message: 'siteId is required' });
    const site = await prisma.site.findUnique({ where: { id: Number(siteId) } });
    if (!site)
        return res.status(404).json({ success: false, message: 'Site not found' });
    const dt = workDate ? new Date(String(workDate)) : null;
    const normalizedWorkTimeText = normalizeWorkTimeText({ startTime, endTime, workTimeText });
    // create new draft
    if (!jobId) {
        const created = await prisma.job.create({
            data: {
                jobNo: makeJobNo(),
                title: `Cleaning - ${site.name}`,
                type: client_1.JobType.CLEANING,
                status: client_1.JobStatus.DRAFT,
                step: 1,
                scheduledDate: dt,
                siteId: site.id,
                projectType: projectType ?? null,
                contractor: contractor ?? null,
                details: problem ?? null,
                createdById: 1, // TODO: ต่อ auth แล้วเอาจาก token
            },
        });
        await prisma.cleaningJob.create({
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
                workTimeText: normalizedWorkTimeText,
                customerName: customerName ?? null,
                note: note ?? null,
            },
        });
        // Ensure a ServiceEntry exists so the job appears on the Client Data → PowerVault Service tab
        const existingEntry = await prisma.serviceEntry.findFirst({
            where: { siteId: site.id, job: client_1.JobType.CLEANING },
        });
        if (!existingEntry) {
            await prisma.serviceEntry.create({
                data: { siteId: site.id, job: client_1.JobType.CLEANING, description: `Cleaning - ${site.name}` },
            });
        }
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
            title: `Cleaning - ${site.name}`,
            projectType: projectType ?? null,
            contractor: contractor ?? null,
            details: problem ?? null,
            step: 1,
        },
    });
    await prisma.cleaningJob.upsert({
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
            workTimeText: normalizedWorkTimeText,
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
            workTimeText: normalizedWorkTimeText,
            customerName: customerName ?? null,
            note: note ?? null,
        },
    });
    res.json({ success: true, data: { jobId: j.id, jobNo: j.jobNo } });
}
/** GET /api/cleaning/job/:jobId */
async function getCleaningJob(req, res) {
    const jobId = Number(req.params.jobId);
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
            site: true,
            attachments: true,
        },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId } });
    res.json({ success: true, data: { job, cleaning, timeRange: splitWorkTimeText(cleaning?.workTimeText ?? null) } });
}
/**
 * POST /api/cleaning/step2/draft  (multipart)
 * fields: jobId, to, subject, body
 * files: attachments
 */
async function saveStep2Draft(req, res) {
    const jobId = Number(req.body.jobId);
    const to = String(req.body.to ?? '');
    const subject = String(req.body.subject ?? '');
    const body = String(req.body.body ?? '');
    const signature = (0, emailSignatureService_1.extractEmailSignatureInput)(req.body);
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    // save files to JobAttachment
    const files = req.files ?? [];
    for (const f of files) {
        const stored = await (0, storageService_1.storeIncomingUserUpload)(f, {
            scopeParts: ['jobs', `job_${jobId}`, 'cleaning-step2'],
        });
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: stored.fileUrl,
                fileType: 'STEP2_ATTACHMENT',
            },
        });
    }
    await prisma.cleaningJob.update({
        where: { jobId },
        data: {
            step2EmailTo: to || null,
            step2EmailSubject: subject || null,
            step2EmailBody: body ? (0, emailSignatureService_1.applyEmailSignature)(body, signature) : null,
        },
    });
    await bumpJobStep(jobId, 2);
    res.json({ success: true });
}
/**
 * POST /api/cleaning/step2/send
 * body: { jobId }
 * -> ส่งทันที + set job.status = ASSIGNED หรือ IN_PROGRESS (แล้วแต่ flow)
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
    const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
    if (!cleaning?.step2EmailTo || !cleaning.step2EmailSubject || !cleaning.step2EmailBody) {
        return res.status(400).json({ success: false, message: 'Email draft incomplete' });
    }
    const missing = [];
    const attResolved = await Promise.all(job.attachments
        .filter((a) => a.fileType === 'STEP2_ATTACHMENT')
        .map(async (a) => {
        const attachment = await (0, storageService_1.tryResolveEmailAttachment)(a.fileUrl);
        if (!attachment) {
            missing.push(String(a.fileUrl ?? ''));
            return null;
        }
        return attachment;
    }));
    const att = attResolved.filter(Boolean);
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 2,
        to: cleaning.step2EmailTo,
        subject: cleaning.step2EmailSubject,
        html: cleaning.step2EmailBody,
        attachments: att,
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.cleaningJob.update({
        where: { jobId: id },
        data: {
            step2SentAt: new Date(),
            step2SentByUserId: 1, // TODO auth
        },
    });
    await prisma.job.update({
        where: { id },
        data: { status: client_1.JobStatus.ASSIGNED },
    });
    return res.json({
        success: true,
        warning: missing.length ? { message: 'บางไฟล์แนบไม่พบ จึงไม่ถูกแนบในอีเมล', missing } : undefined,
    });
}
/**
 * POST /api/cleaning/step3/evidence (multipart)
 * fields: jobId, labelType (BEFORE/AFTER/ETC)
 */
async function uploadEvidence(req, res) {
    const jobId = Number(req.body.jobId);
    const labelType = String(req.body.labelType ?? 'EVIDENCE');
    if (!jobId)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    const files = req.files ?? [];
    for (const f of files) {
        const stored = await (0, storageService_1.storeIncomingUserUpload)(f, {
            scopeParts: ['jobs', `job_${jobId}`, 'cleaning-evidence', labelType],
        });
        await prisma.jobAttachment.create({
            data: {
                jobId,
                fileUrl: stored.fileUrl,
                fileType: `STEP3_${labelType}`,
            },
        });
    }
    await bumpJobStep(jobId, 3);
    res.json({ success: true });
}
/** POST /api/cleaning/step3/checklist  body: { jobId, checklistJson } */
async function saveChecklist(req, res) {
    const { jobId, checklistJson, step3SummaryNote } = req.body ?? {};
    const id = Number(jobId);
    if (!id)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    await prisma.cleaningJob.update({
        where: { jobId: id },
        data: {
            checklist: checklistJson ?? null,
            step3SummaryNote: step3SummaryNote ?? null,
        },
    });
    await bumpJobStep(id, 3);
    res.json({ success: true });
}
/**
 * POST /api/cleaning/step4/generate  body: { jobId }
 * -> สร้าง report pdf, เก็บ url ลง cleaningJob.reportFileUrl
 */
async function generateReport(req, res) {
    const { jobId } = req.body ?? {};
    const id = Number(jobId);
    const job = await prisma.job.findUnique({
        where: { id },
        include: { site: { include: { layouts: true } }, attachments: true },
    });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
    if (!cleaning)
        return res.status(404).json({ success: false, message: 'CleaningJob not found' });
    // เปลี่ยนจาก photos -> fullPageDocs + evidenceGroups
    const attachments = job.attachments ?? [];
    // 1) Certificate images (เอกสารส่งมอบงาน — อัปโหลดรูปแทนตารางดิจิทัล)
    const missingAttachments = [];
    const certImgResolved = await Promise.all(attachments
        .filter((a) => a.fileType === 'STEP3_CERTIFICATE')
        .map(async (a) => {
        const filePath = await (0, storageService_1.tryEnsureLocalFilePath)(a.fileUrl);
        if (!filePath) {
            missingAttachments.push(String(a.fileUrl ?? ''));
            return null;
        }
        return { filePath };
    }));
    const certificateImages = certImgResolved.filter(Boolean);
    const layoutResolved = await Promise.all(attachments
        .filter((a) => a.fileType === 'STEP3_LAYOUT')
        .map(async (a) => {
        const filePath = await (0, storageService_1.tryEnsureLocalFilePath)(a.fileUrl);
        if (!filePath) {
            missingAttachments.push(String(a.fileUrl ?? ''));
            return null;
        }
        return {
            title: 'Layout',
            filePath,
        };
    }));
    const layout = layoutResolved.filter(Boolean);
    // 2) Evidence groups (Step3.1)
    // NOTE: ฝั่งหน้าเว็บ Step3.1 มีหัวข้อย่อยหลายแบบ (ก่อน/ขณะ/หลัง - ล้างแผง / ทำความสะอาดห้องอินเวอร์เตอร์ ฯลฯ)
    // แต่ก่อนหน้านี้ report จัดกลุ่มแค่ BEFORE/AFTER ทำให้ "ข้อความใต้รูป" และ "หัวข้อในรายงาน" ไม่ตรงกับหน้าเว็บ
    // แก้โดย map fileType -> หัวข้อรายงาน + label ใต้รูป ให้ตรงกับหัวข้อบนหน้าเว็บ
    const evidenceLabelMap = {
        // === ตามหน้าเว็บ Step3.1 (Cleaning) ===
        STEP3_BEFORE_PANEL: { groupTitle: 'ก่อน - ล้างแผง', label: 'ก่อน - ล้างแผง' },
        STEP3_DURING_PANEL: { groupTitle: 'ขณะ - ล้างแผง', label: 'ขณะ - ล้างแผง' },
        STEP3_AFTER_PANEL: { groupTitle: 'หลัง - ล้างแผง', label: 'หลัง - ล้างแผง' },
        STEP3_BEFORE_INVERTER: { groupTitle: 'ก่อน - ทำความสะอาดห้องอินเวอร์เตอร์', label: 'ก่อน - ทำความสะอาดห้องอินเวอร์เตอร์' },
        STEP3_DURING_INVERTER: { groupTitle: 'ขณะ - ทำความสะอาดห้องอินเวอร์เตอร์', label: 'ขณะ - ทำความสะอาดห้องอินเวอร์เตอร์' },
        STEP3_AFTER_INVERTER: { groupTitle: 'หลัง - ทำความสะอาดห้องอินเวอร์เตอร์', label: 'หลัง - ทำความสะอาดห้องอินเวอร์เตอร์' },
        STEP3_ZONE_WORK: { groupTitle: 'รูปโซนของการทำงาน', label: 'รูปโซนของการทำงาน' },
        STEP3_ZONE_CHECKLIST: { groupTitle: 'รูปโซนของการทำ Check List', label: 'รูปโซนของการทำ Check List' },
        // === รองรับของเดิม (เก่า) ===
        STEP3_BEFORE: { groupTitle: 'ก่อนทำความสะอาด', label: 'ก่อนทำความสะอาด' },
        STEP3_AFTER: { groupTitle: 'หลังทำความสะอาด', label: 'หลังทำความสะอาด' },
    };
    const grouped = new Map();
    for (const a of attachments) {
        const ft = String(a.fileType ?? '');
        if (!ft.startsWith('STEP3_'))
            continue;
        if (['STEP3_CERTIFICATE', 'STEP3_LAYOUT'].includes(ft))
            continue;
        const mapped = evidenceLabelMap[ft];
        const groupTitle = mapped?.groupTitle ?? 'รูปภาพ/หลักฐานอื่นๆ';
        const label = mapped?.label
            // fallback: แสดงชื่อ type แบบอ่านง่ายขึ้นนิดหน่อย
            ?? ft.replace(/^STEP3_/, '').split('_').join(' ');
        if (!grouped.has(groupTitle))
            grouped.set(groupTitle, []);
        const filePath = await (0, storageService_1.tryEnsureLocalFilePath)(a.fileUrl);
        if (!filePath) {
            missingAttachments.push(String(a.fileUrl ?? ''));
            continue;
        }
        grouped.get(groupTitle).push({
            label,
            filePath,
        });
    }
    const evidenceGroups = Array.from(grouped.entries()).map(([title, images]) => ({ title, images }));
    // 3) PV Layout จาก client data (SiteLayout)
    let siteLayoutPath = null;
    const pvLayout = (job.site.layouts ?? []).find((l) => l.type === 'PV_LAYOUT');
    console.log('[report] pvLayout from DB:', pvLayout ? { id: pvLayout.id, type: pvLayout.type, fileUrl: pvLayout.fileUrl } : 'NOT FOUND');
    console.log('[report] site.layouts count:', (job.site.layouts ?? []).length);
    if (pvLayout?.fileUrl) {
        siteLayoutPath = await (0, storageService_1.tryEnsureLocalFilePath)(pvLayout.fileUrl);
        console.log('[report] siteLayoutPath resolved:', siteLayoutPath);
        if (!siteLayoutPath)
            missingAttachments.push(pvLayout.fileUrl);
    }
    const report = await (0, reportService_1.generateCleaningReportPdf)({
        jobNo: job.jobNo,
        projectName: cleaning.projectName ?? job.site.name,
        address: cleaning.locationText ?? job.site.address,
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
    await prisma.cleaningJob.update({
        where: { jobId: id },
        data: { reportFileUrl: report.fileUrl, reportCreatedAt: new Date() },
    });
    // แนบเป็น JobAttachment ด้วย (optional)
    await prisma.jobAttachment.create({
        data: { jobId: id, fileUrl: report.fileUrl, fileType: 'REPORT' },
    });
    await bumpJobStep(id, 4);
    res.json({
        success: true,
        data: { reportUrl: report.fileUrl, download: `/api/cleaning/step4/download/${id}` },
        warning: missingAttachments.length
            ? { message: 'บางไฟล์แนบ/รูปประกอบไม่พบ จึงถูกข้ามตอนสร้างรายงาน', missing: Array.from(new Set(missingAttachments)) }
            : undefined,
    });
}
/**
 * POST /api/cleaning/step5/draft
 * body: { jobId, to, subject, body }
 * เก็บข้อความอีเมล step5 ไว้ก่อน (ยังไม่ส่ง)
 */
async function saveStep5Draft(req, res) {
    const { jobId, to, subject, body } = req.body ?? {};
    const signature = (0, emailSignatureService_1.extractEmailSignatureInput)(req.body);
    const id = Number(jobId);
    if (!id)
        return res.status(400).json({ success: false, message: 'jobId is required' });
    await prisma.cleaningJob.update({
        where: { jobId: id },
        data: {
            step5EmailTo: to ? String(to) : null,
            step5EmailSubject: subject ? String(subject) : null,
            step5EmailBody: body ? (0, emailSignatureService_1.applyEmailSignature)(String(body), signature) : null,
        },
    });
    await bumpJobStep(id, 5);
    res.json({ success: true });
}
/** GET /api/cleaning/step4/download/:jobId -> redirect ไปไฟล์ report */
async function downloadReportRedirect(req, res) {
    const jobId = Number(req.params.jobId);
    const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId } });
    if (!cleaning?.reportFileUrl)
        return res.status(404).send('Report not found');
    res.redirect(cleaning.reportFileUrl);
}
/**
 * POST /api/cleaning/step5/send
 * body: { jobId, to, subject, body }
 * แนบ report และส่งทันที
 */
async function sendStep5Email(req, res) {
    const { jobId, to, subject, body } = req.body ?? {};
    const signature = (0, emailSignatureService_1.extractEmailSignatureInput)(req.body);
    const id = Number(jobId);
    const job = await prisma.job.findUnique({ where: { id }, include: { site: true } });
    if (!job)
        return res.status(404).json({ success: false, message: 'Job not found' });
    const cleaning = await prisma.cleaningJob.findUnique({ where: { jobId: id } });
    if (!cleaning?.reportFileUrl)
        return res.status(400).json({ success: false, message: 'Report not generated' });
    const reportAbs = await (0, storageService_1.tryEnsureLocalFilePath)(cleaning.reportFileUrl);
    if (!reportAbs)
        return res.status(400).json({ success: false, message: 'Report file not found' });
    const send = await (0, emailService_1.sendEmailNow)({
        jobId: id,
        step: 5,
        to: String(to),
        subject: String(subject),
        html: (0, emailSignatureService_1.applyEmailSignature)(String(body), signature),
        attachments: [{ filename: `Cleaning-Report-${job.jobNo}.pdf`, path: reportAbs }],
    });
    if (!send.success)
        return res.status(500).json({ success: false, message: send.error });
    await prisma.cleaningJob.update({
        where: { jobId: id },
        data: {
            step5EmailTo: String(to),
            step5EmailSubject: String(subject),
            step5EmailBody: (0, emailSignatureService_1.applyEmailSignature)(String(body), signature),
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
/** PUT /api/cleaning/job/:jobId */
async function updateCleaningJob(req, res) {
    req.body = { ...(req.body ?? {}), jobId: Number(req.params.jobId) };
    return createDraftStep1(req, res);
}
/** DELETE /api/cleaning/job/:jobId */
async function deleteCleaningJob(req, res) {
    try {
        const jobId = Number(req.params.jobId);
        if (!jobId)
            return res.status(400).json({ success: false, message: 'jobId is required' });
        const result = await (0, jobManagement_1.deleteJobCascade)(prisma, jobId, client_1.JobType.CLEANING);
        if (!result.found)
            return res.status(404).json({ success: false, message: 'Cleaning job not found' });
        return res.json({ success: true, message: `Deleted ${result.jobNo}` });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
/** GET/POST /api/cleaning/jobs/download-zip */
async function downloadCleaningReportsZip(req, res) {
    try {
        const jobIds = (0, jobManagement_1.parseJobIds)((req.method === 'GET' ? req.query.jobIds : req.body?.jobIds));
        if (!jobIds.length)
            return res.status(400).json({ success: false, message: 'jobIds is required' });
        const { files, skipped } = await (0, jobManagement_1.collectJobReportFiles)(prisma, client_1.JobType.CLEANING, jobIds);
        if (!files.length) {
            return res.status(404).json({ success: false, message: 'No report files found for selected cleaning jobs', skipped });
        }
        const zip = await (0, jobManagement_1.createReportsZip)({ jobType: client_1.JobType.CLEANING, files, skipped });
        return res.download(zip.outPath, zip.downloadName, async () => {
            await zip.cleanup();
        });
    }
    catch (e) {
        return res.status(500).json({ success: false, message: e?.message ?? 'Internal error' });
    }
}
