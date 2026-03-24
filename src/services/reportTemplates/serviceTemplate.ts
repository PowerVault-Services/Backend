import { escapeHtml, formatThaiDate, pickMetaValue, pickMetaArray } from './utils';
import { renderHeader, renderStockTable } from './components';
import type { ServiceStockUsage } from './types';

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

export function renderFormPage(
  logoDataUri: string | null,
  data: {
    projectName: string;
    workDate?: Date | null;
    note?: string | null;
    meta?: any;
    stockUsage?: ServiceStockUsage;
  },
) {
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

  return `
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
}
