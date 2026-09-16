import {
  ACT_OVERTIME_MULTIPLIERS,
  MONTHLY_ORP_DIVISOR,
  OVERTIME_MULTIPLIERS,
  OVERTIME_MULTIPLIER_FLOORS,
  belowActMultiplier,
  completeMonthsWorkedInYear,
  overtimeMultiplierRefusal,
  proRatedAnnualLeaveOnExit,
  untakenLeavePayoutCents,
  checkNormalHours,
  checkOrdinaryRatePolicy,
  daysInMonth,
  hourlyRateOfPayCents,
  incompleteMonthWagesCents,
  ordinaryRateOfPayCents,
  publicHolidayEntitlement,
  restDayEntitlement,
} from './employment-act';

const RM = (ringgit: number) => Math.round(ringgit * 100);

/**
 * THE TWO DIVISORS. This is the rule the codebase had wrong, and the Act is
 * unambiguous once both provisions are read together.
 */
describe('section 60I(1A) — the ordinary rate of pay divides by 26', () => {
  it('prices a monthly wage at monthly ÷ 26', () => {
    expect(ordinaryRateOfPayCents('MONTHLY', RM(2600))).toBe(RM(100));
    expect(MONTHLY_ORP_DIVISOR).toBe(26);
  });

  it('derives the hourly rate from the ordinary rate over normal hours', () => {
    const orp = ordinaryRateOfPayCents('MONTHLY', RM(2600));
    expect(hourlyRateOfPayCents(orp, 8)).toBe(RM(12.5));
  });

  it('divides a weekly wage by 6', () => {
    expect(ordinaryRateOfPayCents('WEEKLY', RM(600))).toBe(RM(100));
  });

  it('refuses a daily rate with no days worked rather than pricing overtime at nothing', () => {
    expect(ordinaryRateOfPayCents('DAILY_OR_HOURLY_OR_PIECE', RM(2600), { daysWorkedInPreviousPeriod: 0 })).toBeNaN();
  });
});

describe('section 18A — an incomplete month divides by the days in the month', () => {
  it('uses the actual length of the wage period, not 26', () => {
    // A joiner on the 16th of a 30-day month is eligible for 15 days.
    const wages = incompleteMonthWagesCents(RM(3000), 30, 15);
    expect(wages).toBe(RM(1500));
    // The 26-divisor answer would have been RM1,730.77 — RM230 too much.
    expect(wages).not.toBe(Math.round((RM(3000) / 26) * 15));
  });

  it('gives a different answer in February than in January, because the month is different', () => {
    const january = incompleteMonthWagesCents(RM(3100), 31, 30);
    const february = incompleteMonthWagesCents(RM(3100), 28, 27);
    expect(january).not.toBe(february);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 1)).toBe(31);
  });

  /*
   * ONE UNPAID DAY IS ONE DAY'S PAY, and the deduction is derived from what is
   * PAYABLE rather than computed separately. A joiner who also took unpaid
   * leave must not be charged twice for the same days, which is exactly what
   * happens when a system subtracts a proration and a deduction independently.
   */
  it('derives the deduction from what is payable, so overlapping reasons cannot double-charge', () => {
    const monthly = RM(3100);
    const days = 31;
    // Joined on the 11th (21 days eligible) AND took 2 unpaid days: 19 eligible.
    const payable = incompleteMonthWagesCents(monthly, days, 19);
    expect(payable).toBe(Math.round((monthly / days) * 19));
    // Not (monthly × 21/31) − (monthly × 2/31) computed as separate rounds,
    // which is the shape that drifts.
    const deduction = monthly - payable;
    expect(payable + deduction).toBe(monthly);
  });

  it('never pays more than the month or less than nothing', () => {
    expect(incompleteMonthWagesCents(RM(3000), 30, 45)).toBe(RM(3000));
    expect(incompleteMonthWagesCents(RM(3000), 30, -5)).toBe(0);
  });
});

describe('section 60I(2) — clinic policy is a floor, not a free choice', () => {
  it('accepts a divisor at or below the statutory one, which pays more per day', () => {
    expect(checkOrdinaryRatePolicy('MONTHLY', 26)).toBeNull();
    expect(checkOrdinaryRatePolicy('MONTHLY', 22)).toBeNull();
  });

  it('REFUSES a divisor above 26, which would pay less than the Act allows', () => {
    const reason = checkOrdinaryRatePolicy('MONTHLY', 31);
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/not be lower|not lower/i);
    expect(reason).toMatch(/26/);
  });

  it('refuses a nonsensical divisor', () => {
    expect(checkOrdinaryRatePolicy('MONTHLY', 0)).not.toBeNull();
  });
});

describe('overtime multipliers are the Act’s minimums', () => {
  it('is 1.5× on a normal working day — s.60A(3)(a)', () => {
    expect(OVERTIME_MULTIPLIERS.NORMAL_DAY).toBe(1.5);
  });

  it('is 2× beyond normal hours on a rest day — s.60(3)(c)', () => {
    expect(OVERTIME_MULTIPLIERS.REST_DAY_EXCESS).toBe(2);
  });

  it('is 3× beyond normal hours on a public holiday — s.60D(3)(aa)', () => {
    expect(OVERTIME_MULTIPLIERS.PUBLIC_HOLIDAY_EXCESS).toBe(3);
  });
});

/*
 * REST DAYS AND PUBLIC HOLIDAYS ARE PAID IN DAYS, NOT HOURS.
 *
 * Pricing a rest day as "hours × 2" underpays the employee who worked two
 * hours — the Act gives them half a day whatever the clock says.
 */
describe('section 60(3) — work on a rest day', () => {
  it('pays a monthly-rated employee half a day for half the normal hours or less', () => {
    expect(restDayEntitlement('MONTHLY', 3, 8).ordinaryRateDays).toBe(0.5);
    expect(restDayEntitlement('MONTHLY', 4, 8).ordinaryRateDays).toBe(0.5);
  });

  it('pays a full day for more than half, up to the normal hours', () => {
    expect(restDayEntitlement('MONTHLY', 5, 8).ordinaryRateDays).toBe(1);
    expect(restDayEntitlement('MONTHLY', 8, 8).ordinaryRateDays).toBe(1);
  });

  it('pays a daily-rated employee more for the same work, as the Act provides', () => {
    expect(restDayEntitlement('DAILY_OR_HOURLY_OR_PIECE', 3, 8).ordinaryRateDays).toBe(1);
    expect(restDayEntitlement('DAILY_OR_HOURLY_OR_PIECE', 6, 8).ordinaryRateDays).toBe(2);
  });

  it('prices anything beyond the normal hours at 2× the hourly rate', () => {
    expect(restDayEntitlement('MONTHLY', 10, 8).excessHourlyMultiplier).toBe(2);
  });

  it('cites the provision it came from', () => {
    expect(restDayEntitlement('MONTHLY', 4, 8).provision).toMatch(/s\.60\(3\)\(b\)/);
  });
});

describe('section 60D(3) — work on a paid public holiday', () => {
  it('pays two days regardless of how little of the day was worked', () => {
    // "regardless that the period of work done on that day is less than the
    // normal hours of work" — one hour on Hari Raya is still two days.
    expect(publicHolidayEntitlement().ordinaryRateDays).toBe(2);
  });

  it('prices anything beyond the normal hours at 3× the hourly rate', () => {
    expect(publicHolidayEntitlement().excessHourlyMultiplier).toBe(3);
  });
});

describe('section 60A(1) — the limits on normal hours', () => {
  it('accepts a contract within the limits', () => {
    expect(checkNormalHours(8, 45)).toEqual([]);
    expect(checkNormalHours(7.5, 40)).toEqual([]);
  });

  it('names the limit a 10-hour day breaches', () => {
    const problems = checkNormalHours(10, 45);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/8/);
    expect(problems[0]).toMatch(/60A\(1\)\(b\)/);
  });

  it('names both limits when both are breached', () => {
    expect(checkNormalHours(10, 60)).toHaveLength(2);
  });
});

/*
 * THE CLINIC'S OWN MULTIPLIERS, AND THE FLOOR UNDER THEM.
 *
 * ss.60A(3)(a), 60(3)(c) and 60D(3)(aa) each say "not less than", which cuts
 * one way: a clinic paying overtime at 2× is complying generously, and one
 * paying 1.25× is not. The product refuses the second the way it refuses a
 * 30-day ordinary-rate divisor — the number is stopped where it is typed, not
 * discovered on pay day.
 */
describe('a multiplier the clinic chose', () => {
  it('lets a clinic pay above the Act on any of the three', () => {
    expect(overtimeMultiplierRefusal('overtimeMultiplier', 2)).toBeNull();
    expect(overtimeMultiplierRefusal('restDayMultiplier', 2.5)).toBeNull();
    expect(overtimeMultiplierRefusal('publicHolidayMultiplier', 4)).toBeNull();
  });

  it('lets a clinic state the Act’s own figure', () => {
    for (const floor of OVERTIME_MULTIPLIER_FLOORS) {
      expect(overtimeMultiplierRefusal(floor.field, floor.act)).toBeNull();
    }
  });

  it('does NOT refuse a figure below the Act — that is a decision, not a mistake', () => {
    // An employer may choose to pay below the Act and carry the liability.
    // Refusing it made Kuwick the arbiter of a decision that is not its own;
    // what it owes instead is that nobody does it by accident.
    expect(overtimeMultiplierRefusal('overtimeMultiplier', 1.25)).toBeNull();
    expect(overtimeMultiplierRefusal('publicHolidayMultiplier', 2)).toBeNull();
    expect(overtimeMultiplierRefusal('restDayMultiplier', 1.5)).toBeNull();
  });

  it('refuses nought, a negative and a figure no clinic pays', () => {
    // These are typing mistakes, and refusing them protects the person at the
    // keyboard rather than overruling them.
    expect(overtimeMultiplierRefusal('overtimeMultiplier', 0)).not.toBeNull();
    expect(overtimeMultiplierRefusal('overtimeMultiplier', -2)).not.toBeNull();
    expect(overtimeMultiplierRefusal('overtimeMultiplier', 50)).toContain('Check the figure');
  });

  it('says what is below what, in one sentence, before anybody saves it', () => {
    const below = belowActMultiplier('publicHolidayMultiplier', 2);
    expect(below).toMatchObject({ field: 'publicHolidayMultiplier', chosen: 2, act: 3 });
    // The section, the minimum and the word BELOW in the same sentence: a
    // clinic reading only two numbers can talk itself into either reading.
    expect(below?.sentence).toContain('BELOW');
    expect(below?.sentence).toContain('3×');
    expect(below?.sentence).toContain('s.60D(3)(aa)');
  });

  it('has nothing to say about a figure at or above the Act', () => {
    expect(belowActMultiplier('overtimeMultiplier', 1.5)).toBeNull();
    expect(belowActMultiplier('overtimeMultiplier', 2)).toBeNull();
  });

  it('keeps the Act’s three figures as the floors', () => {
    // Pinned so a later edit to the table cannot quietly lower a floor.
    expect(OVERTIME_MULTIPLIER_FLOORS.map((row) => [row.field, row.act])).toEqual([
      ['overtimeMultiplier', 1.5],
      ['restDayMultiplier', 2],
      ['publicHolidayMultiplier', 3],
    ]);
    expect(ACT_OVERTIME_MULTIPLIERS).toEqual({ normalDay: 1.5, restDayExcess: 2, publicHolidayExcess: 3 });
  });
});

/*
 * SECTION 60E(3) — WHAT UNTAKEN ANNUAL LEAVE IS WORTH WHEN SOMEBODY LEAVES.
 *
 * The four open questions were put to the account holder rather than guessed,
 * and he checked the Act's text against a second source. These pin his answers:
 * pro-rated by COMPLETE MONTHS, fractions under half a day disregarded and over
 * half rounded up to a whole one, valued at the ordinary rate of pay.
 */
describe('untaken annual leave when the contract ends', () => {
  it('pro-rates by the complete months worked, not by days', () => {
    // Twelve days a year, seven complete months: 12 x 7 / 12 = 7 exactly.
    expect(proRatedAnnualLeaveOnExit(12, 7)).toBe(7);
    // Sixteen days, five months: 6.67 — two thirds of a day, rounded up.
    expect(proRatedAnnualLeaveOnExit(16, 5)).toBe(7);
  });

  it('disregards a fraction under half a day', () => {
    // 12 x 1 / 12 = 1 exactly; 12 x 4 / 12 = 4. A case with a small fraction:
    // 8 days over 5 months is 3.33, and the third of a day goes.
    expect(proRatedAnnualLeaveOnExit(8, 5)).toBe(3);
    // 8 over 7 months is 4.67 — over half, so a whole day.
    expect(proRatedAnnualLeaveOnExit(8, 7)).toBe(5);
  });

  it('rounds exactly half a day UP, which is the assumption in the code', () => {
    // 12 days over 6 months and a half is not expressible in months, so the
    // clean case is 14 over 9: 10.5. The wording says "less than half is
    // disregarded, more than half rounds up" and leaves half itself unsaid.
    // Up is the direction that cannot underpay. Flagged, not hidden.
    expect(proRatedAnnualLeaveOnExit(14, 9)).toBe(11);
  });

  it('gives the whole year to somebody who completed it, and nothing to nobody', () => {
    expect(proRatedAnnualLeaveOnExit(12, 12)).toBe(12);
    expect(proRatedAnnualLeaveOnExit(12, 0)).toBe(0);
    expect(proRatedAnnualLeaveOnExit(0, 7)).toBe(0);
  });

  it('counts a month only when it was worked end to end', () => {
    // 1 January to 15 August 2026: January through July are complete, August is
    // not. Seven.
    expect(completeMonthsWorkedInYear(2026, new Date('2026-01-01T00:00:00Z'), new Date('2026-08-15T00:00:00Z'))).toBe(7);
    // Leaving on the last day of August makes August complete: eight.
    expect(completeMonthsWorkedInYear(2026, new Date('2026-01-01T00:00:00Z'), new Date('2026-08-31T00:00:00Z'))).toBe(8);
    // Joining on the 2nd loses January.
    expect(completeMonthsWorkedInYear(2026, new Date('2026-01-02T00:00:00Z'), new Date('2026-08-31T00:00:00Z'))).toBe(7);
    // Employed all year and still there: twelve.
    expect(completeMonthsWorkedInYear(2026, new Date('2025-06-01T00:00:00Z'), null)).toBe(12);
  });

  it('values the days at the ordinary rate of pay, rounded once', () => {
    // RM2,600 a month over 26 is RM100 a day. Nine days is RM900.
    expect(untakenLeavePayoutCents(9, 10000)).toBe(90000);
    // A rate with a fraction of a sen rounds at the end, not per day.
    expect(untakenLeavePayoutCents(7, 9615)).toBe(67305);
    expect(untakenLeavePayoutCents(0, 10000)).toBe(0);
  });
});
