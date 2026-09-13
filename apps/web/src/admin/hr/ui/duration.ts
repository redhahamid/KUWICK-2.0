/**
 * HOW LONG, IN THE WORDS THE REST OF THE PRODUCT USES.
 *
 * Payroll reports hours to ONE decimal — the register grid, the employee
 * payroll page, the payslip lines — so the attendance screens do too. A month
 * reading `88.0 h` to the owner and `88.00 h` to the employee invites the
 * question of which figure payroll used, and the answer is neither: pay is
 * computed from MINUTES at full precision in `overtime-pricing.ts`. Every
 * figure here is read, never paid on.
 *
 * BUT A DURATION THAT ROUNDS TO 0.0 IS NOT ZERO. A day of two one-minute
 * pairs printed as `0.0 h` beside two visible punches tells the owner nothing
 * happened, which is false — and it is false in the direction that loses
 * somebody's time. Below the point where one decimal can carry the figure it
 * is given in minutes instead: the unit this screen already uses for lateness
 * and for the away gap between pairs.
 *
 * The threshold is not written down as a number. It is whatever one decimal
 * cannot express, asked directly, so the two can never disagree.
 */
export function duration(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return '—';
  const inHours = (minutes / 60).toFixed(1);
  if (minutes > 0 && Number(inHours) === 0) return `${minutes} min`;
  return `${inHours} h`;
}
