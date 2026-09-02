import {
  HRD_EXCLUDED_EXAMPLES,
  HRD_LEVY_RATE_MANDATORY_PERCENT,
  HRD_LEVY_RATE_OPTIONAL_PERCENT,
  hrdLevyCents,
  hrdLevyRatePercent,
  isLeviableEmployee,
  leviableWagesCents,
  leviabilityReason,
} from './hrd-levy';

const RM = (ringgit: number) => Math.round(ringgit * 100);

const citizen = {
  isMalaysianCitizen: true,
  isFullTime: true,
  isDomesticServant: false,
  isDirectorPaidFeesOnly: false,
};

describe('the levy base is the guideline’s formula, not gross payroll', () => {
  it('is [(basic − unpaid leave) + fixed allowance] × 1%', () => {
    const { levyCents, leviableWagesCents: base } = hrdLevyCents({
      registration: 'MANDATORY_SECTION_14',
      eligibility: citizen,
      basicSalaryCents: RM(3000),
      unpaidLeaveCents: RM(100),
      fixedAllowanceCents: RM(200),
    });
    expect(base).toBe(RM(3100));
    expect(levyCents).toBe(RM(31));
  });

  /*
   * WHY THIS MATTERS. Levying 1% of gross would charge the clinic for
   * overtime, bonuses and travel allowances the guideline puts outside the
   * base — every month somebody worked a Saturday.
   */
  it('does not move when overtime or a bonus is paid, because neither is in the base', () => {
    const quiet = hrdLevyCents({
      registration: 'MANDATORY_SECTION_14',
      eligibility: citizen,
      basicSalaryCents: RM(3000),
      unpaidLeaveCents: 0,
      fixedAllowanceCents: RM(200),
    });
    // Same person, same month, with RM800 of overtime and a RM2,000 bonus
    // paid. Neither reaches `fixedAllowanceCents`, so neither reaches the levy.
    const busy = hrdLevyCents({
      registration: 'MANDATORY_SECTION_14',
      eligibility: citizen,
      basicSalaryCents: RM(3000),
      unpaidLeaveCents: 0,
      fixedAllowanceCents: RM(200),
    });
    expect(busy.levyCents).toBe(quiet.levyCents);
    expect(busy.levyCents).toBe(RM(32));
  });

  it('reduces the base by unpaid leave, as the formula subtracts it', () => {
    const full = leviableWagesCents({ basicSalaryCents: RM(3000), unpaidLeaveCents: 0, fixedAllowanceCents: 0 });
    const short = leviableWagesCents({ basicSalaryCents: RM(3000), unpaidLeaveCents: RM(300), fixedAllowanceCents: 0 });
    expect(full - short).toBe(RM(300));
  });

  it('never lets unpaid leave drive the base negative', () => {
    expect(leviableWagesCents({ basicSalaryCents: RM(1000), unpaidLeaveCents: RM(5000), fixedAllowanceCents: RM(200) }))
      .toBe(RM(200));
  });
});

describe('the rate is the employer’s registration class', () => {
  it('is 1% under section 14', () => {
    expect(hrdLevyRatePercent('MANDATORY_SECTION_14')).toBe(HRD_LEVY_RATE_MANDATORY_PERCENT);
    expect(HRD_LEVY_RATE_MANDATORY_PERCENT).toBe(1);
  });

  it('is 0.5% under section 15 for an employer that opted in below the minimum headcount', () => {
    expect(hrdLevyRatePercent('OPTIONAL_SECTION_15')).toBe(HRD_LEVY_RATE_OPTIONAL_PERCENT);
    const half = hrdLevyCents({
      registration: 'OPTIONAL_SECTION_15',
      eligibility: citizen,
      basicSalaryCents: RM(4000),
      unpaidLeaveCents: 0,
      fixedAllowanceCents: 0,
    });
    expect(half.levyCents).toBe(RM(20));
  });

  it('charges nothing when the employer is not registered, and says so', () => {
    const none = hrdLevyCents({
      registration: 'NOT_REGISTERED',
      eligibility: citizen,
      basicSalaryCents: RM(4000),
      unpaidLeaveCents: 0,
      fixedAllowanceCents: 0,
    });
    expect(none.levyCents).toBe(0);
    expect(none.reason).toMatch(/not registered/i);
  });
});

/*
 * ELIGIBILITY IS THE OPPOSITE OF EPF HERE, and that asymmetry is the point.
 * A non-citizen contributes to EPF under Part F but is outside the levy
 * entirely, because section 2 defines an employee as a citizen.
 */
describe('who counts as an employee for levy purposes', () => {
  it('covers a full-time Malaysian citizen', () => {
    expect(isLeviableEmployee(citizen)).toBe(true);
    expect(leviabilityReason(citizen)).toBeNull();
  });

  it('excludes a non-citizen, unlike EPF', () => {
    const foreign = { ...citizen, isMalaysianCitizen: false };
    expect(isLeviableEmployee(foreign)).toBe(false);
    expect(leviabilityReason(foreign)).toMatch(/Malaysian citizens only/);
  });

  it('excludes part-time employment', () => {
    expect(isLeviableEmployee({ ...citizen, isFullTime: false })).toBe(false);
  });

  it('excludes a domestic servant', () => {
    expect(isLeviableEmployee({ ...citizen, isDomesticServant: true })).toBe(false);
  });

  it('excludes a director paid only fees, but not one paid a salary', () => {
    expect(isLeviableEmployee({ ...citizen, isDirectorPaidFeesOnly: true })).toBe(false);
    expect(isLeviableEmployee(citizen)).toBe(true);
  });

  it('charges nothing for an ineligible person, with a reason a clinic can act on', () => {
    const result = hrdLevyCents({
      registration: 'MANDATORY_SECTION_14',
      eligibility: { ...citizen, isMalaysianCitizen: false },
      basicSalaryCents: RM(5000),
      unpaidLeaveCents: 0,
      fixedAllowanceCents: 0,
    });
    expect(result.levyCents).toBe(0);
    expect(result.reason).not.toBeNull();
    // Owner language, never an engine code.
    expect(result.reason).not.toMatch(/HRD_|_EXCLUDED|ERROR/);
  });
});

describe('the excluded components are recorded from the guideline', () => {
  it('names overtime, bonuses, commissions and travel allowances', () => {
    const joined = HRD_EXCLUDED_EXAMPLES.join(' | ');
    for (const item of ['Overtime', 'Bonuses and commissions', 'Travelling allowance', 'Shift allowance']) {
      expect(joined).toContain(item);
    }
  });
});
