import { PrismaClient, JobType } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type ScopedJobType = 'CLEANING' | 'INSPECTION' | 'SERVICE';

function uniqueStrings(items: Array<string | null | undefined>) {
  return Array.from(new Set(items.filter((v): v is string => !!v)));
}

function toAbsUploadPath(fileUrl: string) {
  if (fileUrl.startsWith('/uploads/')) {
    return path.join(process.cwd(), fileUrl.replace('/uploads/', 'uploads/'));
  }
  return path.isAbsolute(fileUrl) ? fileUrl : path.join(process.cwd(), fileUrl);
}

function safeUnlink(absPath: string) {
  try {
    if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
  } catch {
    // ignore file cleanup error
  }
}

export async function buildReportsZipForJobs(args: {
  prisma: PrismaClient;
  type: ScopedJobType;
  jobIds: number[];
}) {
  const { prisma, type, jobIds } = args;

  const uniqueJobIds = Array.from(new Set(jobIds.filter((n) => Number.isFinite(n) && n > 0)));
  if (!uniqueJobIds.length) {
    throw new Error('jobIds is required');
  }

  const jobs = await prisma.job.findMany({
    where: { id: { in: uniqueJobIds }, type: type as JobType },
    include: {
      cleaningJob: { select: { reportFileUrl: true } },
      inspectionJob: { select: { reportFileUrl: true } },
      serviceJob: { select: { reportFileUrl: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const reportRows = jobs
    .map((job) => {
      const reportFileUrl =
        type === 'CLEANING'
          ? job.cleaningJob?.reportFileUrl
          : type === 'INSPECTION'
            ? job.inspectionJob?.reportFileUrl
            : job.serviceJob?.reportFileUrl;
      if (!reportFileUrl) return null;
      const absPath = toAbsUploadPath(reportFileUrl);
      if (!fs.existsSync(absPath)) return null;
      const ext = path.extname(absPath) || '.pdf';
      const sanitizedJobNo = (job.jobNo || `job-${job.id}`).replace(/[^a-zA-Z0-9-_]+/g, '_');
      return {
        jobId: job.id,
        fileUrl: reportFileUrl,
        absPath,
        zipName: `${sanitizedJobNo}${ext}`,
      };
    })
    .filter((v): v is { jobId: number; fileUrl: string; absPath: string; zipName: string } => !!v);

  if (!reportRows.length) {
    throw new Error('No report files found for selected jobs');
  }

  const tmpRoot = path.join(process.cwd(), 'uploads', '_tmp_zip');
  fs.mkdirSync(tmpRoot, { recursive: true });

  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const workDir = path.join(tmpRoot, `${type.toLowerCase()}-${stamp}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(workDir, { recursive: true });

  for (const row of reportRows) {
    fs.copyFileSync(row.absPath, path.join(workDir, row.zipName));
  }

  const zipBaseName = `${type.toLowerCase()}-reports-${stamp}.zip`;
  const zipAbsPath = path.join(tmpRoot, zipBaseName);

  try {
    await execFileAsync('zip', ['-j', '-q', zipAbsPath, ...reportRows.map((r) => path.join(workDir, r.zipName))]);
  } finally {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
    } catch {
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

export async function deleteScopedJob(args: {
  prisma: PrismaClient;
  type: ScopedJobType;
  jobId: number;
}) {
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

  if (!job || job.type !== (type as JobType)) {
    return { notFound: true as const };
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

  for (const fileUrl of fileUrls) {
    safeUnlink(toAbsUploadPath(fileUrl));
  }

  return { notFound: false as const, deletedJobId: jobId, deletedFiles: fileUrls };
}
