import type { PayrollRunDetail, PayslipDoc, PayslipEmployeeSnapshot } from '../types';

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
 *  2. **PROVISIONAL statutory rates say so on the slip.** The schedules come
 *     from the statutory registry — the authorities' own documents — and a
 *     period whose schedules fall short of the approval bar prints the
 *     warning. An employee is entitled to know when the EPF line on their
 *     payslip rests on anything less.
 *  3. **A statutory figure that was not calculated prints as "not calculated",
 *     with the reason, and NEVER as 0.00.** Zero is a statement that nothing is
 *     owed. Blank is a statement that nobody worked it out. On a statutory
 *     document those are different, and printing the first when the second is
 *     true is a false statement.
 *  4. **PCB entered by hand says it was entered by hand.** Kuwick calculates
 *     monthly tax where the profile is on record; where somebody typed the
 *     figure instead, a figure it merely stored must not read as one it
 *     computed.
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
  statutoryNotes?: {
    epf?: string | null;
    socso?: string | null;
    eis?: string | null;
    lindung?: string | null;
    pcb?: string | null;
  };
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
  const classification = (line.snapshot ?? {}).statutoryClassification as
    | { lindungParticipation?: string | null }
    | undefined;
  return [
    { label: 'EPF (employee)', amount: line.epfEmployee, note: notes.epf ?? null, applicable: applicability.epf !== false },
    { label: 'SOCSO (employee)', amount: line.socsoEmployee, note: notes.socso ?? null, applicable: applicability.socso !== false },
    { label: 'EIS (employee)', amount: line.eisEmployee, note: notes.eis ?? null, applicable: applicability.eis !== false },
    {
      // Employee-borne, employer-remitted — it comes out of the pay, so a
      // slip that omitted it would not reach its own net.
      label: 'LINDUNG 24 JAM',
      amount: line.lindungEmployee,
      note: notes.lindung ?? null,
      applicable: classification?.lindungParticipation !== 'NOT_PARTICIPATING',
    },
    { label: 'PCB / MTD', amount: line.pcb, note: notes.pcb ?? null, applicable: applicability.pcb !== false },
  ];
}

export interface PayslipTotals {
  grossPay: number;
  /**
   * Only what is actually printed as a deduction — and NULL when a statutory
   * line is uncalculated: a "total" summing an unknown as zero is not a
   * total, and this slip must not print one.
   */
  deductions: number | null;
  netPay: number;
  /** The net the slip WOULD show from its own figures. Null when unknowable. */
  derivedNet: number | null;
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
  const uncalculated = statutory.filter((item) => item.applicable && item.amount === null).length;
  // AN UNKNOWN IS NOT A ZERO. `?? 0` here printed "Total deductions" over a
  // sum that quietly skipped the uncalculated lines — a finished-looking
  // figure on the exact document that says, two banners up, that it is not a
  // complete statement of deductions.
  if (uncalculated > 0) {
    return {
      grossPay: line.grossPay,
      deductions: null,
      netPay: line.netPay,
      derivedNet: null,
      adds: false,
      uncalculated,
    };
  }
  const statutoryTotal = statutory.reduce((sum, item) => sum + (item.amount ?? 0), 0);
  // UNPAID LEAVE IS NOT HERE. Under s.18A an incomplete month's WAGES are
  // smaller — the engine's stored gross already has the reduction off — so
  // taking it again among the deductions double-counted it, and every real
  // unpaid-leave payslip printed the "does not add up" refusal.
  const deductions = Math.round((statutoryTotal + line.otherDeductions) * 100) / 100;
  const derivedNet = Math.round((line.grossPay - deductions) * 100) / 100;
  return {
    grossPay: line.grossPay,
    deductions,
    netPay: line.netPay,
    derivedNet,
    // A cent of tolerance: the engine works in cents and the display rounds.
    adds: Math.abs(derivedNet - line.netPay) < 0.005,
    uncalculated,
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
    .concat(
      // The s.18A reduction belongs on the WAGES side: it makes gross smaller,
      // and hiding it here while gross quietly shrank left an earnings column
      // that did not reach its own total.
      line.unpaidLeaveDeduction !== 0
        ? [
            `<tr><th>Unpaid leave (s.18A wage reduction)</th><td class="num" style="color:#a8071a">−${money(
              line.unpaidLeaveDeduction,
            )}</td></tr>`,
          ]
        : [],
    )
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

  const otherDeductionRows = [['Other deductions', line.otherDeductions]]
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
    : totals.uncalculated > 0
    ? `<td class="na"><strong>Not stated.</strong> ${totals.uncalculated} statutory deduction(s) were not
       calculated, so a take-home figure cannot be printed from this slip's own lines. Resolve the
       exceptions and recalculate.</td>`
    : `<td class="na"><strong>These figures do not add up.</strong> Gross ${money(
        totals.grossPay,
      )} less deductions ${money(totals.deductions ?? 0)} is ${money(
        totals.derivedNet ?? 0,
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
      <tr class="total"><th class="strong">Total deductions</th><td class="num strong">${
        totals.deductions === null ? 'Not calculable — see above' : money(totals.deductions)
      }</td></tr>
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

// ---------------------------------------------------------------------------
// THE APPROVED PAYSLIP — rendered from the server's snapshot-composed dataset.
//
// Every figure below arrives frozen from the approved snapshot; this renderer
// formats and REFUSES, it never derives. The server's own PDF route renders
// the same dataset, so screen, print and PDF cannot disagree.
// ---------------------------------------------------------------------------

const rm = (cents: number) =>
  (cents / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function renderApprovedPayslipHtml(slip: PayslipDoc, printedBy?: string | null): string {
  const row = (label: string, value: string, strong = false) =>
    `<tr><th${strong ? ' class="strong"' : ''}>${escapeHtml(label)}</th><td class="num${strong ? ' strong' : ''}">${value}</td></tr>`;
  const naRow = (label: string, text: string, note?: string | null) =>
    `<tr><th>${escapeHtml(label)}</th><td class="na">${escapeHtml(text)}${
      note ? `<div class="note">${escapeHtml(note)}</div>` : ''
    }</td></tr>`;

  const banners: string[] = [];
  if (slip.revision.superseded) {
    banners.push(
      `<div class="banner bad"><strong>SUPERSEDED.</strong> This is revision ${slip.revision.version} of
       ${slip.revision.of}; a later approved revision of this run exists.</div>`,
    );
  }
  if (slip.revision.reopenedSinceApproval) {
    banners.push(
      `<div class="banner warn">This run has been <strong>reopened</strong> since this payslip was approved.
       A corrected revision may follow; this document remains the record of what was approved.</div>`,
    );
  }
  if (slip.statutoryStatus === 'PROVISIONAL') {
    banners.push(
      `<div class="banner warn"><strong>Statutory figures:</strong> the schedules behind these figures had not met
       the approval bar when this run was approved.</div>`,
    );
  }
  const uncalculated = slip.statutoryDeductions.filter((item) => item.applicable && item.amountCents === null).length;
  if (uncalculated > 0) {
    banners.push(
      `<div class="banner warn">${uncalculated} statutory deduction(s) were <strong>not calculated</strong>. They are
       shown as words rather than zero, and this payslip is not a complete statement of deductions.</div>`,
    );
  }
  if (!slip.itemised) {
    banners.push(
      `<div class="banner warn">Issued from a format-2 approved record, which froze every figure but not the itemised
       earnings. The totals are the approved figures; the earnings cannot be itemised.</div>`,
    );
  }

  // A month paid on more than one date says which date each amount goes out on.
  const manyDates = (slip.payments?.length ?? 0) > 1;
  const onDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  const earnings = slip.itemised
    ? (slip.earnings ?? [])
        .filter((item) => item.amountCents !== 0)
        .map((item) => row(manyDates && item.payDate ? `${item.label} (paid ${onDay(item.payDate)})` : item.label, rm(item.amountCents)))
        .concat(
          (slip.wageReductions ?? [])
            .filter((item) => item.amountCents !== 0)
            .map(
              (item) =>
                `<tr><th>${escapeHtml(item.label)} (s.18A wage reduction)</th><td class="num" style="color:#a8071a">−${rm(item.amountCents)}</td></tr>`,
            ),
        )
        .join('')
    : row('Gross wages as approved (not itemised in this record format)', rm(slip.figures.grossCents));

  const statutoryRows = slip.statutoryDeductions
    .map((item) => {
      if (!item.applicable) return naRow(item.label, 'Not applicable to this employee');
      if (item.amountCents === null) return naRow(item.label, 'Not calculated', item.note);
      if (item.amountCents === 0 && item.key === 'LINDUNG') return '';
      return `<tr><th>${escapeHtml(item.label)}</th><td class="num">${rm(item.amountCents)}${
        item.key === 'PCB' && item.note ? `<div class="note">${escapeHtml(item.note)}</div>` : ''
      }</td></tr>`;
    })
    .join('');

  const otherDeductions = (slip.otherDeductionLines ?? [])
    .filter((item) => item.amountCents !== 0)
    .map((item) => row(item.label, rm(item.amountCents)))
    .join('');

  const employerRows = slip.employerContributions
    .map((item) => (item.amountCents === null ? naRow(item.label, 'Not calculated') : row(item.label, rm(item.amountCents))))
    .join('');

  const netCell = slip.figures.adds
    ? `<td class="num strong">${rm(slip.figures.netCents)}</td>`
    : `<td class="na"><strong>These figures do not add up.</strong> Gross ${rm(slip.figures.grossCents)} less deductions
       ${rm(slip.figures.deductionCents)} is ${rm(slip.figures.derivedNetCents)}, but the approved net is
       ${rm(slip.figures.netCents)}. This payslip is not safe to issue.</td>`;

  const overtimeSection =
    slip.overtimeDetail && slip.overtimeDetail.length > 0
      ? `<div class="section">
      <h2>Overtime working</h2>
      <table>${slip.overtimeDetail
        .map((tier) => row(`${tier.label} — ${tier.hours} h @ RM${tier.hourlyRate.toFixed(2)}`, money(tier.total)))
        .join('')}</table>
    </div>`
      : '';

  const ytdSection = slip.ytd
    ? `<div class="section">
    <h2>Year to date — ${escapeHtml(slip.period.slice(0, 4))}</h2>
    <table>
      ${row('Gross wages', rm(slip.ytd.grossCents))}
      ${row('EPF (employee)', rm(slip.ytd.epfEmployeeCents))}
      ${row('SOCSO (employee)', rm(slip.ytd.socsoEmployeeCents))}
      ${row('EIS (employee)', rm(slip.ytd.eisEmployeeCents))}
      ${slip.ytd.lindungEmployeeCents > 0 ? row('LINDUNG 24 JAM', rm(slip.ytd.lindungEmployeeCents)) : ''}
      ${row('PCB / MTD', rm(slip.ytd.pcbCents))}
      ${slip.ytd.zakatCents > 0 ? row('Zakat', rm(slip.ytd.zakatCents)) : ''}
    </table>
    ${
      slip.ytd.importedMonths > 0
        ? `<div class="note" style="text-align:left">Includes ${slip.ytd.importedMonths} month(s) imported as opening balances at onboarding.</div>`
        : ''
    }
  </div>`
    : '';

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Payslip — ${escapeHtml(slip.employee.name)} — ${escapeHtml(slip.periodLabel)}</title>
<style>
  @page { margin: 16mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #111; margin: 0; }
  h1 { font-size: 17px; margin: 0 0 2px; }
  .muted { color: #555; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
          border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
  .banner { border-left: 4px solid; padding: 8px 12px; margin-bottom: 10px; line-height: 1.5; }
  .banner.bad { border-color: #a8071a; background: #fff1f0; }
  .banner.warn { border-color: #d46b08; background: #fff7e6; }
  .grid { display: flex; gap: 24px; margin-bottom: 14px; }
  .grid > div { flex: 1; }
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
  .note { font-size: 10px; color: #874d00; font-style: italic; white-space: normal; text-align: right; }
  .foot { margin-top: 18px; padding-top: 8px; border-top: 1px solid #999; font-size: 10px; color: #444; line-height: 1.6; }
</style>
</head>
<body>
<div class="head">
  <div>
    <h1>${escapeHtml(slip.employer.name ?? 'Employer')}</h1>
    ${slip.employer.registrationNo ? `<div class="muted">Reg. ${escapeHtml(slip.employer.registrationNo)}</div>` : ''}
    ${slip.employer.addressLines.map((line) => `<div class="muted">${escapeHtml(line)}</div>`).join('')}
  </div>
  <div style="text-align:right">
    <h1>Payslip</h1>
    <div class="muted">${escapeHtml(slip.periodLabel)}</div>
    ${slip.runType !== 'REGULAR' ? `<div class="muted">${escapeHtml(slip.runType.replace(/_/g, ' '))} run ${slip.sequence}</div>` : ''}
  </div>
</div>

${banners.join('\n')}

<div class="grid">
  <div class="section">
    <h2>Employee</h2>
    <table>
      <tr><th>Name</th><td>${escapeHtml(slip.employee.name)}</td></tr>
      ${slip.employee.employeeNo ? `<tr><th>Employee no.</th><td>${escapeHtml(slip.employee.employeeNo)}</td></tr>` : ''}
      ${slip.employee.position ? `<tr><th>Position</th><td>${escapeHtml(slip.employee.position)}</td></tr>` : ''}
      ${slip.employee.bankName ? `<tr><th>Paid to</th><td>${escapeHtml(slip.employee.bankName)}</td></tr>` : ''}
      ${slip.employee.epfNumber ? `<tr><th>EPF no.</th><td>${escapeHtml(slip.employee.epfNumber)}</td></tr>` : ''}
      ${slip.employee.socsoNumber ? `<tr><th>SOCSO no.</th><td>${escapeHtml(slip.employee.socsoNumber)}</td></tr>` : ''}
    </table>
  </div>
  <div class="section">
    <h2>This period</h2>
    <table>
      ${
        slip.attendance?.workedDays !== null && slip.attendance?.workedDays !== undefined
          ? slip.attendance.workedDays > 0
            ? `<tr><th>Days worked</th><td class="num">${slip.attendance.workedDays}</td></tr>`
            : // A monthly salary with no attendance on record: say what the pay is, not "0 days".
              '<tr><th>Pay basis</th><td>Monthly salary</td></tr>'
          : ''
      }
      ${slip.attendance?.unpaidDays ? `<tr><th>Unpaid days</th><td class="num">${slip.attendance.unpaidDays}</td></tr>` : ''}
      ${slip.attendance?.overtimeHours ? `<tr><th>Overtime hours</th><td class="num">${slip.attendance.overtimeHours}</td></tr>` : ''}
      <tr><th>Approved</th><td>${escapeHtml(new Date(slip.revision.approvedAt).toLocaleDateString('en-MY'))}${
        slip.revision.approvedBy.length > 0 ? ` by ${escapeHtml(slip.revision.approvedBy.join(', '))}` : ''
      }</td></tr>
      ${slip.paymentDate ? `<tr><th>Payment date</th><td>${escapeHtml(slip.paymentDate)}</td></tr>` : ''}
      <tr><th>Revision</th><td>${slip.revision.version} of ${slip.revision.of}</td></tr>
    </table>
  </div>
</div>

<div class="grid">
  <div class="section">
    <h2>Earnings</h2>
    <table>
      ${earnings}
      <tr class="total">${row('Gross wages', rm(slip.figures.grossCents), true)}</tr>
    </table>
  </div>
  <div class="section">
    <h2>Deductions</h2>
    <table>
      ${statutoryRows}
      ${otherDeductions}
      <tr class="total">${row('Total deductions', rm(slip.figures.deductionCents), true)}</tr>
    </table>
  </div>
</div>

${overtimeSection}

<div class="section">
  <h2>Net pay</h2>
  <table><tr><th class="strong">Net pay</th>${netCell}</tr></table>
</div>

${
  manyDates
    ? `<div class="section">
  <h2>When it is paid</h2>
  <table>${slip
    .payments!.map((payment) =>
      row(
        payment.paidOn ? `${onDay(payment.paidOn)} — paid` : `${onDay(payment.date)} — due`,
        rm(payment.amountCents),
      ),
    )
    .join('')}</table>
</div>`
    : ''
}

<div class="section">
  <h2>Employer contributions — not deducted from your pay</h2>
  <table>
    ${employerRows}
    <tr class="total">${row('Total cost to the employer', rm(slip.figures.employerCostCents))}</tr>
  </table>
</div>

${ytdSection}

<div class="foot">
  Issued from approved payroll record ${escapeHtml(slip.verification.hash.slice(0, 16))}… (format
  ${slip.verification.schemaVersion}), verification ${escapeHtml(slip.verification.verdict)}.
  Statutory schedules: ${escapeHtml(
    slip.schedules
      .filter((schedule) => schedule.scheduleId)
      .map((schedule) => `${schedule.scheme} ${schedule.scheduleId}`)
      .join(' · ') || 'none recorded',
  )}.<br />
  Printed ${escapeHtml(new Date().toLocaleString('en-MY'))}${printedBy ? ` by ${escapeHtml(printedBy)}` : ''}.
  This is a computer-generated statement of wages. Employer address and membership numbers are as on file at issue.
</div>
</body>
</html>`;
}

export function printApprovedPayslip(slip: PayslipDoc, printedBy?: string | null): void {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return;
  win.document.write(renderApprovedPayslipHtml(slip, printedBy));
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 250);
}
