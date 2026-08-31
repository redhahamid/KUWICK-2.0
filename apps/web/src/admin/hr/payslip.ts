import type { PayrollRunDetail, PayslipEmployeeSnapshot } from '../types';

/**
 * THE PAYSLIP.
 *
 * A written statement of wages is a statutory record under the Employment Act
 * 1955 s.19, not a report. That single fact decides everything about how this
 * renders, because the failure mode is not an ugly document — it is a document
 * that LOOKS official and is not.
 *
 * Four honesty rules, each of which the payroll module has already established
 * elsewhere and which the printed page must not quietly undo:
 *
 *  1. **A run that is not APPROVED or PAID prints as a DRAFT**, with a
 *     watermark on the paper and a banner naming the status. A payslip handed
 *     to somebody from a run nobody has approved is a promise the clinic has
 *     not made.
 *  2. **PROVISIONAL statutory rates say so on the slip.** The seeded Malaysian
 *     tables are `CORROBORATED` — taken from the clinic's own workbook and
 *     checked against no authority. An employee is entitled to know that the
 *     EPF line on their payslip has not been verified against the Third
 *     Schedule.
 *  3. **A statutory figure that was not calculated prints as "not calculated",
 *     with the reason, and NEVER as 0.00.** Zero is a statement that nothing is
 *     owed. Blank is a statement that nobody worked it out. On a statutory
 *     document those are different, and printing the first when the second is
 *     true is a false statement.
 *  4. **PCB entered by hand says it was entered by hand.** Kuwick does not
 *     calculate monthly tax deduction; a figure it merely stored must not read
 *     as one it computed.
 *
 * And one arithmetic rule: **the slip checks itself.** Gross minus the
 * deductions actually printed must equal the net actually printed. If they
 * disagree the page says so in place of a total, because a payslip that does
 * not add up is worse than no payslip — somebody will pay it.
 *
 * Rendering is a pure function returning HTML. Printing opens it in a window
 * and calls `print()`, the same route as every other document Kuwick prints
 * (`clinical/printTextDocument.ts`) — the browser's own "Save as PDF" is how a
 * PDF is produced, so there is no server-side renderer to keep alive and no
 * headless browser in production.
 */

export type PayslipLine = PayrollRunDetail['lines'][number];

export interface PayslipContext {
  /** The employer's registered name. Whatever the clinic recorded, never invented. */
  employerName: string;
  branchName?: string | null;
  /** Who pressed print, and when. A payslip is reprinted; the copies differ. */
  printedBy?: string | null;
  printedAt?: Date;
}

/** A statutory line, resolved into what should actually appear on paper. */
export interface StatutoryDisplay {
  label: string;
  /** NULL where nothing was calculated — rendered as text, never as zero. */
  amount: number | null;
  note: string | null;
  /** FALSE where the employee is not in this scheme at all. */
  applicable: boolean;
}

interface Breakdown {
  statutoryNotes?: { epf?: string | null; socso?: string | null; eis?: string | null; pcb?: string | null };
  bases?: { epf?: number; socso?: number; eis?: number };
  ordinaryRateOfPay?: { overtimeDays?: number; unpaidLeaveDays?: number; hoursPerDay?: number };
  overtimeTiers?: { label: string; hours: number; hourlyRate: number; total: number }[];
}

const money = (value: number) =>
  value.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A run is only real once somebody with the right to approve it has. */
export function isDraftRun(status: string): boolean {
  return status !== 'APPROVED' && status !== 'PAID';
}

/**
 * The employee's statutory deductions, each resolved to amount-or-reason.
 *
 * An employee outside a scheme (`applicable: false`) is a different case from
 * one whose scheme was not calculated, and the payslip distinguishes them:
 * "not applicable" is a fact about the employee, "not calculated" is a fact
 * about the system.
 */
export function employeeStatutory(line: PayslipLine): StatutoryDisplay[] {
  const breakdown = (line.breakdown ?? {}) as Breakdown;
  const notes = breakdown.statutoryNotes ?? {};
  const applicability = (line.snapshot ?? {}).statutoryApplicability ?? {};
  return [
    { label: 'EPF (employee)', amount: line.epfEmployee, note: notes.epf ?? null, applicable: applicability.epf !== false },
    { label: 'SOCSO (employee)', amount: line.socsoEmployee, note: notes.socso ?? null, applicable: applicability.socso !== false },
    { label: 'EIS (employee)', amount: line.eisEmployee, note: notes.eis ?? null, applicable: applicability.eis !== false },
    { label: 'PCB / MTD', amount: line.pcb, note: notes.pcb ?? null, applicable: applicability.pcb !== false },
  ];
}

export interface PayslipTotals {
  grossPay: number;
  /** Only what is actually printed as a deduction. */
  deductions: number;
  netPay: number;
  /** The net the slip WOULD show from its own figures. */
  derivedNet: number;
  /**
   * TRUE when the stored net and the printed arithmetic agree. FALSE puts a
   * refusal on the page instead of a total.
   */
  adds: boolean;
  /** Statutory lines with no figure. The slip cannot claim to be complete. */
  uncalculated: number;
}

export function payslipTotals(line: PayslipLine): PayslipTotals {
  const statutory = employeeStatutory(line);
  const statutoryTotal = statutory.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  const deductions =
    Math.round((statutoryTotal + line.unpaidLeaveDeduction + line.otherDeductions) * 100) / 100;
  const derivedNet = Math.round((line.grossPay - deductions) * 100) / 100;
  return {
    grossPay: line.grossPay,
    deductions,
    netPay: line.netPay,
    derivedNet,
    // A cent of tolerance: the engine works in cents and the display rounds.
    adds: Math.abs(derivedNet - line.netPay) < 0.005,
    uncalculated: statutory.filter((item) => item.applicable && item.amount === null).length,
  };
}

export function renderPayslipHtml(
  run: PayrollRunDetail,
  line: PayslipLine,
  context: PayslipContext,
): string {
  const snapshot: PayslipEmployeeSnapshot = line.snapshot ?? {};
  const draft = isDraftRun(run.status);
  const totals = payslipTotals(line);
  const statutory = employeeStatutory(line);
  const printedAt = context.printedAt ?? new Date();

  const row = (label: string, value: string, strong = false) =>
    `<tr><th>${escapeHtml(label)}</th><td class="num${strong ? ' strong' : ''}">${value}</td></tr>`;

  const earnings = [
    ['Basic salary', line.basicSalary],
    ['Allowances', line.allowances],
    ['Overtime', line.overtimePay],
    ['Incentives', line.incentives],
    ['Bonus', line.bonus],
  ]
    .filter(([, amount]) => (amount as number) !== 0)
    .map(([label, amount]) => row(label as string, money(amount as number)))
    .join('');

  const statutoryRows = statutory
    .map((item) => {
      if (!item.applicable) {
        return `<tr><th>${escapeHtml(item.label)}</th><td class="na">Not applicable to this employee</td></tr>`;
      }
      if (item.amount === null) {
        // NEVER 0.00. Zero says nothing is owed; this says nobody worked it out.
        return `<tr><th>${escapeHtml(item.label)}</th><td class="na">Not calculated${
          item.note ? ` — ${escapeHtml(item.note)}` : ''
        }</td></tr>`;
      }
      return `<tr><th>${escapeHtml(item.label)}</th><td class="num">${money(item.amount)}${
        item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ''
      }</td></tr>`;
    })
    .join('');

  const otherDeductionRows = [
    ['Unpaid leave', line.unpaidLeaveDeduction],
    ['Other deductions', line.otherDeductions],
  ]
    .filter(([, amount]) => (amount as number) !== 0)
    .map(([label, amount]) => row(label as string, money(amount as number)))
    .join('');

  const employerRows = [
    ['EPF (employer)', line.epfEmployer],
    ['SOCSO (employer)', line.socsoEmployer],
    ['EIS (employer)', line.eisEmployer],
  ]
    .map(([label, amount]) =>
      amount === null
        ? `<tr><th>${escapeHtml(label as string)}</th><td class="na">Not calculated</td></tr>`
        : row(label as string, money(amount as number)),
    )
    .join('');

  const banners: string[] = [];
  if (draft) {
    banners.push(
      `<div class="banner bad"><strong>DRAFT — NOT A PAYSLIP.</strong> This payroll run is
       ${escapeHtml(run.status)} and has not been approved. Figures may still change, and nothing
       here is a statement of wages paid.</div>`,
    );
  }
  if (run.statutoryNotice) {
    banners.push(
      `<div class="banner warn"><strong>Statutory figures:</strong> ${escapeHtml(run.statutoryNotice)}</div>`,
    );
  }
  if (totals.uncalculated > 0) {
    banners.push(
      `<div class="banner warn">${totals.uncalculated} statutory deduction(s) on this payslip were
       <strong>not calculated</strong>. They are shown as blank rather than zero, and this payslip
       is not a complete statement of deductions.</div>`,
    );
  }

  // THE SLIP CHECKS ITSELF. A payslip that does not add up is worse than no
  // payslip, because somebody will pay it.
  const netCell = totals.adds
    ? `<td class="num strong">${money(totals.netPay)}</td>`
    : `<td class="na"><strong>These figures do not add up.</strong> Gross ${money(
        totals.grossPay,
      )} less deductions ${money(totals.deductions)} is ${money(
        totals.derivedNet,
      )}, but the run stored ${money(
        totals.netPay,
      )}. This payslip is not safe to issue — recalculate the run.</td>`;

  const period = new Date(`${run.period}-01T00:00:00.000Z`).toLocaleDateString('en-MY', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Payslip — ${escapeHtml(snapshot.name ?? line.name)} — ${escapeHtml(period)}${draft ? ' (DRAFT)' : ''}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; position: relative; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .banner { border-left: 4px solid; padding: 8px 12px; margin-bottom: 10px; line-height: 1.5; }
  .banner.bad { border-color: #a8071a; background: #fff1f0; }
  .banner.warn { border-color: #d46b08; background: #fff7e6; }
  .grid { display: flex; gap: 24px; margin-bottom: 14px; }
  .grid > div { flex: 1; }
  /* FIXED LAYOUT. Without it the browser sizes the label column to its
     content, and inside a half-width grid cell "Basic salary" wraps onto two
     lines with the amount jammed against it. A payslip is read down a column
     of figures; the columns have to hold still. */
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; padding: 4px 0; vertical-align: top; font-weight: normal; }
  th { width: 56%; padding-right: 10px; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  td.na { text-align: right; color: #874d00; font-style: italic; white-space: normal; }
  td.strong, th.strong { font-weight: bold; }
  .section { margin-bottom: 12px; }
  .section > h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em;
                  border-bottom: 1px solid #999; padding-bottom: 3px; margin: 0 0 4px; }
  .total { border-top: 1px solid #111; }
  /* The reason a figure is missing sits inside a nowrap numeric cell, so it
     has to opt back out or it runs off the page — and that note is the one
     somebody most needs to read. */
  .note { font-size: 10px; color: #874d00; font-style: italic; white-space: normal; text-align: right; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #999; font-size: 10px; color: #444; line-height: 1.6; }
  .draft-watermark {
    position: fixed; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-24deg);
    font-size: 96px; font-weight: bold; color: rgba(168, 7, 26, .12); letter-spacing: 6px;
    pointer-events: none; -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
</style>
</head>
<body>
${draft ? '<div class="draft-watermark">DRAFT</div>' : ''}
<div class="head">
  <div>
    <h1>${escapeHtml(context.employerName)}</h1>
    <div class="muted">${escapeHtml(context.branchName ?? run.clinicName)}</div>
  </div>
  <div style="text-align:right">
    <h1>Payslip</h1>
    <div class="muted">${escapeHtml(period)}</div>
  </div>
</div>

${banners.join('\n')}

<div class="grid">
  <div class="section">
    <h2>Employee</h2>
    <table>
      <tr><th>Name</th><td>${escapeHtml(snapshot.name ?? line.name)}</td></tr>
      ${snapshot.employeeNo ? `<tr><th>Employee no.</th><td>${escapeHtml(snapshot.employeeNo)}</td></tr>` : ''}
      ${snapshot.position ? `<tr><th>Position</th><td>${escapeHtml(snapshot.position)}</td></tr>` : ''}
      ${snapshot.department ? `<tr><th>Department</th><td>${escapeHtml(snapshot.department)}</td></tr>` : ''}
      ${snapshot.employmentType ? `<tr><th>Type</th><td>${escapeHtml(snapshot.employmentType)}</td></tr>` : ''}
      ${snapshot.bankName ? `<tr><th>Paid to</th><td>${escapeHtml(snapshot.bankName)}</td></tr>` : ''}
    </table>
  </div>
  <div class="section">
    <h2>This period</h2>
    <table>
      ${line.workedDays !== null ? `<tr><th>Days worked</th><td class="num">${line.workedDays}</td></tr>` : ''}
      ${line.unpaidDays !== null && line.unpaidDays > 0 ? `<tr><th>Unpaid days</th><td class="num">${line.unpaidDays}</td></tr>` : ''}
      ${line.overtimeHours !== null && line.overtimeHours > 0 ? `<tr><th>Overtime hours</th><td class="num">${line.overtimeHours}</td></tr>` : ''}
      <tr><th>Run approved</th><td>${run.approvedAt ? escapeHtml(new Date(run.approvedAt).toLocaleDateString('en-MY')) : 'Not approved'}</td></tr>
      ${run.paidAt ? `<tr><th>Paid</th><td>${escapeHtml(new Date(run.paidAt).toLocaleDateString('en-MY'))}</td></tr>` : ''}
    </table>
  </div>
</div>

<div class="grid">
  <div class="section">
    <h2>Earnings</h2>
    <table>
      ${earnings}
      <tr class="total"><th class="strong">Gross pay</th><td class="num strong">${money(line.grossPay)}</td></tr>
    </table>
  </div>
  <div class="section">
    <h2>Deductions</h2>
    <table>
      ${statutoryRows}
      ${otherDeductionRows}
      <tr class="total"><th class="strong">Total deductions</th><td class="num strong">${money(totals.deductions)}</td></tr>
    </table>
  </div>
</div>

<div class="section">
  <h2>Net pay</h2>
  <table><tr><th class="strong">Net pay</th>${netCell}</tr></table>
</div>

<div class="section">
  <h2>Employer contributions — not deducted from your pay</h2>
  <table>
    ${employerRows}
    <tr class="total"><th>Total cost to the employer</th><td class="num">${money(line.employerCost)}</td></tr>
  </table>
</div>

<div class="foot">
  Printed ${escapeHtml(printedAt.toLocaleString('en-MY'))}${
    context.printedBy ? ` by ${escapeHtml(context.printedBy)}` : ''
  }. This is a computer-generated statement of wages.
  ${
    draft
      ? '<br /><strong>It is a draft and is not a payslip.</strong>'
      : ''
  }
</div>
</body>
</html>`;
}

/**
 * Open the payslip in a window and print it. The browser's own "Save as PDF"
 * is how a PDF is produced — same route as every other document Kuwick prints,
 * so there is no server-side renderer to keep alive.
 */
export function printPayslip(run: PayrollRunDetail, line: PayslipLine, context: PayslipContext): void {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  win.document.write(renderPayslipHtml(run, line, context));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
