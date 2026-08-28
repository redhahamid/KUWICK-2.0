import { formatCents, fromCents, percentOfCents, sumCents, toCents, toThousandths } from './money';

describe('money', () => {
  describe('toCents', () => {
    it('parses the shapes the database and DTOs actually produce', () => {
      expect(toCents('120.00')).toBe(12000);
      expect(toCents(120)).toBe(12000);
      expect(toCents({ toString: () => '120.00' })).toBe(12000);
      expect(toCents(null)).toBe(0);
      expect(toCents(undefined)).toBe(0);
      expect(toCents('')).toBe(0);
    });

    it('keeps exactly two decimals, rounding the third half away from zero', () => {
      expect(toCents('0.125')).toBe(13);
      expect(toCents('0.124')).toBe(12);
      expect(toCents('-0.125')).toBe(-13);
    });

    it('does not drift the way float addition does', () => {
      // The whole reason this module exists.
      expect(0.1 + 0.2).not.toBe(0.3);
      expect(fromCents(toCents('0.10') + toCents('0.20'))).toBe(0.3);
    });

    it('adds a hundred small amounts without a residue', () => {
      const cents = sumCents(Array.from({ length: 100 }, () => '0.07'));
      expect(cents).toBe(700);
      expect(fromCents(cents)).toBe(7);
    });

    it('refuses a value that is not money rather than silently returning zero', () => {
      expect(() => toCents('twelve ringgit')).toThrow(TypeError);
    });
  });

  describe('percentOfCents', () => {
    it('computes SST at 6% exactly', () => {
      expect(percentOfCents(10000, '6.000')).toBe(600);
      expect(percentOfCents(12345, '6.000')).toBe(741); // 740.7 → 741
    });

    it('keeps the third decimal place of a rate', () => {
      // toCents would round 6.375 to 6.38 and change the answer.
      expect(toThousandths('6.375')).toBe(6375);
      expect(percentOfCents(100000, '6.375')).toBe(6375);
    });

    it('rounds half away from zero, not toward even', () => {
      // 8.33 * 6% = 0.4998 → 50 cents
      expect(percentOfCents(833, '6.000')).toBe(50);
    });

    it('is zero for a zero rate and a zero base', () => {
      expect(percentOfCents(10000, '0')).toBe(0);
      expect(percentOfCents(0, '6.000')).toBe(0);
    });
  });

  describe('formatCents', () => {
    it('always shows two decimals, including negatives', () => {
      expect(formatCents(0)).toBe('0.00');
      expect(formatCents(5)).toBe('0.05');
      expect(formatCents(12345)).toBe('123.45');
      expect(formatCents(-12345)).toBe('-123.45');
    });
  });
});
