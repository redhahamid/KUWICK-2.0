/**
 * WHEN A PAYROLL ITEM IS PAID.
 *
 * A run can pay on more than one date — salary on the 30th, a director's fee
 * on the 1st, overtime and claims on the 15th — and which item goes on which
 * date is the clinic's, set per item in Settings as a day of the run's own
 * month or of the month after it ("salary on the 1st of the following
 * month"). It is only the default: the owner can move a date for one run on
 * its Pay step, before that date's listing is prepared (UAT, 10 October 2026).
 *
 * Which month's work a run pays is a different question, answered beside the
 * day, not folded into it: an item "a month in arrears" is paid in the run
 * after the month it was earned in, counted in that run's statutory figures
 * and labelled with the month it was earned.
 *
 * Statutory figures and the payslip stay on the whole run. Only the money is
 * split, one transfer per date.
 */
export interface PayDateRule {
  /** 1–31. A day the month does not have is paid on its last day. */
  readonly payDay: number;
  /** 1: the date falls in the month after the run's. Absent or 0: the run's own month. */
  readonly monthOffset?: number;
}

/** What every item was before pay dates existed: one date, the 30th. */
export const DEFAULT_PAY_DATE: PayDateRule = { payDay: 30 };

/**
 * THE OWNER'S DATES FOR ONE RUN (UAT, 10 October 2026): the approved record's
 * default date for a payment to the date chosen on the Pay step. Anything that
 * is not a day for a day is ignored rather than trusted.
 */
export type PayDateChoices = Readonly<Record<string, string>>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function payDateChoicesOf(value: unknown): PayDateChoices {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => ISO_DAY.test(entry[0]) && typeof entry[1] === 'string' && ISO_DAY.test(entry[1]),
    ),
  );
}

/** The date a payment the record put on `date` goes out on, for this run. */
export function chosenPayDate(choices: PayDateChoices, date: string): string {
  return choices[date] ?? date;
}

/**
 * One person's payments on the dates this run pays on: two default dates the
 * owner moved onto one day are one payment.
 */
export function paymentsOnChosenDates<P extends { date: string; netCents: number }>(
  payments: readonly P[],
  choices: PayDateChoices,
): { date: string; netCents: number }[] {
  const byDate = new Map<string, number>();
  for (const payment of payments) {
    const date = chosenPayDate(choices, payment.date);
    byDate.set(date, (byDate.get(date) ?? 0) + payment.netCents);
  }
  return [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, netCents]) => ({ date, netCents }));
}

/** "1st", "2nd", "3rd", "11th", "21st", "30th". */
export function ordinal(day: number): string {
  const teen = day % 100 >= 11 && day % 100 <= 13;
  const suffix = teen ? 'th' : day % 10 === 1 ? 'st' : day % 10 === 2 ? 'nd' : day % 10 === 3 ? 'rd' : 'th';
  return `${day}${suffix}`;
}

/** "30th of the run's month", "1st of the following month, a month in arrears" — the words the audit uses. */
export function describePayDate(rule: PayDateRule, paidInArrears = false): string {
  return `${ordinal(rule.payDay)} of ${rule.monthOffset === 1 ? 'the following month' : "the run's month"}${paidInArrears ? ', a month in arrears' : ''}`;
}

/**
 * The date a rule falls on, as YYYY-MM-DD: in the run's month, or in the month
 * after it. `period` is any day of the run's month (its first day, as runs
 * store it).
 */
export function scheduledPayDate(period: Date, rule: PayDateRule): string {
  const year = period.getUTCFullYear();
  const month = period.getUTCMonth() + (rule.monthOffset === 1 ? 1 : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(1, rule.payDay), lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

/** One payslip line, as the split reads it: earnings carry money to a date, everything else is taken off. */
export interface PaySplitLine {
  readonly code: string;
  /** EARNING, WAGE_REDUCTION or DEDUCTION (`ComponentKind`). */
  readonly kind: string;
  /** Always positive; `kind` carries the sign. */
  readonly amountCents: number;
}

/** What one date pays one person. `netCents` is the transfer. */
export interface PaySplit {
  readonly date: string;
  readonly earningsCents: number;
  readonly deductionCents: number;
  readonly netCents: number;
}

/**
 * ONE PERSON'S NET PAY, SPLIT ACROSS THE DATES THEIR ITEMS ARE PAID ON.
 *
 * Each earning goes to its item's date. Everything taken off the month — the
 * statutory deductions, wage reductions such as unpaid leave and the
 * deductions after statutory — is taken from the SALARY payment first, the
 * date basic pay is paid on, because the statutory figures are worked out on
 * the whole month and the salary is where a clinic withholds them. If the
 * salary payment cannot carry all of it, the rest comes off the other dates in
 * date order, so no transfer is ever negative while the month's net is not.
 *
 * The total taken off is earnings less the approved net, not a sum of its
 * parts recomputed here, so the dates add up to the net to the sen whatever
 * the engine withheld.
 */
export function splitByPayDate(args: {
  period: Date;
  lines: readonly PaySplitLine[];
  netCents: number;
  ruleOf: (code: string) => PayDateRule;
}): { lineDates: (string | null)[]; payments: PaySplit[] } {
  const dateOf = (code: string) => scheduledPayDate(args.period, args.ruleOf(code));
  const lineDates = args.lines.map((line) => (line.kind === 'EARNING' ? dateOf(line.code) : null));

  const earnings = new Map<string, number>();
  args.lines.forEach((line, index) => {
    const date = lineDates[index];
    if (date !== null) earnings.set(date, (earnings.get(date) ?? 0) + line.amountCents);
  });
  const basic = args.lines.findIndex((line) => line.code === 'BASIC' && line.kind === 'EARNING');
  const dates = [...earnings.keys()].sort();
  const salaryDate =
    basic >= 0 ? lineDates[basic]! : (dates.find((date) => (earnings.get(date) ?? 0) > 0) ?? dateOf('BASIC'));
  if (!earnings.has(salaryDate)) earnings.set(salaryDate, 0);

  const totalEarnings = [...earnings.values()].reduce((sum, cents) => sum + cents, 0);
  let toTake = totalEarnings - args.netCents;
  const taken = new Map<string, number>();
  for (const date of [salaryDate, ...[...earnings.keys()].filter((date) => date !== salaryDate).sort()]) {
    const take = toTake > 0 ? Math.min(toTake, Math.max(0, earnings.get(date) ?? 0)) : 0;
    taken.set(date, take);
    toTake -= take;
  }
  // A month whose deductions exceed its earnings (or that pays back more than
  // it earns) settles on the salary date: the run blocks a negative net, and
  // the sum still has to be the net.
  if (toTake !== 0) taken.set(salaryDate, (taken.get(salaryDate) ?? 0) + toTake);

  const payments = [...earnings.keys()].sort().map((date) => {
    const earningsCents = earnings.get(date) ?? 0;
    const deductionCents = taken.get(date) ?? 0;
    return { date, earningsCents, deductionCents, netCents: earningsCents - deductionCents };
  });
  return { lineDates, payments };
}
