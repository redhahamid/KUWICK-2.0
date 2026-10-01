import { readNric } from './nric';

/**
 * The same fixtures as the browser's `nric.test.ts`, so the two readings
 * cannot drift: an IC the form accepts is an IC the server accepts.
 */
describe('reading a Malaysian IC on the server', () => {
  const today = new Date('2026-10-01T00:00:00.000Z');

  it('reads the birth date and the gender, odd last digit for a man', () => {
    const read = readNric('900101015001', today)!;
    expect(read.dateOfBirth.toISOString().slice(0, 10)).toBe('1990-01-01');
    expect(read.gender).toBe('MALE');
    expect(readNric('900101015002', today)!.gender).toBe('FEMALE');
  });

  it('accepts dashes as typed on the card, and keeps the digits for a duplicate check', () => {
    const read = readNric('900101-01-5001', today)!;
    expect(read.dateOfBirth.toISOString().slice(0, 10)).toBe('1990-01-01');
    expect(read.digits).toBe('900101015001');
  });

  it('picks the 2000s for a year at or below the current two-digit year', () => {
    expect(readNric('050101015001', today)!.dateOfBirth.getUTCFullYear()).toBe(2005);
    expect(readNric('850505105571', today)!.dateOfBirth.getUTCFullYear()).toBe(1985);
  });

  it('refuses the wrong digit count and an impossible date', () => {
    expect(readNric('90010101500', today)).toBeNull();
    expect(readNric('9001010150011', today)).toBeNull();
    expect(readNric('990230015001', today)).toBeNull();
    expect(readNric('991301015001', today)).toBeNull();
  });
});
