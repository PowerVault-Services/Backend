"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildReportsZipForJobs = buildReportsZipForJobs;
exports.deleteScopedJob = deleteScopedJob;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
const util_1 = require("util");
const storageService_1 = require("./storageService");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
function uniqueStrings(items) {
    return Array.from(new Set(items.filter((v) => !!v)));
}
async function buildReportsZipForJobs(args) {
    const { prisma, type, jobIds } = args;
    const uniqueJobIds = Array.from(new Set(jobIds.filter((n) => Number.isFinite(n) && n > 0)));
    if (!uniqueJobIds.length) {
        throw new Error('jobIds is required');
    }
    const jobs = await prisma.job.findMany({
        where: { id: { in: uniqueJobIds }, type: type },
        include: {
            cleaningJob: { select: { reportFileUrl: true } },
            inspectionJob: { select: { reportFileUrl: true } },
            serviceJob: { select: { reportFileUrl: true } },
        },
        orderBy: { createdAt: 'desc' },
    });
    const reportRows = (await Promise.all(jobs.map(async (job) => {
        const reportFileUrl = type === 'CLEANING'
            ? job.cleaningJob?.reportFileUrl
            : type === 'INSPECTION'
                ? job.inspectionJob?.reportFileUrl
                : job.serviceJob?.reportFileUrl;
        if (!reportFileUrl)
            return null;
        const absPath = await (0, storageService_1.ensureLocalFilePath)(reportFileUrl);
        if (!fs_1.default.existsSync(absPath))
            return null;
        const ext = path_1.default.extname(absPath) || '.pdf';
        const sanitizedJobNo = (job.jobNo || `job-${job.id}`).replace(/[^a-zA-Z0-9-_]+/g, '_');
        return {
            jobId: job.id,
            fileUrl: reportFileUrl,
            absPath,
            zipName: `${sanitizedJobNo}${ext}`,
        };
    }))).filter((v) => !!v);
    if (!reportRows.length) {
        throw new Error('No report files found for selected jobs');
    }
    const tmpRoot = path_1.default.join(os_1.default.tmpdir(), 'solar-job-action-zips');
    fs_1.default.mkdirSync(tmpRoot, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const workDir = path_1.default.join(tmpRoot, `${type.toLowerCase()}-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
    fs_1.default.mkdirSync(workDir, { recursive: true });
    for (const row of reportRows) {
        fs_1.default.copyFileSync(row.absPath, path_1.default.join(workDir, row.zipName));
    }
    const zipBaseName = `${type.toLowerCase()}-reports-${stamp}.zip`;
    const zipAbsPath = path_1.default.join(tmpRoot, zipBaseName);
    try {
        await execFileAsync('zip', ['-j', '-q', zipAbsPath, ...reportRows.map((r) => path_1.default.join(workDir, r.zipName))]);
    }
    finally {
        try {
            fs_1.default.rmSync(workDir, { recursive: true, force: true });
        }
        catch {
            // ignore
        }
    }
    return {
        zipAbsPath,
        zipDownloadName: zipBaseName,
        foundJobIds: jobs.map((j) => j.id),
        includedJobIds: reportRows.map((r) => r.jobId),
        skippedJobIds: uniqueJobIds.filter((id) => !reportRows.some((r) => r.jobId === id)),
    };
}
async function deleteScopedJob(args) {
    const { prisma, type, jobId } = args;
    const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
            attachments: { select: { fileUrl: true } },
            cleaningJob: { select: { reportFileUrl: true } },
            inspectionJob: { select: { reportFileUrl: true } },
            serviceJob: { select: { reportFileUrl: true } },
        },
    });
    if (!job || job.type !== type) {
        return { notFound: true };
    }
    const fileUrls = uniqueStrings([
        ...job.attachments.map((a) => a.fileUrl),
        job.cleaningJob?.reportFileUrl,
        job.inspectionJob?.reportFileUrl,
        job.serviceJob?.reportFileUrl,
    ]);
    await prisma.$transaction(async (tx) => {
        if (type === 'CLEANING') {
            await tx.cleaningJob.deleteMany({ where: { jobId } });
        }
        if (type === 'INSPECTION') {
            await tx.inspectionJob.deleteMany({ where: { jobId } });
        }
        if (type === 'SERVICE') {
            await tx.serviceJob.deleteMany({ where: { jobId } });
            await tx.stockTransaction.deleteMany({ where: { jobId } });
        }
        await tx.emailLog.deleteMany({ where: { jobId } });
        await tx.jobAttachment.deleteMany({ where: { jobId } });
        await tx.job.delete({ where: { id: jobId } });
    });
    await Promise.all(fileUrls.map((fileUrl) => (0, storageService_1.deleteStoredFile)(fileUrl)));
    return { notFound: false, deletedJobId: jobId, deletedFiles: fileUrls };
}
