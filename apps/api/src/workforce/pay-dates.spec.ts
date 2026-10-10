import { DEFAULT_PAY_DATE, describePayDate, ordinal, PayDateRule, scheduledPayDate, splitByPayDate } from './pay-dates';

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

describe('one person’s net pay, split across the dates their items are paid on', () => {
  const october = new Date('2026-10-01T00:00:00.000Z');
  const RULES: Record<string, PayDateRule> = {
    DIRECTOR_FEE: { payDay: 1, payMonthOffset: 1 },
    OVERTIME: { payDay: 15, payMonthOffset: 1 },
    PANEL_CLAIM: { payDay: 15, payMonthOffset: 1 },
  };
  const ruleOf = (code: string) => RULES[code] ?? DEFAULT_PAY_DATE;
  const earning = (code: string, amountCents: number) => ({ code, kind: 'EARNING', amountCents });
  const sum = (payments: { netCents: number }[]) => payments.reduce((total, payment) => total + payment.netCents, 0);

  it('pays each item on its own date and takes the month’s deductions from the salary payment', () => {
    const lines = [
      earning('BASIC', 300_000),
      earning('DIRECTOR_FEE', 50_000),
      earning('OVERTIME', 20_000),
      earning('PANEL_CLAIM', 10_000),
      { code: 'UNIFORM', kind: 'DEDUCTION', amountCents: 5_000 },
    ];
    const { lineDates, payments } = splitByPayDate({ period: october, lines, netCents: 320_000, ruleOf });
    expect(lineDates).toEqual(['2026-10-30', '2026-11-01', '2026-11-15', '2026-11-15', null]);
    expect(payments).toEqual([
      { date: '2026-10-30', earningsCents: 300_000, deductionCents: 60_000, netCents: 240_000 },
      { date: '2026-11-01', earningsCents: 50_000, deductionCents: 0, netCents: 50_000 },
      { date: '2026-11-15', earningsCents: 30_000, deductionCents: 0, netCents: 30_000 },
    ]);
    expect(sum(payments)).toBe(320_000);
  });

  it('takes what the salary payment cannot carry from the next date, so no transfer goes below nil', () => {
    const lines = [earning('BASIC', 30_000), earning('DIRECTOR_FEE', 100_000), earning('OVERTIME', 10_000)];
    const { payments } = splitByPayDate({ period: october, lines, netCents: 90_000, ruleOf });
    expect(payments).toEqual([
      { date: '2026-10-30', earningsCents: 30_000, deductionCents: 30_000, netCents: 0 },
      { date: '2026-11-01', earningsCents: 100_000, deductionCents: 20_000, netCents: 80_000 },
      { date: '2026-11-15', earningsCents: 10_000, deductionCents: 0, netCents: 10_000 },
    ]);
  });

  it('with no basic pay, withholds from the first date that pays anything', () => {
    const { payments } = splitByPayDate({
      period: october,
      lines: [earning('DIRECTOR_FEE', 100_000), earning('OVERTIME', 5_000)],
      netCents: 95_000,
      ruleOf,
    });
    expect(payments.map((payment) => [payment.date, payment.netCents])).toEqual([
      ['2026-11-01', 90_000],
      ['2026-11-15', 5_000],
    ]);
  });

  it('is one payment of the whole net when every item is paid on the same date', () => {
    const { payments } = splitByPayDate({
      period: october,
      lines: [earning('BASIC', 250_000), earning('ALLOWANCE', 20_000), { code: 'UNPAID_LEAVE', kind: 'WAGE_REDUCTION', amountCents: 8_000 }],
      netCents: 230_000,
      ruleOf: () => DEFAULT_PAY_DATE,
    });
    expect(payments).toEqual([{ date: '2026-10-30', earningsCents: 270_000, deductionCents: 40_000, netCents: 230_000 }]);
  });

  it('adds up to the net even when the month’s net is below nil, settling the difference on the salary date', () => {
    const { payments } = splitByPayDate({
      period: october,
      lines: [earning('BASIC', 10_000), earning('OVERTIME', 5_000)],
      netCents: -2_000,
      ruleOf,
    });
    expect(sum(payments)).toBe(-2_000);
    // Every date is taken to nil first; what is still owed sits on the salary date.
    expect(payments[0]).toMatchObject({ date: '2026-10-30', netCents: -2_000 });
    expect(payments[1]).toMatchObject({ date: '2026-11-15', netCents: 0 });
  });
});
