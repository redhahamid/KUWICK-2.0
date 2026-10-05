import dayjs from 'dayjs';

/**
 * WORDS THE PAYROLL SCREENS PRINT FROM FIGURES — pure, so a test can read
 * them without rendering a page.
 */

/**
 * "Director's fee (April 2026)" for a line earned in another month, exactly as
 * the payslip and its PDF print it; the plain label when it was earned in the
 * month it is paid. `payMonth` is the run's month, "YYYY-MM".
 */
export function earnedInLabel(label: string, earnedPeriod: string | null | undefined, payMonth: string): string {
  if (!earnedPeriod) return label;
  const earned = dayjs(earnedPeriod);
  if (!earned.isValid() || earned.format('YYYY-MM') === payMonth) return label;
  return `${label} (${earned.format('MMMM YYYY')})`;
}

/**
 * WHAT A YEAR-TO-DATE CARD ADDS UP, in words.
 *
 * The range is the months actually summed ("Jan – Apr 2026"), not the month
 * the card sits beside: a month joins the year to date when it is approved,
 * so a May draft's card is January to April. A gap inside the range is named,
 * and so is the run's own month while it is not yet in.
 */
export function ytdSummary(
  months: number[],
  year: number,
  runMonth?: number,
): { range: string | null; gaps: string[]; pending: string | null; monthsOnRecord: number } {
  const unique = [...new Set(months)].filter((m) => m >= 1 && m <= 12).sort((a, b) => a - b);
  const name = (m: number, form: string) => dayjs(new Date(Date.UTC(year, m - 1, 1))).format(form);
  const first = unique[0];
  const last = unique[unique.length - 1];
  const range = unique.length === 0 ? null : first === last ? `${name(first, 'MMM')} ${year}` : `${name(first, 'MMM')} – ${name(last, 'MMM')} ${year}`;
  const gaps: string[] = [];
  for (let m = first; unique.length > 1 && m < last; m += 1) {
    if (!unique.includes(m)) gaps.push(name(m, 'MMMM'));
  }
  const pending = runMonth !== undefined && !unique.includes(runMonth) ? name(runMonth, 'MMMM') : null;
  return { range, gaps, pending, monthsOnRecord: unique.length };
}
