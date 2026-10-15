import PDFDocument from 'pdfkit';
import type { PayslipData } from './payroll-payslip.service';

/**
 * THE PAYSLIP AS A PDF — payslip.html on A4.
 *
 * Rendered from the SAME composed dataset the screen shows, so the printed
 * document and the screen cannot disagree. Nothing here calculates: every
 * figure arrives frozen from the approved snapshot, and the one derived value
 * (the self-check) arrives pre-derived with an `adds` flag this renderer only
 * reports.
 *
 * WHAT THE DESIGN SAYS, AND THIS KEEPS:
 *  - the employer's block with its registration and statutory numbers, the
 *    title, the period, and a Paid / Approved tag;
 *  - eight facts about the employee, the identity number among them;
 *  - earnings and deductions side by side, WITHOUT percentages or workings —
 *    only unpaid leave says how many days;
 *  - the employer's contributions ABOVE the net, never mixed into deductions;
 *  - the net pay in figures and in words, the account it was paid to, and a
 *    small Date | Amount table when the month is paid on more than one date;
 *  - no year to date: the clinic does not want it on the payslip;
 *  - Prepared by / Approved by, as typed names — no signature image is on
 *    record.
 *
 * UAT, 12 October 2026: the full employee name always prints (wrapping to a
 * second line), the title reads "Payslip — January 2026" with the period
 * under it, and the employer's uploaded logo replaces the initial letter.
 * Layout only: every figure is the one the approved record froze.
 *
 * Honesty rules carried onto paper, which the design does not draw because
 * they only appear when something is wrong:
 *  - a statutory figure that was not calculated prints as words, never 0.00;
 *  - a superseded or reopened-since-approval revision says so under the
 *    header;
 *  - the footer names the approved record the slip came from, so any copy
 *    can be traced to it.
 */

// A plain hyphen for minus: the built-in Helvetica has no U+2212 and printed it as '"'.
const RM = (cents: number) =>
  `${cents < 0 ? '-' : ''}${(Math.abs(cents) / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

const INK = '#0f1a1e';
const INK2 = '#4b5a63';
const INK3 = '#8b979f';
const LINE = '#d9dee2';
const SLATE = '#16302b';
const TEAL = '#0f8f7a';
const TEAL_SOFT = '#e0f4ef';
const SOFT = '#f4f6f7';
const RED = '#c2362e';
const AMBER = '#b7791f';

const dateOf = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kuala_Lumpur' })
    : null;

/** "Dr Aisyah Rahman" → "A. Rahman": the typed signature the design draws. */
export function typedSignature(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .filter((word, index) => !(index === 0 && /^(dr|mr|mrs|ms|miss|puan|encik|cik|tuan|dato'?|datuk|datin|prof|hj|hjh)\.?$/i.test(word)));
  if (words.length <= 1) return words[0] ?? name;
  return `${words[0][0].toUpperCase()}. ${words[words.length - 1]}`;
}

/** The employer's initials for the logo square: "Contoh Wellness Sdn Bhd" → "CW". */
export function employerInitials(name: string | null): string {
  const words = (name ?? '')
    .split(/\s+/)
    .filter((word) => word && !/^(sdn|bhd|berhad|plt|llp|the|of|&)$/i.test(word));
  const letters = words.slice(0, 2).map((word) => word[0].toUpperCase()).join('');
  return letters || 'KW';
}

type EarningRow = { label: string; amountCents: number; note?: string | null; negative?: boolean; words?: string | null; tone?: string };

export function renderPayslipPdf(slip: PayslipData, logo: Buffer | null = null): Promise<Buffer> {
  return renderPayslipsPdf([slip], logo, `Payslip ${slip.periodLabel} — ${slip.employee.name}`);
}

/**
 * SEVERAL PAYSLIPS IN ONE PDF, one page each (UAT, 14 October 2026: "Download
 * all as one combined PDF"). Each page is drawn exactly as the single payslip.
 */
export function renderPayslipsPdf(slips: PayslipData[], logo: Buffer | null = null, title?: string): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 36,
    bufferPages: true,
    autoFirstPage: false,
    info: { Title: title ?? `Payslips ${slips[0]?.periodLabel ?? ''}` },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  if (slips.length === 0) doc.addPage();
  for (const slip of slips) {
    doc.addPage();
    drawPayslip(doc, slip, logo);
  }
  doc.end();
  return done;
}

/**
 * THE PART THEY WORKED (new-clinic UAT, 15 October 2026): a 15 October
 * joiner's payslip reads "15 – 31 Oct 2026 · 17 of 31 days", not the whole month.
 */
export function periodRange(slip: Pick<PayslipData, 'period'> & { employee: Pick<PayslipData['employee'], 'startedInPeriod' | 'leftInPeriod'> }): string {
  const start = new Date(`${slip.period}-01T00:00:00.000Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const days = end.getUTCDate();
  const from = slip.employee.startedInPeriod ? Number(slip.employee.startedInPeriod.slice(8, 10)) : 1;
  const to = slip.employee.leftInPeriod ? Number(slip.employee.leftInPeriod.slice(8, 10)) : days;
  const part = from !== 1 || to !== days ? ` · ${to - from + 1} of ${days} days` : '';
  return `${from} – ${to} ${end.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' })}${part}`;
}

function drawPayslip(doc: PDFKit.PDFDocument, slip: PayslipData, logo: Buffer | null) {

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;
  const bottom = doc.page.height - doc.page.margins.bottom;

  const range = periodRange(slip);

  // --- Header -----------------------------------------------------------------
  let y = doc.page.margins.top;
  let drewLogo = false;
  if (logo) {
    try {
      doc.image(logo, left, y, { fit: [42, 42], align: 'center', valign: 'center' });
      drewLogo = true;
    } catch {
      // An image the renderer cannot read falls back to the initial below.
    }
  }
  if (!drewLogo) {
    doc.save().roundedRect(left, y, 42, 42, 9).fill(SLATE).restore();
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff').text(employerInitials(slip.employer.name).slice(0, 1), left, y + 12, { width: 42, align: 'center' });
  }

  const titleW = 230;
  const coX = left + 42 + 12;
  const coWidth = width - 42 - 12 - titleW - 10;
  doc.font('Helvetica-Bold').fontSize(13.5).fillColor(INK).text(slip.employer.name ?? 'Employer', coX, y + 1, { width: coWidth });
  doc.font('Helvetica').fontSize(9).fillColor(INK2);
  const registration = [slip.employer.registrationNo ? `(${slip.employer.registrationNo})` : null, slip.employer.addressLines.join(', ') || null]
    .filter(Boolean)
    .join(' · ');
  if (registration) doc.text(registration, coX, doc.y + 1, { width: coWidth });
  const numbers = [
    slip.employer.epfEmployerNo ? `EPF ${slip.employer.epfEmployerNo}` : null,
    slip.employer.socsoEmployerNo ? `SOCSO ${slip.employer.socsoEmployerNo}` : null,
    slip.employer.lhdnEmployerNo ? `LHDN ${slip.employer.lhdnEmployerNo}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  if (numbers) doc.text(numbers, coX, doc.y + 1, { width: coWidth });
  const coBottom = doc.y;

  const titleX = right - titleW;
  doc.font('Helvetica-Bold').fontSize(17).fillColor(SLATE).text(`Payslip — ${slip.periodLabel}`, titleX, y, { width: titleW, align: 'right' });
  doc.font('Helvetica').fontSize(8.5).fillColor(INK2).text(range, titleX, doc.y + 1, { width: titleW, align: 'right' });
  const tag = slip.draft ? 'DRAFT · not approved' : slip.paidAt ? `Paid ${dateOf(slip.paidAt)}` : `Approved ${dateOf(slip.revision.approvedAt)}`;
  doc.font('Helvetica-Bold').fontSize(8);
  const tagWidth = doc.widthOfString(tag) + 14;
  const tagY = doc.y + 5;
  doc.save().roundedRect(right - tagWidth, tagY, tagWidth, 15, 4).fill(slip.draft ? '#fbe9e7' : TEAL_SOFT).restore();
  doc.fillColor(slip.draft ? RED : TEAL).text(tag, right - tagWidth, tagY + 3.5, { width: tagWidth, align: 'center' });
  y = Math.max(coBottom, tagY + 15) + 13;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1.5).strokeColor(SLATE).stroke();
  y += 12;

  // --- Warnings the reader must not miss ----------------------------------------
  const warnings: string[] = [];
  if (slip.revision.superseded) {
    warnings.push(`SUPERSEDED — this is revision ${slip.revision.version} of ${slip.revision.of}. A later approved revision of this run exists.`);
  }
  if (slip.revision.reopenedSinceApproval) {
    warnings.push('This run has been reopened since this payslip was approved. A corrected revision may follow; this document remains the record of what was approved.');
  }
  if (slip.statutoryStatus === 'PROVISIONAL') {
    warnings.push('The statutory schedules behind these figures had not met the approval bar when this run was approved.');
  }
  const uncalculated = slip.statutoryDeductions.filter((row) => row.applicable && row.amountCents === null).length;
  if (uncalculated > 0) {
    warnings.push(`${uncalculated} statutory deduction(s) were not calculated. They are shown as words rather than zero, and this payslip is not a complete statement of deductions.`);
  }
  if (!slip.itemised) {
    warnings.push('Issued from a format-2 approved record, which froze every figure but not the itemised earnings. The totals below are the approved figures; the earnings cannot be itemised.');
  }
  if (!slip.figures.adds) {
    warnings.push(
      `These figures do not add up: gross ${RM(slip.figures.grossCents)} less deductions ${RM(slip.figures.deductionCents)} is ` +
        `${RM(slip.figures.derivedNetCents)}, but the approved net is ${RM(slip.figures.netCents)}. This payslip is not safe to issue.`,
    );
  }
  for (const warning of warnings) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(RED).text(warning, left, y, { width });
    y = doc.y + 3;
  }
  if (warnings.length > 0) y += 4;

  // --- Eight facts ----------------------------------------------------------------
  const facts: [string, string | null][] = [
    ['Employee', slip.employee.name],
    ['Employee no.', slip.employee.employeeNo],
    ['Position', slip.employee.position],
    ['Branch', slip.clinicName],
    [slip.employee.identifier?.type === 'PASSPORT' ? 'Passport' : 'NRIC', slip.employee.identifier?.value ?? null],
    ['EPF no.', slip.employee.epfNumber],
    ['SOCSO no.', slip.employee.socsoNumber],
    ['Tax no.', slip.employee.taxNumber],
  ];
  const cellW = width / 4;
  // A ROW AS TALL AS ITS LONGEST VALUE: the full name always prints, wrapping
  // to a second line rather than being cut off ("DR MUHAMMAD…").
  doc.font('Helvetica').fontSize(9.5);
  const rowHeights = [0, 1].map((row) =>
    Math.max(34, ...facts.slice(row * 4, row * 4 + 4).map(([, value]) => 7 + 11 + doc.heightOfString(value ?? '—', { width: cellW - 18 }) + 6)),
  );
  const factsH = rowHeights[0] + rowHeights[1];
  doc.save().roundedRect(left, y, width, factsH, 6).lineWidth(0.8).strokeColor(LINE).stroke().restore();
  doc.moveTo(left, y + rowHeights[0]).lineTo(right, y + rowHeights[0]).lineWidth(0.8).strokeColor(LINE).stroke();
  for (let i = 1; i < 4; i += 1) {
    doc.moveTo(left + cellW * i, y).lineTo(left + cellW * i, y + factsH).lineWidth(0.8).strokeColor(LINE).stroke();
  }
  facts.forEach(([label, value], index) => {
    const x = left + cellW * (index % 4) + 9;
    const top = y + (index < 4 ? 0 : rowHeights[0]) + 7;
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK3).text(label.toUpperCase(), x, top, { width: cellW - 18, characterSpacing: 0.5 });
    doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(value ?? '—', x, top + 11, { width: cellW - 18 });
  });
  y += factsH + 15;

  // --- Earnings and deductions, side by side -----------------------------------------
  const earnings: EarningRow[] = [];
  // The dates each amount goes out on are in the table under the net pay, not
  // on each line; an earned-in month stays in the line's own label.
  const manyDates = (slip.payments?.length ?? 0) > 1;
  if (slip.itemised && slip.earnings) {
    // One line per kind of extra day — Overtime, Public holiday pay, Rest day
    // pay — rather than one per day the engine priced.
    const grouped = new Map<string, EarningRow>();
    for (const item of slip.earnings) {
      if (item.amountCents === 0) continue;
      if (item.code === 'OVERTIME') {
        const label = item.label === 'Overtime and day-rate work' ? 'Overtime' : item.label;
        const entry = grouped.get(label);
        if (entry) entry.amountCents += item.amountCents;
        else {
          const row = { label, amountCents: item.amountCents };
          grouped.set(label, row);
          earnings.push(row);
        }
        continue;
      }
      earnings.push({ label: item.label, amountCents: item.amountCents });
    }
    for (const reduction of slip.wageReductions ?? []) {
      if (reduction.amountCents === 0) continue;
      const days = reduction.code === 'UNPAID_LEAVE' ? slip.attendance?.unpaidDays : null;
      earnings.push({
        label: reduction.label,
        amountCents: reduction.amountCents,
        negative: true,
        note: days ? `${days} day${days === 1 ? '' : 's'}` : null,
      });
    }
  } else {
    earnings.push({ label: 'Gross wages as approved (not itemised in this record)', amountCents: slip.figures.grossCents });
  }

  const STATUTORY_LABEL: Record<string, string> = { EPF: 'EPF', SOCSO: 'SOCSO', EIS: 'EIS', PCB: 'PCB / MTD', LINDUNG: 'LINDUNG 24 JAM' };
  const deductions: EarningRow[] = [];
  for (const item of slip.statutoryDeductions) {
    if (!item.applicable) continue;
    if (item.amountCents === null) {
      deductions.push({ label: STATUTORY_LABEL[item.key] ?? item.label, amountCents: 0, words: 'Not calculated', tone: AMBER });
      continue;
    }
    if (item.amountCents === 0 && item.key === 'LINDUNG') continue;
    deductions.push({ label: STATUTORY_LABEL[item.key] ?? item.label, amountCents: item.amountCents });
  }
  for (const other of slip.otherDeductionLines ?? []) {
    if (other.amountCents === 0) continue;
    deductions.push({ label: other.label, amountCents: other.amountCents });
  }

  const gap = 15;
  const colW = (width - gap) / 2;
  const headH = 22;
  const rowH = 20;
  const rows = Math.max(earnings.length, deductions.length, 1) + 1; // + one empty row, as the design draws
  const column = (x: number, title: string, items: EarningRow[], totalLabel: string, totalCents: number) => {
    // Header box.
    doc.save().roundedRect(x, y, colW, headH, 6).fill(SOFT).restore();
    doc.rect(x, y + 6, colW, headH - 6).fill(SOFT);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK2).text(title, x + 8, y + 6.5, { width: colW - 16 });
    doc.text('RM', x + 8, y + 6.5, { width: colW - 16, align: 'right' });
    // Body rows.
    let top = y + headH;
    for (let i = 0; i < rows; i += 1) {
      const item = items[i];
      doc.moveTo(x, top).lineTo(x + colW, top).lineWidth(0.6).strokeColor(LINE).stroke();
      if (item) {
        doc.font('Helvetica').fontSize(9.5).fillColor(INK).text(item.label, x + 8, top + 5.5, { width: colW - 100, lineBreak: false });
        if (item.note) {
          const labelW = doc.widthOfString(item.label);
          doc.font('Helvetica').fontSize(8).fillColor(INK3).text(item.note, x + 8 + labelW + 5, top + 6.5, { lineBreak: false });
        }
        if (item.words) {
          doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(item.tone ?? AMBER).text(item.words, x + colW - 108, top + 6, { width: 100, align: 'right' });
        } else {
          doc.font('Helvetica').fontSize(9.5).fillColor(item.negative ? RED : INK).text(`${item.negative ? '-' : ''}${RM(item.amountCents)}`, x + colW - 108, top + 5.5, { width: 100, align: 'right' });
        }
      }
      top += rowH;
    }
    // Total row.
    doc.rect(x, top, colW, headH).fill(SOFT);
    doc.moveTo(x, top).lineTo(x + colW, top).lineWidth(0.6).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(totalLabel, x + 8, top + 6, { width: colW - 16 });
    doc.text(RM(totalCents), x + colW - 108, top + 6, { width: 100, align: 'right' });
    top += headH;
    // Outline.
    doc.save().roundedRect(x, y, colW, top - y, 6).lineWidth(0.8).strokeColor(LINE).stroke().restore();
    return top;
  };
  const leftBottom = column(left, 'Earnings', earnings, 'Total earnings', slip.figures.grossCents);
  const rightBottom = column(left + colW + gap, 'Deductions', deductions, 'Total deductions', slip.figures.deductionCents);
  y = Math.max(leftBottom, rightBottom) + 15;

  // --- Employer contributions, above the net ----------------------------------------
  const contributions: [string, string][] = [
    ['Employer EPF', money(slip.employerContributions.find((row) => row.key === 'EPF')?.amountCents)],
    ['Employer SOCSO', money(slip.employerContributions.find((row) => row.key === 'SOCSO')?.amountCents)],
    ['Employer EIS', money(slip.employerContributions.find((row) => row.key === 'EIS')?.amountCents)],
    ['HRD levy', slip.hrdLevyCents ? money(slip.hrdLevyCents) : '—'],
  ];
  const stripH = 36;
  doc.save().roundedRect(left, y, width, stripH, 6).lineWidth(0.8).strokeColor(LINE).stroke().restore();
  contributions.forEach(([label, value], index) => {
    const x = left + cellW * index;
    if (index > 0) doc.moveTo(x, y).lineTo(x, y + stripH).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK3).text(label.toUpperCase(), x + 9, y + 7, { width: cellW - 18, characterSpacing: 0.5 });
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(value, x + 9, y + 18, { width: cellW - 18 });
  });
  y += stripH + 11;

  // --- Net pay ------------------------------------------------------------------------
  const netH = 54;
  doc.save().roundedRect(left, y, width, netH, 8).lineWidth(1.1).strokeColor(SLATE).stroke().restore();
  doc.font('Helvetica').fontSize(9).fillColor(INK2).text('Net pay', left + 13, y + 10, { width: 200 });
  doc.font('Helvetica-Bold').fontSize(21).fillColor(SLATE).text(`RM ${RM(slip.figures.netCents)}`, left + 13, y + 22, { width: 240, characterSpacing: -0.3 });
  doc.font('Helvetica').fontSize(8).fillColor(INK2).text(slip.netInWords ?? '', right - 13 - 240, y + 12, { width: 240, align: 'right' });
  y += netH + 8;

  // --- Where it was paid, when, and the year so far ------------------------------------
  const halfW = (width - gap) / 2;
  const account = slip.employee.bankName || slip.employee.bankAccountLastFour
    ? `${slip.employee.bankName ?? 'Bank account'}${slip.employee.bankAccountLastFour ? ` ·· ${slip.employee.bankAccountLastFour}` : ''}`
    : 'Cash';
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(INK2).text('Paid to: ', left, y, { continued: true });
  doc.font('Helvetica').fillColor(INK).text(account, { width: halfW });
  let leftY = doc.y + 6;
  if (manyDates) {
    // THE MONTH IN ITS TRANSFERS: the day each went, or the day it is due.
    const rowH2 = 15;
    const dateW = halfW * 0.55;
    doc.rect(left, leftY, halfW, rowH2).fill(SOFT);
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK3).text('DATE', left + 8, leftY + 4, { width: dateW - 8, characterSpacing: 0.5 });
    doc.text('AMOUNT (RM)', left + dateW, leftY + 4, { width: halfW - dateW - 8, align: 'right', characterSpacing: 0.5 });
    let rowY = leftY + rowH2;
    for (const payment of slip.payments ?? []) {
      doc.moveTo(left, rowY).lineTo(left + halfW, rowY).lineWidth(0.6).strokeColor(LINE).stroke();
      doc.font('Helvetica').fontSize(8.5).fillColor(INK).text(dateOf(payment.paidOn ?? payment.date) ?? '—', left + 8, rowY + 4, { width: dateW - 8 });
      doc.text(RM(payment.amountCents), left + dateW, rowY + 4, { width: halfW - dateW - 8, align: 'right' });
      rowY += rowH2;
    }
    doc.save().roundedRect(left, leftY, halfW, rowY - leftY, 4).lineWidth(0.8).strokeColor(LINE).stroke().restore();
    leftY = rowY;
  }

  // No year-to-date box: the clinic does not want one on the payslip (12 October 2026).
  y = leftY + 18;

  // --- Prepared by / Approved by -----------------------------------------------------
  const sigW = (width - 30) / 2;
  const signature = (x: number, label: string, who: { name: string; position: string | null; at: string } | null | undefined) => {
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK3).text(label.toUpperCase(), x, y, { width: sigW, characterSpacing: 0.5 });
    const boxTop = y + 14;
    const boxBottom = boxTop + 48;
    doc.moveTo(x, boxBottom).lineTo(x + sigW, boxBottom).lineWidth(0.8).strokeColor(INK).stroke();
    if (who) {
      doc.font('Helvetica-Oblique').fontSize(15).fillColor('#6b7a83').text(typedSignature(who.name), x + 6, boxBottom - 20, { width: sigW - 12, lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK).text(who.name, x, boxBottom + 6, { width: sigW });
      doc.font('Helvetica').fontSize(8.5).fillColor(INK2).text([who.position, dateOf(who.at)].filter(Boolean).join(' · '), x, doc.y + 1, { width: sigW });
    } else {
      doc.font('Helvetica').fontSize(8.5).fillColor(INK3).text('Not on record', x, boxBottom + 6, { width: sigW });
    }
  };
  signature(left, 'Prepared by', slip.preparedBy);
  signature(left + sigW + 30, 'Approved by', slip.approvedBy);

  // --- DRAFT watermark: a month not yet approved -------------------------------------
  if (slip.draft) {
    doc.save();
    doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
    doc.font('Helvetica-Bold').fontSize(120).fillColor(RED).fillOpacity(0.09);
    doc.text('DRAFT', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
    doc.restore();
    doc.fillOpacity(1);
  }

  // --- Footer -------------------------------------------------------------------------
  const footY = bottom - 26;
  doc.moveTo(left, footY).lineTo(right, footY).lineWidth(0.6).strokeColor(LINE).stroke();
  doc.font('Helvetica').fontSize(7.5).fillColor(INK3);
  doc.text(`${slip.employer.name ?? 'Employer'} · Private and confidential`, left, footY + 6, { width: width / 2, lineBreak: false });
  doc.text(`Generated by Kuwick · Run #${slip.period}${slip.runType !== 'REGULAR' ? ` ${slip.runType.replace(/_/g, ' ').toLowerCase()} ${slip.sequence}` : ''} · Page 1 of 1`, left + width / 2, footY + 6, {
    width: width / 2,
    align: 'right',
    lineBreak: false,
  });
  doc.fontSize(6.5).text(
    slip.draft
      ? 'DRAFT · not approved · the figures may still change · employer details as on file today · membership numbers as on file at issue'
      : `Revision ${slip.revision.version} of ${slip.revision.of} · approved record ${slip.verification.hash.slice(0, 16)}… · verification ${slip.verification.verdict} · employer details as at approval · membership numbers as on file at issue`,
    left,
    footY + 16,
    { width, lineBreak: false },
  );

}

function money(cents: number | null | undefined): string {
  return cents === null || cents === undefined ? 'Not calculated' : `RM ${RM(cents)}`;
}
