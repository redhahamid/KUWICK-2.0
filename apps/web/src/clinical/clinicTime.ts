import dayjs from 'dayjs';

/**
 * G4.5d3 (D-077) — one date/time format for the whole clinical workspace.
 *
 * The Canvas was showing `17:19` in the context band and `1:19 AM` in the Last
 * Visit Snapshot for times on the same record, because each component picked
 * its own dayjs format string. Two clocks on one screen is a reading error
 * waiting to happen, and on a clinical record the time is evidence.
 *
 * Malaysian clinic presentation, 24-hour: `3 Aug 2026 · 17:19`.
 *
 * TIMEZONE: dayjs renders in the browser's local zone, which for a Malaysian
 * clinic on a Malaysian machine is the clinic's zone. Kuwick does not yet
 * store a per-tenant IANA timezone, so there is nothing truer to convert to —
 * inventing one here would be asserting a fact the database does not hold.
 * When a tenant timezone field exists, these three functions are the only
 * place that has to change.
 */

export const CLINIC_DATE = 'D MMM YYYY';
export const CLINIC_TIME = 'HH:mm';
export const CLINIC_DATE_SHORT = 'D MMM';

/** `3 Aug 2026 · 17:19` — the full stamp. */
export function formatClinicDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return dayjs(value).format(`${CLINIC_DATE} · ${CLINIC_TIME}`);
}

/** `3 Aug 2026` */
export function formatClinicDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  return dayjs(value).format(CLINIC_DATE);
}

/** `17:19` */
export function formatClinicTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return dayjs(value).format(CLINIC_TIME);
}

/** `3 Aug` — for the mobile snapshot, where the year is noise. */
export function formatClinicDateShort(value: string | Date | null | undefined): string {
  if (!value) return '';
  return dayjs(value).format(CLINIC_DATE_SHORT);
}
