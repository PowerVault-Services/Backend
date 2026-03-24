import { escapeHtml, formatReportIssue, formatThaiDate, formatCheckStatus, normalizeChecklistKey } from './utils';
import { renderHeader } from './components';

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
  const userItems = Array.isArray(checklist?.items) ? checklist.items : [];
  const childLookup = new Map<string, { status?: string; remark?: string }>();

  for (const group of userItems) {
    const children = Array.isArray(group?.children) ? group.children : [];
    for (const child of children) {
      if (child?.title) {
        childLookup.set(normalizeChecklistKey(child.title), {
          status: child.status,
          remark: child.remark,
        });
      }
    }

    if (group?.title && group?.status !== undefined && !Array.isArray(group?.children)) {
      childLookup.set(normalizeChecklistKey(group.title), {
        status: group.status,
        remark: group.remark,
      });
    }
  }

  return CLEANING_CHECKLIST_TEMPLATE.map((group, idx) => {
    const titleRow = `
      <tr class="plan-group-row">
        <td class="plan-no-col">${idx + 1}</td>
        <td><b>${escapeHtml(group.title)}</b></td>
        <td class="status"></td>
        <td class="note"></td>
      </tr>
    `;

    const childRows = group.children.map((child) => {
      const userData = childLookup.get(normalizeChecklistKey(child.title));
      return `
        <tr>
          <td class="plan-no-col"></td>
          <td class="item-cell">- ${escapeHtml(child.title)}</td>
          <td class="status">${escapeHtml(formatCheckStatus(userData?.status))}</td>
          <td class="note">${escapeHtml(userData?.remark ?? '')}</td>
        </tr>
      `;
    }).join('');

    return titleRow + childRows;
  }).join('');
}

export function renderCoverPage(logoDataUri: string | null, projectName: string, workDate?: Date | null) {
  return `
    <section class="page">
      ${renderHeader(logoDataUri, 'cleaning')}
      <div class="cover">
        <div class="cover-title">รายงานการบำรุงรักษาระบบเชิงป้องกัน</div>
        <div class="cover-issue">${escapeHtml(formatReportIssue(workDate))}</div>
        <div class="cover-project-line">โครงการ ${escapeHtml(projectName || '.....................................................')}</div>
        <div class="cover-spacer"></div>
        <div class="cover-by">โดย</div>
        <div class="cover-company">บริษัท พาวเวอร์วอลท์ เซอร์วิส จำกัด</div>
      </div>
    </section>
  `;
}

export function renderPlanPage(
  logoDataUri: string | null,
  data: {
    projectName: string;
    systemSizeKWp?: number | null;
    workDate?: Date | null;
    checklist?: any;
  },
) {
  return `
    <section class="page">
      ${renderHeader(logoDataUri, 'cleaning')}
      <div class="plan-title">แผนการบำรุงรักษาเชิงป้องกัน โครงการ${data.projectName ? ` ${escapeHtml(data.projectName)}` : '.............................................'}</div>

      <table class="plan-intro-table">
        <tr class="plan-intro-header">
          <td colspan="2">
            รายละเอียด และแผนการดูแล ควบคุม ตรวจสอบ และบำรุงรักษาเชิงป้องกัน อุปกรณ์ต่างๆ
            <br/>(เบื้องต้น)
          </td>
        </tr>
        <tr>
          <td class="plan-label">ลูกค้า</td>
          <td class="plan-value">
            <b>โครงการ</b> ${escapeHtml(data.projectName || '........................................................')}
          </td>
        </tr>
        <tr>
          <td class="plan-label">ขนาดระบบ Solar Rooftop</td>
          <td class="plan-value">
            <b>${escapeHtml(data.systemSizeKWp ? `${data.systemSizeKWp} kWp` : '-')}</b>
          </td>
        </tr>
        <tr>
          <td class="plan-label">วันที่เข้าทำการบำรุงรักษาระบบ</td>
          <td class="plan-value">
            <b>${escapeHtml(formatThaiDate(data.workDate))}</b>
          </td>
        </tr>
      </table>

      <table class="plan-check-table">
        <colgroup>
          <col class="plan-no-col" />
          <col class="plan-item-col" />
          <col class="plan-action-col" />
          <col class="plan-note-col" />
        </colgroup>
        <thead>
          <tr>
            <th>ลำดับ</th>
            <th>อุปกรณ์/รายการ</th>
            <th>การดำเนิน<br/>การ</th>
            <th>หมายเหตุ</th>
          </tr>
        </thead>
        <tbody>
          ${renderCleaningChecklistRows(data.checklist)}
        </tbody>
      </table>
    </section>
  `;
}
