import { BadRequestException } from '@nestjs/common';
import { assertDateOrder, parseDateParam, parseDateRangeParams, parseOptionalDateParam, toDateParam } from './query-dates';
import { OptionalDateParam, RequiredDateParam, RequiredMonthParam } from './date-param.pipe';

/**
 * These exist because of a real defect, not a hypothetical one: GET
 * /finance/payments and GET /finance/day-end both returned a bare 500
 * "Internal server error" when their date parameter was simply left off. The
 * string "undefined" reached `new Date()`, the Invalid Date reached Prisma,
 * and the caller was told the server was broken.
 */
describe('query date parameters', () => {
  describe('parseDateParam', () => {
    it('parses a calendar date to UTC midnight', () => {
      expect(parseDateParam('2026-08-28', 'date').toISOString()).toBe('2026-08-28T00:00:00.000Z');
    });

    it('accepts a full ISO instant and keeps only the calendar day', () => {
      // The business day is a date, not a moment. Two screens passing
      // "2026-08-28" and "2026-08-28T15:04:00Z" must report the same day.
      expect(parseDateParam('2026-08-28T15:04:00.000Z', 'date').toISOString()).toBe('2026-08-28T00:00:00.000Z');
    });

    it('refuses a missing parameter with a 400 that names it', () => {
      expect(() => parseDateParam(undefined, 'from')).toThrow(BadRequestException);
      expect(() => parseDateParam(undefined, 'from')).toThrow(/from is required/);
    });

    it('refuses an empty parameter', () => {
      expect(() => parseDateParam('', 'date')).toThrow(BadRequestException);
    });

    it('refuses something that is not a date at all', () => {
      expect(() => parseDateParam('last-week', 'from')).toThrow(/YYYY-MM-DD/);
    });

    it('refuses a date that does not exist, rather than rolling it forward', () => {
      // `new Date('2026-02-31')` silently becomes March 3rd. A report run for
      // a day the caller did not ask for is worse than one that refuses.
      expect(() => parseDateParam('2026-02-31', 'date')).toThrow(/not a real date/);
      expect(() => parseDateParam('2026-13-01', 'date')).toThrow(BadRequestException);
    });

    it('accepts a leap day in a leap year and refuses it otherwise', () => {
      expect(parseDateParam('2028-02-29', 'date').toISOString()).toBe('2028-02-29T00:00:00.000Z');
      expect(() => parseDateParam('2026-02-29', 'date')).toThrow(/not a real date/);
    });
  });

  describe('parseOptionalDateParam', () => {
    it('lets an absent filter stay absent', () => {
      expect(parseOptionalDateParam(undefined, 'from')).toBeUndefined();
      expect(parseOptionalDateParam('', 'from')).toBeUndefined();
    });

    it('still refuses a present but malformed filter', () => {
      expect(() => parseOptionalDateParam('nonsense', 'from')).toThrow(BadRequestException);
    });
  });

  describe('parseDateRangeParams', () => {
    it('returns both ends of a valid range', () => {
      const range = parseDateRangeParams('2026-08-01', '2026-08-31');
      expect(toDateParam(range.from)).toBe('2026-08-01');
      expect(toDateParam(range.to)).toBe('2026-08-31');
    });

    it('allows a single-day range', () => {
      const range = parseDateRangeParams('2026-08-28', '2026-08-28');
      expect(toDateParam(range.from)).toBe(toDateParam(range.to));
    });

    it('refuses an inverted range instead of reporting an empty week', () => {
      // The one wrong answer a finance screen must never give is "there was
      // no business", so a backwards range is an error, not zero rows.
      expect(() => parseDateRangeParams('2026-08-31', '2026-08-01')).toThrow(/before/);
    });
  });

  describe('the pipes', () => {
    it('RequiredDateParam normalises to YYYY-MM-DD', () => {
      expect(new RequiredDateParam().transform('2026-08-28T09:15:00.000Z', { data: 'date' })).toBe('2026-08-28');
    });

    it('RequiredDateParam names the parameter it was applied to', () => {
      expect(() => new RequiredDateParam().transform(undefined as unknown as string, { data: 'asOf' })).toThrow(/asOf is required/);
    });

    it('OptionalDateParam passes undefined straight through', () => {
      expect(new OptionalDateParam().transform(undefined, { data: 'from' })).toBeUndefined();
    });

    it('RequiredMonthParam yields YYYY-MM and refuses a missing period', () => {
      expect(new RequiredMonthParam().transform('2026-07', { data: 'period' })).toBe('2026-07');
      expect(new RequiredMonthParam().transform('2026-07-19', { data: 'period' })).toBe('2026-07');
      expect(() => new RequiredMonthParam().transform(undefined as unknown as string, { data: 'period' })).toThrow(/period is required/);
    });
  });
});

describe('assertDateOrder', () => {
  it('accepts a forward range and a single day', () => {
    expect(() => assertDateOrder('2026-08-01', '2026-08-31')).not.toThrow();
    expect(() => assertDateOrder('2026-08-28', '2026-08-28')).not.toThrow();
  });

  it('refuses a backwards range', () => {
    // The pipes validate each parameter alone and cannot see the pair, so
    // without this a reversed range returned "nothing was received" — the one
    // wrong answer on a finance screen that gets acted on.
    expect(() => assertDateOrder('2026-08-31', '2026-08-01')).toThrow(BadRequestException);
  });

  it('says nothing when only one end is given', () => {
    expect(() => assertDateOrder('2026-08-01', undefined)).not.toThrow();
    expect(() => assertDateOrder(undefined, '2026-08-01')).not.toThrow();
  });
});
