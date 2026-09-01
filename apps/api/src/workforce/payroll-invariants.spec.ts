import {
  EmployeeFigures,
  checkMembership,
  checkPayrollInvariants,
  checkVariance,
  describeViolations,
} from './payroll-invariants';

const employee = (over: Partial<EmployeeFigures> = {}): EmployeeFigures => ({
  staffId: 's1',
  name: 'Nurul Hidayah',
  grossCents: 354026,
  employeeDeductionCents: 40585,
  netCents: 313441,
  employerContributionCents: 51578,
  employerCostCents: 405604,
  ...over,
});

const totalsFor = (people: EmployeeFigures[]) => ({
  grossCents: people.reduce((s, e) => s + e.grossCents, 0),
  deductionCents: people.reduce((s, e) => s + e.employeeDeductionCents, 0),
  netCents: people.reduce((s, e) => s + e.netCents, 0),
  employerCostCents: people.reduce((s, e) => s + e.employerCostCents, 0),
  employeeCount: people.length,
});

describe('payroll invariants', () => {
  it('passes a run whose rows and totals agree', () => {
    const people = [employee(), employee({ staffId: 's2', name: 'Hafiz Osman', grossCents: 290000, employeeDeductionCents: 38000, netCents: 252000, employerContributionCents: 15225, employerCostCents: 305225 })];
    expect(checkPayrollInvariants(people, totalsFor(people))).toEqual([]);
  });

  it('catches a payslip where gross minus deductions is not net', () => {
    const broken = employee({ netCents: 313441 + 100 });
    const v = checkPayrollInvariants([broken], totalsFor([broken]));
    expect(v.map((x) => x.code)).toContain('EMPLOYEE_NET_MISMATCH');
    expect(v[0].message).toMatch(/should be 3134\.41, but net pay is 3135\.41/);
  });

  it('catches employer cost that is not gross plus employer contributions', () => {
    const broken = employee({ employerCostCents: 400000 });
    const v = checkPayrollInvariants([broken], totalsFor([broken]));
    expect(v.map((x) => x.code)).toContain('EMPLOYER_COST_MISMATCH');
  });

  it('catches the mockup defect: a headline that does not equal the sum of its rows', () => {
    const people = [employee(), employee({ staffId: 's2' })];
    const totals = { ...totalsFor(people), netCents: 3141845 };
    const v = checkPayrollInvariants(people, totals);
    expect(v.map((x) => x.code)).toContain('RUN_NET_MISMATCH');
    expect(v.find((x) => x.code === 'RUN_NET_MISMATCH')!.message).toMatch(/2 employee row\(s\) sum to/);
  });

  it('catches a headcount that has drifted from the payslips written', () => {
    const people = [employee()];
    const v = checkPayrollInvariants(people, { ...totalsFor(people), employeeCount: 5 });
    expect(v.map((x) => x.code)).toContain('RUN_HEADCOUNT_MISMATCH');
    expect(v.find((x) => x.code === 'RUN_HEADCOUNT_MISMATCH')!.message).toMatch(/says 5 employee\(s\) but wrote 1/);
  });

  it('reports every violation, not the first', () => {
    const people = [employee({ netCents: 1 }), employee({ staffId: 's2', employerCostCents: 1 })];
    const v = checkPayrollInvariants(people, { ...totalsFor(people), employeeCount: 9 });
    expect(v.length).toBeGreaterThanOrEqual(3);
  });
});

describe('membership — the same people at every step', () => {
  it('accepts an employee left out for a stated reason', () => {
    const v = checkMembership(['s1'], [{ staffId: 's2', reason: 'NO_SALARY' }], ['s1', 's2']);
    expect(v).toEqual([]);
  });

  it('catches somebody who is neither paid nor explained', () => {
    const v = checkMembership(['s1'], [], ['s1', 's2']);
    expect(v.map((x) => x.code)).toEqual(['UNEXPLAINED_EXCLUSION']);
    expect(v[0].staffId).toBe('s2');
    expect(v[0].message).toMatch(/no reason on screen/);
  });

  it('catches somebody both paid and listed as excluded', () => {
    const v = checkMembership(['s1'], [{ staffId: 's1', reason: 'NO_SALARY' }], ['s1']);
    expect(v.map((x) => x.code)).toContain('INCLUDED_AND_EXCLUDED');
  });

  /*
   * AN EXCEPTION IS NOT AN EXCLUSION, and reading it as one made every
   * calculation with a warning on it fail as a contradiction.
   *
   * A missing punch, an unapproved overtime hour or a hand-entered PCB figure
   * is raised AGAINST a payslip the run still produces. Only the reasons that
   * stop the calculation for that person — no salary, no date of birth, a
   * salary that changed mid-period — put somebody in the excluded register.
   * The caller passes that register, not the exception list.
   */
  it('does not treat a warning raised against a PAID employee as an exclusion', () => {
    // s1 was paid and carries two warnings; s2 was stopped and is excluded.
    const v = checkMembership(['s1'], [{ staffId: 's2', reason: 'NO_SALARY' }], ['s1', 's2']);
    expect(v).toEqual([]);
  });
});

describe('variance is a subtraction', () => {
  it('accepts a movement that equals current minus previous', () => {
    expect(
      checkVariance([
        { staffId: 's1', name: 'Meera', currentCents: 813120, previousCents: 787120, displayedDeltaCents: 26000 },
      ]),
    ).toEqual([]);
  });

  it('catches the mockup defect: a comparison month carrying the current totals', () => {
    const v = checkVariance([
      { staffId: 's1', name: 'Meera', currentCents: 813120, previousCents: 813120, displayedDeltaCents: 26000 },
    ]);
    expect(v.map((x) => x.code)).toEqual(['VARIANCE_MISMATCH']);
    expect(v[0].message).toMatch(/should show 0\.00, but the movement shown is 260\.00/);
  });
});

describe('describeViolations', () => {
  it('says nothing is wrong when nothing is', () => {
    expect(describeViolations([])).toMatch(/All payroll invariants hold/);
  });

  it('names the codes and says these are contradictions, not data problems', () => {
    const people = [employee({ netCents: 1 })];
    const text = describeViolations(checkPayrollInvariants(people, totalsFor(people)));
    expect(text).toMatch(/EMPLOYEE_NET_MISMATCH/);
    expect(text).toMatch(/cannot all be true/);
  });
});
