export interface PrintDocumentOptions {
  /**
   * G3b (§8) — set for a VOIDED document. A voided MC must never come off
   * the printer looking like a valid one: the page gets a diagonal VOID
   * watermark plus a banner naming who voided it and why. Printed, not
   * screen-only — `print-color-adjust: exact` keeps it on paper.
   */
  voided?: { at?: string | null; by?: string | null; reason?: string | null };
}

// D-040 — prints a plain-text clinical document (MC/Referral/Memo/custom)
// through the browser's print dialog. Monospace pre-wrap keeps the
// template's own line layout exactly as composed.
export function printTextDocument(title: string, content: string, options: PrintDocumentOptions = {}) {
  const printWindow = window.open('', '_blank', 'width=800,height=900');
  if (!printWindow) return;
  const escapeHtml = (text: string) =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const voided = options.voided;
  const banner = voided
    ? `<div class="void-banner">
         <strong>VOIDED — this document is no longer valid.</strong>
         <div>${escapeHtml(
           [voided.at ? `Voided ${voided.at}` : '', voided.by ? `by ${voided.by}` : '']
             .filter(Boolean)
             .join(' '),
         )}</div>
         ${voided.reason ? `<div>Reason: ${escapeHtml(voided.reason)}</div>` : ''}
       </div>`
    : '';
  const watermark = voided ? `<div class="void-watermark">VOID</div>` : '';

  printWindow.document.write(`<!doctype html>
<html>
<head>
<title>${escapeHtml(title)}${voided ? ' (VOIDED)' : ''}</title>
<style>
  @page { margin: 18mm; }
  body { font-family: 'Courier New', monospace; font-size: 13px; margin: 40px; position: relative; }
  pre { white-space: pre-wrap; word-wrap: break-word; margin: 0; font: inherit; }
  .void-banner {
    border: 2px solid #a8071a; color: #a8071a; padding: 8px 12px; margin-bottom: 20px;
    font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.5;
  }
  .void-watermark {
    position: fixed; top: 38%; left: 50%;
    transform: translate(-50%, -50%) rotate(-30deg);
    font-family: Arial, Helvetica, sans-serif; font-size: 150px; font-weight: 800;
    letter-spacing: 12px; color: rgba(168, 7, 26, 0.16);
    pointer-events: none; z-index: 1000;
  }
  @media print {
    body { margin: 0; }
    .void-watermark, .void-banner { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>${watermark}${banner}<pre>${escapeHtml(content)}</pre></body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}

export interface DrugLabelParams {
  clinicName: string;
  clinicAddress?: string | null;
  clinicPhone?: string | null;
  clinicEmail?: string | null;
  patientName: string;
  drugName: string;
  dose?: string;
  frequency?: string;
  durationDays?: number;
  indication?: string | null;
  quantity?: number;
}

// D-040 (owner requirement #10) — dispensary drug label: clinic
// name/address/tel/email, patient name, drug, dose, frequency, duration,
// indication. Sized for a small label printer.
export function printDrugLabel(params: DrugLabelParams) {
  const printWindow = window.open('', '_blank', 'width=380,height=420');
  if (!printWindow) return;
  const esc = (text: string | null | undefined) =>
    (text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const contact = [params.clinicPhone ? `Tel: ${params.clinicPhone}` : '', params.clinicEmail ?? '']
    .filter(Boolean)
    .join(' · ');
  printWindow.document.write(`<!doctype html>
<html>
<head>
<title>Label — ${esc(params.drugName)}</title>
<style>
  body { font-family: sans-serif; font-size: 11px; margin: 8px; width: 320px; }
  .clinic { text-align: center; border-bottom: 1px solid #000; padding-bottom: 4px; margin-bottom: 6px; }
  .clinic .name { font-weight: 700; font-size: 12px; }
  .patient { font-weight: 700; margin-bottom: 4px; }
  .drug { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .row { margin-bottom: 2px; }
  .date { margin-top: 6px; font-size: 10px; color: #444; }
</style>
</head>
<body>
  <div class="clinic">
    <div class="name">${esc(params.clinicName)}</div>
    <div>${esc(params.clinicAddress)}</div>
    <div>${esc(contact)}</div>
  </div>
  <div class="patient">${esc(params.patientName)}</div>
  <div class="drug">${esc(params.drugName)}${params.quantity ? ` × ${params.quantity}` : ''}</div>
  ${params.dose ? `<div class="row">Dose: ${esc(params.dose)}</div>` : ''}
  ${params.frequency ? `<div class="row">Frequency: ${esc(params.frequency)}</div>` : ''}
  ${params.durationDays ? `<div class="row">Duration: ${params.durationDays} day(s)</div>` : ''}
  ${params.indication ? `<div class="row">For: ${esc(params.indication)}</div>` : ''}
  <div class="date">${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
