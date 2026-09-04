import {
  DEFAULT_COMPONENT_LIABILITY,
  LIABILITY_BY_STATUS_CODE,
  PayrollComponentLine,
  computeBases,
  computeOvertime,
  computePayslip,
  ordinaryRates,
  unpaidLeaveDeductionCents,
  ageAt,
} from './payroll-calculation';
import { PCB_NOT_IMPLEMENTED, computeEpf, computeEis, computeSocso, statutoryStatusOf } from './statutory';

/**
 * THESE TESTS ARE THE RECONCILIATION.
 *
 * Every expected figure below is a real number off one of the clinic's two
 * payroll workbooks — not a value invented to make an assertion pass. If the
 * engine and the spreadsheet disagree on any of these, one of them is wrong
 * and somebody has to decide which; see docs/HR_PAYROLL_RECONCILIATION.md.
 *
 * The rates used to come from a seeded 2024 JSON file that nobody had checked
 * against KWSP or PERKESO. They now come from `src/statutory/`, transcribed
 * from the authorities' own documents, and are resolved by the PERIOD rather
 * than by a rule-set row.
 *
 * Where the workbook and the official schedule still agree, the expected figure
 * below is unchanged — which is most of them, and is the reassuring result. The
 * two places they no longer agree are marked, and in both the schedule wins.
 */

/** January 2026 — after every schedule in the registry took effect. */
const CTX = { periodEnd: new Date('2026-01-31T00:00:00.000Z') };
/** Before the EPF Third Schedule edition this system holds. */
const BEFORE_ANY_SCHEDULE = { periodEnd: new Date('2020-01-31T00:00:00.000Z') };

const under60 = { age: 34, epfEmployeeRate: 11, epfMembership: 'MALAYSIAN_CITIZEN' as const };
const at60 = { age: 61, epfEmployeeRate: 11, epfMembership: 'MALAYSIAN_CITIZEN' as const };

const earning = (code: string, amount: number): PayrollComponentLine => ({
  code,
  label: code,
  kind: 'EARNING',
  amount,
  liability: DEFAULT_COMPONENT_LIABILITY[code] ?? LIABILITY_BY_STATUS_CODE['2'],
});
const deduction = (code: string, amount: number): PayrollComponentLine => ({
  code,
  label: code,
  kind: 'DEDUCTION',
  amount,
  liability: DEFAULT_COMPONENT_LIABILITY[code] ?? LIABILITY_BY_STATUS_CODE['1'],
});
/** s.18A — unpaid leave makes the WAGES smaller; it is not withheld from them. */
const wageReduction = (code: string, amount: number): PayrollComponentLine => ({
  code,
  label: code,
  kind: 'WAGE_REDUCTION',
  amount,
  liability: DEFAULT_COMPONENT_LIABILITY[code] ?? LIABILITY_BY_STATUS_CODE['2'],
});

describe('EPF — the Third Schedule is a table, not a percentage', () => {
  // payroll_listing.xlsx JAN 26, rows 5, 6, 10, 18 and 29.
  it.each([
    // [wage RM, employee RM, employer RM, source]
    [2100, 231, 273, 'row 5 — 11% and 13% of a round band'],
    [596.77, 66, 78, 'row 6 — band 580.01-600.00'],
    [1451.61, 161, 190, 'row 10 — ceiling rounding, not 11% of the wage'],
    [1741.94, 194, 229, 'row 18 — basic 1800 less 58.06 unpaid leave'],
    [9750, 1078, 1176, 'row 29 — above RM5,000, so employer drops to 12%'],
  ])('RM%s contributes %s / %s (%s)', (wage, employee, employer) => {
    const result = computeEpf(Math.round((wage as number) * 100), CTX, under60);
    expect(result.employeeCents).toBe(Math.round((employee as number) * 100));
    expect(result.employerCents).toBe(Math.round((employer as number) * 100));
  });

  it('is computed on the band ceiling, so it disagrees with naive percentage arithmetic', () => {
    const wage = 145161; // RM1,451.61
    const naive = Math.round(wage * 0.11); // RM159.68 — what the old engine returned
    const actual = computeEpf(wage, CTX, under60).employeeCents;
    expect(actual).toBe(16100);
    expect(actual).not.toBe(naive);
  });

  it('steps the employer rate from 13% to 12% at exactly RM5,000', () => {
    expect(computeEpf(500000, CTX, under60).employerCents).toBe(65000); // 13%
    expect(computeEpf(500001, CTX, under60).employerCents).toBe(61200); // 12% of 5,100
  });

  it('reverts to an exact percentage above RM20,000, rounded up to the ringgit', () => {
    const result = computeEpf(2500000, CTX, under60); // RM25,000
    expect(result.employeeCents).toBe(275000); // 11%
    expect(result.employerCents).toBe(300000); // 12%
  });

  it('refuses an employee election away from the Schedule rather than approximating it', () => {
    // The 9% option was a separate statutory instrument, and an election under
    // Borang KWSP 17A is another. The Third Schedule prints ONE employee column
    // per Part, so a 9% figure could only be produced by multiplying — which is
    // exactly the percentage arithmetic this engine exists to stop.
    const result = computeEpf(210000, CTX, { ...under60, epfEmployeeRate: 9 });
    expect(result.employeeCents).toBeNull();
    expect(result.note).toMatch(/17A/);
  });

  it('cannot pick a Part without the employee’s EPF membership', () => {
    // Part C and Part E both cover people aged 60 and over, at 6%/5.5% and
    // 4%/0%. Nationality free text cannot choose between them.
    const result = computeEpf(210000, CTX, { age: 61, epfEmployeeRate: 11 });
    expect(result.employeeCents).toBeNull();
    expect(result.note).toMatch(/membership/i);
  });

  it('puts a non-citizen in Part F at a flat 2% each side', () => {
    const result = computeEpf(210000, CTX, { age: 34, epfEmployeeRate: 11, epfMembership: 'NON_CITIZEN' });
    expect(result.note).toMatch(/Part F/);
  });

  it('drops the employee share to nil and the employer to 4% at age 60', () => {
    const result = computeEpf(210000, CTX, at60);
    expect(result.employeeCents).toBe(0);
    expect(result.employerCents).toBe(8400); // 4% of RM2,100
  });

  it('refuses to guess when the date of birth is unknown', () => {
    const result = computeEpf(210000, CTX, { ...under60, age: null });
    expect(result.employeeCents).toBeNull();
    expect(result.note).toMatch(/date of birth/i);
  });
});

describe('SOCSO and EIS — different wages, different categories', () => {
  /*
   * THE WORKBOOK WAS RIGHT, AND MY EARLIER READING OF D6 WAS NOT.
   *
   * D6 prints the Non-Employment Injury Scheme beside the Act 4 columns, and
   * this suite briefly asserted that its figures were part of SOCSO — that a
   * RM6,000 employee owed 74.40 rather than 29.75. That "the law changed and
   * the spreadsheet is out of date" conclusion was wrong.
   *
   * SKBBK / LINDUNG 24 JAM is a separate scheme: in force from 1 June 2026,
   * borne by the employee, VOLUNTARY for locals. A local who has not joined
   * owes the workbook's 29.75 and nothing more. Act 4 is asserted here; the
   * other scheme has its own spec.
   */
  it('matches the clinic listing at RM2,229.24 on both sides', () => {
    const socso = computeSocso(222924, CTX, under60);
    expect(socso.employerCents).toBe(3935);
    expect(socso.employeeCents).toBe(1125); // invalidity alone, as the workbook has it
    expect(socso.note).toMatch(/invalidity 11\.25/i);
    const eis = computeEis(222924, CTX, under60);
    expect(eis.employeeCents).toBe(450);
    expect(eis.employerCents).toBe(450);
  });

  it('caps at the RM6,000 ceiling for any wage above it', () => {
    const top = computeSocso(600000, CTX, under60);
    expect(top.employerCents).toBe(10415);
    expect(top.employeeCents).toBe(2975);
    // A doctor on RM9,750 pays the same as one on RM6,000.
    expect(computeSocso(975000, CTX, under60)).toEqual(top);
    expect(computeEis(975000, CTX, under60).employeeCents).toBe(1190);
  });

  it('moves to the Second Category at 60, which Act 4 makes employer-only', () => {
    const result = computeSocso(600000, CTX, at60);
    expect(result.employerCents).toBe(7440);
    expect(result.employeeCents).toBe(0);
    expect(result.note).toMatch(/Second Category/);
  });

  it('ceases EIS entirely at 60', () => {
    const result = computeEis(600000, CTX, at60);
    expect(result.employeeCents).toBe(0);
    expect(result.employerCents).toBe(0);
  });
});

describe('the three bases are different, which is the whole point', () => {
  it('excludes overtime from EPF wages but includes it in SOCSO and EIS wages', () => {
    const bases = computeBases([earning('BASIC', 2100), earning('OVERTIME', 129.24)]);
    expect(bases.epfCents).toBe(210000); // overtime excluded — EPF Act 1991 s.2
    expect(bases.socsoCents).toBe(222924); // overtime included
    expect(bases.eisCents).toBe(222924);
  });

  it('reproduces the clinic listing row 5 end to end', () => {
    const slip = computePayslip([earning('BASIC', 2100), earning('OVERTIME', 129.24)], CTX, under60);
    expect(slip.statutory.epf.employeeCents).toBe(23100);
    expect(slip.statutory.epf.employerCents).toBe(27300);
    // Both sides as the workbook has them — see the note above the SOCSO block.
    expect(slip.statutory.socso.employerCents).toBe(3935);
    expect(slip.statutory.socso.employeeCents).toBe(1125);
    expect(slip.statutory.eis.employeeCents).toBe(450);
  });

  it('lets unpaid leave reduce every base, while a uniform charge reduces none', () => {
    const bases = computeBases([
      earning('BASIC', 1800),
      wageReduction('UNPAID_LEAVE', 58.06),
      deduction('UNIFORM', 65.35),
    ]);
    expect(bases.epfCents).toBe(174194); // 1800 - 58.06
    expect(bases.socsoCents).toBe(174194);
    // GROSS IS WAGES. s.18A makes an incomplete month's wages smaller, so the
    // leave comes off here; the uniform is withheld FROM those wages and comes
    // off net instead. Both used to reduce gross AND both were counted again
    // among the deductions, so gross minus deductions did not equal net.
    expect(bases.grossCents).toBe(174194);
  });

  it('takes a withholding out of net exactly once, and not out of gross', () => {
    const slip = computePayslip(
      [earning('BASIC', 1800), wageReduction('UNPAID_LEAVE', 58.06), deduction('UNIFORM', 65.35)],
      CTX,
      { ...under60, epfApplicable: false, socsoApplicable: false, eisApplicable: false, pcbApplicable: false },
    );
    expect(slip.grossCents).toBe(174194);
    expect(slip.employeeDeductionCents).toBe(6535);
    expect(slip.netCents).toBe(174194 - 6535);
    // The invariant the run enforces: gross − deductions = net.
    expect(slip.grossCents - slip.employeeDeductionCents).toBe(slip.netCents);
  });

  it('withholds LINDUNG from a participant, and from nobody else', () => {
    // Employee-borne, employer-remitted — so it must come off the pay it is
    // remitted on behalf of. It used to be recorded on the line and left out
    // of the withholdings, which overstated a participant's net by exactly
    // what the employer then remitted for them.
    const july = { periodEnd: new Date('2026-07-31T00:00:00.000Z') }; // after 1 June 2026 commencement
    const optedIn = computePayslip([earning('BASIC', 2100)], july, {
      ...under60,
      lindungParticipation: 'VOLUNTARY_OPTED_IN',
    });
    const notParticipating = computePayslip([earning('BASIC', 2100)], july, {
      ...under60,
      lindungParticipation: 'NOT_PARTICIPATING',
    });
    const contribution = optedIn.statutory.lindung.employeeCents ?? 0;
    expect(contribution).toBeGreaterThan(0);
    // The scheme has no employer share, so participation moves net pay and
    // nothing else: not gross, not the employer's cost.
    expect(optedIn.statutory.lindung.employerCents).toBe(0);
    expect(optedIn.grossCents).toBe(notParticipating.grossCents);
    expect(optedIn.employerCostCents).toBe(notParticipating.employerCostCents);
    expect(notParticipating.statutory.lindung.employeeCents).toBe(0);
    expect(optedIn.netCents).toBe(notParticipating.netCents - contribution);
    expect(optedIn.employeeDeductionCents).toBe(notParticipating.employeeDeductionCents + contribution);
    // The invariant the run enforces still holds with the scheme withheld.
    expect(optedIn.grossCents - optedIn.employeeDeductionCents).toBe(optedIn.netCents);
  });

  it('builds the HRD base from the guideline: basic less unpaid leave, plus FIXED allowances only', () => {
    const bases = computeBases([
      earning('BASIC', 3000),
      earning('ALLOWANCE', 200), // fixed — inside
      earning('ATTENDANCE_ALLOWANCE', 100), // variable — the guideline's own exclusion
      earning('OVERTIME', 150), // excluded
      wageReduction('UNPAID_LEAVE', 100),
    ]);
    expect(bases.hrdCents).toBe(310000); // 3,000 − 100 + 200
  });

  describe('the HRD levy reaches employer cost, and only where it truthfully can', () => {
    const july = { periodEnd: new Date('2026-07-31T00:00:00.000Z') };
    const registered = {
      ...under60,
      hrdRegistration: 'MANDATORY_SECTION_14' as const,
      hrdFullTimeEmployment: true,
    };

    it('levies 1% of the leviable wage for a s.14 employer, inside employer cost', () => {
      const slip = computePayslip([earning('BASIC', 3000), earning('OVERTIME', 150)], july, registered);
      expect(slip.hrdLevyCents).toBe(3000); // 1% of 3,000 — overtime outside the base
      const without = computePayslip([earning('BASIC', 3000), earning('OVERTIME', 150)], july, {
        ...registered,
        hrdRegistration: 'NOT_REGISTERED',
      });
      expect(slip.employerCostCents).toBe(without.employerCostCents + 3000);
      // Never the employee's money.
      expect(slip.netCents).toBe(without.netCents);
      expect(slip.employeeDeductionCents).toBe(without.employeeDeductionCents);
      // Invariant 3 holds with the levy inside the contribution.
      expect(slip.employerCostCents).toBe(slip.grossCents + slip.employerContributionCents);
    });

    it('levies 0.5% for a s.15 opt-in employer', () => {
      const slip = computePayslip([earning('BASIC', 3000)], july, {
        ...registered,
        hrdRegistration: 'OPTIONAL_SECTION_15',
      });
      expect(slip.hrdLevyCents).toBe(1500);
    });

    it('levies nothing for a part-timer, and says why', () => {
      const slip = computePayslip([earning('BASIC', 3000)], july, {
        ...registered,
        hrdFullTimeEmployment: false,
      });
      expect(slip.hrdLevyCents).toBe(0);
      expect(slip.hrdNote).toMatch(/full-time/);
    });

    it('levies nothing for a non-citizen — the opposite of EPF Part F', () => {
      const slip = computePayslip([earning('BASIC', 3000)], july, {
        ...registered,
        epfMembership: 'NON_CITIZEN',
      });
      expect(slip.hrdLevyCents).toBe(0);
      expect(slip.hrdNote).toMatch(/citizens only/);
    });

    it('returns NULL — never a quiet zero — when the registration is unrecorded', () => {
      const slip = computePayslip([earning('BASIC', 3000)], july, { ...under60, hrdFullTimeEmployment: true });
      expect(slip.hrdLevyCents).toBeNull();
      expect(slip.hrdNote).toMatch(/not recorded/);
      // And employer cost is computed without it, which the note declares.
      expect(slip.employerCostCents).toBe(slip.grossCents + slip.employerContributionCents);
    });

    it('a recorded NOT_REGISTERED is a fact worth zero, not a gap', () => {
      const slip = computePayslip([earning('BASIC', 3000)], july, {
        ...registered,
        hrdRegistration: 'NOT_REGISTERED',
      });
      expect(slip.hrdLevyCents).toBe(0);
      expect(slip.hrdNote).toMatch(/not registered/);
    });
  });

  it('keeps mileage out of every statutory base but inside gross', () => {
    const bases = computeBases([earning('BASIC', 2100), earning('MILEAGE', 14.34)]);
    expect(bases.epfCents).toBe(210000);
    expect(bases.socsoCents).toBe(210000);
    expect(bases.grossCents).toBe(211434);
  });

  it('treats bonus and incentive as additional remuneration for tax, and as EPF wages', () => {
    const bases = computeBases([earning('BASIC', 2000), earning('BONUS', 1000)]);
    expect(bases.epfCents).toBe(300000);
    expect(bases.pcbNormalCents).toBe(200000);
    expect(bases.pcbAdditionalCents).toBe(100000);
  });

  it('defaults commission to EPF-liable, unlike the clinic spreadsheet', () => {
    // The workbook sets commission to status 1 (no contribution). Commission is
    // not on the EPF Act's closed list of exclusions, so the default here is
    // liable and a clinic must opt out deliberately.
    expect(DEFAULT_COMPONENT_LIABILITY.COMMISSION.epf).toBe(true);
    expect(DEFAULT_COMPONENT_LIABILITY.ALLOWANCE.epf).toBe(true);
    expect(DEFAULT_COMPONENT_LIABILITY.ATTENDANCE_ALLOWANCE.epf).toBe(true);
  });
});

describe('ordinary rate of pay, overtime and unpaid leave', () => {
  // `unpaidLeaveDaysPerMonth` is no longer read: s.18A fixes that divisor at
  // the month's own length. It stays in the shape so historical runs can still
  // say what they applied.
  const config = { overtimeDaysPerMonth: 26, unpaidLeaveDaysPerMonth: 31, hoursPerDay: 7.5 };

  it('uses two different divisors for two different questions', () => {
    // s.60I(1A) fixes 26 for the ordinary rate; s.18A uses the days in the
    // wage period. They are not a matched pair of clinic settings.
    const rates = ordinaryRates(210000, config, 31);
    expect(rates.unpaidLeaveDailyCents).toBe(6774); // 2100 / 31, an August day
    expect(rates.overtimeDailyCents).toBe(8077); // 2100 / 26
    expect(rates.overtimeHourlyCents).toBe(1077); // and then / 7.5, to the sen
  });

  it('follows the month for unpaid leave, and ignores the configured divisor', () => {
    // The same wage in February. A configured 31 would have said 67.74 here,
    // under-deducting by a tenth, and the config says 31.
    const february = ordinaryRates(210000, config, 28);
    expect(february.unpaidLeaveDailyCents).toBe(7500); // 2100 / 28
    // The ordinary rate does NOT move with the month — s.60I(1A) is fixed.
    expect(february.overtimeDailyCents).toBe(8077);
  });

  it('rounds the hourly rate to the sen BEFORE applying the multiplier', () => {
    const rates = ordinaryRates(210000, config, 31);
    const { totalCents } = computeOvertime([{ label: '1.5x', hours: 3, multiplier: 1.5 }], rates.overtimeHourlyCents);
    // 10.77 x 1.5 = 16.155 -> 16.16 per hour, x3
    expect(totalCents).toBe(4848);
  });

  it('supports a flat-rate overtime tier alongside multiplier tiers', () => {
    const result = computeOvertime(
      [
        { label: '1.5x', hours: 2, multiplier: 1.5 },
        { label: 'flat', hours: 2, flatHourlyRate: 10 },
      ],
      1077,
    );
    expect(result.tiers[1].totalCents).toBe(2000);
    expect(result.totalCents).toBe(2000 + 3232);
  });

  it('never lets overtime raise the rate at which overtime is paid', () => {
    expect(DEFAULT_COMPONENT_LIABILITY.OVERTIME.ordinaryRateOfPay).toBe(false);
  });

  it('deducts unpaid leave at the s.18A rate for the month in hand', () => {
    const august = ordinaryRates(180000, config, 31);
    expect(unpaidLeaveDeductionCents(1, august)).toBe(5806); // matches listing row 18
  });
});

describe('PCB — computed when the tax profile is there, refused when it is not', () => {
  const JAN = { periodEnd: new Date('2026-02-01T00:00:00.000Z') };
  const taxed = {
    ...under60,
    pcbApplicable: true,
    taxResidence: 'RESIDENT' as const,
    pcbCategory: 1 as const,
    qualifyingChildren: 0,
    disabledSelf: false,
    disabledSpouse: false,
  };

  it('works the month out through HASiL’s method once residence and category are known', () => {
    const slip = computePayslip([earning('BASIC', 5000)], JAN, taxed);
    expect(slip.statutory.pcbCents).toBe(11000);
    expect(slip.incomplete).toBe(false);
    expect(slip.statutory.pcbNote).toMatch(/Computerised Calculation/);
    // The specification's own working travels with the figure, so a payslip and
    // an auditor can follow it rather than take it on trust.
    expect(slip.statutory.pcbWorking).not.toBeNull();
  });

  it('charges a non-resident a flat 30% with no deductions at all', () => {
    // Not a rate tweak — a different rule. Assuming residence for somebody who
    // is not resident under-deducts by most of the liability.
    const slip = computePayslip([earning('BASIC', 5000)], JAN, { ...taxed, taxResidence: 'NON_RESIDENT' });
    expect(slip.statutory.pcbCents).toBe(150000);
  });

  it('refuses, rather than assuming resident, when residence is unknown', () => {
    const slip = computePayslip([earning('BASIC', 5000)], JAN, { ...taxed, taxResidence: null });
    expect(slip.statutory.pcbCents).toBeNull();
    expect(slip.notes).toContain(PCB_NOT_IMPLEMENTED);
    expect(slip.incomplete).toBe(true);
  });

  it('refuses when the MTD category is unknown', () => {
    const slip = computePayslip([earning('BASIC', 5000)], JAN, { ...taxed, pcbCategory: null });
    expect(slip.statutory.pcbCents).toBeNull();
    expect(slip.incomplete).toBe(true);
  });

  it('says out loud that TP1 deductions were not captured', () => {
    // Nil LP is the right figure for an employee who has filed no TP1, and it
    // errs towards deducting MORE. Saying so is what stops the absence passing
    // for a decision somebody made.
    const slip = computePayslip([earning('BASIC', 5000)], JAN, taxed);
    expect(slip.statutory.pcbTp1Captured).toBe(false);
  });

  it('deducts NOTHING in August from somebody who appears to have earned nothing since January', () => {
    // This looks like a bug and is not, so it is pinned. The method projects
    // the rest of the year from what it has been told: an August run with no
    // year-to-date describes an employee whose whole year is five months of
    // RM5,000, which is below the threshold once the deductions are applied.
    //
    // The figure is right for the facts given. What makes it WRONG in practice
    // is missing history, which is why a mid-year migration must import its
    // opening months rather than starting from zero.
    const AUG = { periodEnd: new Date('2026-09-01T00:00:00.000Z') };
    expect(computePayslip([earning('BASIC', 5000)], AUG, taxed).statutory.pcbCents).toBe(0);
  });

  it('carries the year so far, so month eight is not computed as though it were January', () => {
    // The method is cumulative. Seven months of pay and tax already behind the
    // employee change what August owes.
    const AUG = { periodEnd: new Date('2026-09-01T00:00:00.000Z') };
    const asIfJanuary = computePayslip([earning('BASIC', 5000)], AUG, taxed);
    const withHistory = computePayslip([earning('BASIC', 5000)], AUG, taxed, {
      accumulatedGrossCents: 3500000, // seven months at RM5,000
      accumulatedEpfCents: 385000,
      accumulatedMtdPaidCents: 77000, // seven months of the January figure
      accumulatedZakatCents: 0,
      accumulatedDeductionsCents: 0,
    });
    expect(withHistory.statutory.pcbCents).not.toBe(asIfJanuary.statutory.pcbCents);
    expect(withHistory.statutory.pcbCents).not.toBeNull();
  });

  it('lets this month’s zakat reduce this month’s tax', () => {
    const withZakat = computePayslip([earning('BASIC', 5000), deduction('ZAKAT', 50)], JAN, taxed);
    const without = computePayslip([earning('BASIC', 5000)], JAN, taxed);
    expect(withZakat.statutory.pcbCents).toBeLessThan(without.statutory.pcbCents as number);
  });

  it('is zero — a fact — for somebody recorded as outside PCB', () => {
    const slip = computePayslip([earning('BASIC', 5000)], JAN, { ...taxed, pcbApplicable: false });
    expect(slip.statutory.pcbCents).toBe(0);
  });

  it('ignores a child count on a category 1 record rather than quietly changing the tax', () => {
    // The specification is explicit that category 1 carries no child deduction.
    const withChildren = computePayslip([earning('BASIC', 5000)], JAN, { ...taxed, qualifyingChildren: 3 });
    const without = computePayslip([earning('BASIC', 5000)], JAN, taxed);
    expect(withChildren.statutory.pcbCents).toBe(without.statutory.pcbCents);
  });
});

describe('absent is not zero', () => {
  it('leaves statutory figures null for a period no schedule reaches', () => {
    // Not the nearest schedule, and not zero. A 2020 period predates every
    // edition this system holds, and reaching for the closest one is how a
    // historical run silently acquires today's rates.
    const slip = computePayslip([earning('BASIC', 3000)], BEFORE_ANY_SCHEDULE, under60);
    expect(slip.statutory.epf.employeeCents).toBeNull();
    expect(slip.statutory.socso.employeeCents).toBeNull();
    expect(slip.incomplete).toBe(true);
    // Net pay is gross, visibly a draft rather than a plausible final figure.
    expect(slip.netCents).toBe(300000);
  });

  it('reports zero — a fact — for somebody recorded as outside a scheme', () => {
    const slip = computePayslip([earning('BASIC', 3000)], CTX, { ...under60, epfApplicable: false });
    expect(slip.statutory.epf.employeeCents).toBe(0);
    expect(slip.statutory.epf.note).toMatch(/outside EPF/);
  });

  it('refuses EPF for an employee whose date of birth is unknown, rather than assuming under 60', () => {
    const slip = computePayslip([earning('BASIC', 3000)], CTX, { ...under60, age: null });
    expect(slip.statutory.epf.employeeCents).toBeNull();
    expect(slip.statutory.socso.employeeCents).toBeNull();
    expect(slip.statutory.eis.employeeCents).toBeNull();
    expect(slip.incomplete).toBe(true);
  });
});

describe('a run cannot be approved against rates nobody checked', () => {
  it('is CONFIGURED for a period the official schedules govern', () => {
    // Verification is now a property of the transcription and its evidence,
    // not a checkbox somebody ticked on a rule-set row.
    expect(statutoryStatusOf(CTX.periodEnd)).toBe('CONFIGURED');
  });

  it('is NOT_CONFIGURED for a period no schedule reaches', () => {
    expect(statutoryStatusOf(BEFORE_ANY_SCHEDULE.periodEnd)).toBe('NOT_CONFIGURED');
  });
});

describe('age', () => {
  it('counts completed years, and the day before a 60th birthday is still 59', () => {
    expect(ageAt(new Date(Date.UTC(1966, 7, 30)), new Date(Date.UTC(2026, 7, 29)))).toBe(59);
    expect(ageAt(new Date(Date.UTC(1966, 7, 30)), new Date(Date.UTC(2026, 7, 30)))).toBe(60);
    expect(ageAt(null, new Date())).toBeNull();
  });
});
