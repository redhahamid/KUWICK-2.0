import {
  ContributionOutcome,
  EpfMembership,
  eisContribution,
  epfContribution,
  socsoContribution,
} from '../statutory/contributions';
import { PcbResult, computePcb as computeMtd } from '../statutory/pcb-2026';
import {
  StatutoryScheme,
  StatutoryStamp,
  VerificationState,
  meetsApprovalBar,
  scheduleFor,
  stampFor,
} from '../statutory/registry';

/**
 * MALAYSIAN STATUTORY CONTRIBUTIONS — now from the authorities' own schedules.
 *
 * WHAT CHANGED, AND WHY IT MATTERS.
 *
 * This module used to read its bands from a `StatutoryRuleSet` row seeded from
 * a 2024 table nobody had checked against KWSP or PERKESO. The shape was right
 * — Malaysian contributions are tables, not percentages — but the numbers were
 * only as good as whoever typed them, and the system had no way to say which
 * edition a payslip was calculated against.
 *
 * It now computes from `src/statutory/`, which is transcribed band by band from
 * the documents the account holder supplied: the EPF Third Schedule in force
 * from 1 October 2025, PERKESO's Act 4 rate table including SKBBK, and the
 * Act 800 EIS table. `src/statutory/registry.ts` dates and hashes each one, so
 * a run records not merely THAT it applied EPF but WHICH EPF.
 *
 * That cutover changes real figures. The most consequential: under SKBBK a
 * Second Category employee (60 and over) now contributes to Non-Employment
 * Injury, where the seeded table had them at nil. A clinic reconciling against
 * last year's spreadsheet will see that difference and should — it is the law
 * changing, not the engine drifting.
 *
 * WHAT HAS NOT CHANGED is the discipline the previous version got right, and
 * it is worth restating because everything else here depends on it:
 *
 *  - THE THREE BASES ARE DIFFERENT. EPF Act 1991 s.2 excludes overtime from
 *    wages; SOCSO and EIS include it. One "gross" handed to three schemes
 *    over-contributes EPF for anyone who worked an hour of overtime. The bases
 *    are assembled per component in `payroll-calculation.ts`.
 *
 *  - AGE CHANGES THE SCHEME, NOT THE RATE. At 60 an employee moves to Third
 *    Schedule Part E or C, to SOCSO's Second Category, and out of EIS
 *    altogether. These are different tables, not a discount.
 *
 *  - AN UNCOMPUTABLE FIGURE IS NULL, NEVER ZERO. Zero says nothing is due.
 *    Null says we do not know. Only the second is true of an employee whose
 *    date of birth is missing, and only the second stops the run.
 */

// ---------------------------------------------------------------------------
// What a scheme answers
// ---------------------------------------------------------------------------

export interface Contribution {
  employeeCents: number | null;
  employerCents: number | null;
  /** Why a figure is absent, or which Part produced it. Shown verbatim. */
  note?: string;
}

/**
 * The engines answer with three outcomes and this collapses them to two
 * numbers plus a note. The collapse is where a "we cannot tell" would turn
 * into a "nothing is due" if anybody were careless, so it is written once,
 * here, rather than at each call site.
 */
function fromOutcome<T extends { employerCents: number; employeeCents: number }>(
  outcome: ContributionOutcome<T>,
  describe?: (value: T) => string,
): Contribution {
  switch (outcome.kind) {
    case 'COMPUTED':
      return {
        employeeCents: outcome.value.employeeCents,
        employerCents: outcome.value.employerCents,
        note: describe?.(outcome.value),
      };
    case 'NOT_ELIGIBLE':
      // A genuine nil: the scheme does not reach this employee.
      return { employeeCents: 0, employerCents: 0, note: outcome.reason };
    case 'CANNOT_DETERMINE':
      return { employeeCents: null, employerCents: null, note: outcome.reason };
  }
}

/** Someone explicitly outside a scheme contributes zero, and that zero is a fact. */
const OUTSIDE = (scheme: string): Contribution => ({
  employeeCents: 0,
  employerCents: 0,
  note: `This employee is recorded as outside ${scheme}.`,
});

const noSchedule = (scheme: string, on: Date): Contribution => ({
  employeeCents: null,
  employerCents: null,
  note: `No ${scheme} schedule is in force for ${on.toISOString().slice(0, 10)}, so the contribution cannot be worked out.`,
});

// ---------------------------------------------------------------------------
// The employee
// ---------------------------------------------------------------------------

export interface EmployeeStatutoryProfile {
  /** Age in completed years at the period end. Every scheme branches on it. */
  age?: number | null;
  /**
   * Which limb of the Third Schedule the employee falls under. NOT derivable
   * from nationality alone: Part C and Part E both cover people aged 60 and
   * over, and which applies turns on citizenship, so a free-text country is not
   * an answer. Unknown means EPF cannot be computed.
   */
  epfMembership?: EpfMembership | null;
  /**
   * The employee's elected EPF share. The Third Schedule prints one employee
   * column per Part; an election away from it (Borang KWSP 17A) is a separate
   * instrument this system has no document for.
   */
  epfEmployeeRate?: number | null;
  epfApplicable?: boolean;
  socsoApplicable?: boolean;
  eisApplicable?: boolean;
  pcbApplicable?: boolean;

  /**
   * THE MTD PROFILE. Residence chooses between a flat 30% and the progressive
   * table; category chooses which deductions apply. Neither is derivable from
   * anything else on an employee record, so both absent means PCB cannot be
   * worked out — not that none is due.
   */
  taxResidence?: 'RESIDENT' | 'NON_RESIDENT' | null;
  pcbCategory?: 1 | 2 | 3 | null;
  qualifyingChildren?: number | null;
  disabledSelf?: boolean | null;
  disabledSpouse?: boolean | null;
}

/** What the schedules are resolved against. The period, never today. */
export interface StatutoryContext {
  /** Last day of the pay period. */
  periodEnd: Date;
}

/**
 * The age branch is a cliff, not a taper. An unknown age is NOT quietly read as
 * "under 60": guessing wrong under-contributes for everybody it guesses about.
 */
function ageOrNull(age: number | null | undefined): number | null {
  if (age === null || age === undefined || Number.isNaN(age)) return null;
  return age;
}

// ---------------------------------------------------------------------------
// The three contribution schemes
// ---------------------------------------------------------------------------

export function computeEpf(wageCents: number, context: StatutoryContext, profile: EmployeeStatutoryProfile): Contribution {
  if (profile.epfApplicable === false) return OUTSIDE('EPF');
  if (!scheduleFor('EPF', context.periodEnd)) return noSchedule('EPF', context.periodEnd);

  const membership = profile.epfMembership ?? null;
  if (!membership) {
    return {
      employeeCents: null,
      employerCents: null,
      note:
        'The EPF Third Schedule has a different Part for citizens, permanent residents and other non-citizens, ' +
        'so this employee’s EPF membership has to be recorded before their contribution can be worked out.',
    };
  }

  // The Schedule prints one employee column per Part. An election away from it
  // is lawful but is a different instrument, and this system holds no document
  // for it — so it is refused rather than approximated as a percentage.
  const elected = profile.epfEmployeeRate;
  if (elected !== null && elected !== undefined && Number(elected) !== 11) {
    return {
      employeeCents: null,
      employerCents: null,
      note:
        `This employee has elected an EPF share of ${elected}%, which is not the Third Schedule rate. ` +
        'An election under Borang KWSP 17A is not covered by the Schedule this system holds, so the contribution must be entered as a payroll input.',
    };
  }

  return fromOutcome(epfContribution(wageCents, membership, ageOrNull(profile.age)), (value) =>
    value.abovePercentage
      ? `Third Schedule Part ${value.part}, percentage rate above RM20,000.`
      : `Third Schedule Part ${value.part}.`,
  );
}

export function computeSocso(wageCents: number, context: StatutoryContext, profile: EmployeeStatutoryProfile): Contribution {
  if (profile.socsoApplicable === false) return OUTSIDE('SOCSO');
  if (!scheduleFor('SOCSO', context.periodEnd)) return noSchedule('SOCSO', context.periodEnd);

  const age = ageOrNull(profile.age);
  if (age === null) {
    return {
      employeeCents: null,
      employerCents: null,
      note: 'SOCSO moves to the Second Category at age 60, so a date of birth is needed before this contribution can be worked out.',
    };
  }

  const category = age >= 60 ? 'SECOND' : 'FIRST';
  return fromOutcome(socsoContribution(wageCents, category), (value) =>
    category === 'FIRST'
      ? `First Category — Employment Injury, Invalidity and Non-Employment Injury. Employee share: invalidity ${(value.employeeInvalidityCents / 100).toFixed(2)} + non-employment injury ${(value.employeeNonEmploymentInjuryCents / 100).toFixed(2)}.`
      : 'Second Category — Employment Injury and Non-Employment Injury.',
  );
}

export function computeEis(wageCents: number, context: StatutoryContext, profile: EmployeeStatutoryProfile): Contribution {
  if (profile.eisApplicable === false) return OUTSIDE('EIS');
  if (!scheduleFor('EIS', context.periodEnd)) return noSchedule('EIS', context.periodEnd);

  const age = ageOrNull(profile.age);
  if (age === null) {
    return {
      employeeCents: null,
      employerCents: null,
      note: 'EIS does not apply from age 60, so a date of birth is needed before this contribution can be worked out.',
    };
  }
  if (age >= 60) {
    return { employeeCents: 0, employerCents: 0, note: 'EIS does not apply from age 60.' };
  }
  return fromOutcome(eisContribution(wageCents));
}

/**
 * PCB / MTD — computed, at last, and refused rather than guessed.
 *
 * The engine is `src/statutory/pcb-2026.ts`, transcribed from HASiL's own
 * specification and checked against the worked example the specification
 * publishes with it (Exhibit 5), to the sen, across all twelve months.
 *
 * What kept it unwired was never the formula. The Computerised Calculation
 * method is CUMULATIVE: it needs what the employee has been paid, taxed and
 * contributed since January, including under a previous employer. Kuwick held
 * none of that, so a lawful MTD was impossible in principle rather than merely
 * unimplemented. `EmployeeYtd` now carries it, written from approved runs and
 * from a controlled opening import for a clinic that migrated mid-year.
 *
 * THREE THINGS THIS DOES NOT DO, stated here rather than discovered later:
 *
 *  - TP1 DEDUCTIONS ARE NOT CAPTURED, so LP and ∑LP are nil. That is the
 *    correct treatment for an employee who has filed no TP1, which is most of
 *    them, and it errs towards deducting MORE rather than less — an employee
 *    who has filed one recovers the difference on assessment. It is not a
 *    silent approximation: `tp1Captured: false` travels with the result.
 *
 *  - IT REFUSES WHAT THE SPECIFICATION EXCLUDES. Returning employees under the
 *    REP scheme, knowledge workers and C-suite arrangements have their own
 *    rates, and the engine names them rather than applying the ordinary table.
 *
 *  - IT NEVER GUESSES THE PROFILE. Residence decides between a flat 30% and
 *    the progressive table; category decides which deductions apply. Neither is
 *    derivable from anything else on an employee record, so both being absent
 *    is an unanswerable question and blocks the run.
 */

export const PCB_NOT_IMPLEMENTED =
  'Monthly tax (PCB) is missing. The calculation needs this employee’s tax residence and MTD category, ' +
  'which are not recorded yet. Enter PCB as a payroll input or file it separately.';

/** What the month contributes, over and above the employee's standing facts. */
export interface PcbMonthInput {
  /** 1-12. */
  readonly month: number;
  /** Y1 — this month's normal remuneration. */
  readonly grossNormalCents: number;
  /** K1 — EPF and other approved contributions in respect of Y1. */
  readonly epfOnNormalCents: number;
  /** Yt — bonus, arrears and other additional remuneration this month. */
  readonly grossAdditionalCents: number;
  /** Kt — contributions in respect of Yt. */
  readonly epfOnAdditionalCents: number;
  /** This month's zakat, which reduces this month's MTD. */
  readonly zakatThisMonthCents: number;
}

/** What the year so far contributes. Every figure is a total, in cents. */
export interface PcbYearToDate {
  /** ∑Y — gross paid earlier this year, including a previous employer's. */
  readonly accumulatedGrossCents: number;
  /** ∑K — contributions in respect of ∑Y. */
  readonly accumulatedEpfCents: number;
  /** X — MTD already paid this year, CP38 included. */
  readonly accumulatedMtdPaidCents: number;
  /** Z — zakat paid this year other than this month's. */
  readonly accumulatedZakatCents: number;
}

export interface PcbAnswer {
  readonly cents: number | null;
  readonly note: string;
  /** False when MTD was computed as though no TP1 had been filed. */
  readonly tp1Captured: boolean;
  /** The specification's own working, for the payslip and an auditor. */
  readonly working: PcbResult['working'] | null;
}

export function computePcb(
  profile: EmployeeStatutoryProfile,
  month: PcbMonthInput,
  ytd: PcbYearToDate,
  on: Date,
): PcbAnswer {
  if (profile.pcbApplicable === false) {
    return { cents: 0, note: 'This employee is recorded as outside PCB.', tp1Captured: true, working: null };
  }
  if (!scheduleFor('PCB', on)) {
    return {
      cents: null,
      note: `No MTD specification is in force for ${on.toISOString().slice(0, 10)}, so monthly tax cannot be worked out.`,
      tp1Captured: false,
      working: null,
    };
  }
  if (!profile.taxResidence || !profile.pcbCategory) {
    return { cents: null, note: PCB_NOT_IMPLEMENTED, tp1Captured: false, working: null };
  }

  const outcome = computeMtd({
    residence: profile.taxResidence,
    category: profile.pcbCategory,
    // The specification is explicit that category 1 carries no child
    // deduction, so a stray count on a category 1 record is ignored rather
    // than quietly changing somebody's tax.
    qualifyingChildren: profile.pcbCategory === 1 ? 0 : (profile.qualifyingChildren ?? 0),
    disabledSelf: profile.disabledSelf ?? false,
    disabledSpouse: profile.disabledSpouse ?? false,
    month: month.month,
    accumulatedGrossCents: ytd.accumulatedGrossCents,
    accumulatedEpfCents: ytd.accumulatedEpfCents,
    grossNormalCents: month.grossNormalCents,
    epfOnNormalCents: month.epfOnNormalCents,
    grossAdditionalCents: month.grossAdditionalCents,
    epfOnAdditionalCents: month.epfOnAdditionalCents,
    // TP1 is not captured. Nil is the right figure for an employee who has
    // filed none, and `tp1Captured` below says so rather than letting the
    // absence pass for a decision.
    accumulatedDeductionsCents: 0,
    deductionsThisMonthCents: 0,
    accumulatedMtdPaidCents: ytd.accumulatedMtdPaidCents,
    accumulatedZakatCents: ytd.accumulatedZakatCents,
    zakatThisMonthCents: month.zakatThisMonthCents,
  });

  if (outcome.kind === 'UNSUPPORTED') {
    return { cents: null, note: outcome.reason, tp1Captured: false, working: null };
  }
  return {
    cents: outcome.result.mtdCents,
    note:
      `Worked out by HASiL's Computerised Calculation method for month ${month.month}` +
      (profile.taxResidence === 'NON_RESIDENT' ? ', at the non-resident rate.' : '.'),
    tp1Captured: false,
    working: outcome.result.working,
  };
}

// ---------------------------------------------------------------------------
// Putting the schemes together
// ---------------------------------------------------------------------------

export interface StatutoryBases {
  epfCents: number;
  socsoCents: number;
  eisCents: number;
  /**
   * EPF wages EXCLUDING additional remuneration. The MTD method wants the
   * contribution "in respect of Y1" separately from the one "in respect of
   * Yt", and the Third Schedule is a lookup on the wage actually paid — so K1
   * is the contribution on normal pay alone and Kt is what the bonus adds on
   * top, rather than a proportional share of one figure.
   */
  epfNormalCents: number;
  /** Y1 — remuneration liable to PCB that is not additional remuneration. */
  pcbNormalCents: number;
  /** Yt — bonus and other additional remuneration liable to PCB. */
  pcbAdditionalCents: number;
}

export interface StatutoryResult {
  epf: Contribution;
  socso: Contribution;
  eis: Contribution;
  pcbCents: number | null;
  pcbNote: string;
  /** False when MTD was computed as though no TP1 had been filed. */
  pcbTp1Captured: boolean;
  /** The specification's own working, for the payslip and an auditor. */
  pcbWorking: PcbResult['working'] | null;
  bases: StatutoryBases;
  /** Which schedules produced these figures. Stamped onto the run. */
  stamp: StatutoryStamp;
}

/**
 * The schemes every employee payslip has to answer for.
 *
 * The Employment Act and its First Schedule are here as well as the three
 * contribution schemes, because a payslip's overtime and part-month figures
 * rest on them as squarely as its EPF does — and a run that cannot name the
 * edition that priced a Sunday cannot defend the figure a year later.
 */
const PAYSLIP_SCHEMES: readonly StatutoryScheme[] = [
  'EPF',
  'SOCSO',
  'EIS',
  'PCB',
  'EMPLOYMENT_ACT',
  'EA_FIRST_SCHEDULE',
];

/** What the employee has been paid and taxed since January. */
export const NO_YEAR_TO_DATE: PcbYearToDate = {
  accumulatedGrossCents: 0,
  accumulatedEpfCents: 0,
  accumulatedMtdPaidCents: 0,
  accumulatedZakatCents: 0,
};

export function computeStatutory(
  bases: StatutoryBases,
  context: StatutoryContext,
  profile: EmployeeStatutoryProfile,
  ytd: PcbYearToDate = NO_YEAR_TO_DATE,
  zakatThisMonthCents = 0,
): StatutoryResult {
  const epf = computeEpf(bases.epfCents, context, profile);

  // K1 and Kt. Computing EPF twice — once on normal pay, once on everything —
  // and taking the difference keeps both figures on the Schedule's own bands.
  // Apportioning a single figure would put K1 between two bands, which is a
  // number the Schedule never produces.
  const epfOnNormal = computeEpf(bases.epfNormalCents, context, profile);
  const epfOnNormalCents = epfOnNormal.employeeCents ?? 0;
  const epfOnAdditionalCents = Math.max(0, (epf.employeeCents ?? 0) - epfOnNormalCents);

  const pcb = computePcb(
    profile,
    {
      // `periodEnd` is EXCLUSIVE — the first day of the following month — so
      // the month being paid is the one the last day of the period falls in.
      // Taken from that day rather than from periodEnd's own month, which
      // would be off by one and silently wrong every December.
      month: new Date(context.periodEnd.getTime() - 86_400_000).getUTCMonth() + 1,
      grossNormalCents: bases.pcbNormalCents,
      epfOnNormalCents,
      grossAdditionalCents: bases.pcbAdditionalCents,
      epfOnAdditionalCents,
      zakatThisMonthCents,
    },
    ytd,
    context.periodEnd,
  );

  return {
    epf,
    socso: computeSocso(bases.socsoCents, context, profile),
    eis: computeEis(bases.eisCents, context, profile),
    pcbCents: pcb.cents,
    pcbNote: pcb.note,
    pcbTp1Captured: pcb.tp1Captured,
    pcbWorking: pcb.working,
    bases,
    stamp: stampFor(PAYSLIP_SCHEMES, context.periodEnd),
  };
}

// ---------------------------------------------------------------------------
// Whether a run may be signed off
// ---------------------------------------------------------------------------

export type StatutoryStatus = 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL';

/**
 * Whether the schedules governing a period may drive a run somebody approves.
 *
 * This used to ask a human-entered `verificationStatus` column whether somebody
 * had checked the numbers. It now asks the registry, where the state is a
 * property of the transcription and its evidence rather than a flag anybody can
 * set. `NOT_CONFIGURED` means no schedule covers the period at all;
 * `PROVISIONAL` means one does but has not been checked against the authority's
 * own document, so it may be calculated with and not paid against.
 */
export function statutoryStatusOf(on: Date): StatutoryStatus {
  const resolved = PAYSLIP_SCHEMES.filter((scheme) => scheme !== 'PCB').map((scheme) => scheduleFor(scheme, on));
  if (resolved.some((schedule) => schedule === null)) return 'NOT_CONFIGURED';
  return resolved.every((schedule) => schedule && meetsApprovalBar(schedule.verification)) ? 'CONFIGURED' : 'PROVISIONAL';
}

export type { EpfMembership, StatutoryStamp, VerificationState };
