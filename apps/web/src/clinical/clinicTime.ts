import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

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
 * TIMEZONE — THE CLINIC'S, NOT THE READER'S.
 *
 * This used to render in the browser's local zone, on the stated grounds that
 * "Kuwick does not yet store a per-tenant IANA timezone". It does:
 * `Clinic.timezone`, defaulting to Asia/Kuala_Lumpur, and the consultation
 * tariff has been converting through it for real since D-090. This is the
 * change that comment promised.
 *
 * The reader's zone is the wrong answer even when it usually agrees. A clinic
 * record is a statement about when something happened AT THE CLINIC; an owner
 * checking the diary from Jakarta must see the same 09:00 the front desk sees,
 * not 08:00. The browser's zone is a fact about the laptop, not the clinic.
 *
 * `setClinicTimeZone` is called once, from the session, at app boot. Until it
 * is, the Malaysian default stands — which is the same answer the old code
 * gave on a Malaysian machine, so nothing regresses while it is being wired.
 */

/**
 * The zone every formatter below renders in. Module-level because these are
 * plain functions called from several dozen components, and threading a zone
 * through all of them would put the same value in fifty prop lists — where
 * fifty places could get it wrong instead of one.
 */
let clinicTimeZone = 'Asia/Kuala_Lumpur';

export function setClinicTimeZone(zone: string | null | undefined): void {
  // A blank or unknown zone leaves the default standing rather than throwing
  // in a formatter: a diary that renders in the wrong zone is a bug, and a
  // diary that renders nothing at all is an outage.
  if (!zone) return;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
  } catch {
    return;
  }
  clinicTimeZone = zone;
}

export function getClinicTimeZone(): string {
  return clinicTimeZone;
}

/** Every formatter goes through this — one conversion, one answer. */
function inClinicZone(value: string | Date) {
  return dayjs(value).tz(clinicTimeZone);
}

/**
 * A dayjs in the clinic's zone, for callers that need to do more than format —
 * compare two instants by calendar day, group a diary into date cells.
 *
 * Exported so those callers do not reach for a bare `dayjs()` and quietly
 * reintroduce the reader's zone. A canvas month cell and an appointments list
 * that disagree about which day a booking falls on is the same defect class
 * this whole convention exists to close.
 */
export function clinicDayjs(value: string | Date | number) {
  return dayjs(value).tz(clinicTimeZone);
}

export const CLINIC_DATE = 'D MMM YYYY';
export const CLINIC_TIME = 'HH:mm';
export const CLINIC_DATE_SHORT = 'D MMM';

/** `3 Aug 2026 · 17:19` — the full stamp. */
export function formatClinicDateTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return inClinicZone(value).format(`${CLINIC_DATE} · ${CLINIC_TIME}`);
}

/** `3 Aug 2026` */
export function formatClinicDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  return inClinicZone(value).format(CLINIC_DATE);
}

/** `17:19` */
export function formatClinicTime(value: string | Date | null | undefined): string {
  if (!value) return '';
  return inClinicZone(value).format(CLINIC_TIME);
}

/** `3 Aug` — for the mobile snapshot, where the year is noise. */
export function formatClinicDateShort(value: string | Date | null | undefined): string {
  if (!value) return '';
  return inClinicZone(value).format(CLINIC_DATE_SHORT);
}
