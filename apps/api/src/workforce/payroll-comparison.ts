import { formatCents, toCents } from '../finance/money';

/**
 * THIS MONTH BESIDE THE ONE BEFORE (new-clinic UAT #2 re-check, item 81).
 *
 * The Review step said "Compare with October" and showed nothing. This is
 * the comparison it promised: four totals side by side, and one line per
 * person whose net pay moved, saying why in words ("joined 15 Oct, part
 * month in October"). Read off the lines the engine wrote; nothing is
 * recalculated here.
 */
export interface ComparableLine {
  staffId: string;
  name: string;
  grossPay: unknown;
  netPay: unknown;
  employerCost: unknown;
  basicSalary: unknown;
  overtimePay: unknown;
  unpaidLeaveDeduction: unknown;
}

export interface MonthComparison {
  previousLabel: string;
  currentLabel: string;
  totals: { label: string; previous: string; current: string; change: string }[];
  people: { staffId: string; name: string; previousNet: string | null; currentNet: string | null; change: string; reason: string }[];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
const sameMonth = (date: Date | null | undefined, month: Date) =>
  Boolean(date) && date!.getUTCFullYear() === month.getUTCFullYear() && date!.getUTCMonth() === month.getUTCMonth();
const signed = (cents: number) => (cents > 0 ? `+${formatCents(cents)}` : formatCents(cents));

function sums(lines: ComparableLine[]) {
  return lines.reduce(
    (total, line) => {
      const gross = toCents(line.grossPay as never);
      const net = toCents(line.netPay as never);
      return {
        gross: total.gross + gross,
        deductions: total.deductions + (gross - net),
        net: total.net + net,
        cost: total.cost + toCents(line.employerCost as never),
      };
    },
    { gross: 0, deductions: 0, net: 0, cost: 0 },
  );
}

/** Why one person's net pay moved, in a few words. */
function reasonFor(args: {
  previous: ComparableLine | undefined;
  current: ComparableLine | undefined;
  startDate: Date | null;
  endDate: Date | null;
  previousMonth: Date;
  currentMonth: Date;
  previousLabel: string;
  currentLabel: string;
}): string {
  const { previous, current, startDate, endDate } = args;
  if (!previous && current) {
    return sameMonth(startDate, args.currentMonth) ? `Joined ${shortDate(startDate!)}, part month` : `Not paid in ${args.previousLabel}`;
  }
  if (previous && !current) {
    return endDate && endDate < new Date(Date.UTC(args.currentMonth.getUTCFullYear(), args.currentMonth.getUTCMonth() + 1, 1))
      ? `Left ${shortDate(endDate)}`
      : `Not paid in ${args.currentLabel}`;
  }
  const was = previous!;
  const now = current!;
  if (sameMonth(startDate, args.previousMonth)) return `Joined ${shortDate(startDate!)}, part month in ${args.previousLabel}`;
  if (sameMonth(endDate, args.currentMonth)) return `Left ${shortDate(endDate!)}, part month`;
  const moved = (field: keyof ComparableLine) => toCents(was[field] as never) !== toCents(now[field] as never);
  if (moved('basicSalary')) return 'Basic pay changed';
  if (moved('unpaidLeaveDeduction')) return 'Unpaid leave';
  if (moved('overtimePay')) return 'Overtime';
  if (moved('grossPay')) return 'Allowances or other pay';
  return 'Deductions changed';
}

export function compareMonths(args: {
  previous: ComparableLine[];
  current: ComparableLine[];
  /** Start and end dates of everybody on either list. */
  employment: Map<string, { startDate: Date | null; endDate: Date | null }>;
  previousMonth: Date;
  currentMonth: Date;
  previousLabel: string;
  currentLabel: string;
}): MonthComparison {
  const before = sums(args.previous);
  const after = sums(args.current);
  const row = (label: string, previous: number, current: number) => ({
    label,
    previous: formatCents(previous),
    current: formatCents(current),
    change: signed(current - previous),
  });
  const previousBy = new Map(args.previous.map((line) => [line.staffId, line]));
  const currentBy = new Map(args.current.map((line) => [line.staffId, line]));
  const everybody = [...new Set([...currentBy.keys(), ...previousBy.keys()])];
  const people = everybody
    .map((staffId) => {
      const previous = previousBy.get(staffId);
      const current = currentBy.get(staffId);
      const was = previous ? toCents(previous.netPay as never) : 0;
      const now = current ? toCents(current.netPay as never) : 0;
      if (was === now && previous && current) return null;
      const dates = args.employment.get(staffId) ?? { startDate: null, endDate: null };
      return {
        staffId,
        name: (current ?? previous)!.name,
        previousNet: previous ? formatCents(was) : null,
        currentNet: current ? formatCents(now) : null,
        change: signed(now - was),
        reason: reasonFor({
          previous,
          current,
          ...dates,
          previousMonth: args.previousMonth,
          currentMonth: args.currentMonth,
          previousLabel: args.previousLabel,
          currentLabel: args.currentLabel,
        }),
      };
    })
    .filter((person): person is NonNullable<typeof person> => person !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    previousLabel: args.previousLabel,
    currentLabel: args.currentLabel,
    totals: [
      row('Gross pay', before.gross, after.gross),
      row('Employee deductions', before.deductions, after.deductions),
      row('Net pay', before.net, after.net),
      row('Cost to the clinic', before.cost, after.cost),
    ],
    people,
  };
}
