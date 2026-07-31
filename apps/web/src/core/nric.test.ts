import { describe, expect, it } from 'vitest';
import { parseNric } from './nric';

describe('parseNric', () => {
  it('extracts DOB and gender from a valid NRIC (odd last digit = male)', () => {
    const result = parseNric('900101015001');
    expect(result?.dob.format('YYYY-MM-DD')).toBe('1990-01-01');
    expect(result?.gender).toBe('Male');
  });

  it('extracts gender as female for an even last digit', () => {
    const result = parseNric('900101015002');
    expect(result?.gender).toBe('Female');
  });

  it('accepts dashes as typed on a physical card', () => {
    const result = parseNric('900101-01-5001');
    expect(result?.dob.format('YYYY-MM-DD')).toBe('1990-01-01');
  });

  it('picks the 2000s century for a YY at or below the current two-digit year', () => {
    const result = parseNric('050101015001');
    expect(result?.dob.year()).toBe(2005);
  });

  it('returns null for the wrong digit count', () => {
    expect(parseNric('90010101500')).toBeNull();
    expect(parseNric('9001010150011')).toBeNull();
  });

  it('returns null for an impossible calendar date', () => {
    expect(parseNric('990230015001')).toBeNull(); // Feb 30
    expect(parseNric('991301015001')).toBeNull(); // month 13
  });
});
