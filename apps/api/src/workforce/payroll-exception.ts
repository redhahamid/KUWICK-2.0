/**
 * THE EXCEPTION CATALOGUE.
 *
 * Exceptions were a `Json?` column holding `{ staffId, name, issue }`. They
 * could not be queried, counted by severity, overridden individually or
 * audited, and every one of them blocked approval — so a purely informational
 * observation had the same force as an unpayable employee.
 *
 * Each entry now carries the three things the best warning found in the
 * competitor audit carries, and which almost none of its others do: the
 * CONDITION, the CONSEQUENCE, and the REMEDY. Naming the consequence is what
 * turns "PCB is missing" into something a clinic manager can act on.
 */

export type ExceptionSeverity = 'BLOCKING' | 'WARNING' | 'INFO';

export interface ExceptionTemplate {
  code: string;
  severity: ExceptionSeverity;
  /** Whether a permitted actor may pass it with a recorded reason. */
  overridable: boolean;
  cause: (ctx: Record<string, string | number>) => string;
  consequence: string;
  remediation: string;
  deepLink?: (ctx: Record<string, string | number>) => string;
}

/*
 * A NOTE ON `deepLink`, after the Stage 1 + 2 visual UAT.
 *
 * Every link in this catalogue used to point at a route nobody had mounted:
 * `/admin/hr/employees/:id/salary`, `/admin/hr/timesheet`,
 * `/admin/hr/pay-components`, `/admin/hr/payroll/:id/inputs`,
 * `/admin/hr/statutory`. The remedy sentence beside each exception told a
 * clinic manager exactly what to do, and the link under it took them to a
 * blank page — on the one screen whose whole job is getting blockers resolved.
 *
 * These now name routes that exist. `?staffId=` opens that person's record
 * directly, so an employee link lands on the employee rather than on a
 * directory to search. PCB_MISSING keeps a link for completeness, but the
 * exception centre offers a button instead: its remedy is a keystroke on the
 * screen the reader is already looking at.
 */
export const EXCEPTION_CATALOGUE: Record<string, ExceptionTemplate> = {
  NO_SALARY: {
    code: 'NO_SALARY',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Salary setup is incomplete.',
    consequence: 'They have no salary on file for this month, so they are left out of the totals entirely rather than paid a figure nobody chose.',
    remediation: 'Set their monthly salary from the date it starts.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NO_DOB: {
    code: 'NO_DOB',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Date of birth is missing.',
    consequence:
      'EPF, SOCSO and EIS all change at 60, so without a date of birth every statutory figure for this person would be a guess.',
    remediation: 'Add their date of birth to their employee record.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NO_LEGAL_EMPLOYER: {
    code: 'NO_LEGAL_EMPLOYER',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'No employing company is recorded.',
    consequence:
      'Nothing could be filed for them: EPF, SOCSO, EIS and monthly tax are all submitted by a company, and this person is not attached to one.',
    remediation: 'Set the company that employs them on their employee record.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  PCB_MISSING: {
    code: 'PCB_MISSING',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'Monthly tax (PCB) is missing.',
    consequence:
      'Their payslip would show more take-home pay than they are really owed, and the clinic would pay LHDN too little for this month.',
    remediation:
      'Enter their PCB figure, or record them as not paying PCB if that is genuinely their situation. Kuwick does not work out monthly tax for you.',
    deepLink: () => '/admin/hr/payroll',
  },
  UNAPPROVED_OVERTIME: {
    code: 'UNAPPROVED_OVERTIME',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.hours} hours of overtime need approval.`,
    consequence: 'The hours were clocked but nobody has approved them, so they will be paid less than they claimed.',
    remediation: 'Approve or reject the overtime on their timesheet.',
    deepLink: (c) => `/admin/hr/attendance?staffId=${c.staffId}`,
  },
  MISSING_PUNCH: {
    code: 'MISSING_PUNCH',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.days} day(s) have no clock-in or clock-out.`,
    consequence: 'Hours for those days are incomplete, so any overtime or attendance-based pay may be understated.',
    remediation: 'Correct those days on their timesheet.',
    deepLink: (c) => `/admin/hr/attendance?staffId=${c.staffId}`,
  },
  UNKNOWN_COMPONENT: {
    code: 'UNKNOWN_COMPONENT',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `Payroll input "${c.componentCode}" is not a known pay component.`,
    consequence: 'The amount was NOT included, so somebody is being paid less than was entered for them.',
    remediation: 'Add the component to the catalogue, or correct the input.',
    deepLink: () => '/admin/hr/employers',
  },
  NO_BANK_DETAILS: {
    code: 'NO_BANK_DETAILS',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'No bank account is recorded for this employee.',
    consequence: 'They cannot be included in a bank payment file and will have to be paid by another means.',
    remediation: 'Record the bank name, account number and account name.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  NEGATIVE_NET: {
    code: 'NEGATIVE_NET',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `Deductions exceed earnings; net pay would be ${c.net}.`,
    consequence: 'A negative payslip cannot be paid, and would mean the employee owes the clinic money this month.',
    remediation: 'Reduce a deduction, or spread the recovery across periods.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * BLOCKING, and deliberately not overridable.
   *
   * This was a WARNING that let the run proceed on "the rate in force at the
   * period end", which silently pays the new salary for days worked at the old
   * one. Whether a mid-period change is prorated, paid forward or paid back is
   * a policy this clinic has not decided, and Malaysian practice does not
   * decide it for them. A prorated figure and a wrong one look identical on a
   * payslip, so the run stops and asks.
   */
  SALARY_CHANGED_MID_PERIOD: {
    code: 'SALARY_CHANGED_MID_PERIOD',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) =>
      `Salary changed from ${c.previousAmount} to ${c.nextAmount} on ${c.changedOn}, part-way through ${c.periodLabel}.`,
    consequence:
      'How a mid-period change is paid has not been decided for this clinic, so payroll will not assume one. ' +
      'This employee is left out of the run totals rather than paid a figure nobody chose.',
    remediation:
      'Decide the treatment for this employee: date the change from the start of a period, or split the run. ' +
      'Kuwick does not prorate a mid-period salary change.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  /*
   * The calculation models a MONTHLY salary. A daily or hourly rate needs a day
   * or hour count for the period, and where that count comes from — roster,
   * timesheet, or a contract minimum — is not settled. Paying a daily-rate
   * employee a monthly figure would be a silent, plausible-looking error.
   */
  SALARY_BASIS_UNSUPPORTED: {
    code: 'SALARY_BASIS_UNSUPPORTED',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => `This employee is on a ${c.basis} rate, and this build calculates monthly salaries only.`,
    consequence: 'They are left out of the run rather than paid a monthly figure derived from a daily or hourly rate.',
    remediation:
      'Record a monthly salary for this employee, or leave them out of payroll until daily and hourly pay is implemented.',
    deepLink: (c) => `/admin/hr/employees/${c.staffId}`,
  },
  STATUTORY_UNVERIFIED: {
    code: 'STATUTORY_UNVERIFIED',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'The EPF, SOCSO and EIS rates have not been checked.',
    consequence:
      'Every statutory figure in this run rests on tables nobody has confirmed against KWSP and PERKESO, and the payslip says so on its face.',
    remediation:
      'Check the rates in Payroll settings, or carry on knowing this run is provisional and must not be used to pay staff or file.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * INFO, and deliberately not a warning.
   *
   * A contractor is not an employee who cannot be paid — they are somebody this
   * run is not about. Their fee is a payable. Raising a blocker for every locum
   * every month would train the owner to click past blockers, which is how a
   * real one eventually gets clicked past too. It is recorded so the run can
   * account for everybody the clinic pays, not only everybody it payrolls.
   */
  CONTRACTOR_EXCLUDED: {
    code: 'CONTRACTOR_EXCLUDED',
    severity: 'INFO',
    overridable: false,
    cause: (c) => `${c.name} is engaged as a contractor, not an employee.`,
    consequence:
      'They are paid for their sessions as a professional fee through Finance, so they are not on this payroll ' +
      'and no EPF, SOCSO or EIS is contributed for them.',
    remediation:
      'Nothing to do, unless this person should in fact be an employee — in which case change their engagement.',
    deepLink: () => '/admin/hr/locum',
  },
  /*
   * AN EMPLOYEE-SPECIFIC STATUTORY UNKNOWN — the fail-safe, and the one
   * exception that must never become overridable.
   *
   * It used to fire only when a note matched /incomplete|outside every
   * configured/, which was a regex over prose and therefore a gate that any
   * rewording could open. It is now raised from the figures themselves: if EPF,
   * SOCSO or EIS came back NULL for this employee, this is raised, whatever the
   * reason and whatever the wording.
   *
   * Distinct from a run-level gap ("no schedule is in force for this period"),
   * which `statutoryStatus` carries.
   */
  /*
   * s.18A — a part-month, stated rather than silent.
   *
   * INFO, deliberately. A joiner or a leaver is an ordinary event and blocking
   * on one would train somebody to click past blockers. What is not acceptable
   * is a prorated figure appearing with nothing on screen saying why it is
   * smaller than the contract, which is indistinguishable from a bug.
   */
  PART_MONTH: {
    code: 'PART_MONTH',
    severity: 'INFO',
    overridable: false,
    cause: (c) => String(c.note),
    consequence:
      'Their basic pay is worked out under s.18A of the Employment Act — the monthly wage divided by the days ' +
      'in this month, times the days they served. Overtime is still priced on their full monthly wage.',
    remediation: 'Nothing to do, unless the start or end date on their record is wrong.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  /*
   * Somebody the run would otherwise have paid a whole month, who was not
   * employed for a single day of it. Almost always a leaver whose record is
   * still marked ACTIVE, which is a data problem rather than a pay problem —
   * so they are excluded and named, not paid nought and listed.
   */
  NOT_EMPLOYED_IN_PERIOD: {
    code: 'NOT_EMPLOYED_IN_PERIOD',
    severity: 'WARNING',
    overridable: true,
    cause: (c) =>
      `They were not employed during this month${c.endDate ? ` — they left on ${String(c.endDate)}` : c.startDate ? ` — they start on ${String(c.startDate)}` : ''}.`,
    consequence: 'They are left off this payroll entirely rather than paid a part-month of nought.',
    remediation:
      'If that is right, nothing to do. If they did work this month, correct their start or end date and recalculate.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  STATUTORY_UNKNOWN: {
    code: 'STATUTORY_UNKNOWN',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => String(c.note),
    consequence:
      'A statutory figure for this employee could not be worked out, so their payslip is incomplete and the ' +
      'contribution that would be filed for them is unknown — not nil.',
    remediation: 'Record what is missing on the employee, then recalculate the run.',
    deepLink: (c) => `/admin/hr/employees/${String(c.staffId)}`,
  },
  VARIANCE_OUTSIDE_THRESHOLD: {
    code: 'VARIANCE_OUTSIDE_THRESHOLD',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `Take-home pay moved ${c.percent}% against last month.`,
    consequence: 'A change this size is usually a mistake in the month rather than a real one.',
    remediation: 'Open them and check their hours, salary and anything added this month.',
    deepLink: () => '/admin/hr/payroll',
  },
};

export interface BuiltException {
  code: string;
  severity: ExceptionSeverity;
  staffId: string | null;
  cause: string;
  consequence: string;
  remediation: string;
  deepLink: string | null;
  overridable: boolean;
}

export function buildException(
  code: keyof typeof EXCEPTION_CATALOGUE,
  staffId: string | null,
  ctx: Record<string, string | number> = {},
): BuiltException {
  const t = EXCEPTION_CATALOGUE[code];
  if (!t) throw new Error(`Unknown payroll exception code: ${code}`);
  return {
    code: t.code,
    severity: t.severity,
    staffId,
    cause: t.cause(ctx),
    consequence: t.consequence,
    remediation: t.remediation,
    deepLink: t.deepLink ? t.deepLink(ctx) : null,
    overridable: t.overridable,
  };
}

/**
 * Whether a run may be approved.
 *
 * BLOCKING gates approval. WARNING does not — that distinction is the whole
 * point of having severities, and it is what stops a purely informational
 * observation from making a run unapprovable. An overridden blocking exception
 * only counts as resolved if it was overridable in the first place, which the
 * database also enforces.
 */
export interface ExceptionGate {
  canApprove: boolean;
  /** Every exception row on the run, whatever its severity or override state. */
  total: number;
  /** BLOCKING rows that are still standing. These, and only these, stop approval. */
  blocking: number;
  warnings: number;
  info: number;
  overridden: number;
  reason: string;
}

/**
 * THE ONE PLACE EXCEPTION STATE IS COUNTED.
 *
 * Every surface that says anything about a run's exceptions — the banner, the
 * run table's column, the exception centre, the approval button, the approval
 * confirmation — takes its numbers from this function, applied to the
 * `payroll_exceptions` ROWS. It returns the whole vocabulary those surfaces
 * need rather than just the gate, so that none of them has to count anything
 * for itself.
 *
 * That is not tidiness. The run's legacy `exceptions` JSON blob and the rows
 * are two stores of the same fact, and while the banner read one and the gate
 * read the other, a run could say "5 exceptions must be resolved" beside an
 * enabled Approve button and an exception centre reading "No exceptions". A
 * payroll screen that contradicts itself about who cannot be paid is worse
 * than one that says nothing.
 */
export function approvalGate(
  exceptions: { severity: ExceptionSeverity; overridable: boolean; overriddenByStaffId: string | null }[],
): ExceptionGate {
  const blockingRows = exceptions.filter(
    (e) => e.severity === 'BLOCKING' && !(e.overridable && e.overriddenByStaffId),
  );
  const warnings = exceptions.filter((e) => e.severity === 'WARNING').length;
  const info = exceptions.filter((e) => e.severity === 'INFO').length;
  const overridden = exceptions.filter((e) => e.overriddenByStaffId).length;
  return {
    canApprove: blockingRows.length === 0,
    total: exceptions.length,
    blocking: blockingRows.length,
    warnings,
    info,
    overridden,
    reason:
      blockingRows.length === 0
        ? warnings > 0
          ? `${warnings} warning(s) noted; none of them prevents approval.`
          : 'No exceptions.'
        : `${blockingRows.length} blocking exception(s) must be resolved before this run can be approved.`,
  };
}
