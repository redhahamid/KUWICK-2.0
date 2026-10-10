import { describeProration, partMonthPay, proratedBasicCents, prorationFor, unpaidLeaveDeductionCents, workingWeek } from './proration';

/** August 2026 — 31 days. */
const AUG = {
  periodStart: new Date('2026-08-01T00:00:00.000Z'),
  periodEnd: new Date('2026-09-01T00:00:00.000Z'),
  daysInPeriod: 31,
};
/** February 2026 — 28 days, which is where a hardcoded 30 or 26 shows up. */
const FEB = {
  periodStart: new Date('2026-02-01T00:00:00.000Z'),
  periodEnd: new Date('2026-03-01T00:00:00.000Z'),
  daysInPeriod: 28,
};

const on = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('a complete month', () => {
  it('is not prorated when the employee served all of it', () => {
    const p = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: null });
    expect(p).toMatchObject({ complete: true, daysEligible: 31, joinedOn: null, leftOn: null });
    expect(proratedBasicCents(300000, p, 31)).toBe(300000);
    expect(describeProration(p, 31)).toBeNull();
  });

  it('counts a start on the first day and an end on the last as a full month', () => {
    // Both ends inclusive. Off by one here costs every leaver a day's pay.
    const p = prorationFor({ ...AUG, startDate: on('2026-08-01'), endDate: on('2026-08-31') });
    expect(p.daysEligible).toBe(31);
    expect(p.complete).toBe(true);
  });
});

describe('a joiner', () => {
  it('is paid from the day they started, both ends inclusive', () => {
    const p = prorationFor({ ...AUG, startDate: on('2026-08-20'), endDate: null });
    // 20th to 31st inclusive is 12 days, not 11.
    expect(p.daysEligible).toBe(12);
    expect(p.joinedOn).toEqual(on('2026-08-20'));
    expect(p.complete).toBe(false);
  });

  it('divides by the days in THAT month, not by 26 and not by 30', () => {
    // s.18A uses the wage period; s.60I(1A)'s 26 answers a different question.
    const p = prorationFor({ ...FEB, startDate: on('2026-02-15'), endDate: null });
    expect(p.daysEligible).toBe(14);
    // RM3,000 x 14/28 = RM1,500 exactly.
    expect(proratedBasicCents(300000, p, 28)).toBe(150000);
    // Against a 26-day divisor this would have been RM1,615.38, and against 30
    // it would have been RM1,400. Both are wrong, and differently wrong.
    expect(proratedBasicCents(300000, p, 28)).not.toBe(161538);
  });

  it('rounds once, at the end', () => {
    // RM3,333.33 x 12/31 = RM1,290.32258…, which must land on 1290.32 rather
    // than on a figure built from a pre-rounded daily rate.
    const p = prorationFor({ ...AUG, startDate: on('2026-08-20'), endDate: null });
    expect(proratedBasicCents(333333, p, 31)).toBe(129032);
  });
});

describe('a leaver', () => {
  it('is paid to the day they left, inclusive', () => {
    const p = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-08-03') });
    expect(p.daysEligible).toBe(3);
    expect(p.leftOn).toEqual(on('2026-08-03'));
    expect(proratedBasicCents(310000, p, 31)).toBe(30000);
  });

  it('handles somebody who both joined and left inside one month', () => {
    const p = prorationFor({ ...AUG, startDate: on('2026-08-10'), endDate: on('2026-08-19') });
    expect(p.daysEligible).toBe(10);
    expect(describeProration(p, 31)).toBe('Paid for 10 of 31 days: they started on 2026-08-10 and left on 2026-08-19.');
  });
});

describe('somebody who was not employed during the period at all', () => {
  it('is flagged as outside it rather than paid a prorated amount', () => {
    // A leaver whose record is still marked ACTIVE. Paying them 0/31 of a
    // month and calling it a payslip is not better than paying them a month;
    // they simply are not on this payroll.
    const left = prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-07-31') });
    expect(left.outsidePeriod).toBe(true);
    expect(left.daysEligible).toBe(0);

    const notYet = prorationFor({ ...AUG, startDate: on('2026-09-01'), endDate: null });
    expect(notYet.outsidePeriod).toBe(true);
  });

  it('treats the boundary days as inside, not outside', () => {
    expect(prorationFor({ ...AUG, startDate: on('2024-01-01'), endDate: on('2026-08-01') }).outsidePeriod).toBe(false);
    expect(prorationFor({ ...AUG, startDate: on('2026-08-31'), endDate: null }).outsidePeriod).toBe(false);
  });
});

describe('a stored timestamp with a time on it', () => {
  it('does not shift the day count', () => {
    // Dates arrive from Prisma as DateTime. A 16:00 start must not read as a
    // different day, or a proration silently changes with the server's clock.
    const p = prorationFor({
      ...AUG,
      startDate: new Date('2026-08-20T16:30:00.000Z'),
      endDate: null,
    });
    expect(p.daysEligible).toBe(12);
  });
});

describe('unpaid leave is s.18A too, not clinic policy', () => {
  /*
   * THE CORRECTION THIS PINS.
   *
   * Section 18A reaches ANY incomplete month, expressly including leave of
   * absence without pay for one or more days — not only joiners and leavers.
   * Kuwick deducted on a configured, fixed 31-day divisor, which under-deducts
   * in every month shorter than 31 days and by a tenth in February.
   *
   * RM3,100 a month makes the arithmetic checkable at a glance.
   */
  it.each([
    // [days in the wage period, month, one day's deduction in cents]
    [28, 'February 2026', 11071],
    [29, 'February 2028 (a leap year)', 10690],
    [30, 'September 2026', 10333],
    [31, 'August 2026', 10000],
  ])('divides by %s — %s — giving %s cents a day', (days, _month, expected) => {
    expect(unpaidLeaveDeductionCents(310000, 1, days as number)).toBe(expected);
  });

  it('costs a tenth more in February than the fixed 31 did', () => {
    // The whole of the defect, in one comparison: the same day of leave.
    const underTheAct = unpaidLeaveDeductionCents(310000, 1, 28);
    const underTheOldPolicy = Math.round(310000 / 31);
    expect(underTheAct).toBe(11071);
    expect(underTheOldPolicy).toBe(10000);
    expect(underTheAct - underTheOldPolicy).toBe(1071);
  });

  it('never deducts more than the month contains', () => {
    // Somebody absent every day of the period is owed nothing, not less than
    // nothing, and a run that produced a negative deduction would add pay.
    expect(unpaidLeaveDeductionCents(310000, 40, 31)).toBe(310000);
    expect(unpaidLeaveDeductionCents(310000, 0, 31)).toBe(0);
    expect(unpaidLeaveDeductionCents(310000, -3, 31)).toBe(0);
  });

  it('composes with a part-month of service without charging the same days twice', () => {
    // s.18A gives ONE formula: monthly x eligible / days. A joiner on the 20th
    // who then took a day of unpaid leave has 11 eligible days of 31, and
    // "prorate, then deduct" must land on exactly that.
    const p = prorationFor({ ...AUG, startDate: on('2026-08-20'), endDate: null });
    const prorated = proratedBasicCents(310000, p, 31); // 12 days served
    const afterLeave = prorated - unpaidLeaveDeductionCents(310000, 1, 31);
    const directly = Math.round((310000 / 31) * 11);
    expect(afterLeave).toBe(directly);
  });
});

describe('a part month by working days, when the rule set says so (UAT, 10 October 2026)', () => {
  /** October 2026 — 31 days, the 1st a Thursday, Sundays on the 4th, 11th, 18th and 25th. */
  const OCT = { periodStart: on('2026-10-01'), periodEnd: on('2026-11-01'), daysInPeriod: 31 };
  const sundayRest = (workDaysPerWeek: number | null) => workingWeek({ workDaysPerWeek, restDayOfWeek: 0, restDayVaries: false });
  const pay = (startDate: Date | null, endDate: Date | null, basis: string, week: readonly number[] | null) => {
    const window = { ...OCT, startDate, endDate };
    return partMonthPay({ monthlyCents: 180000, proration: prorationFor(window), window, basis, week });
  };

  it('pays the Act’s calendar days unless told otherwise: 1,800 × 11/31 = 638.71', () => {
    expect(pay(on('2026-10-21'), null, 'CALENDAR_DAYS', sundayRest(6))).toMatchObject({
      basicCents: 63871,
      calendarCents: 63871,
      basis: 'CALENDAR_DAYS',
      workingDays: null,
      fallback: null,
    });
  });

  it('reads the working week from the rest day', () => {
    expect(sundayRest(6)).toEqual([0, 1, 1, 1, 1, 1, 1]);
    expect(sundayRest(5.5)).toEqual([0, 1, 1, 1, 1, 1, 0.5]);
    expect(sundayRest(5)).toEqual([0, 1, 1, 1, 1, 1, 0]);
    // A Friday rest day on a five-day week takes Thursday off too.
    expect(workingWeek({ workDaysPerWeek: 5, restDayOfWeek: 5, restDayVaries: false })).toEqual([1, 1, 1, 1, 0, 0, 1]);
    expect(workingWeek({ workDaysPerWeek: 6, restDayOfWeek: null, restDayVaries: true })).toBeNull();
    expect(workingWeek({ workDaysPerWeek: 4, restDayOfWeek: 0, restDayVaries: false })).toBeNull();
    expect(workingWeek({ workDaysPerWeek: null, restDayOfWeek: 0, restDayVaries: false })).toBeNull();
  });

  it('pays a joiner by the working days of their own week', () => {
    // The 21st to the 31st: eleven days, one Sunday, two Saturdays.
    expect(pay(on('2026-10-21'), null, 'WORKING_DAYS', sundayRest(6))).toMatchObject({
      basicCents: 66667,
      calendarCents: 63871,
      basis: 'WORKING_DAYS',
      workingDays: { employed: 10, inPeriod: 27 },
    });
    expect(pay(on('2026-10-21'), null, 'WORKING_DAYS', sundayRest(5.5))).toMatchObject({ basicCents: 66122, workingDays: { employed: 9, inPeriod: 24.5 } });
    expect(pay(on('2026-10-21'), null, 'WORKING_DAYS', sundayRest(5))).toMatchObject({ basicCents: 65455, workingDays: { employed: 8, inPeriod: 22 } });
  });

  it('can pay less than the Act, and keeps the Act’s figure beside it to say so', () => {
    // Left on Sunday the 4th: four calendar days, three of them working days.
    expect(pay(null, on('2026-10-04'), 'WORKING_DAYS', sundayRest(6))).toMatchObject({ basicCents: 20000, calendarCents: 23226, basis: 'WORKING_DAYS' });
  });

  it('pays a whole month whole, and falls back to calendar days, with the reason, when there is no week to count', () => {
    expect(pay(on('2024-01-01'), null, 'WORKING_DAYS', sundayRest(6))).toMatchObject({ basicCents: 180000, calendarCents: 180000 });
    const noWeek = pay(on('2026-10-21'), null, 'WORKING_DAYS', null);
    expect(noWeek).toMatchObject({ basicCents: 63871, basis: 'CALENDAR_DAYS', workingDays: null });
    expect(noWeek.fallback).toMatch(/no fixed working week/);
  });

  it('describes the month in working days when it was paid by them', () => {
    const p = prorationFor({ ...OCT, startDate: on('2026-10-21'), endDate: null });
    expect(describeProration(p, 31, { employed: 10, inPeriod: 27 })).toBe('Paid for 10 of 27 working days: they started on 2026-10-21.');
    expect(describeProration(p, 31)).toBe('Paid for 11 of 31 days: they started on 2026-10-21.');
  });
});
