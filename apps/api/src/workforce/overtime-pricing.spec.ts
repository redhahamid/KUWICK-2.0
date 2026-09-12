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

/*
 * MODE B — CLINIC RATES (§6). The same RM3,120 wage: ORP RM120 a day, RM15
 * an hour, so the Act's figures above are the floor the clinic rate is held
 * to. A doctor on RM9,500 is outside the First Schedule and has no floor.
 */
import { clinicRateShortfalls, dayTypeLabel } from './overtime-pricing';

describe('a clinic-rate rule set', () => {
  const doctors = { ruleSet: 'Doctors', overtimeHourlyCents: null, publicHolidayShiftCents: 50000, restDayShiftCents: 30000, sessionCents: 15000 };
  const staff = { ruleSet: 'Clinical staff', overtimeHourlyCents: 3000, publicHolidayShiftCents: 30000, restDayShiftCents: 15000, sessionCents: null };
  const withRates = (clinicRates: typeof staff) => ({ ...ctx, clinicRates });

  it('pays approved overtime at the clinic hourly rate when it is at least the Act’s', () => {
    // RM30 an hour against the Act's RM22.50 (15 × 1.5).
    const priced = priceDay(day({ overtimeMinutes: 120, overtimeApproved: true }), 'NORMAL_DAY', withRates(staff));
    expect(priced.pricedBy).toBe('CLINIC_RATE');
    expect(priced.totalCents).toBe(6000);
    expect(priced.excessHourlyRateCents).toBe(3000);
    expect(priced.statutoryFloorCents).toBe(4500);
    expect(priced.belowStatutoryFloor).toBe(false);
    expect(priced.entitlement).toBe('STATUTORY');
    expect(priced.provision).toMatch(/Clinic rate, Clinical staff: RM30\.00 an hour/);
  });

  it('holds a clinic rate to the Act’s floor for somebody the First Schedule reaches', () => {
    // RM20 an hour is below the Act's RM22.50: the Act's figure is paid, the
    // clinic's is kept for the exception to name, and the run blocks.
    const priced = priceDay(
      day({ overtimeMinutes: 120, overtimeApproved: true }),
      'NORMAL_DAY',
      withRates({ ...staff, overtimeHourlyCents: 2000 }),
    );
    expect(priced.belowStatutoryFloor).toBe(true);
    expect(priced.totalCents).toBe(4500);
    expect(priced.clinicRateCents).toBe(4000);
    expect(priced.statutoryFloorCents).toBe(4500);
    expect(priced.provision).toMatch(/below the Employment Act's RM45\.00/);
    expect(describePricedDay(priced)).toMatch(/^2026-08-12: Clinical staff pays RM40\.00/);
  });

  it('prices a public holiday per shift, whatever the hours, and a short day as a session', () => {
    const shift = priceDay(day({ workedMinutes: 480 }), 'PUBLIC_HOLIDAY', withRates(doctors as never));
    expect(shift.totalCents).toBe(50000);
    expect(shift.provision).toMatch(/RM500\.00 per public holiday shift/);
    const session = priceDay(day({ workedMinutes: 240 }), 'PUBLIC_HOLIDAY', withRates(doctors as never));
    expect(session.totalCents).toBe(24000); // the Act's two days (RM240) outranks a RM150 session
    expect(session.belowStatutoryFloor).toBe(true);
    // On a rest day the same session clears the Act's half day (RM60).
    const restSession = priceDay(day({ workedMinutes: 240, date: new Date('2026-08-16T00:00:00.000Z') }), 'REST_DAY', withRates(doctors as never));
    expect(restSession.totalCents).toBe(15000);
    expect(restSession.provision).toMatch(/per rest day session/);
  });

  it('prices a kind of day the rule set gives no amount for by the Act', () => {
    // Doctors' rule set fixes no hourly rate: a normal day's overtime is the Act's.
    const priced = priceDay(day({ overtimeMinutes: 60, overtimeApproved: true }), 'NORMAL_DAY', withRates(doctors as never));
    expect(priced.pricedBy).toBe('ACT');
    expect(priced.totalCents).toBe(2250);
  });

  it('is a company benefit above the First Schedule, with no floor', () => {
    // RM9,500: the Act does not reach the doctor, and the rule set is the
    // employer's undertaking — CONTRACTUAL, no floor, RM500 as set.
    const contractual = { ...ctx, scope: overtimeScope(950000, AUGUST, null), clinicRates: doctors as never };
    const priced = priceDay(day({ workedMinutes: 300 }), 'PUBLIC_HOLIDAY', contractual);
    expect(priced.entitlement).toBe('CONTRACTUAL');
    expect(priced.totalCents).toBe(50000);
    expect(priced.statutoryFloorCents).toBeNull();
    expect(priced.belowStatutoryFloor).toBe(false);
  });

  it('collects the days a clinic rate would have underpaid, and labels each kind of day', () => {
    const pricing = priceOvertime(
      [day({ overtimeMinutes: 120, overtimeApproved: true }), day({ attendanceId: 'a2', date: new Date('2026-08-31T00:00:00.000Z'), workedMinutes: 480 })],
      (date) => classifyDay(date, { publicHolidayDates: new Set(['2026-08-31']), restDayOfWeek: 0 }),
      withRates({ ...staff, overtimeHourlyCents: 2000 }),
    );
    expect(pricing.belowStatutoryFloor.map((row) => row.attendanceId)).toEqual(['a1']);
    expect(pricing.totalCents).toBe(4500 + 30000);
    expect(dayTypeLabel('NORMAL_DAY')).toBe('Overtime');
    expect(dayTypeLabel('REST_DAY')).toBe('Rest day pay');
    expect(dayTypeLabel('PUBLIC_HOLIDAY')).toBe('Public holiday pay');
  });
});

describe('the Settings-time check of clinic rates against the Act', () => {
  it('names each rate below the Act for a RM4,000 wage on an 8-hour day', () => {
    // Daily RM153.85, hourly RM19.23 → overtime floor RM28.85; a holiday two
    // days RM307.69; a rest day RM153.85.
    const out = clinicRateShortfalls(
      { ruleSet: 'Staff', overtimeHourlyCents: 2000, publicHolidayShiftCents: 50000, restDayShiftCents: 10000, sessionCents: null },
      400000,
      8,
    );
    expect(out.map((row) => row.rate)).toEqual(['OVERTIME_HOURLY', 'REST_DAY_SHIFT']);
    expect(out[0].actCents).toBe(2885);
    expect(out[0].sentence).toBe("An hour of overtime: RM20.00 against the Act's RM28.85.");
    expect(out[1].actCents).toBe(15385);
  });

  it('holds a session rate to the public-holiday floor, the stricter day it can price', () => {
    const out = clinicRateShortfalls({ ruleSet: 'Staff', overtimeHourlyCents: null, publicHolidayShiftCents: null, restDayShiftCents: null, sessionCents: 15000 }, 312000, 8);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ rate: 'SESSION', actCents: 24000 });
  });

  it('has nothing to say above the First Schedule limit', () => {
    expect(clinicRateShortfalls({ ruleSet: 'Doctors', overtimeHourlyCents: 100, publicHolidayShiftCents: 100, restDayShiftCents: 100, sessionCents: 100 }, 950000, 8)).toEqual([]);
  });
});
