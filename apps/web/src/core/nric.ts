import dayjs from 'dayjs';

export interface NricInfo {
  dob: dayjs.Dayjs;
  gender: 'Male' | 'Female';
}

// Malaysian NRIC: YYMMDD-PB-###G (12 digits, dashes optional as typed).
// YYMMDD is DOB; the century is ambiguous in the number itself, so we pick
// whichever of 19YY/20YY doesn't put the birth date in the future — the
// standard heuristic every MyKad-reading system uses (Phase A2 — manual
// entry only for now per docs/DECISIONS.md, no physical reader hardware).
// The last digit of the serial is odd for male, even for female.
export function parseNric(value: string): NricInfo | null {
  const digits = value.replace(/[^0-9]/g, '');
  if (digits.length !== 12) {
    return null;
  }

  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  const lastDigit = Number(digits.slice(11, 12));

  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
    return null;
  }

  const currentYY = dayjs().year() % 100;
  const century = yy <= currentYY ? 2000 : 1900;
  const fullYear = century + yy;
  const dob = dayjs(new Date(fullYear, mm - 1, dd));
  // Rejects roll-over dates (e.g. "310230" -> Feb 30) since the round trip
  // through JS Date won't match what was typed.
  if (dob.year() !== fullYear || dob.month() !== mm - 1 || dob.date() !== dd || dob.isAfter(dayjs())) {
    return null;
  }

  return { dob, gender: lastDigit % 2 === 1 ? 'Male' : 'Female' };
}
