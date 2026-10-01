/**
 * A MALAYSIAN IC, READ ON THE SERVER. YYMMDD-PB-###G: the first six digits
 * are the birth date, the last is odd for a man and even for a woman. The
 * same reading the browser does in `apps/web/src/core/nric.ts`, kept in step
 * by `nric.spec.ts`, so the single form and the bulk grid cannot accept
 * different ICs. Dashes are accepted as typed on the card.
 *
 * The century is not in the number: YY at or below the current two-digit
 * year reads as 20YY, anything later as 19YY, which is what every MyKad
 * reader assumes and is right for everybody of working age.
 */
export interface NricReading {
  /** Midnight UTC on the birth date, the way the profile stores it. */
  dateOfBirth: Date;
  gender: 'MALE' | 'FEMALE';
  /** The twelve digits, dashes removed: the form a duplicate check compares. */
  digits: string;
}

export function nricDigits(value: string): string {
  return value.replace(/[^0-9]/g, '');
}

export function readNric(value: string, today: Date = new Date()): NricReading | null {
  const digits = nricDigits(value);
  if (digits.length !== 12) return null;
  const yy = Number(digits.slice(0, 2));
  const mm = Number(digits.slice(2, 4));
  const dd = Number(digits.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const currentYY = today.getUTCFullYear() % 100;
  const year = (yy <= currentYY ? 2000 : 1900) + yy;
  const dateOfBirth = new Date(Date.UTC(year, mm - 1, dd));
  // A roll-over date (30 February) does not survive the round trip.
  if (dateOfBirth.getUTCFullYear() !== year || dateOfBirth.getUTCMonth() !== mm - 1 || dateOfBirth.getUTCDate() !== dd) return null;
  if (dateOfBirth.getTime() > today.getTime()) return null;
  return { dateOfBirth, gender: Number(digits[11]) % 2 === 1 ? 'MALE' : 'FEMALE', digits };
}
