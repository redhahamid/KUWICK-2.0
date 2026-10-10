/**
 * WHEN A PAYROLL ITEM IS PAID.
 *
 * One payroll month can be paid on more than one date — salary on the 30th, a
 * director's fee on the 1st of the next month, overtime and claims on the 15th
 * of the next month — and which item goes on which date is the clinic's, set
 * per item in Settings. A rule is a day of the month and whether that day
 * falls in the payroll month (0) or the month after it (1).
 *
 * Statutory figures and the payslip stay on the whole payroll month. Only the
 * money is split, one transfer per date.
 */
export interface PayDateRule {
  /** 1–31. A day the month does not have is paid on its last day. */
  readonly payDay: number;
  /** 0: the payroll month itself. 1: the month after it. */
  readonly payMonthOffset: number;
}

/** What every item was before pay dates existed: one date, the 30th of the payroll month. */
export const DEFAULT_PAY_DATE: PayDateRule = { payDay: 30, payMonthOffset: 0 };

/** "1st", "2nd", "3rd", "11th", "21st", "30th". */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/** "30th of the payroll month", "15th of the next month" — the words Settings and the audit use. */
export function describePayDate(rule: PayDateRule): string {
  return `${ordinal(rule.payDay)} of the ${rule.payMonthOffset === 1 ? 'next month' : 'payroll month'}`;
}

/**
 * The date a rule falls on for a payroll month, as YYYY-MM-DD. `period` is any
 * day of the payroll month (its first day, as runs store it).
 */
export function scheduledPayDate(period: Date, rule: PayDateRule): string {
  const year = period.getUTCFullYear();
  const month = period.getUTCMonth() + rule.payMonthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, rule.payDay), lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}
