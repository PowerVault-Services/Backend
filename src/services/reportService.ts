import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import { createTemporaryArtifactPath, storeGeneratedReportFromLocalFile } from './storageService';
import { resolveFromProjectRoot } from '../config/runtimePaths';

type EvidenceImage = { label?: string; filePath: string };
type EvidenceGroup = {
  title: string;
  images: EvidenceImage[];
};

type ServiceStockUsage = Array<{
  id: number;
  quantity: any;
  txDate: Date;
  product: {
    sku: string;
    name: string;
    category: { name: string };
    unit: { name: string };
  };
}>;

function escapeHtml(s: any) {
  return String(s ?? '')
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

function fileToDataUri(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime =
      ext === 'png' ? 'image/png' :
      (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      null;
    if (!mime) return null;
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

function asFileUrl(p: string) {
  return 'file://' + p.replace(/\\/g, '/');
}

function formatThaiDate(date?: Date | null) {
  if (!date) return '-';
  try {
    return new Intl.DateTimeFormat('th-TH', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toLocaleDateString('th-TH');
  }
}

function formatReportIssue(date?: Date | null) {
  const d = date ?? new Date();
  const beYear = d.getFullYear() + 543;
  const month = String(d.getMonth() + 1);
  return `ครั้งที่ ${month}/${beYear}`;
}

function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function getFontFaceCss() {
  const candidates = [
    {
      family: 'ReportThai',
      normal: resolveFromProjectRoot('assets', 'fonts', 'THSarabunNew.ttf'),
      bold: resolveFromProjectRoot('assets', 'fonts', 'THSarabunNew Bold.ttf'),
    },
    {
      family: 'ReportThai',
      normal: '/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf',
      bold: '/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf',
    },
  ];

  for (const c of candidates) {
    if (fs.existsSync(c.normal) && fs.existsSync(c.bold)) {
      return {
        css: `
          @font-face {
            font-family: '${c.family}';
            src: url('${asFileUrl(c.normal)}') format('truetype');
            font-weight: 400;
          }
          @font-face {
            font-family: '${c.family}';
            src: url('${asFileUrl(c.bold)}') format('truetype');
            font-weight: 700;
          }
        `,
        family: `'${c.family}', 'Noto Sans Thai', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`,
      };
    }
  }

  return {
    css: '',
    family: `'Noto Sans Thai', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`,
  };
}

function getLogoDataUri() {
  const logoPath = resolveFromProjectRoot('assets', 'powervault-logo.png');
  return fs.existsSync(logoPath) ? fileToDataUri(logoPath) : null;
}

function renderHeader(logoDataUri: string | null) {
  return `
    <div class="report-header">
      <div class="header-left">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : '<div class="logo-fallback">POWER VAULT</div>'}
      </div>
      <div class="header-right">
        <div class="company-th">บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</div>
        <div>407 หมู่ที่ 2 ต.สำโรงเหนือ อ.เมือง</div>
        <div>สมุทรปราการ จ.สมุทรปราการ 10270</div>
      </div>
    </div>
    <div class="header-rule"></div>
  `;
}

function renderInfoRow(label: string, value: any, line = false) {
  return `
    <div class="info-row ${line ? 'line-row' : ''}">
      <div class="info-label">${escapeHtml(label)}</div>
      <div class="info-value">${escapeHtml(value ?? '-')}</div>
    </div>
  `;
}

function renderImageGridSection(title: string, images: EvidenceImage[], perPage: number, gridClass = 'photo-grid-2') {
  if (!images.length) return '';
  return splitIntoChunks(images, perPage)
    .map((chunk, index) => `
      <section class="page">
        ${renderHeader(getLogoDataUri())}
        <div class="photo-title">${escapeHtml(title)}${images.length > perPage ? ` (${index + 1})` : ''}</div>
        <div class="${gridClass}">
          ${chunk.map((img) => {
            const uri = fileToDataUri(img.filePath);
            return `
              <div class="photo-card">
                <div class="photo-box">${uri ? `<img src="${uri}" />` : '<div class="photo-empty">ไม่สามารถแสดงรูปภาพ</div>'}</div>
                ${img.label ? `<div class="photo-label">${escapeHtml(img.label)}</div>` : ''}
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `)
    .join('');
}

function renderFullPageImage(title: string, filePath: string) {
  const uri = fileToDataUri(filePath);
  if (!uri) return '';
  return `
    <section class="page">
      ${renderHeader(getLogoDataUri())}
      <div class="section-head line-fill">${escapeHtml(title)}</div>
      <div class="full-image-wrap"><img src="${uri}" /></div>
    </section>
  `;
}

function renderCleaningChecklistRows(checklist: any) {
  const items = Array.isArray(checklist?.items) ? checklist.items : [];
  if (!items.length) {
    return `
      <tr>
        <td class="center">1</td>
        <td>-</td>
        <td class="center">-</td>
        <td>-</td>
      </tr>
    `;
  }

  return items.map((it: any, idx: number) => {
    const statusRaw = String(it?.status ?? '').trim().toLowerCase();
    const status = statusRaw === 'done' || statusRaw === 'pass' || statusRaw === 'completed' || statusRaw === 'yes'
      ? '✓'
      : (it?.status ? String(it.status) : '-');

    return `
      <tr>
        <td class="center">${idx + 1}</td>
        <td>${escapeHtml(it?.title ?? '-')}</td>
        <td class="center">${escapeHtml(status)}</td>
        <td>${escapeHtml(it?.remark ?? '-')}</td>
      </tr>
    `;
  }).join('');
}

function pickMetaValue(meta: any, keys: string[]) {
  if (!meta || typeof meta !== 'object') return '';
  for (const key of keys) {
    const value = meta[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function pickMetaArray(meta: any, keys: string[]) {
  if (!meta || typeof meta !== 'object') return [] as any[];
  for (const key of keys) {
    const value = meta[key];
    if (Array.isArray(value) && value.length) return value;
  }
  return [] as any[];
}

function renderServiceDetailRows(meta: any, note?: string | null) {
  const serviceType = pickMetaValue(meta, ['serviceType', 'serviceName', 'jobType', 'title']);
  const technician = pickMetaValue(meta, ['technicianName', 'technician', 'serviceBy', 'operatorName', 'staffName']);
  const position = pickMetaValue(meta, ['technicianPosition', 'position', 'staffPosition']);
  const startDate = pickMetaValue(meta, ['startDate', 'serviceStartDate', 'workStartDate']);
  const endDate = pickMetaValue(meta, ['endDate', 'serviceEndDate', 'workEndDate']);
  const customerSigner = pickMetaValue(meta, ['customerName', 'customerSigner', 'approverName', 'ownerName']);
  const customerPosition = pickMetaValue(meta, ['customerPosition', 'approverPosition', 'ownerPosition']);
  const summary = pickMetaValue(meta, ['summary', 'remark', 'description', 'details']) || note || '';

  const tasks = pickMetaArray(meta, ['tasks', 'details', 'checklist', 'items', 'works']);
  const taskLines = tasks
    .map((item: any, idx: number) => {
      if (!item) return '';
      if (typeof item === 'string') {
        return `<tr><td class="center">${idx + 1}</td><td>${escapeHtml(item)}</td><td></td></tr>`;
      }
      const name = item.name ?? item.title ?? item.topic ?? item.item ?? item.description ?? '-';
      const detail = item.detail ?? item.remark ?? item.result ?? item.note ?? '';
      return `<tr><td class="center">${idx + 1}</td><td>${escapeHtml(name)}</td><td>${escapeHtml(detail)}</td></tr>`;
    })
    .filter(Boolean)
    .join('');

  const fallbackRows = !taskLines
    ? `<tr><td class="center">1</td><td>${escapeHtml(serviceType || 'งานบริการ')}</td><td>${escapeHtml(summary || '-')}</td></tr>`
    : taskLines;

  return {
    serviceType,
    technician,
    position,
    startDate,
    endDate,
    customerSigner,
    customerPosition,
    summary,
    taskRowsHtml: fallbackRows,
  };
}

function renderStockTable(stockUsage?: ServiceStockUsage) {
  const rows = (stockUsage ?? [])
    .filter(Boolean)
    .map((t) => {
      const qty = Number((t as any).quantity ?? 0);
      const p = (t as any).product;
      return {
        sku: p?.sku ?? '-',
        category: p?.category?.name ?? '-',
        name: p?.name ?? '-',
        unit: p?.unit?.name ?? '-',
        qty: Number.isFinite(qty) ? qty : 0,
      };
    })
    .filter((r) => r.qty > 0);

  if (!rows.length) return '';

  return `
    <div class="mini-section-title">รายการอุปกรณ์/อะไหล่ที่ใช้</div>
    <table class="clean-table stock-table">
      <thead>
        <tr>
          <th style="width:18%;">SKU</th>
          <th style="width:18%;">หมวดหมู่</th>
          <th>รายการ</th>
          <th style="width:12%;">หน่วย</th>
          <th style="width:12%;">จำนวน</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => `
          <tr>
            <td>${escapeHtml(r.sku)}</td>
            <td>${escapeHtml(r.category)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td class="center">${escapeHtml(r.unit)}</td>
            <td class="center">${escapeHtml(r.qty)}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

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
    await page.setContent(html, { waitUntil: 'networkidle0' });
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
    @page { size: A4; margin: 0; }
    ${fontCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: ${family};
      color: #111;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      background: #fff;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      padding: 14mm 16mm 14mm 16mm;
      page-break-after: always;
      position: relative;
      background: #fff;
    }
    .page:last-child { page-break-after: auto; }
    .report-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10mm;
    }
    .header-left { width: 46%; }
    .header-right {
      width: 54%;
      text-align: right;
      font-size: 11pt;
      line-height: 1.35;
      font-weight: 700;
    }
    .company-th { font-size: 12.5pt; }
    .logo { width: 78mm; max-width: 100%; object-fit: contain; }
    .logo-fallback { font-size: 24pt; font-weight: 700; }
    .header-rule { border-top: 1px solid #222; margin-top: 4mm; margin-bottom: 6mm; }
    .cover {
      display: flex;
      flex-direction: column;
      min-height: 250mm;
      align-items: center;
      text-align: center;
      padding-top: 12mm;
    }
    .cover-top-address {
      width: 100%;
      text-align: center;
      font-size: 14pt;
      line-height: 1.35;
      margin-top: 6mm;
    }
    .cover-title {
      font-size: 24pt;
      font-weight: 700;
      margin-top: 24mm;
      line-height: 1.35;
    }
    .cover-issue {
      font-size: 22pt;
      font-weight: 700;
      margin-top: 8mm;
    }
    .cover-project-line {
      margin-top: 22mm;
      font-size: 18pt;
      width: 100%;
    }
    .cover-spacer { flex: 1; }
    .cover-by { font-size: 17pt; margin-bottom: 6mm; }
    .cover-company { font-size: 20pt; font-weight: 700; line-height: 1.4; }
    .section-head {
      font-size: 19pt;
      font-weight: 700;
      margin: 1mm 0 5mm;
      line-height: 1.25;
    }
    .line-fill::after {
      content: '................................................................';
      letter-spacing: 0.5px;
      margin-left: 2mm;
    }
    .summary-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 2.5mm 9mm;
      margin-top: 3mm;
      font-size: 13pt;
    }
    .info-row {
      display: flex;
      align-items: flex-end;
      gap: 3mm;
      line-height: 1.3;
      min-height: 8mm;
    }
    .info-label { width: 36mm; font-weight: 700; }
    .info-value { flex: 1; border-bottom: 1px dotted #555; padding-bottom: 0.5mm; }
    .line-row .info-label { width: auto; }
    .line-row .info-value { min-height: 8mm; }
    .clean-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5pt;
      margin-top: 4mm;
    }
    .clean-table th,
    .clean-table td {
      border: 1px solid #444;
      padding: 2.2mm 2.6mm;
      vertical-align: top;
      line-height: 1.35;
    }
    .clean-table th {
      background: #f2f2f2;
      text-align: center;
      font-weight: 700;
    }
    .center { text-align: center; }
    .photo-title {
      text-align: center;
      font-size: 19pt;
      font-weight: 700;
      text-decoration: underline;
      margin: 0 0 6mm;
      line-height: 1.25;
    }
    .photo-grid-2 {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 5mm;
    }
    .photo-card { display: flex; flex-direction: column; gap: 1.5mm; }
    .photo-box {
      width: 100%;
      height: 83mm;
      border: 1px solid #8a8a8a;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      background: #fff;
    }
    .photo-box img { width: 100%; height: 100%; object-fit: cover; }
    .photo-empty { color: #777; font-size: 12pt; }
    .photo-label { font-size: 11pt; text-align: center; color: #333; }
    .full-image-wrap {
      width: 100%;
      height: 232mm;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #777;
      overflow: hidden;
      background: #fff;
    }
    .full-image-wrap img { width: 100%; height: 100%; object-fit: contain; }
    .service-heading-en {
      text-align: center;
      font-size: 24pt;
      font-weight: 700;
      margin-top: 2mm;
      line-height: 1.05;
    }
    .service-heading-sub {
      text-align: center;
      font-size: 17pt;
      font-weight: 700;
      margin-top: 2mm;
      margin-bottom: 4mm;
      letter-spacing: 0.3px;
    }
    .service-meta-grid {
      width: 100%;
      border-collapse: collapse;
      font-size: 11.5pt;
      margin-bottom: 4mm;
    }
    .service-meta-grid td {
      border: 1px solid #555;
      padding: 2mm 2.4mm;
      vertical-align: top;
      line-height: 1.3;
    }
    .checkbox-row {
      display: flex;
      flex-wrap: wrap;
      gap: 3mm 6mm;
      margin-top: 1mm;
    }
    .checkbox-item { white-space: nowrap; }
    .checkbox {
      display: inline-block;
      width: 4mm;
      height: 4mm;
      border: 1px solid #333;
      margin-right: 1.6mm;
      text-align: center;
      line-height: 3.6mm;
      font-size: 10pt;
      vertical-align: middle;
    }
    .signature-grid {
      width: 100%;
      border-collapse: collapse;
      margin-top: 4mm;
      font-size: 11pt;
    }
    .signature-grid td {
      border: 1px solid #555;
      vertical-align: top;
      padding: 3mm;
      height: 44mm;
    }
    .sign-line {
      display: flex;
      align-items: flex-end;
      gap: 2mm;
      margin-top: 3mm;
    }
    .sign-line-label { min-width: 14mm; }
    .sign-line-value {
      flex: 1;
      border-bottom: 1px dotted #555;
      min-height: 6mm;
    }
    .mini-section-title {
      font-size: 13pt;
      font-weight: 700;
      margin-top: 4mm;
      margin-bottom: 2mm;
    }
    .stock-table { font-size: 11pt; margin-top: 2mm; }
    .muted-note { font-size: 10.5pt; color: #555; }
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
}) {
  const absPath = createTemporaryArtifactPath('.pdf');
  const logoDataUri = getLogoDataUri();

  const coverPage = `
    <section class="page">
      <div class="cover">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : '<div class="logo-fallback">POWER VAULT SERVICE</div>'}
        <div class="cover-top-address">
          <div><b>บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</b></div>
          <div>407 หมู่ที่ 2 ต.สำโรงเหนือ อ.เมือง</div>
          <div>จ.สมุทรปราการ 10270</div>
        </div>
        <div class="cover-title">รายงานการบำรุงรักษาระบบเชิงป้องกัน</div>
        <div class="cover-issue">${escapeHtml(formatReportIssue(data.workDate))}</div>
        <div class="cover-project-line">โครงการ ${escapeHtml(data.projectName || '.....................................................')}</div>
        <div class="cover-spacer"></div>
        <div class="cover-by">โดย</div>
        <div class="cover-company">บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</div>
      </div>
    </section>
  `;

  const layoutAndCertificatePages = (data.fullPageDocs ?? [])
    .map((doc) => renderFullPageImage(doc.title, doc.filePath))
    .join('');

  const planPage = `
    <section class="page">
      ${renderHeader(logoDataUri)}
      <div class="section-head">แผนการบำรุงรักษาเชิงป้องกัน โครงการ ${escapeHtml(data.projectName || '.............................................')}</div>
      <div style="font-size:13pt; line-height:1.45; margin-bottom:2mm;">
        รายละเอียด และแผนการดูแล ควบคุม ตรวจสอบ และบำรุงรักษาเชิงป้องกัน อุปกรณ์ต่างๆ (เบื้องต้น)
      </div>
      <div class="summary-grid">
        ${renderInfoRow('ลูกค้า', data.projectName)}
        ${renderInfoRow('โครงการ', data.projectName)}
        ${renderInfoRow('ขนาดระบบ Solar Rooftop', data.systemSizeKWp ? `${data.systemSizeKWp} kWp` : '-')}
        ${renderInfoRow('วันที่เข้าทำการบำรุงรักษาระบบ', formatThaiDate(data.workDate))}
        ${renderInfoRow('จำนวนแผง PV', data.pvModuleEA ?? '-')}
        ${renderInfoRow('เวลา', data.workTime ?? '-')}
        ${renderInfoRow('สถานที่', data.address ?? '-', true)}
        ${renderInfoRow('หมายเหตุ', data.note ?? '-', true)}
      </div>
      <table class="clean-table">
        <thead>
          <tr>
            <th style="width:10%;">ลำดับ</th>
            <th style="width:40%;">อุปกรณ์/รายการ</th>
            <th style="width:14%;">การดำเนินการ</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${renderCleaningChecklistRows(data.checklist)}
        </tbody>
      </table>
    </section>
  `;

  const evidencePages = (data.evidenceGroups ?? [])
    .map((group) => renderImageGridSection(group.title, group.images, 6, 'photo-grid-2'))
    .join('');

  const html = wrapHtml([coverPage, layoutAndCertificatePages, planPage, evidencePages].join(''));
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
  serviceReportFormPath?: string | null;
  evidencePhotos?: EvidenceImage[];
  meta?: any;
  stockUsage?: ServiceStockUsage;
}) {
  const absPath = createTemporaryArtifactPath('.pdf');
  const logoDataUri = getLogoDataUri();
  const meta = data.meta ?? {};
  const detail = renderServiceDetailRows(meta, data.note);

  const checkbox = (label: string, value: boolean) => `
    <span class="checkbox-item"><span class="checkbox">${value ? '✓' : ''}</span>${escapeHtml(label)}</span>
  `;

  const projectType = pickMetaValue(meta, ['projectType', 'systemType']) || 'Solar Rooftop';
  const selectedWorkType = (detail.serviceType || '').toLowerCase();

  const formPage = `
    <section class="page">
      ${renderHeader(logoDataUri)}
      <div class="service-heading-en">PowerVault Service Center</div>
      <div class="service-heading-sub">SERVICE REPORT</div>

      <table class="service-meta-grid">
        <tr>
          <td style="width:50%;">
            <div><b>โครงการ</b> ${escapeHtml(data.projectName)}</div>
          </td>
          <td style="width:50%; text-align:right;">
            <div><b>วันที่</b> ${escapeHtml(formatThaiDate(data.workDate))}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div><b>ลักษณะงานบริการ</b></div>
            <div class="checkbox-row">
              ${checkbox('งานติดตั้ง', selectedWorkType.includes('ติดตั้ง') || selectedWorkType.includes('install'))}
              ${checkbox('งานบริการ', !selectedWorkType || selectedWorkType.includes('service') || selectedWorkType.includes('ซ่อม') || selectedWorkType.includes('บำรุง'))}
              ${checkbox('ตรวจสอบโครงการ', selectedWorkType.includes('inspect') || selectedWorkType.includes('ตรวจ'))}
              ${checkbox('การซ่อมบำรุง', selectedWorkType.includes('maintenance') || selectedWorkType.includes('บำรุง'))}
              ${checkbox('งานแก้ไขอื่นๆ', selectedWorkType.includes('other') || selectedWorkType.includes('อื่น'))}
            </div>
          </td>
        </tr>
        <tr>
          <td>
            <div><b>ลักษณะระบบบริการ</b></div>
            <div class="checkbox-row">
              ${checkbox('Solar Rooftop', projectType.toLowerCase().includes('roof') || projectType.toLowerCase().includes('rooftop') || projectType.toLowerCase().includes('solar'))}
              ${checkbox('Solar Farm', projectType.toLowerCase().includes('farm'))}
              ${checkbox('Solar Floating', projectType.toLowerCase().includes('floating'))}
            </div>
          </td>
          <td>
            <div><b>เลขที่งาน</b> ${escapeHtml(data.jobNo)}</div>
            <div><b>เวลา</b> ${escapeHtml(data.workTime ?? '-')}</div>
          </td>
        </tr>
        <tr>
          <td>
            <div><b>ชื่อ-นามสกุล ผู้ปฏิบัติงานภายนอก</b> ${escapeHtml(detail.technician || '-')}</div>
            <div><b>ตำแหน่ง</b> ${escapeHtml(detail.position || 'Service Technician')}</div>
          </td>
          <td>
            <div><b>สถานที่</b> ${escapeHtml(data.address ?? '-')}</div>
            <div><b>ขนาดระบบ</b> ${escapeHtml(data.systemSizeKWp ? `${data.systemSizeKWp} kWp` : '-')}</div>
          </td>
        </tr>
      </table>

      <table class="clean-table" style="font-size:11.5pt;">
        <thead>
          <tr>
            <th style="width:9%;">ลำดับ</th>
            <th style="width:31%;">รายการ</th>
            <th>รายละเอียด / วิธีดำเนินการ</th>
          </tr>
        </thead>
        <tbody>
          ${detail.taskRowsHtml}
        </tbody>
      </table>

      ${renderStockTable(data.stockUsage)}

      <table class="signature-grid">
        <tr>
          <td style="width:50%;">
            <div><b>วันที่เริ่มดำเนินการ :</b> ${escapeHtml(detail.startDate || formatThaiDate(data.workDate))}</div>
            <div style="margin-top:2mm;"><b>ลงชื่อผู้ตรวจสอบ :</b></div>
            <div class="sign-line"><div class="sign-line-label">ชื่อ</div><div class="sign-line-value">${escapeHtml(detail.technician || '-')}</div></div>
            <div class="sign-line"><div class="sign-line-label">ตำแหน่ง</div><div class="sign-line-value">${escapeHtml(detail.position || 'Service Technician')}</div></div>
            <div class="sign-line"><div class="sign-line-label">หน่วยงาน</div><div class="sign-line-value">บริษัท พาวเวอร์วอลท์ (ประเทศไทย) จำกัด</div></div>
            <div class="sign-line"><div class="sign-line-label">ลายเซ็น</div><div class="sign-line-value"></div></div>
          </td>
          <td style="width:50%;">
            <div><b>วันที่ดำเนินงานแล้วเสร็จ :</b> ${escapeHtml(detail.endDate || formatThaiDate(data.workDate))}</div>
            <div style="margin-top:2mm;"><b>ลงชื่อผู้รับมอบงาน :</b></div>
            <div class="sign-line"><div class="sign-line-label">ชื่อ</div><div class="sign-line-value">${escapeHtml(detail.customerSigner || '-')}</div></div>
            <div class="sign-line"><div class="sign-line-label">ตำแหน่ง</div><div class="sign-line-value">${escapeHtml(detail.customerPosition || '-')}</div></div>
            <div class="sign-line"><div class="sign-line-label">หมายเหตุ</div><div class="sign-line-value">${escapeHtml(detail.summary || data.note || '-')}</div></div>
            <div class="sign-line"><div class="sign-line-label">ลายเซ็น</div><div class="sign-line-value"></div></div>
          </td>
        </tr>
      </table>
    </section>
  `;

  const uploadedFormPage = data.serviceReportFormPath
    ? renderFullPageImage('เอกสาร Service Report ที่อัปโหลด', data.serviceReportFormPath)
    : '';

  const evidencePages = renderImageGridSection('รูปภาพประกอบการปฏิบัติงาน', data.evidencePhotos ?? [], 4, 'photo-grid-2');

  const html = wrapHtml([formPage, uploadedFormPage, evidencePages].join(''));
  await renderPdfToFile(html, absPath);
  return storeGeneratedReportFromLocalFile(absPath, { jobType: 'service', jobNo: data.jobNo });
}
