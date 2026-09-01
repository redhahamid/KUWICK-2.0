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
