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
    cause: () => 'No salary or hourly rate is in force for this period.',
    consequence: 'This employee cannot be paid, and the run total excludes them.',
    remediation: 'Add an effective-dated salary that covers this period.',
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
  },
  NO_DOB: {
    code: 'NO_DOB',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'No date of birth is recorded.',
    consequence:
      'EPF, SOCSO and EIS all change treatment at age 60, so every statutory figure for this employee would be a guess.',
    remediation: 'Record the date of birth on the employee profile.',
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
  },
  NO_LEGAL_EMPLOYER: {
    code: 'NO_LEGAL_EMPLOYER',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'This employee is not assigned to a legal employer.',
    consequence:
      'Nothing can be filed for them: EPF, SOCSO, EIS and PCB submissions are all made by an employer, and this employee has none.',
    remediation: 'Assign the employee to a legal employer.',
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
  },
  PCB_MISSING: {
    code: 'PCB_MISSING',
    severity: 'BLOCKING',
    overridable: false,
    cause: () => 'PCB is not calculated by this system and no amount has been entered for this employee.',
    consequence:
      'The payslip would understate the deduction and overstate net pay, and the employer would under-remit to LHDN.',
    remediation:
      'Enter the PCB amount as a payroll input, or record this employee as outside PCB if that is genuinely their status.',
    deepLink: () => '/admin/hr/payroll',
  },
  UNAPPROVED_OVERTIME: {
    code: 'UNAPPROVED_OVERTIME',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.hours}h of overtime is claimed but not approved.`,
    consequence: 'It is NOT included in this payslip, so the employee will be paid less than they claimed.',
    remediation: 'Approve or reject the overtime on the timesheet, then recalculate.',
    deepLink: (c) => `/admin/hr/attendance?staffId=${c.staffId}`,
  },
  MISSING_PUNCH: {
    code: 'MISSING_PUNCH',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `${c.days} day(s) have a missing clock-in or clock-out.`,
    consequence: 'Hours for those days are incomplete, so overtime and attendance-based pay may be understated.',
    remediation: 'Correct the attendance records, then recalculate.',
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
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
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
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
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
    deepLink: (c) => `/admin/hr/employees?staffId=${c.staffId}`,
  },
  STATUTORY_UNVERIFIED: {
    code: 'STATUTORY_UNVERIFIED',
    severity: 'WARNING',
    overridable: true,
    cause: () => 'The statutory rate tables in force for this period have not been verified against the authority that publishes them.',
    consequence:
      'Every EPF, SOCSO and EIS figure in this run rests on unverified tables, and the payslip says so on its face.',
    remediation:
      'Verify the seeded tables against KWSP and PERKESO and record who did so, or continue on the understanding that this run is provisional.',
    deepLink: () => '/admin/hr/payroll',
  },
  /*
   * An employee-specific statutory gap: their wage falls outside every band the
   * configured table has, or the table is incomplete where they sit. Distinct
   * from "no schedule is configured", which is a property of the run.
   */
  STATUTORY_BAND_GAP: {
    code: 'STATUTORY_BAND_GAP',
    severity: 'BLOCKING',
    overridable: false,
    cause: (c) => String(c.note),
    consequence: 'A statutory figure for this employee could not be computed, so their payslip is incomplete.',
    remediation: 'Complete the statutory rate table for this period, then recalculate.',
    deepLink: () => '/admin/hr/payroll',
  },
  VARIANCE_OUTSIDE_THRESHOLD: {
    code: 'VARIANCE_OUTSIDE_THRESHOLD',
    severity: 'WARNING',
    overridable: true,
    cause: (c) => `Net pay moved ${c.percent}% against the previous period.`,
    consequence: 'A movement this size is usually a data error rather than a real change.',
    remediation: 'Open the employee and check their inputs and salary for this period.',
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
