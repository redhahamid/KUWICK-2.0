import { kioskCode, onClinicNetwork, readKioskCode } from './attendance-qr';

/* The kiosk code (UAT, 14 October 2026): genuine, current, and useless as a photo. */
describe('the kiosk code', () => {
  const clinic = '11111111-2222-4333-8444-555555555555';
  const at = new Date('2026-10-14T01:00:10.000Z');
  beforeAll(() => {
    process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-secret';
  });

  it('accepts the code on screen, for its branch', () => {
    const { code } = kioskCode(clinic, at, 30);
    expect(readKioskCode(code, new Date(at.getTime() + 5_000), 30)).toEqual({ clinicId: clinic });
  });

  it('accepts the code just changed for a few seconds, then refuses it', () => {
    const { code, expiresAt } = kioskCode(clinic, at, 30);
    const changed = new Date(expiresAt).getTime();
    expect(readKioskCode(code, new Date(changed + 3_000), 30)).toEqual({ clinicId: clinic });
    expect(readKioskCode(code, new Date(changed + 10_000), 30)).toEqual({ refused: expect.stringMatching(/expired/) });
  });

  it('refuses a code nobody signed, or one moved to another branch', () => {
    const { code } = kioskCode(clinic, at, 30);
    const forged = code.replace(clinic, '99999999-2222-4333-8444-555555555555');
    expect(readKioskCode(forged, at, 30)).toEqual({ refused: expect.stringMatching(/not genuine/) });
    expect(readKioskCode('hello', at, 30)).toEqual({ refused: expect.stringMatching(/not a Kuwick/) });
  });

  it('matches the clinic network exactly or by prefix', () => {
    expect(onClinicNetwork('203.106.12.45', ['203.106.12.45'])).toBe(true);
    expect(onClinicNetwork('::ffff:203.106.12.9', ['203.106.12.'])).toBe(true);
    expect(onClinicNetwork('10.0.0.1', ['203.106.12.'])).toBe(false);
    expect(onClinicNetwork('10.0.0.1', [])).toBe(false);
  });
});
