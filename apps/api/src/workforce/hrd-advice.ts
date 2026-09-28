/**
 * WHY THE HRD LEVY IS A DASH — the employer-level answer for a run whose
 * lines carry a null levy.
 *
 * The engine writes a note on every such line; this is the one sentence the
 * run needs beside them. "3 not worked out" alone sent a clinic that had
 * just recorded its s.14 registration looking for a bug, when the class was
 * simply dated after the months it was looking at: a class is in force from
 * its date, a month is worked out once, and an approved month keeps what it
 * was approved with.
 */
export interface HrdEmployerRow {
  name: string;
  /** The latest dated class row on file, or null when none was ever recorded. */
  latest: { effectiveFrom: Date; hrdRegistration: string; createdAt: Date } | null;
}

// Spelled by hand: ICU renders September as "Sept" in en-GB, and a date in a
// sentence should not depend on which Node the API runs on.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateLabel = (date: Date) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

export function hrdAdviceFor(input: {
  employers: HrdEmployerRow[];
  /** The last day of the run's month — the day a class must be in force by to apply. */
  lastDay: Date;
  runStatus: string;
  calculatedAt: Date | null;
  /** "September 2026". */
  monthName: string;
  notWorkedOut: number;
}): string | null {
  const { employers, lastDay, runStatus, calculatedAt, monthName, notWorkedOut } = input;
  if (notWorkedOut <= 0) return null;
  const people = notWorkedOut === 1 ? '1 person' : `${notWorkedOut} people`;
  if (employers.length === 0) {
    return (
      `${people} ${notWorkedOut === 1 ? 'has' : 'have'} no employing company on record, so no HRD Corp class applies to them. ` +
      'Put them on a company under Settings, Company and statutory, then recalculate.'
    );
  }
  return employers
    .map((employer) => {
      const latest = employer.latest;
      if (!latest) {
        return (
          `Whether ${employer.name} is registered with HRD Corp is not recorded, so the levy was not worked out. ` +
          'Record its class under Settings, Company and statutory, then recalculate this month.'
        );
      }
      if (latest.effectiveFrom.getTime() > lastDay.getTime()) {
        return (
          `${employer.name}’s HRD Corp class is recorded from ${dateLabel(latest.effectiveFrom)}, after ${monthName}, ` +
          'so no levy was worked out for this month. If the registration was in force earlier, record it from that date.'
        );
      }
      if (calculatedAt && latest.createdAt.getTime() > calculatedAt.getTime()) {
        if (runStatus === 'PAID') {
          return (
            `${employer.name}’s HRD Corp class covers ${monthName} but was recorded after this month was worked out. ` +
            'The month is paid and cannot be reopened, so its levy has to be settled outside Kuwick.'
          );
        }
        if (runStatus === 'APPROVED') {
          return (
            `${employer.name}’s HRD Corp class covers ${monthName} but was recorded after this month was worked out. ` +
            'Reopen the month, recalculate and approve it again to include the levy.'
          );
        }
        return `${employer.name}’s HRD Corp class covers ${monthName} but this month was worked out before it was recorded. Recalculate to include the levy.`;
      }
      return `${employer.name}’s HRD Corp class covers ${monthName}; the levy could not be worked out for ${people} for a reason on their own row — hover the dash.`;
    })
    .join(' ');
}
