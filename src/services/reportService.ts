import fs from 'fs';
import path from 'path';
import { v4 as uuid } from 'uuid';
import puppeteer from 'puppeteer';

type EvidenceGroup = {
  title: string;
  images: { label?: string; filePath: string }[];
};

function ensureUploadsDir() {
  const dir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function escapeHtml(s: any) {
  // ไม่ใช้ replaceAll เพื่อให้เข้ากับ ts target เดิม
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
  // windows-safe: แปลง backslash -> slash
  return 'file://' + p.replace(/\\/g, '/');
}

/**
 * Generate Cleaning Report PDF (Puppeteer)
 * - รองรับภาษาไทย (ใช้ system font: TH Sarabun New / Sarabun / Tahoma)
 * - ถ้ามีไฟล์ฟอนต์ใน assets/fonts/ จะ embed ให้ด้วย (ทำให้เครื่องอื่นก็แสดงไทยได้)
 */
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
  ensureUploadsDir();

  const fileName = `cleaning-report-${data.jobNo}-${uuid()}.pdf`;
  const absPath = path.join(process.cwd(), 'uploads', fileName);

  // Optional embedded fonts
  const fontNormal = path.join(process.cwd(), 'assets', 'fonts', 'THSarabunNew.ttf');
  const fontBold = path.join(process.cwd(), 'assets', 'fonts', 'THSarabunNew-Bold.ttf');
  const hasEmbeddedFonts = fs.existsSync(fontNormal) && fs.existsSync(fontBold);

  // Optional logo
  const logoPath = path.join(process.cwd(), 'assets', 'powervault-logo.png');
  const logoDataUri = fs.existsSync(logoPath) ? fileToDataUri(logoPath) : null;

  const thDate = data.workDate ? data.workDate.toLocaleDateString('th-TH') : '-';
  const checklistItems = Array.isArray(data.checklist?.items) ? data.checklist.items : [];

  const fullDocsHtml = (data.fullPageDocs ?? [])
    .map((doc) => {
      const uri = fileToDataUri(doc.filePath);
      if (!uri) return '';
      return `
        <div class="page">
          <div class="section-title">${escapeHtml(doc.title)}</div>
          <div class="fullpage"><img src="${uri}" /></div>
        </div>
      `;
    })
    .join('\n');

  const evidenceHtml = (data.evidenceGroups ?? [])
    .map((group) => {
      const cards = (group.images ?? [])
        .map((img) => {
          const uri = fileToDataUri(img.filePath);
          if (!uri) return '';
          return `
            <div class="img-card">
              <div class="img-wrap"><img src="${uri}" /></div>
              <div class="img-label">${escapeHtml(img.label ?? '')}</div>
            </div>
          `;
        })
        .join('\n');

      return `
        <div class="page">
          <div class="section-title">${escapeHtml(group.title)}</div>
          <div class="grid-2">${cards || '<div>ไม่มีรูปภาพ</div>'}</div>
        </div>
      `;
    })
    .join('\n');

  const fontCss = hasEmbeddedFonts
    ? `
      @font-face {
        font-family: 'THSarabunEmbed';
        src: url('${asFileUrl(fontNormal)}') format('truetype');
        font-weight: normal;
      }
      @font-face {
        font-family: 'THSarabunEmbed';
        src: url('${asFileUrl(fontBold)}') format('truetype');
        font-weight: bold;
      }
    `
    : '';

  // ถ้าไม่มี embedded font จะใช้ system font บน Windows (TH Sarabun New) เป็นหลัก
  const baseFontFamily = hasEmbeddedFonts
    ? `'THSarabunEmbed', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`
    : `'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`;

  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 14mm; }
    ${fontCss}
    body { font-family: ${baseFontFamily}; font-size: 16pt; color: #111; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #111; padding-bottom:6mm; margin-bottom:6mm; }
    .logo { width: 52mm; }
    .company { text-align:right; font-size:14pt; line-height:1.2; }
    .title { font-size:22pt; font-weight:bold; text-align:center; margin:6mm 0; }
    .meta { display:grid; grid-template-columns: 1fr 1fr; gap:2mm 10mm; line-height:1.2; }
    .row { display:flex; gap:6mm; }
    .k { width:42mm; font-weight:bold; }
    .v { flex:1; }
    .section-title { font-size:18pt; font-weight:bold; margin:4mm 0 2mm 0; }
    table { width:100%; border-collapse:collapse; font-size:15pt; }
    th, td { border:1px solid #222; padding:2.5mm; vertical-align:top; }
    th { background:#f2f2f2; font-weight:bold; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin-top:3mm; }
    .img-card { border:1px solid #333; padding:2mm; }
    .img-wrap { width:100%; height:70mm; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fafafa; }
    .img-wrap img { width:100%; height:100%; object-fit:cover; }
    .img-label { font-size:13pt; margin-top:1.5mm; }
    .fullpage { width:100%; height:260mm; border:1px solid #333; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .fullpage img { width:100%; height:100%; object-fit:contain; }
  </style>
</head>
<body>

  <div class="page">
    <div class="header">
      <div>
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : `<div style="font-weight:bold;font-size:18pt;">POWER VAULT</div>`}
      </div>
      <div class="company">
        <div><b>บริษัท พาวเวอร์วอลท์ (ประเทศไทย) จำกัด</b></div>
        <div>รายงานการทำความสะอาดแผงโซลาร์เซลล์และอินเวอร์เตอร์</div>
      </div>
    </div>

    <div class="title">Cleaning Report</div>

    <div class="meta">
      <div class="row"><div class="k">Job No:</div><div class="v">${escapeHtml(data.jobNo)}</div></div>
      <div class="row"><div class="k">Project:</div><div class="v">${escapeHtml(data.projectName)}</div></div>
      <div class="row"><div class="k">Address:</div><div class="v">${escapeHtml(data.address ?? '-')}</div></div>
      <div class="row"><div class="k">Date:</div><div class="v">${escapeHtml(thDate)}</div></div>
      <div class="row"><div class="k">Time:</div><div class="v">${escapeHtml(data.workTime ?? '-')}</div></div>
      <div class="row"><div class="k">System Size (kWp):</div><div class="v">${escapeHtml(data.systemSizeKWp ?? '-')}</div></div>
      <div class="row"><div class="k">PV Module (ea.):</div><div class="v">${escapeHtml(data.pvModuleEA ?? '-')}</div></div>
      <div class="row"><div class="k">Note:</div><div class="v">${escapeHtml(data.note ?? '-')}</div></div>
    </div>

    <div class="section-title">Checklist</div>
    <table>
      <thead>
        <tr>
          <th style="width:10mm;">#</th>
          <th>รายการ</th>
          <th style="width:25mm;">สถานะ</th>
          <th>หมายเหตุ</th>
        </tr>
      </thead>
      <tbody>
        ${
          checklistItems.length === 0
            ? `<tr><td colspan="4">- ไม่มีรายการ Checklist -</td></tr>`
            : checklistItems.map((it: any, idx: number) => `
              <tr>
                <td>${idx + 1}</td>
                <td>${escapeHtml(it.title ?? '')}</td>
                <td>${escapeHtml(it.status ?? '')}</td>
                <td>${escapeHtml(it.remark ?? '')}</td>
              </tr>
            `).join('')
        }
      </tbody>
    </table>
    <div style="margin-top:6mm; font-size:14pt;">* รูปภาพและเอกสารแนบอยู่ในหน้าถัดไป</div>
  </div>

  ${fullDocsHtml}
  ${evidenceHtml}

</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
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
    });
  } finally {
    await browser.close();
  }

  return { fileUrl: `/uploads/${fileName}`, absPath };
}

/**
 * Generate Service Report PDF (Puppeteer)
 * แนวคิด: "เหมือนเอาฟอร์มกระดาษมาแปะ" (ตามภาพตัวอย่าง)
 * - หน้า 1: หัวกระดาษ + รายละเอียด Job
 * - หน้า 2+: แนบรูปฟอร์ม Service Report แบบเต็มหน้า (ถ้ามี)
 * - หน้าถัดไป: รูปหลักฐาน (กริด 2 คอลัมน์)
 */
export async function generateServiceReportPdf(data: {
  jobNo: string;
  projectName: string;
  address?: string | null;
  workDate?: Date | null;
  workTime?: string | null;
  systemSizeKWp?: number | null;
  pvModuleEA?: number | null;
  note?: string | null;

  // รูปฟอร์มที่อัปโหลด (แนะนำ jpg/png)
  serviceReportFormPath?: string | null;

  // รูปหลักฐานอื่น ๆ
  evidencePhotos?: { label?: string; filePath: string }[];

  // ข้อมูลเพิ่มเติม (dropdown/ฟิลด์ใน step3)
  meta?: any;

  stockUsage?: Array<{
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
}) {
  ensureUploadsDir();

  const fileName = `service-report-${data.jobNo}-${uuid()}.pdf`;
  const absPath = path.join(process.cwd(), 'uploads', fileName);

  const fontNormal = path.join(process.cwd(), 'assets', 'fonts', 'THSarabunNew.ttf');
  const fontBold = path.join(process.cwd(), 'assets', 'fonts', 'THSarabunNew-Bold.ttf');
  const hasEmbeddedFonts = fs.existsSync(fontNormal) && fs.existsSync(fontBold);

  const logoPath = path.join(process.cwd(), 'assets', 'powervault-logo.png');
  const logoDataUri = fs.existsSync(logoPath) ? fileToDataUri(logoPath) : null;

  const thDate = data.workDate ? data.workDate.toLocaleDateString('th-TH') : '-';

  const fontCss = hasEmbeddedFonts
    ? `
      @font-face {
        font-family: 'THSarabunEmbed';
        src: url('${asFileUrl(fontNormal)}') format('truetype');
        font-weight: normal;
      }
      @font-face {
        font-family: 'THSarabunEmbed';
        src: url('${asFileUrl(fontBold)}') format('truetype');
        font-weight: bold;
      }
    `
    : '';

  const baseFontFamily = hasEmbeddedFonts
    ? `'THSarabunEmbed', 'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`
    : `'TH Sarabun New', 'Sarabun', 'Tahoma', sans-serif`;

  const formUri = data.serviceReportFormPath ? fileToDataUri(data.serviceReportFormPath) : null;
  const formPageHtml = formUri
    ? `
      <div class="page">
        <div class="section-title">Service Report</div>
        <div class="fullpage"><img src="${formUri}" /></div>
      </div>
    `
    : '';

  const evidence = (data.evidencePhotos ?? []).slice(0, 12);
  const evidenceCards = evidence
    .map((img) => {
      const uri = fileToDataUri(img.filePath);
      if (!uri) return '';
      return `
        <div class="img-card">
          <div class="img-wrap"><img src="${uri}" /></div>
          <div class="img-label">${escapeHtml(img.label ?? '')}</div>
        </div>
      `;
    })
    .join('\n');

  const scrubMeta = (m: any) => {
    if (!m || typeof m !== 'object') return null;

    const cloned = JSON.parse(JSON.stringify(m));

    // ไม่แสดงข้อมูลภายในระบบ/ข้อมูลที่เราแสดงแยกเป็นตารางอยู่แล้ว
    for (const k of ['stockItems', 'stock', 'items', 'products', 'stockUsage', 'usedStock', 'note']) {
      if (k in cloned) delete cloned[k];
    }

    // ถ้าตัดออกแล้วไม่เหลืออะไร ไม่ต้องแสดง "รายละเอียดเพิ่มเติม"
    if (cloned && typeof cloned === 'object' && !Array.isArray(cloned) && Object.keys(cloned).length === 0) {
      return null;
    }

    return cloned;
  };
  const scrubbedMeta = scrubMeta(data.meta);
  const metaText = scrubbedMeta ? JSON.stringify(scrubbedMeta, null, 2) : '';

  const stockRows = (data.stockUsage ?? [])
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

  const stockTableHtml = stockRows.length
    ? `
      <div class="section-title">รายการอุปกรณ์/อะไหล่ที่ใช้ (Stock)</div>
      <table class="tbl">
        <thead>
          <tr>
            <th style="width:26mm;">SKU</th>
            <th style="width:28mm;">หมวดหมู่</th>
            <th>ชื่อสินค้า</th>
            <th style="width:20mm;">หน่วย</th>
            <th style="width:18mm; text-align:right;">จำนวน</th>
          </tr>
        </thead>
        <tbody>
          ${stockRows
            .map(
              (r) => `
            <tr>
              <td>${escapeHtml(r.sku)}</td>
              <td>${escapeHtml(r.category)}</td>
              <td>${escapeHtml(r.name)}</td>
              <td>${escapeHtml(r.unit)}</td>
              <td style="text-align:right;">${escapeHtml(r.qty)}</td>
            </tr>
          `
            )
            .join('')}
        </tbody>
      </table>
    `
    : '';

  const html = `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <style>
    @page { size: A4; margin: 14mm; }
    ${fontCss}
    body { font-family: ${baseFontFamily}; font-size: 16pt; color: #111; }
    .page { page-break-after: always; }
    .page:last-child { page-break-after: auto; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:1px solid #111; padding-bottom:6mm; margin-bottom:6mm; }
    .logo { width: 52mm; }
    .company { text-align:right; font-size:14pt; line-height:1.2; }
    .title { font-size:22pt; font-weight:bold; text-align:center; margin:6mm 0; }
    .meta { display:grid; grid-template-columns: 1fr 1fr; gap:2mm 10mm; line-height:1.2; }
    .row { display:flex; gap:6mm; }
    .k { width:42mm; font-weight:bold; }
    .v { flex:1; }
    .section-title { font-size:18pt; font-weight:bold; margin:4mm 0 2mm 0; }
    .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:6mm; margin-top:3mm; }
    .img-card { border:1px solid #333; padding:2mm; }
    .img-wrap { width:100%; height:70mm; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fafafa; }
    .img-wrap img { width:100%; height:100%; object-fit:cover; }
    .img-label { font-size:13pt; margin-top:1.5mm; }
    .fullpage { width:100%; height:260mm; border:1px solid #333; display:flex; align-items:center; justify-content:center; overflow:hidden; }
    .fullpage img { width:100%; height:100%; object-fit:contain; }
    pre { background:#f7f7f7; border:1px solid #ccc; padding:4mm; font-size:12pt; white-space:pre-wrap; }
    .tbl { width:100%; border-collapse:collapse; font-size:14pt; }
    .tbl th, .tbl td { border:1px solid #333; padding:1.5mm 2mm; vertical-align:top; }
    .tbl th { background:#f2f2f2; font-weight:bold; }
  </style>
</head>
<body>

  <div class="page">
    <div class="header">
      <div>
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : `<div style="font-weight:bold;font-size:18pt;">POWER VAULT</div>`}
      </div>
      <div class="company">
        <div><b>PowerVault Service Center</b></div>
        <div>SERVICE REPORT</div>
      </div>
    </div>

    <div class="title">Service Report</div>

    <div class="meta">
      <div class="row"><div class="k">Job No:</div><div class="v">${escapeHtml(data.jobNo)}</div></div>
      <div class="row"><div class="k">Project:</div><div class="v">${escapeHtml(data.projectName)}</div></div>
      <div class="row"><div class="k">Address:</div><div class="v">${escapeHtml(data.address ?? '-')}</div></div>
      <div class="row"><div class="k">Date:</div><div class="v">${escapeHtml(thDate)}</div></div>
      <div class="row"><div class="k">Time:</div><div class="v">${escapeHtml(data.workTime ?? '-')}</div></div>
      <div class="row"><div class="k">System Size (kWp):</div><div class="v">${escapeHtml(data.systemSizeKWp ?? '-')}</div></div>
      <div class="row"><div class="k">PV Module (ea.):</div><div class="v">${escapeHtml(data.pvModuleEA ?? '-')}</div></div>
      <div class="row"><div class="k">Note:</div><div class="v">${escapeHtml(data.note ?? '-')}</div></div>
    </div>

    ${stockTableHtml}

    ${metaText ? `<div class="section-title">รายละเอียดเพิ่มเติม</div><pre>${escapeHtml(metaText)}</pre>` : ''}
  </div>

  ${formPageHtml}

  <div class="page">
    <div class="section-title">รูปภาพประกอบ</div>
    <div class="grid-2">
      ${evidenceCards || '<div>ไม่มีรูปภาพ</div>'}
    </div>
  </div>

</body>
</html>`;

  const browser = await puppeteer.launch({
    headless: true,
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
    });
  } finally {
    await browser.close();
  }

  return { fileUrl: `/uploads/${fileName}`, absPath };
}
