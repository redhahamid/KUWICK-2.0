import dayjs from 'dayjs';

/**
 * "Resigned · 7 Jan 2026" — the day somebody left, where they are named, not
 * only on the Employment tab (UAT, 10 October 2026). A back-dated month pays
 * them up to that day, so the date is what a reader needs beside the word.
 */
export const leftLabel = (endDate: string | null | undefined): string =>
  endDate ? `Resigned · ${dayjs(endDate).format('D MMM YYYY')}` : 'Resigned';
