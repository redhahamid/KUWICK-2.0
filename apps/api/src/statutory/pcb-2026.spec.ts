import {
  DEDUCTION_INDIVIDUAL_CENTS,
  DEDUCTION_PER_CHILD_CENTS,
  EPF_RELIEF_CAP_CENTS,
  PCB_TABLE_1,
  PcbInput,
  computeK2Cents,
  computeP,
  computePcb,
  roundUpToFiveCents,
  truncateToCents,
  yearTaxCents,
} from './pcb-2026';

/**
 * OFFICIAL VECTORS — HASiL's own worked example.
 *
 * SOURCE: "Amendment to: Specification for MTD Calculations using Computerized
 * Calculation for 2026", Exhibit 5, "Example of Calculation", pages 45-51.
 *
 * These are not cases somebody invented to match the implementation. They are
 * the authority's published example, with the authority's own intermediate and
 * final values, and every one of them is asserted: K2, P, the year's tax, the
 * year's MTD, the bonus's MTD, and the month's deduction.
 *
 * The example runs one employee — married, spouse working, three qualifying
 * children, so Category 3 — through January to April, with a bonus in April.
 */

const RM = (ringgit: number) => Math.round(ringgit * 100);

/** The example's employee, with the month's own figures filled in per test. */
const employee = (over: Partial<PcbInput>): PcbInput => ({
  residence: 'RESIDENT',
  category: 3,
  qualifyingChildren: 3,
  disabledSelf: false,
  disabledSpouse: false,
  month: 1,
  accumulatedGrossCents: 0,
  accumulatedEpfCents: 0,
  grossNormalCents: RM(5500),
  epfOnNormalCents: RM(605),
  grossAdditionalCents: 0,
  epfOnAdditionalCents: 0,
  accumulatedDeductionsCents: 0,
  deductionsThisMonthCents: 0,
  accumulatedMtdPaidCents: 0,
  accumulatedZakatCents: 0,
  zakatThisMonthCents: 0,
  ...over,
});

const computed = (input: PcbInput) => {
  const outcome = computePcb(input);
  if (outcome.kind !== 'COMPUTED') throw new Error(`expected a computation, got ${outcome.kind}`);
  return outcome.result;
};

describe('Exhibit 5 — January 2025', () => {
  const input = employee({ month: 1 });

  it('K2 is RM308.63, truncated rather than rounded', () => {
    // [RM4,000 − (0 + 605 + 0)] / 11 = 308.6363…, and the authority prints
    // RM308.63. Rounding would give 308.64 and every later month would drift.
    expect(computeK2Cents(input, 11)).toBe(RM(308.63));
  });

  it('P is RM47,000.07', () => {
    expect(computeP(input, 11, computeK2Cents(input, 11), false)).toBe(RM(47000.07));
  });

  it('the month deducts RM110.00', () => {
    expect(computed(input).mtdCents).toBe(RM(110));
  });
});

describe('Exhibit 5 — February 2025', () => {
  const input = employee({
    month: 2,
    accumulatedGrossCents: RM(5500),
    accumulatedEpfCents: RM(605),
    accumulatedMtdPaidCents: RM(110),
  });

  it('K2 is RM279.00', () => {
    expect(computeK2Cents(input, 10)).toBe(RM(279));
  });

  it('P is RM47,000.00', () => {
    expect(computeP(input, 10, computeK2Cents(input, 10), false)).toBe(RM(47000));
  });

  /*
   * THE MONTH THAT SETTLES THE FORMULA.
   *
   * The printed layout leaves it ambiguous whether (Z + X) is subtracted
   * inside or outside the division by n+1. Here X = 110, and the two readings
   * give RM10.00 and RM110.00. The authority's answer is RM110.00, so the
   * subtraction is inside the numerator.
   */
  it('deducts RM110.00, which is only true if (Z + X) is inside the numerator', () => {
    expect(computed(input).mtdCents).toBe(RM(110));
  });
});

describe('Exhibit 5 — March 2025, with TP1 deductions', () => {
  const input = employee({
    month: 3,
    accumulatedGrossCents: RM(11000),
    accumulatedEpfCents: RM(1210),
    accumulatedMtdPaidCents: RM(220),
    // Books RM100 and medical expenses for a parent RM200.
    deductionsThisMonthCents: RM(300),
  });

  it('K2 is RM242.77', () => {
    expect(computeK2Cents(input, 9)).toBe(RM(242.77));
  });

  it('P is RM46,700.07', () => {
    expect(computeP(input, 9, computeK2Cents(input, 9), false)).toBe(RM(46700.07));
  });

  it('the month deducts RM108.20', () => {
    expect(computed(input).mtdCents).toBe(RM(108.2));
  });
});

describe('Exhibit 5 — April 2025, bonus of RM8,250', () => {
  const input = employee({
    month: 4,
    accumulatedGrossCents: RM(16500),
    accumulatedEpfCents: RM(1815),
    accumulatedMtdPaidCents: RM(328.2),
    accumulatedDeductionsCents: RM(300),
    deductionsThisMonthCents: RM(300),
    grossAdditionalCents: RM(8250),
    epfOnAdditionalCents: RM(908),
  });

  it('Step 1[B]: P without the bonus is RM46,400.00', () => {
    // Step 1 recomputes K2 with Kt included, giving RM197.50.
    const withoutBonus = { ...input, grossAdditionalCents: 0, epfOnAdditionalCents: 0 };
    expect(computeK2Cents(input, 8)).toBe(RM(84));
    expect(computeK2Cents(withoutBonus, 8)).toBe(RM(197.5));
    expect(computeP(withoutBonus, 8, RM(197.5), false)).toBe(RM(46400));
  });

  it('Step 1[C]: the normal month is RM106.20', () => {
    expect(computed(input).normalMtdCents).toBe(RM(106.2));
  });

  it('Step 1[E]: the year total is RM1,284.00', () => {
    expect(computed(input).working.yearMtdCents).toBe(RM(1284));
  });

  it('Step 2[B]: P including the bonus is RM54,650.00', () => {
    expect(computed(input).working.pWithAdditionalCents).toBe(RM(54650));
  });

  it('Step 3: the year total tax is RM2,011.50', () => {
    expect(computed(input).working.yearTaxCents).toBe(RM(2011.5));
    // And independently, straight from Table 1.
    expect(yearTaxCents(RM(54650), 3)).toBe(RM(2011.5));
  });

  it('Step 4: the bonus attracts RM727.50', () => {
    expect(computed(input).additionalMtdCents).toBe(RM(727.5));
  });

  it('Step 5: the month deducts RM833.70', () => {
    expect(computed(input).mtdCents).toBe(RM(833.7));
  });
});

/*
 * Section D(a) gives its own worked figure: RM3,000 × 30% = RM900.
 */
describe('a non-resident employee', () => {
  it('deducts a flat 30%, with no reliefs and no accumulation', () => {
    const result = computed(employee({ residence: 'NON_RESIDENT', grossNormalCents: RM(3000) }));
    expect(result.mtdCents).toBe(RM(900));
  });

  it('ignores children, spouse and EPF, because the rate is on remuneration', () => {
    const rich = computed(
      employee({
        residence: 'NON_RESIDENT',
        grossNormalCents: RM(3000),
        category: 2,
        qualifyingChildren: 5,
        epfOnNormalCents: RM(330),
      }),
    );
    expect(rich.mtdCents).toBe(RM(900));
  });
});

// ---------------------------------------------------------------------------
// Rounding, as section E states it.
// ---------------------------------------------------------------------------
describe('rounding follows section E in order', () => {
  it('truncates to two decimals rather than rounding: 123.4534 → 123.45', () => {
    expect(truncateToCents(12345.34)).toBe(12345);
  });

  it('rounds 1-4 sen up to 5 sen: 287.02 → 287.05', () => {
    expect(roundUpToFiveCents(28702)).toBe(28705);
  });

  it('rounds 6-9 sen up to 10 sen: 152.06 → 152.10', () => {
    expect(roundUpToFiveCents(15206)).toBe(15210);
  });

  it('leaves a five-cent boundary alone', () => {
    expect(roundUpToFiveCents(28705)).toBe(28705);
    expect(roundUpToFiveCents(15210)).toBe(15210);
  });

  it('never rounds down', () => {
    for (let cents = 1; cents <= 200; cents += 1) {
      expect(roundUpToFiveCents(cents)).toBeGreaterThanOrEqual(cents);
      expect(roundUpToFiveCents(cents) % 5).toBe(0);
    }
  });

  it('deducts nothing when the month is below RM10 — section E(3)', () => {
    // A small salary yields a small P and an MTD under the floor.
    const result = computed(employee({ grossNormalCents: RM(1500), epfOnNormalCents: RM(165) }));
    expect(result.mtdCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Boundaries in Table 1.
// ---------------------------------------------------------------------------
describe('Table 1 boundaries', () => {
  it('taxes nothing at or below RM5,000 of chargeable income', () => {
    expect(yearTaxCents(RM(5000), 1)).toBe(0);
    expect(yearTaxCents(RM(0), 1)).toBe(0);
  });

  it('applies the first band from RM5,001, which is where the document starts it', () => {
    // Table 1 states its ranges in whole ringgit — "5,001 - 20,000" — and the
    // transcription follows the document rather than tidying it.
    // (5,001 − 5,000) × 1% + (−400) = a rebate larger than the tax.
    expect(yearTaxCents(RM(5001), 1)).toBe(RM(-399.99));
  });

  /*
   * THE SUB-RINGGIT GAP IN TABLE 1, and why it cannot change a deduction.
   *
   * P is computed to the cent, but Table 1's ranges are whole ringgit, so a P
   * of RM5,000.50 falls in no row. Rather than invent a row, the lookup
   * returns no band and the year's tax is nil.
   *
   * That is safe, and provably so: the first band's B is −RM400, so its tax is
   * (P − 5,000) × 1% − 400, which stays negative for every P the band covers
   * (it would need P above RM45,000 to turn positive, and the band ends at
   * RM20,000). Both readings of the boundary therefore produce a nil monthly
   * deduction, and no employee is deducted differently because of the gap.
   */
  it('treats the gap below RM5,001 as nil tax, which no reading could turn into a deduction', () => {
    expect(yearTaxCents(RM(5000.5), 1)).toBe(0);
    for (const p of [5000.01, 5000.5, 5000.99, 5001, 12000, 20000]) {
      expect(yearTaxCents(RM(p), 1)).toBeLessThanOrEqual(0);
    }
  });

  it('gives category 2 the larger rebate in the first two bands only', () => {
    expect(yearTaxCents(RM(20000), 1)).toBe(yearTaxCents(RM(20000), 3));
    expect(yearTaxCents(RM(20000), 2)).toBe(yearTaxCents(RM(20000), 1) - RM(400));
    // From the third band the two coincide.
    expect(yearTaxCents(RM(40000), 2)).toBe(yearTaxCents(RM(40000), 1));
  });

  it('steps at every band edge Table 1 actually states', () => {
    // The document's own boundaries, in whole ringgit.
    const edges: [number, number][] = [
      [20000, 20001], [35000, 35001], [50000, 50001],
      [70000, 70001], [100000, 100001], [400000, 400001],
      [600000, 600001], [2000000, 2000001],
    ];
    for (const [below, above] of edges) {
      expect(yearTaxCents(RM(above), 3)).toBeGreaterThan(yearTaxCents(RM(below), 3));
    }
  });

  it('has contiguous whole-ringgit bands, each starting one ringgit above the last', () => {
    for (let i = 1; i < PCB_TABLE_1.length; i += 1) {
      const previous = PCB_TABLE_1[i - 1];
      const current = PCB_TABLE_1[i];
      expect(previous.toCents).not.toBeNull();
      expect(current.fromCents).toBe((previous.toCents as number) + 100);
      // M is the band's first chargeable income, one ringgit below its start.
      expect(current.mCents).toBe(current.fromCents - 100);
    }
  });
});

// ---------------------------------------------------------------------------
// Category rules, enforced rather than trusted to the caller.
// ---------------------------------------------------------------------------
describe('the specification’s category rules are enforced here', () => {
  it('category 1 gets no spouse deduction and no children, whatever it is passed', () => {
    const single = employee({ category: 1, qualifyingChildren: 4 });
    const p = computeP(single, 11, computeK2Cents(single, 11), false);
    const noChildren = employee({ category: 1, qualifyingChildren: 0 });
    expect(p).toBe(computeP(noChildren, 11, computeK2Cents(noChildren, 11), false));
  });

  it('category 3 gets children but no spouse deduction', () => {
    const cat3 = employee({ category: 3, qualifyingChildren: 2 });
    const cat2 = employee({ category: 2, qualifyingChildren: 2 });
    const diff =
      computeP(cat3, 11, computeK2Cents(cat3, 11), false) - computeP(cat2, 11, computeK2Cents(cat2, 11), false);
    expect(diff).toBe(DEDUCTION_INDIVIDUAL_CENTS); // the spouse deduction, RM9,000
  });

  it('each qualifying child reduces chargeable income by RM2,000', () => {
    const one = employee({ qualifyingChildren: 1 });
    const two = employee({ qualifyingChildren: 2 });
    const drop =
      computeP(one, 11, computeK2Cents(one, 11), false) - computeP(two, 11, computeK2Cents(two, 11), false);
    expect(drop).toBe(DEDUCTION_PER_CHILD_CENTS);
  });
});

describe('the EPF relief cap', () => {
  it('admits no more than RM4,000 of contributions across the year', () => {
    // Contributions far above the cap must not reduce P beyond it.
    const heavy = employee({ accumulatedGrossCents: RM(100000), accumulatedEpfCents: RM(11000), month: 6 });
    const capped = employee({ accumulatedGrossCents: RM(100000), accumulatedEpfCents: EPF_RELIEF_CAP_CENTS, month: 6 });
    expect(computeP(heavy, 6, 0, false)).toBe(computeP(capped, 6, 0, false));
  });

  it('K2 falls to zero once the cap is exhausted', () => {
    const exhausted = employee({ accumulatedEpfCents: EPF_RELIEF_CAP_CENTS, month: 6 });
    expect(computeK2Cents(exhausted, 6)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The methods this build refuses rather than approximates.
// ---------------------------------------------------------------------------
describe('the four special methods are refused, not approximated', () => {
  it.each(['REP', 'KNOWLEDGE_WORKER', 'C_SUITE'] as const)('refuses %s by name', (method) => {
    const outcome = computePcb(employee({}), method);
    expect(outcome.kind).toBe('UNSUPPORTED');
    if (outcome.kind !== 'UNSUPPORTED') throw new Error('unreachable');
    // The refusal has to tell somebody what to do, not merely that it stopped.
    expect(outcome.reason).toMatch(/entered by hand/);
    expect(outcome.reason).not.toMatch(/PCB|MTD_|_ERROR/);
  });

  it('computes normally when no special method applies', () => {
    expect(computePcb(employee({}), 'NONE').kind).toBe('COMPUTED');
  });
});
