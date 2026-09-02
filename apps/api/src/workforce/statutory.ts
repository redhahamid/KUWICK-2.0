import {
  ContributionOutcome,
  EpfMembership,
  eisContribution,
  epfContribution,
  socsoContribution,
} from '../statutory/contributions';
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
 * PCB / MTD.
 *
 * The engine exists and reproduces HASiL's own worked example (see
 * `src/statutory/pcb-2026.ts` and its spec). What it needs and does not yet
 * receive is the cumulative substrate the Computerised Calculation method is
 * built on: remuneration and MTD paid so far this year, a previous employer's
 * figures via TP3, TP1 deductions, and the employee's category and children.
 *
 * `EmployeeYtd` holds the first of those and nothing populates the rest, so
 * PCB stays absent — and absent means BLOCKING, not zero. Wiring the engine to
 * a half-filled input would produce a number that looks like tax and is not.
 */
export const PCB_NOT_IMPLEMENTED =
  'Monthly tax (PCB) is missing. The calculation needs this employee’s year-to-date remuneration, tax paid ' +
  'so far, and their TP1/TP3 details, which are not recorded yet. Enter PCB as a payroll input or file it separately.';

export function computePcb(profile: EmployeeStatutoryProfile): { cents: number | null; note: string } {
  if (profile.pcbApplicable === false) {
    return { cents: 0, note: 'This employee is recorded as outside PCB.' };
  }
  return { cents: null, note: PCB_NOT_IMPLEMENTED };
}

// ---------------------------------------------------------------------------
// Putting the schemes together
// ---------------------------------------------------------------------------

export interface StatutoryBases {
  epfCents: number;
  socsoCents: number;
  eisCents: number;
}

export interface StatutoryResult {
  epf: Contribution;
  socso: Contribution;
  eis: Contribution;
  pcbCents: number | null;
  pcbNote: string;
  bases: StatutoryBases;
  /** Which schedules produced these figures. Stamped onto the run. */
  stamp: StatutoryStamp;
}

/** The schemes every employee payslip has to answer for. */
const PAYSLIP_SCHEMES: readonly StatutoryScheme[] = ['EPF', 'SOCSO', 'EIS', 'PCB'];

export function computeStatutory(
  bases: StatutoryBases,
  context: StatutoryContext,
  profile: EmployeeStatutoryProfile,
): StatutoryResult {
  const pcb = computePcb(profile);
  return {
    epf: computeEpf(bases.epfCents, context, profile),
    socso: computeSocso(bases.socsoCents, context, profile),
    eis: computeEis(bases.eisCents, context, profile),
    pcbCents: pcb.cents,
    pcbNote: pcb.note,
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
