import { DEFAULT_PAY_DATE, describePayDate, ordinal, scheduledPayDate } from './pay-dates';

describe('pay dates', () => {
  const october = new Date('2026-10-01T00:00:00.000Z');

  it('puts the three dates a clinic pays a month on where the clinic said', () => {
    expect(scheduledPayDate(october, { payDay: 30, payMonthOffset: 0 })).toBe('2026-10-30');
    expect(scheduledPayDate(october, { payDay: 1, payMonthOffset: 1 })).toBe('2026-11-01');
    expect(scheduledPayDate(october, { payDay: 15, payMonthOffset: 1 })).toBe('2026-11-15');
  });

  it('pays a day the month does not have on its last day, and crosses the year', () => {
    expect(scheduledPayDate(new Date('2027-02-01T00:00:00.000Z'), DEFAULT_PAY_DATE)).toBe('2027-02-28');
    expect(scheduledPayDate(new Date('2028-02-01T00:00:00.000Z'), { payDay: 31, payMonthOffset: 0 })).toBe('2028-02-29');
    expect(scheduledPayDate(new Date('2026-01-01T00:00:00.000Z'), { payDay: 30, payMonthOffset: 1 })).toBe('2026-02-28');
    expect(scheduledPayDate(new Date('2026-12-01T00:00:00.000Z'), { payDay: 15, payMonthOffset: 1 })).toBe('2027-01-15');
  });

  it('says the date in words', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30, 31].map(ordinal)).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th', '31st',
    ]);
    expect(describePayDate(DEFAULT_PAY_DATE)).toBe('30th of the payroll month');
    expect(describePayDate({ payDay: 15, payMonthOffset: 1 })).toBe('15th of the next month');
  });
});
