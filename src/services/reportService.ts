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
type CertificateItem = {
  description: string;
  location: string;
  signaturePV?: string | null;
  signatureCustomer?: string | null;
};
type CertificateApproval = 'approval' | 'acknowledgement' | 'comment' | null;
type CertificateSignature = {
  engineerName?: string | null;
  engineerDate?: string | null;
  customerName?: string | null;
  customerDate?: string | null;
  customerApproval?: 'A' | 'AC' | 'N' | null;
  customerNote?: string | null;
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

function renderHeader(logoDataUri: string | null, variant: 'service' | 'cleaning' = 'cleaning') {
  if (variant === 'service') {
    return `
      <div class="report-header">
        <div class="header-left">
          ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : '<div class="logo-fallback">POWER VAULT</div>'}
        </div>
        <div class="header-right">
          <div class="company-th">บริษัท พาวเวอร์วอลท์(ประเทศไทย)</div>
          <div>จำกัด (สำนักงานใหญ่)</div>
          <div>407 หมู่ที่ 2 ต.สำโรงเหนือ อ.เมือง</div>
          <div>สมุทรปราการ จ.สมุทรปราการ 10270</div>
          <div>เลขประจำตัวผู้เสียภาษี 0105561040684</div>
        </div>
      </div>
      <div class="header-rule"></div>
    `;
  }
  return `
    <div class="report-header">
      <div class="header-left">
        ${logoDataUri ? `<img class="logo" src="${logoDataUri}" />` : '<div class="logo-fallback">POWER VAULT</div>'}
      </div>
      <div class="header-right">
        <div class="company-th">บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</div>
        <div>407 หมู่ที่ 2 ต.สำโรงเหนือ อ.เมือง</div>
        <div>สมุทรปราการ</div>
        <div>จ.สมุทรปราการ 10270</div>
      </div>
    </div>
    <div class="header-rule"></div>
  `;
}


function renderImageGridSection(title: string, images: EvidenceImage[], perPage: number, gridClass = 'photo-grid-2', headerVariant: 'service' | 'cleaning' = 'cleaning') {
  if (!images.length) return '';
  return splitIntoChunks(images, perPage)
    .map((chunk, index) => `
      <section class="page">
        ${renderHeader(getLogoDataUri(), headerVariant)}
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

function renderFullPageImage(title: string, filePath: string, headerVariant: 'service' | 'cleaning' = 'cleaning', lineFill = true) {
  const uri = fileToDataUri(filePath);
  if (!uri) return '';
  const titleHtml = title
    ? `<div class="section-head${lineFill ? ' line-fill' : ''}">${escapeHtml(title)}</div>`
    : '';
  return `
    <section class="page" style="display:flex; flex-direction:column; height:297mm;">
      ${renderHeader(getLogoDataUri(), headerVariant)}
      ${titleHtml}
      <div class="full-image-wrap"><img src="${uri}" /></div>
    </section>
  `;
}

function formatCheckStatus(raw: any): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (s === 'done' || s === 'pass' || s === 'completed' || s === 'yes' || s === 'true' || s === '1') return '✓';
  return raw ? String(raw) : '-';
}

// Fixed checklist categories for cleaning maintenance plan
const CLEANING_CHECKLIST_TEMPLATE = [
  {
    title: 'แผงโซลาร์เซลล์',
    children: [
      { title: 'ตรวจสอบความสะอาดแผงและล้างแผงโซลาร์เซลล์' },
      { title: 'ตรวจสอบสภาพแผง สีกระจก และการเกิดออกไซต์ บน Frame' },
    ],
  },
  {
    title: 'Inverter Unit',
    children: [
      { title: 'ตรวจสอบสภาพและทำความสะอาด Filter' },
      { title: 'ตรวจสอบการทำงานของพัดลมระบายอากาศและดูดฝุ่น' },
    ],
  },
  {
    title: 'Monitoring System',
    children: [
      { title: 'ตรวจสอบสภาพและทำความสะอาดภายในตู้ควบคุม คอมพิวเตอร์' },
    ],
  },
  {
    title: 'ระบบน้ำทำความสะอาดแผงโซลาร์เซลล์',
    children: [
      { title: 'ตรวจสอบสภาพและความพร้อมของปั๊มน้ำและอุปกรณ์ Starter' },
      { title: 'ตรวจสอบสภาพของหัวจ่ายน้ำ' },
    ],
  },
];

function renderCleaningChecklistRows(checklist: any) {
  // Build lookup from user data: key = child title -> { status, remark }
  const userItems = Array.isArray(checklist?.items) ? checklist.items : [];
  const childLookup = new Map<string, { status?: string; remark?: string }>();

  for (const group of userItems) {
    const children = Array.isArray(group?.children) ? group.children : [];
    for (const child of children) {
      if (child?.title) {
        childLookup.set(child.title, { status: child.status, remark: child.remark });
      }
    }
    // Also support flat items (backward compat)
    if (group?.title && group?.status !== undefined && !Array.isArray(group?.children)) {
      childLookup.set(group.title, { status: group.status, remark: group.remark });
    }
  }

  // Render fixed structure with merged user data
  return CLEANING_CHECKLIST_TEMPLATE.map((group, idx) => {
    const totalRows = 1 + group.children.length;
    const titleRow = `
      <tr>
        <td class="center" rowspan="${totalRows}">${idx + 1}</td>
        <td><b>${escapeHtml(group.title)}</b></td>
        <td class="center"></td>
        <td></td>
      </tr>
    `;
    const childRows = group.children.map((child) => {
      const userData = childLookup.get(child.title);
      return `
        <tr>
          <td>- ${escapeHtml(child.title)}</td>
          <td class="center">${formatCheckStatus(userData?.status)}</td>
          <td>${escapeHtml(userData?.remark ?? '')}</td>
        </tr>
      `;
    }).join('');
    return titleRow + childRows;
  }).join('');
}

function renderCertificatePage(
  logoDataUri: string | null,
  data: {
    projectName: string;
    systemLabel?: string;
    docNo?: string;
    date?: Date | null;
    items: CertificateItem[];
    approval?: CertificateApproval;
    signature?: CertificateSignature;
  },
) {
  const dateObj = data.date ?? new Date();
  const thaiDay = String(dateObj.getDate());
  const thaiMonthNames = [
    '', 'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
  ];
  const thaiMonth = thaiMonthNames[dateObj.getMonth() + 1] || '';
  const thaiYear = String(dateObj.getFullYear() + 543);
  const dateStr = `${thaiDay} ${thaiMonth} ${thaiYear}`;

  const sig: CertificateSignature = data.signature ?? {};
  const emptyRows = Math.max(0, 8 - data.items.length);

  return `
    <section class="page">
      ${renderHeader(logoDataUri, 'cleaning')}

      <!-- Certificate inner box -->
      <div style="border:1.5px solid #333; padding: 5mm 6mm; font-size:11pt; line-height:1.4;">

        <!-- Inner header -->
        <div style="display:flex; align-items:flex-start; gap:4mm; margin-bottom:3mm;">
          <div style="width:55%;">
            ${logoDataUri ? `<img src="${logoDataUri}" style="width:38mm; margin-bottom:1mm;" />` : ''}
            <div style="font-size:11pt; font-weight:700;">บริษัท พาวเวอร์วอลท์ (ประเทศไทย)</div>
            <div style="font-size:10pt;">PowerVault (Thailand) Company Limited</div>
          </div>
          <div style="width:45%; text-align:right;">
            <div style="font-size:14pt; font-weight:700;">เอกสารส่งมอบงาน</div>
            <div style="font-size:11pt;">(Certificate of Completion)</div>
          </div>
        </div>

        <!-- Project / Date fields -->
        <table style="width:100%; border-collapse:collapse; font-size:10.5pt; margin-bottom:2mm;">
          <tr>
            <td style="width:55%;">โครงการ/ Project : <span style="border-bottom:1px dotted #555; padding-bottom:0.5mm;">${escapeHtml(data.projectName)}</span></td>
            <td>เลขที่/ Doc.No. : <span style="border-bottom:1px dotted #555; padding-bottom:0.5mm;">${escapeHtml(data.docNo || '')}</span></td>
          </tr>
          <tr>
            <td>ระบบ/ System : <span style="border-bottom:1px dotted #555; padding-bottom:0.5mm;">${escapeHtml(data.systemLabel || '')}</span></td>
            <td>วันที่/ Date : <span style="border-bottom:1px dotted #555; padding-bottom:0.5mm;">${escapeHtml(dateStr)}</span></td>
          </tr>
        </table>

        <!-- Recipient -->
        <div style="margin:3mm 0 1mm; font-size:10.5pt;">
          <b>เรียน</b> ลูกค้า/ผู้ตรวจรับมอบงาน
        </div>
        <div style="font-size:10pt; margin-bottom:2mm;">
          บริษัทฯ ขอนำส่งเอกสารส่งมอบงาน เพื่อพิจารณา
        </div>

        <!-- Approval checkboxes -->
        <div style="display:flex; gap:8mm; font-size:10pt; margin-bottom:3mm;">
          <span>[${data.approval === 'approval' ? '✓' : ' '}] อนุมัติ/ Approval</span>
          <span>[${data.approval === 'acknowledgement' ? '✓' : ' '}] รับทราบ/ Acknowledgement</span>
          <span>[${data.approval === 'comment' ? '✓' : ' '}] ระบุความคิดเห็น/ Comment</span>
        </div>

        <!-- Items table -->
        <table style="width:100%; border-collapse:collapse; font-size:10pt;">
          <thead>
            <tr>
              <th style="border:1px solid #444; padding:1.5mm 2mm; width:8%; text-align:center;">ลำดับ<br/>(Item)</th>
              <th style="border:1px solid #444; padding:1.5mm 2mm; width:32%; text-align:center;">รายละเอียดงาน<br/>(Description)</th>
              <th style="border:1px solid #444; padding:1.5mm 2mm; width:18%; text-align:center;">สถานที่ทำงาน<br/>(Location)</th>
              <th style="border:1px solid #444; padding:1.5mm 2mm; width:21%; text-align:center;" colspan="1">ลงนาม/ Signature<br/>PowerVault (Thailand)</th>
              <th style="border:1px solid #444; padding:1.5mm 2mm; width:21%; text-align:center;">ผู้ตรวจรับมอบงาน</th>
            </tr>
          </thead>
          <tbody>
            ${data.items.map((item, i) => `
              <tr>
                <td style="border:1px solid #444; padding:1.5mm 2mm; text-align:center;">${i + 1}</td>
                <td style="border:1px solid #444; padding:1.5mm 2mm;">- ${escapeHtml(item.description)}</td>
                <td style="border:1px solid #444; padding:1.5mm 2mm; text-align:center;">${escapeHtml(item.location)}</td>
                <td style="border:1px solid #444; padding:1.5mm 2mm; text-align:center;">${escapeHtml(item.signaturePV ?? '')}</td>
                <td style="border:1px solid #444; padding:1.5mm 2mm; text-align:center;">${escapeHtml(item.signatureCustomer ?? '')}</td>
              </tr>
            `).join('')}
            ${Array.from({ length: emptyRows }, () => `
              <tr>
                <td style="border:1px solid #444; padding:1.5mm 2mm; height:7mm;"></td>
                <td style="border:1px solid #444; padding:1.5mm 2mm;"></td>
                <td style="border:1px solid #444; padding:1.5mm 2mm;"></td>
                <td style="border:1px solid #444; padding:1.5mm 2mm;"></td>
                <td style="border:1px solid #444; padding:1.5mm 2mm;"></td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        <!-- Bottom signatures -->
        <div style="display:flex; gap:4mm; margin-top:5mm; font-size:9.5pt; line-height:1.5;">
          <!-- Left: Engineer -->
          <div style="width:50%;">
            <div style="margin-bottom:2mm;"><b>เรียน ผู้บริหาร และผู้เกี่ยวข้อง</b></div>
            <div style="font-size:9pt; line-height:1.4;">
              ข้าพเจ้าในฐานะตัวแทนผู้รับเหมาได้ทำงานเสร็จสิ้น และตรวจสอบงาน<br/>
              ในเบื้องต้นแล้ว จึงใคร่ให้ท่านตรวจสอบการเสร็จสิ้นสุดท้าย เพื่อที่จะได้ดำเนินงาน<br/>
              ต่อไป
            </div>
            <div style="margin-top:10mm;">
              <div>ลงชื่อ/ Name : ${sig.engineerName ? `<span style="border-bottom:1px dotted #555; padding:0 2mm;">${escapeHtml(sig.engineerName)}</span>` : '...................................'}</div>
              <div style="text-align:center; margin-top:1mm;">(Engineer/ Foreman)</div>
              <div style="margin-top:2mm;">วันที่/ Date : ${sig.engineerDate ? `<span style="border-bottom:1px dotted #555; padding:0 2mm;">${escapeHtml(sig.engineerDate)}</span>` : '......../......../........'}</div>
            </div>
          </div>
          <!-- Right: Customer -->
          <div style="width:50%;">
            <div style="margin-bottom:2mm;">ผู้บริหารงานและผู้เกี่ยวข้อนได้ตรวจสอบ และขอแจ้งผลให้ทราบดังนี้</div>
            <div style="font-size:9pt; line-height:1.5;">
              [${sig.customerApproval === 'A' ? '✓' : ' '}] A - อนุมัติ/ Approved<br/>
              [${sig.customerApproval === 'AC' ? '✓' : ' '}] AC - ความเห็น, ข้อควรแก้ไข/ Comment<br/>
              [${sig.customerApproval === 'N' ? '✓' : ' '}] N - ไม่อนุมัติ/ Not Approved
            </div>
            <div style="margin-top:1mm;">Note : ${sig.customerNote ? `<span style="border-bottom:1px dotted #555; padding:0 2mm;">${escapeHtml(sig.customerNote)}</span>` : '...................................'}</div>
            <div style="margin-top:8mm;">
              <div>ลงชื่อ /Name : ${sig.customerName ? `<span style="border-bottom:1px dotted #555; padding:0 2mm;">${escapeHtml(sig.customerName)}</span>` : '...................................'}</div>
              <div style="text-align:center; margin-top:1mm;">(ผู้ตรวจรับมอบงาน ลูกค้า)</div>
              <div style="margin-top:2mm;">วันที่/ Date : ${sig.customerDate ? `<span style="border-bottom:1px dotted #555; padding:0 2mm;">${escapeHtml(sig.customerDate)}</span>` : '......../......../........'}</div>
            </div>
          </div>
        </div>

      </div>
    </section>
  `;
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
      min-height: 220mm;
      align-items: center;
      text-align: center;
      padding-top: 0;
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
      background: #305496;
      color: #fff;
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
    .full-page-body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .full-image-wrap {
      width: 100%;
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #777;
      overflow: hidden;
      background: #fff;
      min-height: 0;
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
    .sign-line-label { min-width: 32mm; white-space: nowrap; }
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
  siteLayoutPath?: string | null;
  certificateImages?: { filePath: string }[];
  certificateItems?: CertificateItem[];
  certificateApproval?: CertificateApproval;
  certificateSignature?: CertificateSignature;
}) {
  const absPath = createTemporaryArtifactPath('.pdf');
  const logoDataUri = getLogoDataUri();

  const coverPage = `
    <section class="page">
      ${renderHeader(logoDataUri, 'cleaning')}
      <div class="cover">
        <div class="cover-title">รายงานการบำรุงรักษาระบบเชิงป้องกัน</div>
        <div class="cover-issue">${escapeHtml(formatReportIssue(data.workDate))}</div>
        <div class="cover-project-line">โครงการ ${escapeHtml(data.projectName || '.....................................................')}</div>
        <div class="cover-spacer"></div>
        <div class="cover-by">โดย</div>
        <div class="cover-company">บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</div>
      </div>
    </section>
  `;

  // Certificate of Completion — ใช้รูปอัปโหลด (STEP3_CERTIFICATE) แทนตารางดิจิทัล
  // ถ้ามี certificateImages → แสดงเป็น full-page images
  const certificatePages = (data.certificateImages ?? [])
    .map((img) => renderFullPageImage('เอกสารส่งมอบงาน', img.filePath, 'cleaning', true))
    .join('');

  // Legacy full-page docs (STEP3_LAYOUT / STEP3_CERTIFICATE attachments — backward compat)
  const legacyFullPageDocs = (data.fullPageDocs ?? [])
    .map((doc) => {
      const isLayout = doc.title === 'Layout';
      const title = isLayout
        ? (data.projectName ? `Layout โครงการ ${data.projectName}` : 'Layout โครงการ')
        : doc.title;
      return renderFullPageImage(title, doc.filePath, 'cleaning', !isLayout);
    })
    .join('');

  // PV Layout page from SiteLayout (client data)
  // ถ้ามี siteLayoutPath → แสดงรูปจาก SiteLayout
  // ถ้าไม่มี siteLayoutPath แต่มี legacy STEP3_LAYOUT → ไม่ต้องแสดงหน้าว่าง (legacy จะแสดงแทน)
  // ถ้าไม่มีทั้งสองอย่าง → ไม่แสดงหน้า layout เลย
  const layoutTitle = data.projectName
    ? `Layout โครงการ ${data.projectName}`
    : 'Layout โครงการ';
  const siteLayoutPage = data.siteLayoutPath
    ? renderFullPageImage(layoutTitle, data.siteLayoutPath, 'cleaning', false)
    : '';

  const planPage = `
    <section class="page">
      ${renderHeader(logoDataUri, 'cleaning')}
      <div class="section-head">แผนการบำรุงรักษาเชิงป้องกัน โครงการ${escapeHtml(data.projectName ? ' ' + data.projectName : '.............................................')}</div>
      <div style="font-size:12pt; line-height:1.45; margin-bottom:3mm; font-weight:700; text-align:center;">
        รายละเอียด และแผนการดูแล ควบคุม ตรวจสอบ และบำรุงรักษาเชิงป้องกัน อุปกรณ์ต่างๆ<br/>(เบื้องต้น)
      </div>
      <table class="service-meta-grid" style="font-size:12pt;">
        <tr>
          <td style="width:50%;"><b>ลูกค้า</b></td>
          <td style="width:50%;"><b>โครงการ</b> ${escapeHtml(data.projectName || '..........................................')}</td>
        </tr>
        <tr>
          <td><b>ขนาดระบบ Solar Rooftop</b></td>
          <td>${escapeHtml(data.systemSizeKWp ? `${data.systemSizeKWp} kWp` : '-')}</td>
        </tr>
        <tr>
          <td><b>วันที่เข้าทำการบำรุงรักษาระบบ</b></td>
          <td>${escapeHtml(formatThaiDate(data.workDate))}</td>
        </tr>
      </table>
      <table class="clean-table">
        <thead>
          <tr>
            <th style="width:8%;">ลำดับ</th>
            <th style="width:42%;">อุปกรณ์/รายการ</th>
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
  const meta = data.meta ?? {};
  const detail = renderServiceDetailRows(meta, data.note);

  const checkbox = (label: string, value: boolean) => `
    <span class="checkbox-item"><span class="checkbox">${value ? '✓' : ''}</span>${escapeHtml(label)}</span>
  `;

  const projectType = pickMetaValue(meta, ['projectType', 'systemType']) || 'Solar Rooftop';
  const selectedWorkType = (detail.serviceType || '').toLowerCase();

  const workDateObj = data.workDate ?? new Date();
  const thaiDay = String(workDateObj.getDate());
  const thaiMonthNames = ['', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const thaiMonth = thaiMonthNames[workDateObj.getMonth() + 1] || '';
  const thaiYear = String(workDateObj.getFullYear() + 543);

  const formPage = `
    <section class="page">
      ${renderHeader(logoDataUri, 'service')}
      <div class="service-heading-en">PowerVault Service Center</div>
      <div class="service-heading-sub">SERVICE REPORT</div>

      <table class="service-meta-grid">
        <tr>
          <td style="width:50%;">
            <div><b>โครงการ</b> &nbsp; ${escapeHtml(data.projectName)}</div>
          </td>
          <td style="width:50%;">
            <div style="display:flex; gap:4mm;">
              <span><b>วันที่</b> ${escapeHtml(thaiDay)}</span>
              <span><b>เดือน</b> ${escapeHtml(thaiMonth)}</span>
              <span><b>ปี</b> ${escapeHtml(thaiYear)}</span>
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div><b>ลักษณะงานติดตั้ง</b></div>
            <div class="checkbox-row">
              ${checkbox('Solar Rooftop', projectType.toLowerCase().includes('roof') || projectType.toLowerCase().includes('rooftop') || (!projectType.toLowerCase().includes('farm') && !projectType.toLowerCase().includes('floating')))}
              ${checkbox('Solar Farm', projectType.toLowerCase().includes('farm'))}
              ${checkbox('Solar Floating', projectType.toLowerCase().includes('floating'))}
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div><b>ลักษณะงานบริการ</b></div>
            <div class="checkbox-row">
              ${checkbox('งานติดตั้ง', selectedWorkType.includes('ติดตั้ง') || selectedWorkType.includes('install'))}
              ${checkbox('งานเปิดระบบ', selectedWorkType.includes('เปิดระบบ') || selectedWorkType.includes('commission'))}
              ${checkbox('ตรวจสอบโครงการ', selectedWorkType.includes('inspect') || selectedWorkType.includes('ตรวจ'))}
              ${checkbox('การซ่อมบำรุง', selectedWorkType.includes('maintenance') || selectedWorkType.includes('บำรุง') || selectedWorkType.includes('ซ่อม') || selectedWorkType.includes('service'))}
              ${checkbox('งานเพิ่มเติม', selectedWorkType.includes('other') || selectedWorkType.includes('อื่น') || selectedWorkType.includes('เพิ่มเติม'))}
            </div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div style="display:flex; gap:6mm;">
              <span><b>ชื่อ-นามสกุล (ผู้เข้าตรวจสอบ)</b> &nbsp; ${escapeHtml(detail.technician || '-')}</span>
            </div>
            <div><b>ตำแหน่ง</b> &nbsp; ${escapeHtml(detail.position || 'Service Technician')}</div>
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

      <div style="margin-top:4mm; font-size:12pt;">
        <b>หมายเหตุ :</b> ${escapeHtml(detail.summary || data.note || '')}
      </div>

      <table class="signature-grid">
        <tr>
          <td style="width:50%;">
            <div><b>วันที่เริ่มเข้าดำเนินการ :</b> &nbsp; ${escapeHtml(detail.startDate || formatThaiDate(data.workDate))}</div>
            <div style="margin-top:2mm;"><b>ลงชื่อผู้ตรวจสอบ :</b></div>
            <div class="sign-line"><div class="sign-line-label">สถานภาพ / ตำแหน่ง :</div><div class="sign-line-value">${escapeHtml(detail.position || 'Service Technician')}</div></div>
            <div class="sign-line"><div class="sign-line-label">หน่วยงาน / สังกัด :</div><div class="sign-line-value">บริษัท พาวเวอร์วอลท์ (ประเทศไทย) จำกัด</div></div>
            <div class="sign-line"><div class="sign-line-label">ลายเซ็น :</div><div class="sign-line-value"></div></div>
          </td>
          <td style="width:50%;">
            <div><b>วันที่เสร็จสิ้นงาน :</b> &nbsp; ${escapeHtml(detail.endDate || formatThaiDate(data.workDate))}</div>
            <div style="margin-top:2mm;"><b>ลงชื่อผู้รับรอง :</b></div>
            <div class="sign-line"><div class="sign-line-label">สถานภาพ / ตำแหน่ง :</div><div class="sign-line-value">${escapeHtml(detail.customerPosition || '')}</div></div>
            <div class="sign-line"><div class="sign-line-label">หน่วยงาน / สังกัด :</div><div class="sign-line-value"></div></div>
            <div class="sign-line"><div class="sign-line-label">ลายเซ็น :</div><div class="sign-line-value"></div></div>
          </td>
        </tr>
      </table>
    </section>
  `;

  const serviceReportPages = (data.serviceReportImages ?? [])
    .map((img) => renderFullPageImage('', img.filePath, 'service', false))
    .join('');

  const evidencePages = renderImageGridSection('รูปภาพประกอบการปฏิบัติงาน', data.evidencePhotos ?? [], 4, 'photo-grid-2', 'service');

  const html = wrapHtml([serviceReportPages || formPage, evidencePages].join(''));
  await renderPdfToFile(html, absPath);
  return storeGeneratedReportFromLocalFile(absPath, { jobType: 'service', jobNo: data.jobNo });
}
