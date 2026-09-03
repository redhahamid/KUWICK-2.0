import { overtimeScope } from '../statutory/employment-act';
import { classifyDay, describePricedDay, priceDay, priceOvertime, WorkedDay } from './overtime-pricing';

/**
 * The figures below are the Act's, worked by hand from a RM3,120 monthly wage
 * so the arithmetic is checkable: ORP = 3120 / 26 = RM120 a day, and the hourly
 * rate = 120 / 8 = RM15.
 */
const AUGUST = new Date('2026-09-01T00:00:00.000Z');
/** RM3,120 a month — inside the First Schedule's RM4,000 limit. */
const STATUTORY = overtimeScope(312000, AUGUST, null);

const ctx = {
  basis: 'MONTHLY' as const,
  scope: STATUTORY,
  normalHoursPerDay: 8,
  dailyOrpCents: 12000,
  hourlyOrpCents: 1500,
};

const day = (over: Partial<WorkedDay> = {}): WorkedDay => ({
  attendanceId: 'a1',
  date: new Date('2026-08-12T00:00:00.000Z'), // a Wednesday
  workedMinutes: 480,
  overtimeMinutes: 0,
  overtimeApproved: false,
  ...over,
});

describe('which kind of day it was', () => {
  const SUNDAY = new Date('2026-08-16T00:00:00.000Z');
  const WEDNESDAY = new Date('2026-08-12T00:00:00.000Z');

  it('treats a designated rest day as one, and any other day as normal', () => {
    const context = { publicHolidayDates: new Set<string>(), restDayOfWeek: 0 };
    expect(classifyDay(SUNDAY, context)).toBe('REST_DAY');
    expect(classifyDay(WEDNESDAY, context)).toBe('NORMAL_DAY');
  });

  it('does NOT infer a rest day when none is designated', () => {
    // s.59 makes the rest day the employer's to designate and to tell the
    // employee. It is not the day the clinic happens to be shut, and Sunday is
    // not a default — assuming one would price somebody's Saturday wrongly in
    // whichever direction the assumption fell.
    const context = { publicHolidayDates: new Set<string>(), restDayOfWeek: null };
    expect(classifyDay(SUNDAY, context)).toBe('NORMAL_DAY');
  });

  it('lets a public holiday outrank a rest day it falls on', () => {
    // s.60D is the more generous provision, and a holiday on somebody's rest
    // day is still a holiday.
    const context = { publicHolidayDates: new Set(['2026-08-16']), restDayOfWeek: 0 };
    expect(classifyDay(SUNDAY, context)).toBe('PUBLIC_HOLIDAY');
  });
});

describe('a normal working day', () => {
  it('pays approved overtime at 1.5× and nothing for the day itself', () => {
    // The monthly salary already covers the day.
    const priced = priceDay(day({ overtimeMinutes: 120, overtimeApproved: true }), 'NORMAL_DAY', ctx);
    expect(priced.dayPayCents).toBe(0);
    expect(priced.excessPayCents).toBe(4500); // 2h × RM15 × 1.5
    expect(priced.totalCents).toBe(4500);
    expect(priced.provision).toMatch(/s\.60A\(3\)\(a\)/);
  });

  it('pays nothing for overtime nobody approved, but records the hours', () => {
    const priced = priceDay(day({ overtimeMinutes: 120, overtimeApproved: false }), 'NORMAL_DAY', ctx);
    expect(priced.totalCents).toBe(0);
    expect(priced.unapprovedExcessHours).toBe(2);
  });
});

describe('a rest day — s.60(3)', () => {
  it('pays HALF a day at the ordinary rate for up to half the normal hours', () => {
    // Two hours on a rest day is not "two hours of overtime". The Act owes a
    // monthly-rated employee half a day's wages.
    const priced = priceDay(day({ workedMinutes: 120 }), 'REST_DAY', ctx);
    expect(priced.ordinaryRateDays).toBe(0.5);
    expect(priced.dayPayCents).toBe(6000); // half of RM120
    expect(priced.totalCents).toBe(6000);
    // Under the old engine this was 2h × RM15 × 1.5 = RM45, an underpayment of RM15.
    expect(priced.totalCents).toBeGreaterThan(4500);
  });

  it('pays a WHOLE day once more than half the normal hours are worked', () => {
    const priced = priceDay(day({ workedMinutes: 300 }), 'REST_DAY', ctx); // 5h
    expect(priced.ordinaryRateDays).toBe(1);
    expect(priced.dayPayCents).toBe(12000);
  });

  it('adds 2× hourly for hours beyond the normal working day', () => {
    const priced = priceDay(day({ workedMinutes: 600, overtimeMinutes: 120, overtimeApproved: true }), 'REST_DAY', ctx);
    expect(priced.ordinaryRateDays).toBe(1);
    expect(priced.dayPayCents).toBe(12000);
    expect(priced.excessHours).toBe(2); // 10h worked, 8 normal
    expect(priced.excessPayCents).toBe(6000); // 2h × RM15 × 2
    expect(priced.totalCents).toBe(18000);
  });

  it('still pays the day rate when the excess was never approved', () => {
    // The entitlement arises from having worked the day, which the clock
    // recorded. Withholding it for a missing tick would withhold wages the Act
    // says are owed; the unapproved EXCESS is what waits for approval.
    const priced = priceDay(day({ workedMinutes: 600, overtimeMinutes: 120, overtimeApproved: false }), 'REST_DAY', ctx);
    expect(priced.dayPayCents).toBe(12000);
    expect(priced.excessPayCents).toBe(0);
    expect(priced.unapprovedExcessHours).toBe(2);
  });
});

describe('a paid public holiday — s.60D(3)', () => {
  it('pays TWO days at the ordinary rate however little was worked', () => {
    // "regardless that the period of work done on that day is less than the
    // normal hours of work". One hour on Hari Raya owes two days.
    const priced = priceDay(day({ workedMinutes: 60 }), 'PUBLIC_HOLIDAY', ctx);
    expect(priced.ordinaryRateDays).toBe(2);
    expect(priced.totalCents).toBe(24000);
    // The old engine paid 1h × RM15 × 1.5 = RM22.50 against RM240 owed.
    expect(priced.totalCents).toBeGreaterThan(2250);
  });

  it('adds 3× hourly beyond normal hours', () => {
    const priced = priceDay(
      day({ workedMinutes: 600, overtimeMinutes: 120, overtimeApproved: true }),
      'PUBLIC_HOLIDAY',
      ctx,
    );
    expect(priced.dayPayCents).toBe(24000);
    expect(priced.excessPayCents).toBe(9000); // 2h × RM15 × 3
    expect(priced.totalCents).toBe(33000);
  });
});

describe('a month of attendance', () => {
  it('totals the three kinds of day separately and names each', () => {
    const classify = (date: Date) =>
      classifyDay(date, { publicHolidayDates: new Set(['2026-08-31']), restDayOfWeek: 0 });
    const result = priceOvertime(
      [
        day({ attendanceId: 'w', date: new Date('2026-08-12T00:00:00.000Z'), overtimeMinutes: 120, overtimeApproved: true }),
        day({ attendanceId: 'r', date: new Date('2026-08-16T00:00:00.000Z'), workedMinutes: 300 }),
        day({ attendanceId: 'h', date: new Date('2026-08-31T00:00:00.000Z'), workedMinutes: 60 }),
      ],
      classify,
      ctx,
    );
    expect(result.normalDayHours).toBe(2);
    expect(result.restDaysWorked).toBe(1);
    expect(result.publicHolidaysWorked).toBe(1);
    expect(result.totalCents).toBe(4500 + 12000 + 24000);
    expect(result.days.map((d) => d.dayType)).toEqual(['NORMAL_DAY', 'REST_DAY', 'PUBLIC_HOLIDAY']);
  });

  it('drops days with nothing to pay rather than listing rows of nil', () => {
    const classify = () => 'NORMAL_DAY' as const;
    const result = priceOvertime([day(), day({ attendanceId: 'b' })], classify, ctx);
    expect(result.days).toHaveLength(0);
    expect(result.totalCents).toBe(0);
  });

  it('carries unapproved excess hours forward for the exception list', () => {
    const classify = () => 'NORMAL_DAY' as const;
    const result = priceOvertime([day({ overtimeMinutes: 90, overtimeApproved: false })], classify, ctx);
    expect(result.unapprovedExcessHours).toBe(1.5);
    expect(result.totalCents).toBe(0);
  });
});

describe('what the payslip says', () => {
  it('names the section, so a figure can be checked against the Act', () => {
    const rest = priceDay(day({ workedMinutes: 300 }), 'REST_DAY', ctx);
    expect(describePricedDay(rest)).toBe(
      '2026-08-12: worked a rest day — 1 day at the ordinary rate (Employment Act 1955, s.60(3)(b) and s.60(3)(c)).',
    );
    const normal = priceDay(day({ overtimeMinutes: 120, overtimeApproved: true }), 'NORMAL_DAY', ctx);
    expect(describePricedDay(normal)).toBe('2026-08-12: 2.00h overtime at 1.5× (Employment Act 1955, s.60A(3)(a)).');
  });
});

describe('who the Act actually reaches — the First Schedule', () => {
  it('applies ss.60, 60A and 60D up to RM4,000 a month', () => {
    expect(overtimeScope(400000, AUGUST, null)).toMatchObject({ withinFirstSchedule: true, basis: 'STATUTORY' });
  });

  it('stops applying one sen above the limit', () => {
    // "not exceeding" is exact. A boundary tested only at round numbers is a
    // boundary nobody has tested.
    const above = overtimeScope(400001, AUGUST, null);
    expect(above.withinFirstSchedule).toBe(false);
    expect(above.basis).toBe('NONE');
  });

  it('pays NOTHING above the limit when the employer undertook nothing', () => {
    // Not an underpayment: there is no entitlement to underpay. What would be
    // wrong is inventing one, or paying nil without anybody having decided.
    const scope = overtimeScope(900000, AUGUST, null);
    const priced = priceDay(day({ workedMinutes: 300 }), 'REST_DAY', { ...ctx, scope });
    expect(priced.totalCents).toBe(0);
    expect(priced.entitlement).toBe('NONE');
    expect(describePricedDay(priced)).toMatch(/nothing payable/);
  });

  it('pays above the limit as a COMPANY BENEFIT when the employer undertook to', () => {
    const scope = overtimeScope(900000, AUGUST, 'PAY_AT_STATUTORY_RATES');
    const priced = priceDay(day({ workedMinutes: 300 }), 'REST_DAY', { ...ctx, scope });
    expect(priced.entitlement).toBe('CONTRACTUAL');
    // Same money, different footing — and the payslip says which.
    expect(priced.totalCents).toBe(12000);
    expect(priced.provision).toMatch(/Company benefit/);
    expect(priced.provision).toMatch(/outside the First Schedule limit/);
  });

  it('pays nothing above the limit when the employer said it does not', () => {
    const scope = overtimeScope(900000, AUGUST, 'NOT_PAID');
    expect(priceDay(day({ workedMinutes: 300 }), 'REST_DAY', { ...ctx, scope }).totalCents).toBe(0);
  });

  it('ignores a contract that would pay LESS than the Act to somebody the Act reaches', () => {
    // s.60I(2): a contract may better the Act and may never worsen it, so
    // NOT_PAID cannot take statutory overtime away from a RM3,120 employee.
    const scope = overtimeScope(312000, AUGUST, 'NOT_PAID');
    expect(scope.basis).toBe('STATUTORY');
    expect(priceDay(day({ workedMinutes: 300 }), 'REST_DAY', { ...ctx, scope }).totalCents).toBe(12000);
  });

  it('refuses to judge a period before the limitation took its current form', () => {
    // The First Schedule limit dates from 1 January 2023. A 2022 run is not
    // re-judged against it.
    const scope = overtimeScope(312000, new Date('2022-06-30T00:00:00.000Z'), null);
    expect(scope.basis).toBe('NONE');
    expect(scope.reason).toMatch(/predates/);
  });
});
