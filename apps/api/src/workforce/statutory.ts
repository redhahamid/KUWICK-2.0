import {
  ContributionOutcome,
  EpfMembership,
  eisContribution,
  epfContribution,
  epfPartFor,
  socsoContribution,
} from '../statutory/contributions';
import { EPF_PARTS } from '../statutory/epf-third-schedule';
import { LindungParticipation, lindungContribution } from '../statutory/lindung-24-jam';
import { PcbParams, PcbResult, computePcb as computeMtd } from '../statutory/pcb-2026';
import { BUILT_IN_EDITIONS, Editions } from '../statutory/editions';
import { eisBandFor, epfBandFor, socsoBandFor } from '../statutory/contributions';
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
 * SKBBK IS NOT PART OF ACT 4, and an earlier version of this module treated it
 * as though it were — adding its column to every employee's SOCSO deduction.
 * LINDUNG 24 JAM is a scheme of its own, in force from 1 June 2026, voluntary
 * for local employees and mandatory for foreign workers, and it lives in
 * `lindung-24-jam.ts` behind an explicit participation record. A First
 * Category employee's Act 4 share is invalidity alone.
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

/** How a figure was worked out, as rows a screen can print: inputs, the table row, the rate. */
export type StatutoryWorking = Record<string, string | number | null>;

export interface Contribution {
  employeeCents: number | null;
  employerCents: number | null;
  /** Why a figure is absent, or which Part produced it. Shown verbatim. */
  note?: string;
  working?: StatutoryWorking;
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
   * THE EMPLOYER'S HRD CORP REGISTRATION CLASS, resolved for the period —
   * employer-level context riding on the employee profile because the levy is
   * computed per employee on their leviable wages. Undefined/null means
   * UNRECORDED, which is not the same answer as NOT_REGISTERED: one is a gap,
   * the other is a fact, and only the fact yields a figure (of zero).
   */
  hrdRegistration?: 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED' | null;
  /**
   * WHAT THE LEVY IS WORKED OUT ON, the employer's setting. Absent is the
   * PSMB Act's definition, basic plus fixed allowances; a run always passes
   * the employer's own answer, whose default is basic only.
   */
  hrdLevyBase?: 'BASIC_ONLY' | 'BASIC_PLUS_FIXED_ALLOWANCES';
  /**
   * Section 2 covers FULL-TIME employment, contract or permanent. Derived by
   * the caller from the employment type — PERMANENT and CONTRACT qualify;
   * part-timers, interns (apprentice contracts are on the guideline's own
   * excluded list) and locums do not.
   */
  hrdFullTimeEmployment?: boolean | null;

  /**
   * THE MTD PROFILE. Residence chooses between a flat 30% and the progressive
   * table; category chooses which deductions apply. Neither is derivable from
   * anything else on an employee record, so both absent means PCB cannot be
   * worked out — not that none is due.
   */
  /**
   * LINDUNG 24 JAM participation. Never inferred from EPF membership, tax
   * residence or nationality — those answer different questions, and reading
   * one off another charges a local for a scheme they declined.
   */
  lindungParticipation?: LindungParticipation | null;
  taxResidence?: 'RESIDENT' | 'NON_RESIDENT' | null;
  pcbCategory?: 1 | 2 | 3 | null;
  qualifyingChildren?: number | null;
  disabledSelf?: boolean | null;
  disabledSpouse?: boolean | null;
}

/** What the schedules are resolved against. The period, never today. */
export interface StatutoryContext {
  /**
   * The last day INSIDE the pay period — 31 July for a July run, never
   * 1 August. `scheduleFor` matches `effectiveFrom <= on`, so an exclusive
   * first-of-next-month here made every schedule commence one period early:
   * a September 2025 run acquired the October Third Schedule instead of
   * blocking, and a May 2026 run charged LINDUNG before the scheme existed.
   */
  periodEnd: Date;
  /** The tables in force for the period — the built-in ones when absent. */
  editions?: Editions;
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

  // The Schedule prints one employee column per Part — 11% (A), 5.5% (C),
  // 0% (E), 2% (F) — and an election away from THE PART'S OWN rate is a
  // different instrument (Borang KWSP 17A) this system holds no document
  // for, so that is refused rather than approximated. The old guard compared
  // every election against a hardcoded 11: a Part E citizen of 61 whose true
  // 0% was faithfully recorded was refused with a message asserting the
  // Schedule's rate is 11%, which is false for their Part.
  const elected = profile.epfEmployeeRate;
  if (elected !== null && elected !== undefined) {
    const electionAge = ageOrNull(profile.age);
    // With no age the Part is unknowable and the contribution below refuses
    // on the age itself — the election cannot be judged before that.
    if (electionAge !== null) {
      const partLetter = epfPartFor(membership, electionAge);
      const scheduleRate = EPF_PARTS.find((part) => part.part === partLetter)?.aboveCeiling.employeePercent;
      if (scheduleRate !== undefined && Number(elected) !== scheduleRate) {
        return {
          employeeCents: null,
          employerCents: null,
          note:
            `This employee has an elected EPF share of ${elected}% on record, but Third Schedule Part ${partLetter} ` +
            `prints ${scheduleRate}% for them. An election under Borang KWSP 17A is not covered by the Schedule ` +
            'this system holds, so the contribution must be entered as a payroll input.',
        };
      }
    }
  }

  return fromOutcome(epfContribution(wageCents, membership, ageOrNull(profile.age), context.editions?.epf), (value) =>
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
  return fromOutcome(socsoContribution(wageCents, category, context.editions?.socso), (value) =>
    category === 'FIRST'
      ? `First Category — Employment Injury, Invalidity and Non-Employment Injury. Employee share shown here is the invalidity column, ${(value.employeeInvalidityCents / 100).toFixed(2)}; the non-employment injury column is on its own line.`
      : // NOT "no employee share". The schedule gives the Second Category an
        // employee non-employment-injury column too, and it is on its own line
        // exactly as it is for the First. What ends at 60 is invalidity.
        'Second Category — Employment Injury and Non-Employment Injury. No invalidity contribution from age 60; the non-employment injury column is on its own line.',
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
  return fromOutcome(eisContribution(wageCents, context.editions?.eis));
}

/**
 * LINDUNG 24 JAM (SKBBK) — THE THIRD COLUMN OF ACT 4'S OWN SCHEDULE.
 *
 * This comment used to say "a scheme of its own, not a column of Act 4", which
 * is the opposite of what `socso-act4.ts` says and the opposite of what
 * PERKESO's schedule shows. The published table is headed "Act 4: new
 * contribution rate INCLUDING the Non-Employment Injury Security Scheme", and
 * the employee's share is printed as two columns — invalidity, and
 * non-employment injury — of one contribution.
 *
 * It is computed here rather than inside `computeSocso` for one reason: the two
 * columns are separately reportable and an employee may be out of this one
 * while remaining in the rest. That is a presentation choice, not a claim that
 * the scheme sits outside Act 4.
 *
 * EMPLOYEE-BORNE, no employer share, in force from 1 June 2026. AUTO-ENROLLED:
 * every employee contributes unless they opt out through PERKESO, so an
 * unrecorded participation reads as enrolled rather than as unknown. The
 * employer remits it and does not pay it, and the payslip says so.
 */
export function computeLindung(
  wagesCents: number,
  context: StatutoryContext,
  profile: EmployeeStatutoryProfile,
): Contribution {
  if (!scheduleFor('LINDUNG', context.periodEnd)) {
    return {
      employeeCents: 0,
      employerCents: 0,
      note: `LINDUNG 24 JAM is not in force for ${context.periodEnd.toISOString().slice(0, 10)}.`,
    };
  }
  return fromOutcome(
    lindungContribution(wagesCents, profile.lindungParticipation, context.periodEnd, context.editions?.lindung),
    (value) =>
      value.participation === 'MANDATORY_FOREIGN_WORKER'
        ? 'Non-Employment Injury Scheme, phase 1 — mandatory for foreign workers. Borne by the employee and remitted by the employer.'
        : 'Non-Employment Injury Scheme, phase 1 — joined voluntarily. Borne by the employee and remitted by the employer.',
  );
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
  /**
   * LP1 — this month's allowable deductions, from the employee's Form TP1 as
   * the employer approved it. The 2026 specification changes the relief ITEMS
   * on the form, not the formula: the figure enters here and in ∑LP.
   */
  readonly deductionsThisMonthCents: number;
  /** Whether a TP1 capture exists for this month — nil-with-form is a fact. */
  readonly tp1Captured: boolean;
  /**
   * Y2 — what each REMAINING month of the year is expected to pay.
   *
   * The MTD method is forward-looking: this month's deduction depends on the
   * whole year's projected income, so somebody has to say what the rest of the
   * year looks like. LHDN calls it "the estimated remuneration as Y1" and
   * leaves the estimate to the employer, which is why it is a clinic setting
   * rather than a constant.
   *
   * Absent means Y1 — the specification's own default, and what every Kuwick
   * run did before the setting existed.
   */
  readonly estimatedFutureNormalCents?: number;
}

/** One month's TP1 capture, as the employer approved it off the form. */
export interface Tp1MonthCapture {
  /** LP1 — the month's allowable deductions. */
  readonly deductionsCents: number;
  /** Zakat the employee paid OUTSIDE payroll and claimed on the form. */
  readonly zakatSelfPaidCents: number;
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
  /** ∑LP — allowable deductions accumulated: applied TP1 months, and TP3's. */
  readonly accumulatedDeductionsCents: number;
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
  params?: PcbParams,
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
    ...(month.estimatedFutureNormalCents === undefined
      ? {}
      : { estimatedFutureNormalCents: month.estimatedFutureNormalCents }),
    epfOnNormalCents: month.epfOnNormalCents,
    grossAdditionalCents: month.grossAdditionalCents,
    epfOnAdditionalCents: month.epfOnAdditionalCents,
    // TP1 reaches the formula as the spec wrote it: LP1 for the month, ∑LP
    // for the year (applied TP1 months plus TP3's previous-employer figure).
    // Nil stays the right figure for an employee who filed none, and
    // `tp1Captured` says which of the two truths the nil is.
    accumulatedDeductionsCents: ytd.accumulatedDeductionsCents,
    deductionsThisMonthCents: month.deductionsThisMonthCents,
    accumulatedMtdPaidCents: ytd.accumulatedMtdPaidCents,
    accumulatedZakatCents: ytd.accumulatedZakatCents,
    zakatThisMonthCents: month.zakatThisMonthCents,
  }, undefined, params);

  if (outcome.kind === 'UNSUPPORTED') {
    return { cents: null, note: outcome.reason, tp1Captured: false, working: null };
  }
  return {
    cents: outcome.result.mtdCents,
    note:
      `Worked out by HASiL's Computerised Calculation method for month ${month.month}` +
      (profile.taxResidence === 'NON_RESIDENT'
        ? ', at the non-resident rate.'
        : month.tp1Captured
          ? `, applying RM${(month.deductionsThisMonthCents / 100).toFixed(2)} of TP1 deductions for the month.`
          : '.'),
    tp1Captured: month.tp1Captured,
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
  /** SKBBK. Employee-borne; the employer share is always nil. */
  lindung: Contribution;
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
export const PAYSLIP_SCHEMES: readonly StatutoryScheme[] = [
  'EPF',
  'SOCSO',
  'EIS',
  'LINDUNG',
  'PCB',
  // The levy is employer cost on the same payslip's leviable wages, resolved
  // from the same registry — it was left off this list, so a run's stamp
  // could not say which levy guideline priced its employer cost, and the
  // levy engine ran undated (a pre-October-2025 period was levied anyway).
  'HRD_LEVY',
  'EMPLOYMENT_ACT',
  'EA_FIRST_SCHEDULE',
];

/** What the employee has been paid and taxed since January. */
export const NO_YEAR_TO_DATE: PcbYearToDate = {
  accumulatedGrossCents: 0,
  accumulatedEpfCents: 0,
  accumulatedMtdPaidCents: 0,
  accumulatedZakatCents: 0,
  accumulatedDeductionsCents: 0,
};

export function computeStatutory(
  bases: StatutoryBases,
  context: StatutoryContext,
  profile: EmployeeStatutoryProfile,
  ytd: PcbYearToDate = NO_YEAR_TO_DATE,
  zakatThisMonthCents = 0,
  tp1: Tp1MonthCapture | null = null,
  /** Y2 — the clinic's estimate for the remaining months. Absent means Y1. */
  estimatedFutureNormalCents?: number,
): StatutoryResult {
  const epf = computeEpf(bases.epfCents, context, profile);

  // K1 and Kt. Computing EPF twice — once on normal pay, once on everything —
  // and taking the difference keeps both figures on the Schedule's own bands.
  // Apportioning a single figure would put K1 between two bands, which is a
  // number the Schedule never produces.
  const epfOnNormal = computeEpf(bases.epfNormalCents, context, profile);
  const epfOnNormalCents = epfOnNormal.employeeCents ?? 0;
  const epfOnAdditionalCents = Math.max(0, (epf.employeeCents ?? 0) - epfOnNormalCents);

  // A RESIDENT'S MTD RESTS ON K1 — the EPF contribution in respect of this
  // month's normal pay. With EPF itself unknowable the `?? 0` below would
  // compute a finished-looking tax figure on K1 = 0, over-deducting, and the
  // payslip would show it beside an EPF that says "could not be worked out".
  // The run blocked either way (on the EPF null); the FIGURE was still wrong
  // on screen. A non-resident's flat 30% uses no K1 and is unaffected.
  const pcb =
    epf.employeeCents === null && profile.taxResidence === 'RESIDENT' && profile.pcbCategory
      ? {
          cents: null,
          note:
            'Monthly tax could not be worked out: the Computerised Calculation needs the EPF contribution on this ' +
            'month’s pay (K1), and EPF itself could not be worked out. Resolve the EPF question and recalculate.',
          tp1Captured: false,
          working: null,
        }
      : computePcb(
    profile,
    {
      // `periodEnd` is the last day INSIDE the pay period — the same day the
      // schedules resolve on — so the month being paid is its own month. It
      // was the exclusive first-of-next-month for a while, and that convention
      // made every schedule commence one period early (a September 2025 run
      // acquired the October Third Schedule; a May 2026 run charged LINDUNG).
      month: context.periodEnd.getUTCMonth() + 1,
      grossNormalCents: bases.pcbNormalCents,
      epfOnNormalCents,
      grossAdditionalCents: bases.pcbAdditionalCents,
      epfOnAdditionalCents,
      // Zakat this month: what payroll deducted, plus what the employee paid
      // themselves and claimed on the TP1 — both are the month's zakat to Z.
      zakatThisMonthCents: zakatThisMonthCents + (tp1?.zakatSelfPaidCents ?? 0),
      deductionsThisMonthCents: tp1?.deductionsCents ?? 0,
      tp1Captured: tp1 !== null,
      ...(estimatedFutureNormalCents === undefined ? {} : { estimatedFutureNormalCents }),
    },
    ytd,
    context.periodEnd,
    context.editions?.pcb,
  );

  const socso = computeSocso(bases.socsoCents, context, profile);
  const eis = computeEis(bases.eisCents, context, profile);
  // Priced on the SOCSO wage base — the same Act 4 table carries its column.
  const lindung = computeLindung(bases.socsoCents, context, profile);
  const editions = context.editions ?? BUILT_IN_EDITIONS;
  attachWorkings({ epf, socso, eis, lindung }, bases, profile, editions);

  return {
    epf,
    socso,
    eis,
    lindung,
    pcbCents: pcb.cents,
    pcbNote: pcb.note,
    pcbTp1Captured: pcb.tp1Captured,
    pcbWorking: pcb.working,
    bases,
    stamp: stampFor(PAYSLIP_SCHEMES, context.periodEnd, context.editions),
  };
}

const rm = (cents: number | null | undefined): string | null => (cents === null || cents === undefined ? null : `RM${(cents / 100).toFixed(2)}`);

/**
 * HOW EACH FIGURE WAS WORKED OUT, as rows: the wages it was read against,
 * the table row or the rate, the edition that held the row. Only on figures
 * that were computed — a figure that could not be has its note instead.
 */
function attachWorkings(
  figures: { epf: Contribution; socso: Contribution; eis: Contribution; lindung: Contribution },
  bases: StatutoryBases,
  profile: EmployeeStatutoryProfile,
  editions: Editions,
): void {
  const age = ageOrNull(profile.age);
  if (figures.epf.employeeCents !== null && profile.epfMembership && age !== null) {
    const part = epfPartFor(profile.epfMembership, age);
    const band = epfBandFor(editions.epf, part, bases.epfCents);
    const parts = editions.epf.parts.find((candidate) => candidate.part === part);
    figures.epf.working = {
      'EPF wages': rm(bases.epfCents),
      'Third Schedule part': `Part ${part} (${profile.epfMembership.toLowerCase().replace(/_/g, ' ')}, age ${age})`,
      'Table row': band
        ? `${rm(band[0])} to ${rm(band[1])}: employer ${rm(band[2])}, employee ${rm(band[3])}`
        : bases.epfCents > editions.epf.ceilingCents && parts
          ? `Above ${rm(editions.epf.ceilingCents)}: ${parts.aboveCeiling.employeePercent}% employee, ${parts.aboveCeiling.employerPercent}% employer, total rounded up to the ringgit`
          : null,
      Edition: editions.sources.EPF.document,
    };
  }
  if (figures.socso.employeeCents !== null && age !== null) {
    const band = socsoBandFor(editions.socso, bases.socsoCents);
    const category = age >= 60 ? 'Second' : 'First';
    figures.socso.working = {
      'SOCSO wages': rm(bases.socsoCents),
      Category: `${category} category (age ${age})`,
      'Table row': band
        ? `${rm(band[0])} to ${band[1] === null ? 'above' : rm(band[1])}: ${category === 'First' ? `employer ${rm(band[2])}, employee ${rm(band[3])}` : `employer ${rm(band[5])}, no employee share`}`
        : null,
      Ceiling: rm(editions.socso.ceilingCents),
      Edition: editions.sources.SOCSO.document,
    };
  }
  if (figures.eis.employeeCents !== null && age !== null && age < 60) {
    const band = eisBandFor(editions.eis, bases.eisCents);
    figures.eis.working = {
      'EIS wages': rm(bases.eisCents),
      'Table row': band ? `${rm(band[0])} to ${band[1] === null ? 'above' : rm(band[1])}: employer ${rm(band[2])}, employee ${rm(band[3])}` : null,
      Ceiling: rm(editions.eis.ceilingCents),
      Edition: editions.sources.EIS.document,
    };
  }
  if (figures.lindung.employeeCents !== null && figures.lindung.employeeCents > 0) {
    const band = socsoBandFor(editions.lindung.socso, bases.socsoCents);
    figures.lindung.working = {
      Wages: rm(bases.socsoCents),
      Participation: profile.lindungParticipation ?? 'ENROLLED (nothing recorded, so enrolled)',
      'Table row': band ? `${rm(band[0])} to ${band[1] === null ? 'above' : rm(band[1])}: employee ${rm(band[4])}, borne by the employee` : null,
      'In force from': editions.lindung.effectiveFrom.toISOString().slice(0, 10),
      Edition: editions.sources.LINDUNG.document,
    };
  }
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
  // PCB is excluded because it may legitimately be entered by hand; LINDUNG
  // because a period before it commenced is not a period missing a schedule.
  const resolved = PAYSLIP_SCHEMES.filter((scheme) => scheme !== 'PCB' && scheme !== 'LINDUNG').map((scheme) =>
    scheduleFor(scheme, on),
  );
  if (resolved.some((schedule) => schedule === null)) return 'NOT_CONFIGURED';
  return resolved.every((schedule) => schedule && meetsApprovalBar(schedule.verification)) ? 'CONFIGURED' : 'PROVISIONAL';
}

export type { EpfMembership, LindungParticipation, StatutoryStamp, VerificationState };
