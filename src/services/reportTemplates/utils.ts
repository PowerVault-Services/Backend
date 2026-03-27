import fs from 'fs';
import path from 'path';
import { resolveFromProjectRoot } from '../../config/runtimePaths';

export function escapeHtml(s: any) {
  return String(s ?? '')
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;');
}

export function fileToDataUri(filePath: string): string | null {
  try {
    const ext = path.extname(filePath).toLowerCase().replace('.', '');
    const mime =
      ext === 'png' ? 'image/png' :
      (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
      ext === 'webp' ? 'image/webp' :
      ext === 'gif' ? 'image/gif' :
      ext === 'svg' ? 'image/svg+xml' :
      null;
    if (!mime) {
      console.warn(`[report] fileToDataUri: unsupported ext "${ext}" for ${filePath}`);
      return null;
    }
    if (!fs.existsSync(filePath)) {
      console.warn(`[report] fileToDataUri: file not found at ${filePath}`);
      return null;
    }
    const buf = fs.readFileSync(filePath);
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch (err) {
    console.warn(`[report] fileToDataUri: error reading ${filePath}:`, err);
    return null;
  }
}

function asFileUrl(p: string) {
  return 'file://' + p.replace(/\\/g, '/');
}

export function formatThaiDate(date?: Date | null) {
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

export function formatReportIssue(date?: Date | null) {
  const d = date ?? new Date();
  const beYear = d.getFullYear() + 543;
  const month = String(d.getMonth() + 1);
  return `ครั้งที่ ${month}/${beYear}`;
}

export function splitIntoChunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function getFontFaceCss() {
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
    {
      family: 'ReportThai',
      normal: '/usr/share/fonts/truetype/noto-sans-thai/NotoSansThai-Regular.ttf',
      bold: '/usr/share/fonts/truetype/noto-sans-thai/NotoSansThai-Bold.ttf',
    },
    {
      family: 'ReportThai',
      normal: '/usr/share/fonts/opentype/noto/NotoSansThai-Regular.ttf',
      bold: '/usr/share/fonts/opentype/noto/NotoSansThai-Bold.ttf',
    },
  ];

  for (const c of candidates) {
    if (fs.existsSync(c.normal) && fs.existsSync(c.bold)) {
      const normalB64 = fs.readFileSync(c.normal).toString('base64');
      const boldB64 = fs.readFileSync(c.bold).toString('base64');
      return {
        css: `
          @font-face {
            font-family: '${c.family}';
            src: url('data:font/truetype;base64,${normalB64}') format('truetype');
            font-weight: 400;
          }
          @font-face {
            font-family: '${c.family}';
            src: url('data:font/truetype;base64,${boldB64}') format('truetype');
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

export function getLogoDataUri() {
  const logoPath = resolveFromProjectRoot('assets', 'powervault-logo.png');
  return fs.existsSync(logoPath) ? fileToDataUri(logoPath) : null;
}

export function formatCheckStatus(raw: any): string {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (['done', 'pass', 'completed', 'yes', 'true', '1', 'ok', 'checked'].includes(s)) return '✓';
  if (['no', 'false', '0', 'pending', 'notyet', 'not_yet', 'not-started', 'not_started'].includes(s)) return '';
  return String(raw ?? '').trim();
}

export function normalizeChecklistKey(value: any): string {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s\-–—_/\.,:;()\[\]{}]+/g, '')
    .replace(/frame/g, 'frame');
}

export function pickMetaValue(meta: any, keys: string[]) {
  if (!meta || typeof meta !== 'object') return '';
  for (const key of keys) {
    const value = meta[key];
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

export function pickMetaArray(meta: any, keys: string[]) {
  if (!meta || typeof meta !== 'object') return [] as any[];
  for (const key of keys) {
    const value = meta[key];
    if (Array.isArray(value) && value.length) return value;
  }
  return [] as any[];
}
