import { EIS_BANDS } from './eis-act800';
import { EPF_PARTS } from './epf-third-schedule';
import { SOCSO_BANDS } from './socso-act4';
import { eisContribution, epfContribution, epfPartFor, socsoContribution } from './contributions';

const RM = (ringgit: number) => Math.round(ringgit * 100);
const computed = <T>(outcome: { kind: string; value?: T }): T => {
  if (outcome.kind !== 'COMPUTED') throw new Error(`expected COMPUTED, got ${outcome.kind}`);
  return outcome.value as T;
};

/**
 * EPF — Third Schedule in force from 1 October 2025.
 *
 * The point of these is that the Schedule is a LOOKUP. Several assert a figure
 * that a percentage would get wrong, which is the whole reason the table is
 * transcribed rather than approximated.
 */
describe('EPF is a table, not a percentage', () => {
  it('reads the Schedule’s own figure, which is nowhere near wages × 11%', () => {
    // Part A, "From 3,000.01 to 3,020.00": employer RM393, employee RM333.
    const value = computed(epfContribution(RM(3000.5), 'MALAYSIAN_CITIZEN', 35));
    expect(value.employeeCents).toBe(RM(333));
    expect(value.employerCents).toBe(RM(393));

    /*
     * THE SIZE OF THE ERROR A PERCENTAGE WOULD MAKE.
     *
     * The Schedule works each band out from the TOP of the band and rounds to
     * the next ringgit, so an employee anywhere in a band pays the same. At
     * RM3,000.50 that is RM333, where 11% of the actual wage is RM330.06 —
     * the percentage under-contributes by RM2.94 a month for this one
     * employee, every month, and nothing on a payslip would look wrong.
     */
    const percentageWouldSay = Math.round(RM(3000.5) * 0.11);
    expect(value.employeeCents - percentageWouldSay).toBe(RM(2.94));
  });

  it('gives the same figures anywhere inside a band', () => {
    const low = computed(epfContribution(RM(3000.01), 'MALAYSIAN_CITIZEN', 35));
    const high = computed(epfContribution(RM(3020), 'MALAYSIAN_CITIZEN', 35));
    expect(low).toEqual(high);
  });

  it('steps at the band edge', () => {
    const inside = computed(epfContribution(RM(3020), 'MALAYSIAN_CITIZEN', 35));
    const next = computed(epfContribution(RM(3020.01), 'MALAYSIAN_CITIZEN', 35));
    expect(next.employeeCents).toBeGreaterThan(inside.employeeCents);
  });

  it('contributes nothing on wages of RM10 or less, as the Schedule says NIL', () => {
    expect(computed(epfContribution(RM(10), 'MALAYSIAN_CITIZEN', 35)).employeeCents).toBe(0);
  });
});

describe('EPF Parts follow the Schedule’s own divisions', () => {
  it.each([
    ['MALAYSIAN_CITIZEN', 59, 'A'],
    ['MALAYSIAN_CITIZEN', 60, 'E'],
    ['PERMANENT_RESIDENT', 59, 'A'],
    ['PERMANENT_RESIDENT', 60, 'C'],
    ['NON_CITIZEN_ELECTED_PRE_1998', 60, 'C'],
    ['NON_CITIZEN', 30, 'F'],
    ['NON_CITIZEN', 65, 'F'],
  ] as const)('%s aged %i falls under Part %s', (membership, age, part) => {
    expect(epfPartFor(membership, age)).toBe(part);
  });

  it('moves a Malaysian citizen to Part E at 60, not Part C', () => {
    // The citizen limb of Part C was deleted by P.U. (A) 370/2018.
    expect(epfPartFor('MALAYSIAN_CITIZEN', 60)).toBe('E');
    const value = computed(epfContribution(RM(5000), 'MALAYSIAN_CITIZEN', 60));
    expect(value.part).toBe('E');
    // Part E's employee share is nil throughout.
    expect(value.employeeCents).toBe(0);
    expect(value.employerCents).toBeGreaterThan(0);
  });

  it('charges a non-citizen 2% each side under Part F, with no band lookup', () => {
    const value = computed(epfContribution(RM(3000), 'NON_CITIZEN', 30));
    expect(value.part).toBe('F');
    expect(value.abovePercentage).toBe(true);
    // 2% of RM3,000 is RM60 each; the total is already whole ringgit.
    expect(value.employeeCents).toBe(RM(60));
    expect(value.employerCents).toBe(RM(60));
  });
});

describe('EPF above the RM20,000 table ceiling', () => {
  it('switches to 11% and 12% for Part A', () => {
    const value = computed(epfContribution(RM(25000), 'MALAYSIAN_CITIZEN', 35));
    expect(value.abovePercentage).toBe(true);
    expect(value.employeeCents).toBe(RM(2750)); // 11%
    expect(value.employerCents).toBe(RM(3000)); // 12%
  });

  it('switches to 5.5% and 6% for Part C', () => {
    const value = computed(epfContribution(RM(25000), 'PERMANENT_RESIDENT', 60));
    expect(value.employeeCents).toBe(RM(1375));
    expect(value.employerCents).toBe(RM(1500));
  });

  it('switches to 0% and 4% for Part E', () => {
    const value = computed(epfContribution(RM(25000), 'MALAYSIAN_CITIZEN', 60));
    expect(value.employeeCents).toBe(0);
    expect(value.employerCents).toBe(RM(1000));
  });

  it('rounds the TOTAL up to the next ringgit, putting the difference on the employer', () => {
    // RM20,000.50: employee 11% = 2,200.055, employer 12% = 2,400.06.
    const value = computed(epfContribution(RM(20000.5), 'MALAYSIAN_CITIZEN', 35));
    expect((value.employerCents + value.employeeCents) % 100).toBe(0);
    // The employee's share is never inflated by the rounding.
    expect(value.employeeCents).toBeLessThanOrEqual(Math.ceil(RM(20000.5) * 0.11));
  });
});

describe('EPF refuses rather than assuming an age', () => {
  it('cannot determine a contribution without a date of birth', () => {
    const outcome = epfContribution(RM(3000), 'MALAYSIAN_CITIZEN', null);
    expect(outcome.kind).toBe('CANNOT_DETERMINE');
    if (outcome.kind !== 'CANNOT_DETERMINE') throw new Error('unreachable');
    expect(outcome.reason).toMatch(/age 60/);
    // Never zero: nil and unknown are different facts.
    expect(outcome).not.toHaveProperty('value');
  });
});

// ---------------------------------------------------------------------------

describe('SOCSO keeps its schemes apart', () => {
  it('splits the First Category employee share into Invalidity and Non-Employment Injury', () => {
    // Band 65, at the ceiling: 29.75 Invalidity + 44.65 Non-Employment Injury.
    const value = computed(socsoContribution(RM(6000), 'FIRST'));
    expect(value.employeeInvalidityCents).toBe(RM(29.75));
    expect(value.employeeNonEmploymentInjuryCents).toBe(RM(44.65));
    expect(value.employeeCents).toBe(RM(74.4));
    expect(value.employerCents).toBe(RM(104.15));
  });

  /*
   * SKBBK CHANGED THE SECOND CATEGORY. It used to charge the employee nothing;
   * it now charges the Non-Employment Injury share. An implementation carrying
   * the old assumption under-deducts every second-category employee.
   */
  it('charges a Second Category employee the non-employment injury share, which is no longer nil', () => {
    const value = computed(socsoContribution(RM(6000), 'SECOND'));
    expect(value.employeeInvalidityCents).toBe(0);
    expect(value.employeeNonEmploymentInjuryCents).toBe(RM(44.65));
    expect(value.employeeCents).toBe(RM(44.65));
    expect(value.employeeCents).toBeGreaterThan(0);
  });

  it('holds at the RM6,000 ceiling', () => {
    const at = computed(socsoContribution(RM(6000), 'FIRST'));
    const above = computed(socsoContribution(RM(50000), 'FIRST'));
    expect(above.employerCents).toBe(at.employerCents);
    expect(above.employeeCents).toBe(at.employeeCents);
    expect(above.atCeiling).toBe(true);
    expect(at.atCeiling).toBe(false);
  });

  it('reads the first band inclusively — "Wages up to RM30"', () => {
    const value = computed(socsoContribution(RM(30), 'FIRST'));
    expect(value.employerCents).toBe(RM(0.4));
    expect(value.employeeCents).toBe(RM(0.3));
  });

  it('steps at a band edge', () => {
    const inside = computed(socsoContribution(RM(30), 'FIRST'));
    const next = computed(socsoContribution(RM(30.01), 'FIRST'));
    expect(next.employerCents).toBeGreaterThan(inside.employerCents);
  });
});

describe('EIS is its own Act with its own schedule', () => {
  it('charges employer and employee the same in every band', () => {
    for (const [, , employerCents, employeeCents] of EIS_BANDS) {
      expect(employerCents).toBe(employeeCents);
    }
  });

  it('reads the Act 800 figure at the ceiling', () => {
    const value = computed(eisContribution(RM(6000)));
    expect(value.employerCents).toBe(RM(11.9));
    expect(value.employeeCents).toBe(RM(11.9));
  });

  it('holds at the RM6,000 ceiling', () => {
    const above = computed(eisContribution(RM(20000)));
    expect(above.employerCents).toBe(RM(11.9));
    expect(above.atCeiling).toBe(true);
  });

  it('is not the same figure as SOCSO for the same wage', () => {
    // The two schedules are independent; sharing a wage does not share a rate.
    const eis = computed(eisContribution(RM(3000)));
    const socso = computed(socsoContribution(RM(3000), 'FIRST'));
    expect(eis.employeeCents).not.toBe(socso.employeeCents);
  });
});

// ---------------------------------------------------------------------------
// Table integrity — the transcription itself.
// ---------------------------------------------------------------------------
describe('the transcribed schedules are internally sound', () => {
  it('EPF bands are contiguous within every Part that has them', () => {
    for (const part of EPF_PARTS) {
      for (let i = 1; i < part.bands.length; i += 1) {
        expect(part.bands[i][0]).toBe(part.bands[i - 1][1] + 1);
      }
    }
  });

  it('EPF Parts A, C and E each carry 401 bands ending at RM20,000', () => {
    for (const letter of ['A', 'C', 'E'] as const) {
      const part = EPF_PARTS.find((candidate) => candidate.part === letter);
      expect(part?.bands).toHaveLength(401);
      expect(part?.bands[400][1]).toBe(RM(20000));
    }
  });

  it('SOCSO and EIS both carry 65 bands ending at the RM6,000 ceiling', () => {
    expect(SOCSO_BANDS).toHaveLength(65);
    expect(EIS_BANDS).toHaveLength(65);
    expect(SOCSO_BANDS[63][1]).toBe(RM(6000));
    expect(EIS_BANDS[63][1]).toBe(RM(6000));
    expect(SOCSO_BANDS[64][1]).toBeNull();
    expect(EIS_BANDS[64][1]).toBeNull();
  });

  it('every SOCSO band’s shares sum to the printed total', () => {
    for (const [, , c1Er, c1Inv, c1Nei, c2Er, c2Nei] of SOCSO_BANDS) {
      expect(c1Er + c1Inv + c1Nei).toBeGreaterThan(0);
      expect(c2Er + c2Nei).toBeGreaterThan(0);
      // The employer always carries more than the employee in both categories.
      expect(c1Er).toBeGreaterThanOrEqual(c1Inv + c1Nei);
      expect(c2Er).toBeGreaterThanOrEqual(c2Nei);
    }
  });

  /*
   * THE EMPLOYER RATE STEPS DOWN AT RM5,000, and this test exists because a
   * naive "contributions only ever rise" check failed here — correctly.
   *
   * The Schedule charges the employer 13% at or below RM5,000 of wages and 12%
   * above it, so the employer's contribution genuinely FALLS as wages cross
   * that line: RM650 on RM5,000 becomes RM612 on RM5,100. The employee's share
   * stays at 11% throughout and does rise.
   *
   * An implementation that "corrected" this into a monotonic curve, or that
   * used one employer percentage for everybody, would overcharge every clinic
   * with staff just above RM5,000.
   */
  it('steps the employer rate down from 13% to 12% as wages cross RM5,000', () => {
    const partA = EPF_PARTS.find((candidate) => candidate.part === 'A');
    if (!partA) throw new Error('Part A');
    const atFiveThousand = partA.bands.find((band) => band[1] === RM(5000));
    const justAbove = partA.bands.find((band) => band[0] === RM(5000.01));
    if (!atFiveThousand || !justAbove) throw new Error('boundary bands');

    expect(atFiveThousand[2]).toBe(RM(650)); // 13% of RM5,000
    expect(justAbove[2]).toBe(RM(612)); // 12% of RM5,100
    expect(justAbove[2]).toBeLessThan(atFiveThousand[2]);

    // The employee's share does not step down.
    expect(justAbove[3]).toBeGreaterThan(atFiveThousand[3]);
  });

  it('EPF contributions rise with wages everywhere except that one boundary', () => {
    for (const letter of ['A', 'C', 'E'] as const) {
      const part = EPF_PARTS.find((candidate) => candidate.part === letter);
      if (!part) throw new Error(letter);
      for (let i = 1; i < part.bands.length; i += 1) {
        const crossesFiveThousand = part.bands[i][0] === RM(5000.01);
        if (!crossesFiveThousand) {
          expect(part.bands[i][2]).toBeGreaterThanOrEqual(part.bands[i - 1][2]);
        }
        // The employee's share is monotonic throughout, in every Part.
        expect(part.bands[i][3]).toBeGreaterThanOrEqual(part.bands[i - 1][3]);
      }
    }
  });
});
