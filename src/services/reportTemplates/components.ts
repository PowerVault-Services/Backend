import { escapeHtml, fileToDataUri, getLogoDataUri, splitIntoChunks } from './utils';
import type { EvidenceImage, ServiceStockUsage } from './types';

export function renderHeader(logoDataUri: string | null, variant: 'service' | 'cleaning' = 'cleaning') {
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

export function renderImageGridSection(title: string, images: EvidenceImage[], perPage: number, gridClass = 'photo-grid-2', headerVariant: 'service' | 'cleaning' = 'cleaning') {
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
              </div>
            `;
          }).join('')}
        </div>
      </section>
    `)
    .join('');
}

export function renderFullPageImage(title: string, filePath: string, headerVariant: 'service' | 'cleaning' = 'cleaning', lineFill = true) {
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

export function renderStockTable(stockUsage?: ServiceStockUsage) {
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
