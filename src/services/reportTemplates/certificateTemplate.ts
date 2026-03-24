import { escapeHtml } from './utils';
import { renderHeader } from './components';
import type { CertificateApproval, CertificateItem, CertificateSignature } from './types';

export function renderCertificatePage(
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
