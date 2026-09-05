import PDFDocument from 'pdfkit';
import type { PayslipData } from './payroll-payslip.service';

/**
 * THE PAYSLIP AS A PDF — rendered from the SAME composed dataset the screen
 * shows, so the printed document and the screen cannot disagree. Nothing here
 * calculates: every figure arrives frozen from the approved snapshot, and the
 * one derived value (the self-check) arrives pre-derived with an `adds` flag
 * this renderer only reports.
 *
 * Honesty rules carried onto paper:
 *  - a statutory figure that was not calculated prints as words, never 0.00;
 *  - "not applicable" (a fact about the employee) is distinct from "not
 *    calculated" (a fact about the system);
 *  - a superseded or reopened-since-approval revision says so in the header;
 *  - the snapshot hash and version print in the footer, so any copy can be
 *    traced to the exact approved record it came from.
 */

const RM = (cents: number) =>
  `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const GREY = '#444444';
const LIGHT = '#767676';
const RULE = '#1a1a1a';
const AMBER = '#8a5a00';
const RED = '#a8071a';

export function renderPayslipPdf(slip: PayslipData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // --- Header ---------------------------------------------------------------
  doc.font('Helvetica-Bold').fontSize(15).fillColor(RULE).text(slip.employer.name ?? 'Employer', left, doc.y);
  doc.font('Helvetica').fontSize(8.5).fillColor(GREY);
  if (slip.employer.registrationNo) doc.text(`Reg. ${slip.employer.registrationNo}`);
  for (const line of slip.employer.addressLines) doc.text(line);

  doc.font('Helvetica-Bold').fontSize(15).fillColor(RULE);
  doc.text('PAYSLIP', left, 48, { width, align: 'right' });
  doc.font('Helvetica').fontSize(10).fillColor(GREY);
  doc.text(slip.periodLabel, left, doc.y, { width, align: 'right' });
  if (slip.runType !== 'REGULAR') {
    doc.text(`${slip.runType.replace(/_/g, ' ')} run ${slip.sequence}`, left, doc.y, { width, align: 'right' });
  }

  doc.moveDown(0.6);
  doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1.4).strokeColor(RULE).stroke();
  doc.moveDown(0.5);

  // --- Warnings the reader must not miss -------------------------------------
  const warnings: string[] = [];
  if (slip.revision.superseded) {
    warnings.push(
      `SUPERSEDED — this is revision ${slip.revision.version} of ${slip.revision.of}. A later approved revision of this run exists.`,
    );
  }
  if (slip.revision.reopenedSinceApproval) {
    warnings.push(
      'This run has been reopened since this payslip was approved. A corrected revision may follow; this document remains the record of what was approved.',
    );
  }
  if (slip.statutoryStatus === 'PROVISIONAL') {
    warnings.push('The statutory schedules behind these figures had not met the approval bar when this run was approved.');
  }
  const uncalculated = slip.statutoryDeductions.filter((row) => row.applicable && row.amountCents === null).length;
  if (uncalculated > 0) {
    warnings.push(
      `${uncalculated} statutory deduction(s) were not calculated. They are shown as words rather than zero, and this payslip is not a complete statement of deductions.`,
    );
  }
  if (!slip.itemised) {
    warnings.push(
      'Issued from a format-2 approved record, which froze every figure but not the itemised earnings. The totals below are the approved figures; the earnings cannot be itemised.',
    );
  }
  for (const warning of warnings) {
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(RED).text(warning, { width });
    doc.moveDown(0.25);
  }
  if (warnings.length > 0) doc.moveDown(0.35);

  // --- Identity block ---------------------------------------------------------
  const identityTop = doc.y;
  const half = width / 2 - 10;
  const kv = (label: string, value: string | null | undefined, x: number, w: number) => {
    if (!value) return;
    const y = doc.y;
    doc.font('Helvetica').fontSize(8.5).fillColor(LIGHT).text(label.toUpperCase(), x, y, { width: 110 });
    doc.font('Helvetica').fontSize(9.5).fillColor(RULE).text(value, x + 115, y, { width: w - 115 });
  };
  kv('Employee', slip.employee.name, left, half);
  kv('Employee no.', slip.employee.employeeNo, left, half);
  kv('Position', slip.employee.position, left, half);
  kv('Paid to', slip.employee.bankName, left, half);
  const leftBottom = doc.y;
  doc.y = identityTop;
  kv('EPF no.', slip.employee.epfNumber, left + half + 20, half);
  kv('SOCSO no.', slip.employee.socsoNumber, left + half + 20, half);
  kv('Income tax no.', slip.employee.taxNumber, left + half + 20, half);
  if (slip.attendance?.workedDays !== null && slip.attendance?.workedDays !== undefined) {
    kv('Days worked', String(slip.attendance.workedDays), left + half + 20, half);
  }
  if (slip.attendance?.unpaidDays) kv('Unpaid days', String(slip.attendance.unpaidDays), left + half + 20, half);
  doc.y = Math.max(leftBottom, doc.y);
  doc.moveDown(0.7);

  // --- Table helpers ----------------------------------------------------------
  const section = (title: string) => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(RULE).text(title.toUpperCase(), left, doc.y, { width });
    doc.moveTo(left, doc.y + 1).lineTo(right, doc.y + 1).lineWidth(0.6).strokeColor('#999999').stroke();
    doc.moveDown(0.35);
  };
  const row = (label: string, value: string, opts: { bold?: boolean; colour?: string; note?: string | null } = {}) => {
    const y = doc.y;
    doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).fillColor(RULE);
    doc.text(label, left, y, { width: width - 130 });
    const labelBottom = doc.y;
    doc.fillColor(opts.colour ?? RULE).text(value, right - 160, y, { width: 160, align: 'right' });
    doc.y = Math.max(labelBottom, doc.y);
    if (opts.note) {
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(AMBER).text(opts.note, left + 14, doc.y, { width: width - 14 });
    }
    doc.moveDown(0.18);
  };
  const totalRule = () => {
    doc.moveTo(left, doc.y + 1).lineTo(right, doc.y + 1).lineWidth(0.9).strokeColor(RULE).stroke();
    doc.moveDown(0.25);
  };

  // --- Earnings ---------------------------------------------------------------
  section('Earnings');
  if (slip.itemised && slip.earnings) {
    for (const item of slip.earnings) {
      if (item.amountCents === 0) continue;
      row(item.label, RM(item.amountCents));
    }
    for (const reduction of slip.wageReductions ?? []) {
      if (reduction.amountCents === 0) continue;
      row(`${reduction.label} (wage reduction, s.18A)`, `-${RM(reduction.amountCents)}`, { colour: RED });
    }
  } else {
    row('Gross wages as approved (not itemised in this record format)', RM(slip.figures.grossCents));
  }
  totalRule();
  row('Gross wages', RM(slip.figures.grossCents), { bold: true });
  doc.moveDown(0.5);

  // --- Overtime working -------------------------------------------------------
  if (slip.overtimeDetail && slip.overtimeDetail.length > 0) {
    section('Overtime working');
    for (const tier of slip.overtimeDetail) {
      // A rest day or public holiday is priced in DAYS (s.60(3), s.60D), with
      // hourly pay only for the excess. "0 h @ RM33.00 … 200.00" is what this
      // line read before the days travelled with the row — a statement of
      // wages the person holding it could not multiply out.
      const days = tier.ordinaryRateDays ?? 0;
      const parts: string[] = [];
      if (days > 0) parts.push(`${days} day${days === 1 ? '' : 's'} at ordinary rate`);
      if (tier.hours > 0) parts.push(`${tier.hours} h @ RM${tier.hourlyRate.toFixed(2)}`);
      if (parts.length === 0) parts.push(`${tier.hours} h @ RM${tier.hourlyRate.toFixed(2)}`);
      row(`${tier.label} — ${parts.join(' + ')}`, RM(Math.round(tier.total * 100)));
    }
    doc.moveDown(0.5);
  }

  // --- Deductions -------------------------------------------------------------
  section('Deductions from pay');
  for (const item of slip.statutoryDeductions) {
    if (!item.applicable) {
      row(item.label, 'Not applicable', { colour: LIGHT });
      continue;
    }
    if (item.amountCents === null) {
      row(item.label, 'Not calculated', { colour: AMBER, note: item.note });
      continue;
    }
    if (item.amountCents === 0 && item.key === 'LINDUNG') continue;
    row(item.label, RM(item.amountCents), { note: item.key === 'PCB' ? item.note : null });
  }
  for (const other of slip.otherDeductionLines ?? []) {
    if (other.amountCents === 0) continue;
    row(other.label, RM(other.amountCents));
  }
  totalRule();
  row('Total deductions', RM(slip.figures.deductionCents), { bold: true });
  doc.moveDown(0.5);

  // --- Net pay ----------------------------------------------------------------
  section('Net pay');
  if (slip.figures.adds) {
    row('Net pay', `RM ${RM(slip.figures.netCents)}`, { bold: true });
  } else {
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(RED).text(
      `These figures do not add up: gross ${RM(slip.figures.grossCents)} less deductions ` +
        `${RM(slip.figures.deductionCents)} is ${RM(slip.figures.derivedNetCents)}, but the approved net is ` +
        `${RM(slip.figures.netCents)}. This payslip is not safe to issue.`,
      left,
      doc.y,
      { width },
    );
    doc.moveDown(0.3);
  }
  doc.moveDown(0.5);

  // --- Employer contributions -------------------------------------------------
  section('Employer contributions — not deducted from pay');
  for (const item of slip.employerContributions) {
    if (item.amountCents === null) {
      row(item.label, 'Not calculated', { colour: AMBER });
      continue;
    }
    row(item.label, RM(item.amountCents));
  }
  totalRule();
  row('Total cost to employer', RM(slip.figures.employerCostCents));
  doc.moveDown(0.5);

  // --- Year to date -----------------------------------------------------------
  if (slip.ytd) {
    section(`Year to date — ${slip.period.slice(0, 4)}`);
    row('Gross wages', RM(slip.ytd.grossCents));
    row('EPF (employee)', RM(slip.ytd.epfEmployeeCents));
    row('SOCSO (employee)', RM(slip.ytd.socsoEmployeeCents));
    row('EIS (employee)', RM(slip.ytd.eisEmployeeCents));
    row('PCB / MTD', RM(slip.ytd.pcbCents));
    if (slip.ytd.zakatCents > 0) row('Zakat', RM(slip.ytd.zakatCents));
    if (slip.ytd.importedMonths > 0) {
      doc.font('Helvetica-Oblique').fontSize(7.5).fillColor(LIGHT).text(
        `Includes ${slip.ytd.importedMonths} month(s) imported as opening balances at onboarding.`,
        left,
        doc.y,
        { width },
      );
    }
    doc.moveDown(0.5);
  }

  // --- Footer -----------------------------------------------------------------
  doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.6).strokeColor('#999999').stroke();
  doc.moveDown(0.35);
  doc.font('Helvetica').fontSize(7.5).fillColor(LIGHT);
  doc.text(
    `Approved ${new Date(slip.revision.approvedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` +
      (slip.revision.approvedBy.length > 0 ? ` by ${slip.revision.approvedBy.join(', ')}` : '') +
      `. Revision ${slip.revision.version} of ${slip.revision.of}.`,
    left,
    doc.y,
    { width },
  );
  doc.text(
    `Issued from approved payroll record ${slip.verification.hash.slice(0, 16)}… (format ${slip.verification.schemaVersion}), ` +
      `verification ${slip.verification.verdict}. Statutory schedules: ` +
      (slip.schedules
        .filter((schedule) => schedule.scheduleId)
        .map((schedule) => `${schedule.scheme} ${schedule.scheduleId}`)
        .join(' · ') || 'none recorded') +
      '.',
    { width },
  );
  doc.text('This is a computer-generated statement of wages. Employer address and membership numbers are as on file at issue.', {
    width,
  });

  doc.end();
  return done;
}
