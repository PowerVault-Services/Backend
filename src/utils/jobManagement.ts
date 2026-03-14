import { JobType, PrismaClient } from '@prisma/client';
import fs from 'fs';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { deleteStoredFile, ensureLocalFilePath } from '../services/storageService';
import { projectRoot } from '../config/runtimePaths';

const execFileAsync = promisify(execFile);

export type ReportFileItem = {
  jobId: number;
  jobNo: string;
  fileUrl: string;
  absPath: string;
  zipName: string;
};

function sanitizeFileName(input: string) {
  return input
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function uniqueName(baseName: string, used: Set<string>) {
  let candidate = baseName;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const ext = path.extname(baseName);
    const stem = baseName.slice(0, baseName.length - ext.length);
    candidate = `${stem} (${i})${ext}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function fileUrlToAbsPath(fileUrl: string) {
  if (fileUrl.startsWith('/uploads/')) {
    return path.join(projectRoot, fileUrl.replace('/uploads/', 'uploads/'));
  }
  return path.isAbsolute(fileUrl) ? fileUrl : path.join(projectRoot, fileUrl);
}

export function parseJobIds(input: unknown): number[] {
  const raw = Array.isArray(input)
    ? input
    : typeof input === 'string'
      ? input.split(',')
      : [];

  const ids = raw
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  return Array.from(new Set(ids));
}

export async function deleteJobCascade(prisma: PrismaClient, jobId: number, jobType: JobType) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: {
      attachments: { select: { fileUrl: true } },
      cleaningJob: { select: { reportFileUrl: true } },
      inspectionJob: { select: { reportFileUrl: true } },
      serviceJob: { select: { reportFileUrl: true } },
    },
  });

  if (!job || job.type !== jobType) return { found: false as const };

  const fileUrls = new Set<string>();
  for (const att of job.attachments) {
    if (att.fileUrl) fileUrls.add(att.fileUrl);
  }
  if (job.cleaningJob?.reportFileUrl) fileUrls.add(job.cleaningJob.reportFileUrl);
  if (job.inspectionJob?.reportFileUrl) fileUrls.add(job.inspectionJob.reportFileUrl);
  if (job.serviceJob?.reportFileUrl) fileUrls.add(job.serviceJob.reportFileUrl);

  await prisma.$transaction(async (tx) => {
    await tx.emailLog.deleteMany({ where: { jobId } });
    await tx.stockTransaction.deleteMany({ where: { jobId } });
    await tx.jobAttachment.deleteMany({ where: { jobId } });

    if (jobType === JobType.CLEANING) {
      await tx.cleaningJob.deleteMany({ where: { jobId } });
    } else if (jobType === JobType.INSPECTION) {
      await tx.inspectionJob.deleteMany({ where: { jobId } });
    } else if (jobType === JobType.SERVICE) {
      await tx.serviceJob.deleteMany({ where: { jobId } });
    }

    await tx.job.delete({ where: { id: jobId } });
  });

  await Promise.all(Array.from(fileUrls).map((fileUrl) => deleteStoredFile(fileUrl)));

  return { found: true as const, jobNo: job.jobNo };
}

export async function collectJobReportFiles(
  prisma: PrismaClient,
  jobType: JobType,
  jobIds: number[],
): Promise<{ files: ReportFileItem[]; skipped: string[] }> {
  const rows = await prisma.job.findMany({
    where: { id: { in: jobIds }, type: jobType },
    include: {
      site: { select: { name: true } },
      cleaningJob: { select: { reportFileUrl: true, projectName: true } },
      inspectionJob: { select: { reportFileUrl: true, projectName: true } },
      serviceJob: { select: { reportFileUrl: true, projectName: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const usedNames = new Set<string>();
  const files: ReportFileItem[] = [];
  const skipped: string[] = [];

  for (const row of rows) {
    const reportFileUrl =
      jobType === JobType.CLEANING
        ? row.cleaningJob?.reportFileUrl
        : jobType === JobType.INSPECTION
          ? row.inspectionJob?.reportFileUrl
          : row.serviceJob?.reportFileUrl;

    const projectName =
      jobType === JobType.CLEANING
        ? row.cleaningJob?.projectName
        : jobType === JobType.INSPECTION
          ? row.inspectionJob?.projectName
          : row.serviceJob?.projectName;

    if (!reportFileUrl) {
      skipped.push(`${row.jobNo}: report not found`);
      continue;
    }

    const absPath = await ensureLocalFilePath(reportFileUrl);
    if (!fs.existsSync(absPath)) {
      skipped.push(`${row.jobNo}: report file missing in storage`);
      continue;
    }

    const ext = path.extname(absPath) || '.pdf';
    const baseName = sanitizeFileName(`${row.jobNo}${projectName || row.site?.name ? ` - ${projectName || row.site?.name}` : ''}${ext}`);
    const zipName = uniqueName(baseName, usedNames);

    files.push({
      jobId: row.id,
      jobNo: row.jobNo,
      fileUrl: reportFileUrl,
      absPath,
      zipName,
    });
  }

  const foundIds = new Set(rows.map((row) => row.id));
  for (const requestedId of jobIds) {
    if (!foundIds.has(requestedId)) {
      skipped.push(`jobId=${requestedId}: job not found for ${jobType}`);
    }
  }

  return { files, skipped };
}

export async function createReportsZip(options: {
  jobType: JobType;
  files: ReportFileItem[];
  skipped?: string[];
}) {
  const { jobType, files, skipped = [] } = options;
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), `solar-${jobType.toLowerCase()}-zip-`));
  const outDir = path.join(os.tmpdir(), 'solar-zip-output');
  await fsp.mkdir(outDir, { recursive: true });

  try {
    for (const file of files) {
      await fsp.copyFile(file.absPath, path.join(tmpDir, file.zipName));
    }

    const readmeLines = [
      `Generated at: ${new Date().toISOString()}`,
      `Job type: ${jobType}`,
      `Included reports: ${files.length}`,
      `Skipped items: ${skipped.length}`,
      '',
    ];

    if (files.length) {
      readmeLines.push('Included files:');
      for (const file of files) {
        readmeLines.push(`- ${file.zipName} (jobNo=${file.jobNo}, jobId=${file.jobId})`);
      }
      readmeLines.push('');
    }

    if (skipped.length) {
      readmeLines.push('Skipped:');
      for (const item of skipped) {
        readmeLines.push(`- ${item}`);
      }
      readmeLines.push('');
    }

    await fsp.writeFile(path.join(tmpDir, 'README.txt'), readmeLines.join('\n'), 'utf8');

    const zipBaseName = `${jobType.toLowerCase()}-reports-${Date.now()}.zip`;
    const outPath = path.join(outDir, zipBaseName);
    await execFileAsync('zip', ['-r', outPath, '.'], { cwd: tmpDir });

    return {
      outPath,
      downloadName: zipBaseName,
      cleanup: async () => {
        try {
          await fsp.unlink(outPath);
        } catch {
          // noop
        }
      },
    };
  } finally {
    await fsp.rm(tmpDir, { recursive: true, force: true });
  }
}
