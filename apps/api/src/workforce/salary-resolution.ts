/**
 * WHICH SALARY WAS IN FORCE.
 *
 * `EmployeeProfile.basicSalary` is one mutable number, so recalculating an
 * unlocked past period applied today's pay to it. Approved runs escaped only
 * because a database trigger refuses to recalculate them — safety by accident,
 * not by design.
 *
 * A period resolves to the row whose window contains the period END. The end,
 * not the start: a raise effective on the 15th is the salary that month's
 * payslip is issued against. Whether it should instead be prorated across the
 * two rates is a policy question the proration engine answers (spec §19), and
 * it is deliberately NOT decided here.
 */

export interface SalaryRow {
  id: string;
  basis: 'MONTHLY' | 'DAILY' | 'HOURLY';
  /** Cents. */
  amountCents: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface SalaryResolution {
  row: SalaryRow | null;
  /** Every row whose window overlaps the period, oldest first. */
  overlapping: SalaryRow[];
  /** True when more than one rate applied inside the period. */
  changedDuringPeriod: boolean;
  reason: string;
}

function atDayStart(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function covers(row: SalaryRow, instant: number): boolean {
  if (atDayStart(row.effectiveFrom) > instant) return false;
  if (row.effectiveTo && atDayStart(row.effectiveTo) < instant) return false;
  return true;
}

/**
 * Resolve the salary for a period.
 *
 * `periodStart` and `periodEnd` are inclusive day boundaries.
 */
export function resolveSalaryForPeriod(
  rows: SalaryRow[],
  periodStart: Date,
  periodEnd: Date,
): SalaryResolution {
  const start = atDayStart(periodStart);
  const end = atDayStart(periodEnd);

  const sorted = [...rows].sort((a, b) => atDayStart(a.effectiveFrom) - atDayStart(b.effectiveFrom));

  const overlapping = sorted.filter((row) => {
    const from = atDayStart(row.effectiveFrom);
    const to = row.effectiveTo ? atDayStart(row.effectiveTo) : Number.POSITIVE_INFINITY;
    return from <= end && to >= start;
  });

  const atEnd = [...sorted].reverse().find((row) => covers(row, end)) ?? null;

  if (!atEnd) {
    return {
      row: null,
      overlapping,
      changedDuringPeriod: false,
      reason:
        overlapping.length > 0
          ? 'A salary is recorded for part of this period but none was in force at the period end.'
          : 'No salary is recorded for this employee for this period.',
    };
  }

  const changed = overlapping.length > 1;
  return {
    row: atEnd,
    overlapping,
    changedDuringPeriod: changed,
    reason: changed
      ? `Salary changed during this period; ${overlapping.length} rates overlap it and the rate in force at the period end was used.`
      : 'One salary was in force for the whole period.',
  };
}

// ---------------------------------------------------------------------------
// The payroll-facing answer
// ---------------------------------------------------------------------------

/**
 * WHAT PAYROLL IS ALLOWED TO DO WITH A SALARY CHANGE MID-PERIOD.
 *
 * `resolveSalaryForPeriod` takes the rate in force at the period end and says
 * so. That is a reasonable default for a UI, and a bad one for money: the
 * treatment of a mid-period raise — prorate across the two rates, pay the new
 * rate for the whole month, pay the old — is a POLICY question that Malaysian
 * practice does not settle for you, and which this clinic has not yet decided.
 *
 * So payroll does not choose. It refuses, and hands the owner the four facts
 * they need to decide: what the salary was, what it became, the day it changed,
 * and which month is affected. Guessing here would be the same class of error
 * as guessing a statutory rate — a plausible number nobody verified — and it
 * would be invisible, because a prorated figure looks exactly like a correct one.
 */
export type PayrollSalaryOutcome =
  | { kind: 'RESOLVED'; row: SalaryRow; reason: string }
  | { kind: 'NO_SALARY'; reason: string }
  | {
      kind: 'CHANGED_MID_PERIOD';
      /** Oldest first. At least two rows, or this outcome would not arise. */
      overlapping: SalaryRow[];
      previous: SalaryRow;
      next: SalaryRow;
      /** The day the change takes effect — `next.effectiveFrom`. */
      changedOn: Date;
      reason: string;
    };

/**
 * Resolve a salary for a payroll period, refusing rather than guessing when
 * more than one rate applied.
 */
export function resolveSalaryForPayroll(
  rows: SalaryRow[],
  periodStart: Date,
  periodEnd: Date,
): PayrollSalaryOutcome {
  const resolution = resolveSalaryForPeriod(rows, periodStart, periodEnd);

  if (resolution.overlapping.length > 1) {
    const ordered = [...resolution.overlapping].sort(
      (a, b) => atDayStart(a.effectiveFrom) - atDayStart(b.effectiveFrom),
    );
    const previous = ordered[0];
    const next = ordered[ordered.length - 1];
    return {
      kind: 'CHANGED_MID_PERIOD',
      overlapping: ordered,
      previous,
      next,
      changedOn: next.effectiveFrom,
      reason:
        `${ordered.length} salary rates apply to this period. How a mid-period change is paid ` +
        'has not been decided for this clinic, so payroll will not assume one.',
    };
  }

  if (!resolution.row) {
    return { kind: 'NO_SALARY', reason: resolution.reason };
  }

  return { kind: 'RESOLVED', row: resolution.row, reason: resolution.reason };
}
