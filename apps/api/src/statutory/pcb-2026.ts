/**
 * PCB / MTD 2026 — MONTHLY TAX DEDUCTION BY COMPUTERISED CALCULATION.
 *
 * SOURCE (Tier A): Lembaga Hasil Dalam Negeri Malaysia, "Amendment to:
 * Specification for Monthly Tax Deduction (MTD) Calculations using
 * Computerized Calculation for 2026", updated 1 January 2026. Supplied by the
 * account holder as `spesifikasikaedahpengiraanberkomputerpcb2026.pdf`.
 *
 * The specification states plainly, at section C: "In line with the Budget
 * 2026 as above, there is no amendment to the MTD formula." The 2026 changes
 * are to the relief ITEMS declarable on Forms TP1 and TP3, which reach this
 * engine as `lp` and `accumulatedLp` rather than as formula changes.
 *
 * WHAT THE PRINTED FORMULA DOES NOT SAY, AND THE WORKED EXAMPLE DOES.
 *
 * The specification renders the monthly formula as
 *
 *     [(P – M) R + B] – (Z + X)
 *                n+1
 *
 * with `n+1` set under the middle of the line, which reads as though only the
 * bracket is divided. It is not. Exhibit 5's February month settles it:
 * P = 47,000.00, M = 35,000, R = 6%, B = 600, X = 110, n = 10, answer RM110.
 *
 *   dividing only the bracket:  1320/11 − 110 = 10.00   ✗
 *   dividing the whole thing:  (1320 − 110)/11 = 110.00 ✓
 *
 * So the subtraction happens INSIDE the numerator. Getting this wrong yields a
 * figure that is plausible, monotonic in salary, and wrong by an order of
 * magnitude in exactly the months where tax has already been paid — which is
 * every month after January. The authority's own worked example is the only
 * thing in the document that disambiguates it.
 *
 * ROUNDING, from section E, in this order:
 *   1. Truncate to two decimals — "limited to two decimal points only and omit
 *      the subsequent figures". Truncate, never round: 123.4534 → 123.45.
 *   2. Round the result UP to the nearest five cents: 1-4 sen → 5 sen,
 *      6-9 sen → 10 sen.
 *   3. If the month's MTD is below RM10, deduct nothing.
 *
 * NOTHING IN THIS FILE IS INFERRED. Where the specification is silent the
 * engine returns a refusal rather than a number; see `PcbOutcome`.
 */

/** The employee's residence status decides which method applies at all. */
export type ResidenceStatus = 'RESIDENT' | 'NON_RESIDENT';

/**
 * The specification's own three categories, which set D, S and C.
 *
 * Named as the document names them rather than as "single/married", because
 * category 3 covers a married employee with a working spouse, a divorcee, a
 * widow or widower, AND a single person with an adopted child — one label
 * cannot carry that.
 */
export type PcbCategory = 1 | 2 | 3;

/** MTD is 30% of remuneration for an employee who is not resident. */
export const NON_RESIDENT_RATE_PERCENT = 30;

/** Deduction for the individual (D). Exhibit 5: RM9,000.00. */
export const DEDUCTION_INDIVIDUAL_CENTS = 900_000;

/** Deduction for a husband or wife (S), for category 2. Exhibit 5: RM9,000.00. */
export const DEDUCTION_SPOUSE_CENTS = 900_000;

/** Deduction per qualifying child (Q). Exhibit 5 writes the term as 2000C. */
export const DEDUCTION_PER_CHILD_CENTS = 200_000;

/**
 * The yearly cap on K — contributions to the EPF or another approved scheme —
 * for MTD purposes. Exhibit 5: "RM4,000.00 (limited)".
 *
 * This is the MTD relief ceiling, not the EPF contribution itself. An employee
 * contributing RM605 a month reaches it in the seventh month, and K2 shrinks
 * each month to keep the year's total at or under it.
 */
export const EPF_RELIEF_CAP_CENTS = 400_000;

/**
 * TABLE 1 — value of P, M, R and B.
 *
 * B differs between category 2 and categories 1 and 3 in the first two bands
 * only, because B is the tax on M after the individual rebate and, where it
 * applies, the spouse rebate. Both are negative in those bands, which is the
 * rebate exceeding the tax.
 */
export interface PcbBand {
  /** Lower bound of P, in cents, inclusive. */
  readonly fromCents: number;
  /** Upper bound of P, in cents, inclusive. Null on the top band. */
  readonly toCents: number | null;
  /** M — the first chargeable income of the band, in cents. */
  readonly mCents: number;
  /** R — the rate, as a percentage. */
  readonly ratePercent: number;
  /** B for categories 1 and 3, in cents. May be negative. */
  readonly bCategory13Cents: number;
  /** B for category 2, in cents. May be negative. */
  readonly bCategory2Cents: number;
}

export const PCB_TABLE_1: readonly PcbBand[] = [
  { fromCents: 500_100, toCents: 2_000_000, mCents: 500_000, ratePercent: 1, bCategory13Cents: -40_000, bCategory2Cents: -80_000 },
  { fromCents: 2_000_100, toCents: 3_500_000, mCents: 2_000_000, ratePercent: 3, bCategory13Cents: -25_000, bCategory2Cents: -65_000 },
  { fromCents: 3_500_100, toCents: 5_000_000, mCents: 3_500_000, ratePercent: 6, bCategory13Cents: 60_000, bCategory2Cents: 60_000 },
  { fromCents: 5_000_100, toCents: 7_000_000, mCents: 5_000_000, ratePercent: 11, bCategory13Cents: 150_000, bCategory2Cents: 150_000 },
  { fromCents: 7_000_100, toCents: 10_000_000, mCents: 7_000_000, ratePercent: 19, bCategory13Cents: 370_000, bCategory2Cents: 370_000 },
  { fromCents: 10_000_100, toCents: 40_000_000, mCents: 10_000_000, ratePercent: 25, bCategory13Cents: 940_000, bCategory2Cents: 940_000 },
  { fromCents: 40_000_100, toCents: 60_000_000, mCents: 40_000_000, ratePercent: 26, bCategory13Cents: 8_440_000, bCategory2Cents: 8_440_000 },
  { fromCents: 60_000_100, toCents: 200_000_000, mCents: 60_000_000, ratePercent: 28, bCategory13Cents: 13_640_000, bCategory2Cents: 13_640_000 },
  { fromCents: 200_000_100, toCents: null, mCents: 200_000_000, ratePercent: 30, bCategory13Cents: 52_840_000, bCategory2Cents: 52_840_000 },
] as const;

/** Everything the formula needs for one employee in one month. All money in cents. */
export interface PcbInput {
  readonly residence: ResidenceStatus;
  readonly category: PcbCategory;
  /** C — qualifying children. Category 1 must be 0. */
  readonly qualifyingChildren: number;
  /** Whether the employee is a disabled person (DU). */
  readonly disabledSelf: boolean;
  /** Whether the spouse is disabled (SU). Category 2 only. */
  readonly disabledSpouse: boolean;

  /** The month being paid, 1-12. Decides n. */
  readonly month: number;

  /** ∑Y — gross normal + additional remuneration paid earlier this year, including a previous employer's. */
  readonly accumulatedGrossCents: number;
  /** ∑K — contributions in respect of ∑Y. */
  readonly accumulatedEpfCents: number;
  /** Y1 — gross normal remuneration for this month. */
  readonly grossNormalCents: number;
  /** K1 — contribution in respect of Y1. */
  readonly epfOnNormalCents: number;
  /** Yt — gross ADDITIONAL remuneration this month: bonus, arrears, non-monthly commission. */
  readonly grossAdditionalCents: number;
  /** Kt — contribution in respect of Yt. */
  readonly epfOnAdditionalCents: number;
  /**
   * Y2 — the estimate of Y1 for each remaining month. The specification calls
   * it "estimated remuneration as Y1", so it defaults to Y1.
   */
  readonly estimatedFutureNormalCents?: number;

  /** ∑LP — allowable deductions accumulated this year (TP1, and TP3 for a previous employer). */
  readonly accumulatedDeductionsCents: number;
  /** LP1 — allowable deductions for this month. */
  readonly deductionsThisMonthCents: number;

  /** X — MTD already paid this year, including under a previous employer. */
  readonly accumulatedMtdPaidCents: number;
  /** Z — zakat paid this year other than this month's. */
  readonly accumulatedZakatCents: number;
  /** This month's zakat, deducted from the month's MTD. */
  readonly zakatThisMonthCents: number;
}

/**
 * The engine refuses rather than guesses.
 *
 * `UNSUPPORTED` is returned where the specification defines a method this
 * build does not implement — the Returning Expert Programme, knowledge workers
 * in a specified region, and a resident non-citizen in a C-Suite position all
 * have their own formulas and their own approvals. Returning a number for one
 * of those by running the ordinary formula would be a wrong figure that looks
 * right, which is worse than a refusal.
 */
export type PcbOutcome =
  | { readonly kind: 'COMPUTED'; readonly result: PcbResult }
  | { readonly kind: 'UNSUPPORTED'; readonly reason: string };

export interface PcbResult {
  /** What is actually deducted from this month's pay. */
  readonly mtdCents: number;
  /** The month's MTD on normal remuneration, before this month's zakat. */
  readonly normalMtdCents: number;
  /** Net of this month's zakat. */
  readonly netNormalMtdCents: number;
  /** The separate MTD on additional remuneration, nil when there is none. */
  readonly additionalMtdCents: number;
  /** Zakat carried to the following month as part of Z. */
  readonly zakatCarriedForwardCents: number;
  /** The working, so a payslip and an auditor can follow it. */
  readonly working: PcbWorking;
}

export interface PcbWorking {
  readonly pCents: number;
  readonly mCents: number;
  readonly ratePercent: number;
  readonly bCents: number;
  readonly n: number;
  readonly k2Cents: number;
  readonly totalReliefCents: number;
  /** Present only when additional remuneration was paid this month. */
  readonly pWithAdditionalCents?: number;
  readonly yearTaxCents?: number;
  readonly yearMtdCents?: number;
}

// ---------------------------------------------------------------------------
// Rounding, exactly as section E states it.
// ---------------------------------------------------------------------------

/**
 * "Calculations is limited to two decimal points only and omit the subsequent
 * figures." Truncation toward zero, not rounding — 123.4534 becomes 123.45.
 */
export function truncateToCents(value: number): number {
  return value < 0 ? -Math.floor(-value) : Math.floor(value);
}

/**
 * "The amount of Monthly Tax Deduction to be rounded up to the nearest five
 * cents": 1-4 sen go up to 5, 6-9 sen go up to 10.
 *
 * Always upward, so 287.02 becomes 287.05 and 152.06 becomes 152.10. A value
 * already on a five-cent boundary is unchanged.
 */
export function roundUpToFiveCents(cents: number): number {
  if (cents <= 0) return cents;
  const remainder = cents % 5;
  return remainder === 0 ? cents : cents + (5 - remainder);
}

/** Section E(3): below RM10 for the month, the employer deducts nothing. */
export const MTD_MINIMUM_CENTS = 1_000;

function applyMinimum(cents: number, params: PcbParams = BUILT_IN_PCB_PARAMS): number {
  return cents < params.minimumCents ? 0 : cents;
}

// ---------------------------------------------------------------------------

/** Table 1 lookup. P at or below RM5,000 attracts no tax. */
export function bandForP(pCents: number, params: PcbParams = BUILT_IN_PCB_PARAMS): PcbBand | null {
  for (const band of params.table1) {
    if (pCents >= band.fromCents && (band.toCents === null || pCents <= band.toCents)) return band;
  }
  return null;
}

function bValue(band: PcbBand, category: PcbCategory): number {
  return category === 2 ? band.bCategory2Cents : band.bCategory13Cents;
}

/**
 * The relief block: D + S + DU + SU + QC.
 *
 * The specification sets S to zero outside category 2, and C to zero in
 * category 1, so those are enforced here rather than trusted to the caller.
 */
export function reliefCents(input: PcbInput, params: PcbParams = BUILT_IN_PCB_PARAMS): number {
  const spouse = input.category === 2 ? params.spouseCents : 0;
  const children = input.category === 1 ? 0 : input.qualifyingChildren;
  const disabledSelf = input.disabledSelf ? params.disabledSelfCents : 0;
  const disabledSpouse = input.category === 2 && input.disabledSpouse ? params.disabledSpouseCents : 0;
  return params.individualCents + spouse + disabledSelf + disabledSpouse + children * params.perChildCents;
}

/** DU — deduction for a disabled individual. */
export const DEDUCTION_DISABLED_SELF_CENTS = 600_000;
/** SU — deduction for a disabled husband or wife. */
export const DEDUCTION_DISABLED_SPOUSE_CENTS = 500_000;

/**
 * THE SPECIFICATION'S PARAMETERS, handed in rather than reached for, so a
 * later year's specification — added by the platform as data, in force from
 * a date — is applied without a code change. Built-in by default: with
 * nothing handed in the engine reads the 2026 figures exactly as before.
 */
export interface PcbParams {
  readonly table1: readonly PcbBand[];
  readonly individualCents: number;
  readonly spouseCents: number;
  readonly perChildCents: number;
  readonly disabledSelfCents: number;
  readonly disabledSpouseCents: number;
  readonly epfReliefCapCents: number;
  readonly nonResidentRatePercent: number;
  readonly minimumCents: number;
}
export const BUILT_IN_PCB_PARAMS: PcbParams = {
  table1: PCB_TABLE_1,
  individualCents: DEDUCTION_INDIVIDUAL_CENTS,
  spouseCents: DEDUCTION_SPOUSE_CENTS,
  perChildCents: DEDUCTION_PER_CHILD_CENTS,
  disabledSelfCents: DEDUCTION_DISABLED_SELF_CENTS,
  disabledSpouseCents: DEDUCTION_DISABLED_SPOUSE_CENTS,
  epfReliefCapCents: EPF_RELIEF_CAP_CENTS,
  nonResidentRatePercent: NON_RESIDENT_RATE_PERCENT,
  minimumCents: MTD_MINIMUM_CENTS,
};

/**
 * K2 — the estimated EPF for each remaining month.
 *
 * "[[Total qualifying amount per year – (K + K1 + Kt)] / n] or K1, whichever
 * is lower". Truncated to cents like every other intermediate value: Exhibit 5
 * takes 3,395/11 = 308.6363… to RM308.63, not RM308.64.
 */
export function computeK2Cents(input: PcbInput, n: number, params: PcbParams = BUILT_IN_PCB_PARAMS): number {
  if (n <= 0) return 0;
  const used = input.accumulatedEpfCents + input.epfOnNormalCents + input.epfOnAdditionalCents;
  const remaining = Math.max(0, params.epfReliefCapCents - used);
  const spread = truncateToCents(remaining / n);
  return Math.min(spread, input.epfOnNormalCents);
}

/**
 * K is capped for the year. `K + K1 + K2 + Kt` may not exceed the cap, so each
 * component is admitted only up to what the cap still allows, in the order the
 * formula states them.
 */
function cappedNetCents(grossCents: number, epfCents: number, allowanceLeft: number): { net: number; used: number } {
  const admitted = Math.min(epfCents, Math.max(0, allowanceLeft));
  return { net: grossCents - admitted, used: admitted };
}

/**
 * P — total chargeable income for the year.
 *
 * P = [∑(Y − K) + (Y1 − K1) + (Y2 − K2)n + (Yt − Kt)] − [D + S + DU + SU + QC + (∑LP + LP1)]
 *
 * `includeAdditional` is the difference between Step 1[B] and Step 2[B] of the
 * additional-remuneration method: the same expression, once without this
 * month's bonus and once with it.
 */
export function computeP(
  input: PcbInput,
  n: number,
  k2Cents: number,
  includeAdditional: boolean,
  params: PcbParams = BUILT_IN_PCB_PARAMS,
): number {
  let allowanceLeft = params.epfReliefCapCents;

  const prior = cappedNetCents(input.accumulatedGrossCents, input.accumulatedEpfCents, allowanceLeft);
  allowanceLeft -= prior.used;

  const current = cappedNetCents(input.grossNormalCents, input.epfOnNormalCents, allowanceLeft);
  allowanceLeft -= current.used;

  const additional = includeAdditional
    ? cappedNetCents(input.grossAdditionalCents, input.epfOnAdditionalCents, allowanceLeft)
    : { net: 0, used: 0 };
  allowanceLeft -= additional.used;

  const futureGross = input.estimatedFutureNormalCents ?? input.grossNormalCents;
  const futureEpfPerMonth = Math.min(k2Cents, Math.max(0, allowanceLeft) / Math.max(1, n));
  const future = n > 0 ? (futureGross - truncateToCents(futureEpfPerMonth)) * n : 0;

  const income = prior.net + current.net + future + additional.net;
  const deductions =
    reliefCents(input, params) + input.accumulatedDeductionsCents + input.deductionsThisMonthCents;
  return income - deductions;
}

/** [(P − M) R + B], the year's tax before any month is apportioned. */
export function yearTaxCents(pCents: number, category: PcbCategory, params: PcbParams = BUILT_IN_PCB_PARAMS): number {
  const band = bandForP(pCents, params);
  if (!band) return 0;
  return truncateToCents((pCents - band.mCents) * (band.ratePercent / 100)) + bValue(band, category);
}

/**
 * THE MONTH'S DEDUCTION.
 *
 * Returns an outcome rather than a number: an employee under one of the four
 * special methods gets a refusal naming the method, because running the
 * ordinary formula for them would produce a confident wrong answer.
 */
export function computePcb(input: PcbInput, special?: SpecialMethod, params: PcbParams = BUILT_IN_PCB_PARAMS): PcbOutcome {
  if (special && special !== 'NONE') {
    return { kind: 'UNSUPPORTED', reason: SPECIAL_METHOD_REASON[special] };
  }

  if (input.residence === 'NON_RESIDENT') {
    // Section D(a): 30% of remuneration, flat. No reliefs, no accumulation.
    const remuneration = input.grossNormalCents + input.grossAdditionalCents;
    const raw = truncateToCents(remuneration * (params.nonResidentRatePercent / 100));
    const mtd = applyMinimum(roundUpToFiveCents(raw), params);
    return {
      kind: 'COMPUTED',
      result: {
        mtdCents: mtd,
        normalMtdCents: mtd,
        netNormalMtdCents: mtd,
        additionalMtdCents: 0,
        zakatCarriedForwardCents: input.accumulatedZakatCents + input.zakatThisMonthCents,
        working: {
          pCents: 0, mCents: 0, ratePercent: params.nonResidentRatePercent, bCents: 0,
          n: 0, k2Cents: 0, totalReliefCents: 0,
        },
      },
    };
  }

  const n = 12 - input.month;

  /*
   * STEP 1 DOES NOT KNOW ABOUT THE BONUS — including its EPF.
   *
   * The specification computes K2 twice with different inputs. In Step 1 the
   * additional remuneration does not exist, so Kt is nil and K2 is
   * [cap − (K + K1)] / n. In Step 2 the bonus and its Kt are both present, and
   * K2 shrinks accordingly.
   *
   * Exhibit 5's April makes the difference visible: Step 1 has K2 = RM197.50
   * and Step 2 has K2 = RM84.00, from the same month. Carrying Step 2's figure
   * into Step 1 understates the year's EPF relief, overstates P, and returns
   * RM112.25 where the authority says RM106.20 — a wrong number that looks
   * entirely reasonable.
   */
  const normalOnly: PcbInput = { ...input, grossAdditionalCents: 0, epfOnAdditionalCents: 0 };
  const k2 = computeK2Cents(normalOnly, n, params);

  // --- Step 1: the month's MTD on normal remuneration -----------------------
  const p = computeP(normalOnly, n, k2, false, params);
  const band = bandForP(p, params);
  const b = band ? bValue(band, input.category) : 0;
  const m = band ? band.mCents : 0;
  const rate = band ? band.ratePercent : 0;

  const yearTax = yearTaxCents(p, input.category, params);
  // The whole numerator is divided by n+1; see the note at the top of the file.
  const numerator = yearTax - (input.accumulatedZakatCents + input.accumulatedMtdPaidCents);
  const normalRaw = truncateToCents(numerator / (n + 1));
  const normalMtd = applyMinimum(roundUpToFiveCents(Math.max(0, normalRaw)), params);

  // Step 1[D]: net of this month's zakat. A negative result is nil, and the
  // unused zakat is carried forward in Z rather than lost.
  const netNormal = normalMtd - input.zakatThisMonthCents;
  const netNormalMtd = Math.max(0, netNormal);
  const zakatCarried = input.accumulatedZakatCents + input.zakatThisMonthCents;

  if (input.grossAdditionalCents === 0) {
    return {
      kind: 'COMPUTED',
      result: {
        mtdCents: netNormalMtd,
        normalMtdCents: normalMtd,
        netNormalMtdCents: netNormalMtd,
        additionalMtdCents: 0,
        zakatCarriedForwardCents: zakatCarried,
        working: { pCents: p, mCents: m, ratePercent: rate, bCents: b, n, k2Cents: k2, totalReliefCents: reliefCents(input, params) },
      },
    };
  }

  // --- Steps 2 to 5: additional remuneration --------------------------------
  // Step 1[E]: the year's MTD if every remaining month matched this one.
  const yearMtd = input.accumulatedMtdPaidCents + normalMtd * (n + 1);

  // Step 2[B]: P again, this time including the bonus. K2 is recomputed from
  // the FULL input, because Kt now consumes part of the year's EPF relief.
  const k2WithAdditional = computeK2Cents(input, n, params);
  const pWithAdditional = computeP(input, n, k2WithAdditional, true, params);

  // Step 3: the year's total tax at that higher chargeable income.
  const totalYearTax = yearTaxCents(pWithAdditional, input.category, params);

  // Step 4: the bonus's own MTD is the difference, plus zakat already paid.
  const additionalRaw = truncateToCents(totalYearTax - yearMtd + input.accumulatedZakatCents);
  const additionalMtd = applyMinimum(roundUpToFiveCents(Math.max(0, additionalRaw)), params);

  // Step 5: what is deducted this month.
  return {
    kind: 'COMPUTED',
    result: {
      mtdCents: netNormalMtd + additionalMtd,
      normalMtdCents: normalMtd,
      netNormalMtdCents: netNormalMtd,
      additionalMtdCents: additionalMtd,
      zakatCarriedForwardCents: zakatCarried,
      working: {
        pCents: p, mCents: m, ratePercent: rate, bCents: b, n, k2Cents: k2,
        totalReliefCents: reliefCents(input, params),
        pWithAdditionalCents: pWithAdditional,
        yearTaxCents: totalYearTax,
        yearMtdCents: yearMtd,
      },
    },
  };
}

/**
 * The four methods the specification defines separately, each requiring its own
 * IRBM approval. None is implemented; each is refused by name.
 */
export type SpecialMethod = 'NONE' | 'REP' | 'KNOWLEDGE_WORKER' | 'C_SUITE';

export const SPECIAL_METHOD_REASON: Record<Exclude<SpecialMethod, 'NONE'>, string> = {
  REP:
    'This employee is under the Returning Expert Programme, which the specification taxes at a flat 15% under its own formula. Kuwick has not implemented it, so their monthly tax has to be entered by hand.',
  KNOWLEDGE_WORKER:
    'This employee is a knowledge worker in a specified region, which the specification taxes under its own formula. Kuwick has not implemented it, so their monthly tax has to be entered by hand.',
  C_SUITE:
    'This employee is a resident non-citizen in a C-Suite position at an approved company, which the specification taxes under its own formula. Kuwick has not implemented it, so their monthly tax has to be entered by hand.',
};
