/**
 * A JOINER'S MEDICAL BENEFIT (Section F, decision 11): the whole months left
 * in the year ÷ 12 × the yearly limit, to the sen. The joining month counts
 * when somebody joined on or before the clinic's cut-off day; with no cut-off
 * set it never counts. Somebody employed before the year gets the full limit.
 */
export function proratedAllowanceCents(
  yearlyLimitCents: number,
  year: number,
  startDate: Date | null,
  joiningMonthCutoffDay: number | null,
): number {
  if (!startDate || startDate.getUTCFullYear() < year) return yearlyLimitCents;
  if (startDate.getUTCFullYear() > year) return 0;
  const joinMonth = startDate.getUTCMonth(); // 0 = January
  const joiningCounts = joiningMonthCutoffDay !== null && startDate.getUTCDate() <= joiningMonthCutoffDay;
  const months = 12 - joinMonth - (joiningCounts ? 0 : 1);
  return Math.round((yearlyLimitCents * Math.max(0, months)) / 12);
}

/** The warning: what is left has fallen to the clinic's alert level. */
export function benefitAlert(allowanceCents: number, usedCents: number, alertBelowPercent: number): 'OVERDRAWN' | 'LOW' | null {
  if (usedCents > allowanceCents) return 'OVERDRAWN';
  if (allowanceCents > 0 && (allowanceCents - usedCents) * 100 <= allowanceCents * alertBelowPercent) return 'LOW';
  return null;
}
