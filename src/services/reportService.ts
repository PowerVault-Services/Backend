import fs from 'fs';
import puppeteer from 'puppeteer';
import { createTemporaryArtifactPath, storeGeneratedReportFromLocalFile } from './storageService';
import {
  getLogoDataUri,
  getFontFaceCss,
  getReportCss,
  renderImageGridSection,
  renderFullPageImage,
  renderCoverPage,
  renderPlanPage,
  renderFormPage,
} from './reportTemplates';
import type {
  EvidenceImage,
  EvidenceGroup,
  CertificateItem,
  CertificateApproval,
  CertificateSignature,
  ServiceStockUsage,
} from './reportTemplates';

function resolveChromiumExecutable() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
  ].filter(Boolean) as string[];

  return candidates.find((file) => fs.existsSync(file));
}

async function renderPdfToFile(html: string, absPath: string) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: resolveChromiumExecutable(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    await page.pdf({
      path: absPath,
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
    });
  } finally {
    await browser.close();
  }
}

function wrapHtml(bodyHtml: string) {
  const { css: fontCss, family } = getFontFaceCss();
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <style>
    ${getReportCss(fontCss, family)}
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export async function generateCleaningReportPdf(data: {
  jobNo: string;
  projectName: string;
  address?: string | null;
  workDate?: Date | null;
  workTime?: string | null;
  systemSizeKWp?: number | null;
  pvModuleEA?: number | null;
  note?: string | null;
  checklist?: any;
  fullPageDocs?: { title: string; filePath: string }[];
  evidenceGroups?: EvidenceGroup[];
  siteLayoutPath?: string | null;
  certificateImages?: { filePath: string }[];
  certificateItems?: CertificateItem[];
  certificateApproval?: CertificateApproval;
  certificateSignature?: CertificateSignature;
}) {
  const absPath = createTemporaryArtifactPath('.pdf');
  const logoDataUri = getLogoDataUri();

  const coverPage = renderCoverPage(logoDataUri, data.projectName, data.workDate);

  const certificatePages = (data.certificateImages ?? [])
    .map((img) => renderFullPageImage('', img.filePath, 'cleaning', false))
    .join('');

  const legacyFullPageDocs = (data.fullPageDocs ?? [])
    .map((doc) => {
      const isLayout = doc.title === 'Layout';
      const title = isLayout
        ? (data.projectName ? `Layout โครงการ ${data.projectName}` : 'Layout โครงการ')
        : doc.title;
      return renderFullPageImage(title, doc.filePath, 'cleaning', !isLayout);
    })
    .join('');

  const layoutTitle = data.projectName
    ? `Layout โครงการ ${data.projectName}`
    : 'Layout โครงการ';
  const siteLayoutPage = data.siteLayoutPath
    ? renderFullPageImage(layoutTitle, data.siteLayoutPath, 'cleaning', false)
    : '';

  const planPage = renderPlanPage(logoDataUri, {
    projectName: data.projectName,
    systemSizeKWp: data.systemSizeKWp,
    workDate: data.workDate,
    checklist: data.checklist,
  });

  const evidencePages = (data.evidenceGroups ?? [])
    .map((group) => renderImageGridSection(group.title, group.images, 6, 'photo-grid-2'))
    .join('');

  const html = wrapHtml([coverPage, certificatePages, siteLayoutPage, legacyFullPageDocs, planPage, evidencePages].join(''));
  await renderPdfToFile(html, absPath);
  return storeGeneratedReportFromLocalFile(absPath, { jobType: 'cleaning', jobNo: data.jobNo });
}


export async function generateServiceReportPdf(data: {
  jobNo: string;
  projectName: string;
  address?: string | null;
  workDate?: Date | null;
  workTime?: string | null;
  systemSizeKWp?: number | null;
  pvModuleEA?: number | null;
  note?: string | null;
  serviceReportImages?: { filePath: string }[];
  evidencePhotos?: EvidenceImage[];
  meta?: any;
  stockUsage?: ServiceStockUsage;
}) {
  const absPath = createTemporaryArtifactPath('.pdf');
  const logoDataUri = getLogoDataUri();

  const formPage = renderFormPage(logoDataUri, {
    projectName: data.projectName,
    workDate: data.workDate,
    note: data.note,
    meta: data.meta,
    stockUsage: data.stockUsage,
  });

  const serviceReportPages = (data.serviceReportImages ?? [])
    .map((img) => renderFullPageImage('', img.filePath, 'service', false))
    .join('');

  const evidencePages = renderImageGridSection('PowerVault Service Center', data.evidencePhotos ?? [], 4, 'photo-grid-2', 'service');

  const html = wrapHtml([serviceReportPages || formPage, evidencePages].join(''));
  await renderPdfToFile(html, absPath);
  return storeGeneratedReportFromLocalFile(absPath, { jobType: 'service', jobNo: data.jobNo });
}
