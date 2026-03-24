export function getReportCss(fontCss: string, fontFamily: string) {
  return `
    @page { size: A4; margin: 0; }
    ${fontCss}
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: ${fontFamily};
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
      font-size: 22pt;
      font-weight: 700;
      margin: 1mm 0 5mm;
      line-height: 1.25;
      text-align: center;
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
    .plan-title {
      font-size: 22pt;
      font-weight: 700;
      line-height: 1.1;
      text-align: center;
      margin: 0 0 4mm;
    }
    .plan-intro-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 2.2mm;
      table-layout: fixed;
      font-size: 10.9pt;
    }
    .plan-intro-table td {
      border: 1px solid #2d2d2d;
      padding: 1.15mm 1.9mm;
      vertical-align: middle;
      line-height: 1.12;
    }
    .plan-intro-header td {
      background: #8ea9db;
      font-weight: 700;
      text-align: center;
      font-size: 11.2pt;
      padding-top: 1.45mm;
      padding-bottom: 1.45mm;
    }
    .plan-label {
      width: 32%;
      font-weight: 700;
    }
    .plan-value {
      width: 68%;
    }
    .plan-check-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: 9.9pt;
      margin-top: 1.5mm;
    }
    .plan-check-table th,
    .plan-check-table td {
      border: 1px solid #2d2d2d;
      padding: 1mm 1.55mm;
      line-height: 1.18;
    }
    .plan-check-table th {
      background: #d0cece;
      color: #111;
      text-align: center;
      font-weight: 700;
      vertical-align: middle;
    }
    .plan-check-table tbody tr {
      page-break-inside: avoid;
    }
    .plan-no-col {
      width: 6.5%;
      text-align: center;
      font-weight: 700;
    }
    .plan-item-col { width: 50.5%; }
    .plan-action-col { width: 15.5%; }
    .plan-note-col { width: 27.5%; }
    .plan-group-row td {
      background: #dbe5f1;
      font-weight: 700;
      vertical-align: middle;
    }
    .plan-check-table .item-cell {
      vertical-align: top;
    }
    .plan-check-table .status {
      text-align: center;
      vertical-align: middle;
      font-weight: 700;
      font-size: 12pt;
    }
    .plan-check-table .note {
      vertical-align: middle;
    }
    .photo-title {
      text-align: center;
      font-size: 24pt;
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
  `;
}
