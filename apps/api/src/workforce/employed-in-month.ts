import type { Prisma } from '@prisma/client';

/**
 * WHO A MONTH'S PAYROLL IS FOR (UAT, 10 October 2026).
 *
 * "A month's run must include everyone employed at any point in THAT month:
 * start date on or before the month's last day, AND no end date or end date
 * on or after the month's first day." Every payroll list read the status a
 * person has TODAY instead, so a back-dated January listed only today's
 * staff: the people who left in January were missing, and somebody starting
 * in August was in it, blocked for want of a salary.
 *
 * The status still says who is a leaver. ACTIVE, PROBATION and NOTICE are
 * employed until their end date, if they have one. RESIGNED and TERMINATED
 * are employed up to their end date, so one without an end date is in no
 * month: when they left is not on record, and guessing would pay them for
 * months they did not work. SUSPENDED is left out, as it always was.
 *
 * Kept as a Prisma fragment so every list (the run, the grid, readiness, the
 * change stamps and carry-forward) asks the same question the same way; a
 * list that disagreed with the run would show somebody the run does not pay.
 */
export const EMPLOYED_STATUSES = ['ACTIVE', 'PROBATION', 'NOTICE'] as const;
export const LEFT_STATUSES = ['RESIGNED', 'TERMINATED'] as const;

/** Employed at any point in [periodStart, periodEnd). `periodEnd` is the first day of the next month. */
export function employedInMonth(periodStart: Date, periodEnd: Date): Prisma.EmployeeProfileWhereInput {
  return {
    AND: [
      { OR: [{ startDate: null }, { startDate: { lt: periodEnd } }] },
      { OR: [{ endDate: null }, { endDate: { gte: periodStart } }] },
      {
        OR: [
          { employmentStatus: { in: [...EMPLOYED_STATUSES] } },
          { employmentStatus: { in: [...LEFT_STATUSES] }, endDate: { not: null } },
        ],
      },
    ],
  };
}

/** The month containing `period`, as [first day, first day of the next month). */
export function monthWindow(period: Date): { periodStart: Date; periodEnd: Date } {
  const periodStart = new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth(), 1));
  return { periodStart, periodEnd: new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1)) };
}

/** The same, for the month containing `period`. */
export const employedInMonthOf = (period: Date): Prisma.EmployeeProfileWhereInput => {
  const { periodStart, periodEnd } = monthWindow(period);
  return employedInMonth(periodStart, periodEnd);
};

/**
 * Whether the run pays somebody the month selected. A switched-off login
 * kept a current employee off the payroll, and still does; a leaver's login
 * is switched off as a matter of course, so it does not keep them off the
 * months they worked.
 */
export const paidThisMonth = (row: { endDate: Date | null; staff: { active: boolean } }): boolean =>
  row.staff.active || row.endDate !== null;
