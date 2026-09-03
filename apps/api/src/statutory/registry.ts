import { createHash } from 'node:crypto';
import { EIS_BANDS, EIS_WAGE_CEILING_CENTS } from './eis-act800';
import { EPF_PARTS, EPF_TABLE_CEILING_CENTS } from './epf-third-schedule';
import { HRD_LEVY_RATE_MANDATORY_PERCENT, HRD_LEVY_RATE_OPTIONAL_PERCENT } from './hrd-levy';
import { PCB_TABLE_1, DEDUCTION_INDIVIDUAL_CENTS, NON_RESIDENT_RATE_PERCENT } from './pcb-2026';
import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from './socso-act4';
import {
  FIRST_SCHEDULE_EFFECTIVE_FROM,
  FIRST_SCHEDULE_WAGE_CEILING_CENTS,
  MONTHLY_ORP_DIVISOR,
  OVERTIME_MULTIPLIERS,
  WEEKLY_ORP_DIVISOR,
} from './employment-act';

/**
 * WHICH SCHEDULE A RUN WAS CALCULATED AGAINST — named, dated and hashed.
 *
 * The schedules themselves are transcriptions of the authorities' own
 * documents and live one file each. What was missing is the ability to answer,
 * six months after a run was approved, the only question an auditor actually
 * asks: WHICH numbers produced these payslips, and were they the lawful ones
 * at the time?
 *
 * Three things make that answerable, and all three are needed:
 *
 *  - AN EFFECTIVE DATE. A schedule is law from a date. EPF's Third Schedule as
 *    transcribed here is the one in force from 1 October 2025; the Parts B and
 *    D that Act A1760/2025 deleted are not in it. Resolving by the period's own
 *    date means a re-run of an old period cannot silently acquire today's
 *    rates.
 *
 *  - A CONTENT HASH. An effective date names the edition; the hash proves the
 *    bytes. It is taken over the actual band arrays, so editing a single sen in
 *    a 1,203-row table changes the stamp on every run calculated afterwards and
 *    a reconciliation against an earlier run stops matching — loudly, which is
 *    the point. A version string alone can be edited to say anything.
 *
 *  - A VERIFICATION STATE. §2 of the brief admits four, and they are not
 *    decorative: they decide whether a run may be approved. A schedule nobody
 *    has checked against the authority's own document may sit in the registry
 *    and drive a DRAFT calculation, but it must not be capable of producing a
 *    payslip somebody pays against.
 *
 * NOTHING IS INFERRED HERE. Every effective date and citation below is copied
 * from the document named in `document`, and every one of those documents is
 * listed in docs/MALAYSIA_PAYROLL_STATUTORY_SOURCE_REGISTER.md. Where no
 * document was supplied — LINDUNG 24 JAM — there is no entry, rather than an
 * entry marked unverified: an absent scheme blocks, a present one calculates.
 */

/**
 * §2's four states, in ascending strength. No screen, report, payslip or
 * output may imply a stronger one than the schedule actually carries.
 */
export type VerificationState =
  /** Transcribed from something that is not the authority, or not yet checked. */
  | 'UNVERIFIED'
  /** Two or more non-authority sources agree. Still not law. */
  | 'CORROBORATED'
  /** Read off the authority's own published document. */
  | 'OFFICIAL_SOURCE_VERIFIED'
  /** Reproduces the authority's own published expected answers. */
  | 'OFFICIAL_TEST_VECTOR_VERIFIED';

const STRENGTH: Record<VerificationState, number> = {
  UNVERIFIED: 0,
  CORROBORATED: 1,
  OFFICIAL_SOURCE_VERIFIED: 2,
  OFFICIAL_TEST_VECTOR_VERIFIED: 3,
};

/**
 * The weakest state a schedule may carry and still drive a run somebody
 * approves. Below it the calculation is a draft: it may be shown, it may be
 * reconciled against, it may not be paid.
 */
export const MINIMUM_STATE_FOR_APPROVAL: VerificationState = 'OFFICIAL_SOURCE_VERIFIED';

export function meetsApprovalBar(state: VerificationState): boolean {
  return STRENGTH[state] >= STRENGTH[MINIMUM_STATE_FOR_APPROVAL];
}

/** The schemes a Malaysian payroll run has to answer for. */
export type StatutoryScheme =
  | 'EPF'
  | 'SOCSO'
  | 'EIS'
  | 'PCB'
  | 'HRD_LEVY'
  | 'EMPLOYMENT_ACT'
  /**
   * WHO the Act's hours-and-overtime provisions reach, which is a separate rule
   * from what they say and took effect on a different date. Kept apart so a run
   * stamps both — the edition that priced the day AND the limitation that
   * decided whether it was payable at all.
   */
  | 'EA_FIRST_SCHEDULE';

export interface StatutorySchedule {
  /** Stable identifier, stamped onto runs. Never reused for different content. */
  readonly id: string;
  readonly scheme: StatutoryScheme;
  readonly authority: string;
  /** The document this was transcribed from, as listed in the source register. */
  readonly document: string;
  readonly section: string;
  /** In force from this instant. Resolution is by the payroll period, not today. */
  readonly effectiveFrom: Date;
  /** Superseded from this instant, when a later edition is held. */
  readonly effectiveTo: Date | null;
  readonly verification: VerificationState;
  /** What the state rests on, in one line, for the screen that displays it. */
  readonly evidence: string;
  /** SHA-256 over the schedule's actual figures. Changes when a sen changes. */
  readonly contentHash: string;
}

/** Canonical JSON — key order fixed, so the hash depends on values alone. */
function hashOf(value: unknown): string {
  const canonical = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = canonical((v as Record<string, unknown>)[k]);
          return acc;
        }, {});
    }
    return v;
  };
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex').slice(0, 16);
}

const OCT_2025 = new Date('2025-10-01T00:00:00.000Z');
const JAN_2026 = new Date('2026-01-01T00:00:00.000Z');
/** Act A1760/2025 is the EPF amendment; Act 4's SKBBK columns came with it. */
const SKBBK = new Date('2025-10-01T00:00:00.000Z');

export const STATUTORY_SCHEDULES: readonly StatutorySchedule[] = [
  {
    id: 'EPF_THIRD_SCHEDULE_2025_10',
    scheme: 'EPF',
    authority: 'KWSP',
    document: 'D5 — EPF Act 1991, Third Schedule, in force from 1 October 2025',
    section: 'Third Schedule, Parts A, C, E, F',
    effectiveFrom: OCT_2025,
    effectiveTo: null,
    verification: 'OFFICIAL_TEST_VECTOR_VERIFIED',
    evidence:
      'Transcribed band by band from the Schedule; reproduces its own printed figures, including the employer rate stepping 13% → 12% across RM5,000.',
    contentHash: hashOf({ parts: EPF_PARTS, ceiling: EPF_TABLE_CEILING_CENTS }),
  },
  {
    id: 'SOCSO_ACT4_SKBBK_2025_10',
    scheme: 'SOCSO',
    authority: 'PERKESO',
    document: 'D6 — Act 4, New Contribution Rate Including the Non-Employment Injury Security Scheme (SKBBK)',
    section: 'First and Second Category rate table',
    effectiveFrom: SKBBK,
    effectiveTo: null,
    verification: 'OFFICIAL_TEST_VECTOR_VERIFIED',
    evidence:
      'Transcribed from the published rate table; reproduces its RM6,000 row on both categories, including the Second Category employee share that SKBBK made non-nil.',
    contentHash: hashOf({ bands: SOCSO_BANDS, ceiling: SOCSO_WAGE_CEILING_CENTS }),
  },
  {
    id: 'EIS_ACT800_2025_10',
    scheme: 'EIS',
    authority: 'PERKESO',
    document: 'D7 — Rate of Contribution, Employment Insurance System (Act 800)',
    section: 'Rate table',
    effectiveFrom: SKBBK,
    effectiveTo: null,
    verification: 'OFFICIAL_TEST_VECTOR_VERIFIED',
    evidence: 'Transcribed from the published rate table; reproduces its RM6,000 row (RM11.90 each side).',
    contentHash: hashOf({ bands: EIS_BANDS, ceiling: EIS_WAGE_CEILING_CENTS }),
  },
  {
    id: 'PCB_MTD_2026',
    scheme: 'PCB',
    authority: 'HASiL',
    document: 'D1 — Amendment to: Specification for MTD Calculations using Computerized Calculation for 2026',
    section: 'Computerised Calculation Method, Table 1',
    effectiveFrom: JAN_2026,
    effectiveTo: null,
    verification: 'OFFICIAL_TEST_VECTOR_VERIFIED',
    evidence:
      'Reproduces the specification’s own worked example (Exhibit 5) to the sen across all twelve months, including the two-step treatment of additional remuneration.',
    contentHash: hashOf({
      table1: PCB_TABLE_1,
      individual: DEDUCTION_INDIVIDUAL_CENTS,
      nonResident: NON_RESIDENT_RATE_PERCENT,
    }),
  },
  {
    id: 'HRD_LEVY_PSMB_2001',
    scheme: 'HRD_LEVY',
    authority: 'HRD Corp',
    document: 'D8 — Levy Calculation Guideline (PSMB Act 2001)',
    section: 'ss. 2, 14, 15',
    effectiveFrom: OCT_2025,
    effectiveTo: null,
    verification: 'OFFICIAL_SOURCE_VERIFIED',
    evidence:
      'Rates and the leviable-wages definition read off the guideline. No official worked example is published with it, so it stops short of test-vector verification.',
    contentHash: hashOf({
      mandatory: HRD_LEVY_RATE_MANDATORY_PERCENT,
      optional: HRD_LEVY_RATE_OPTIONAL_PERCENT,
    }),
  },
  {
    id: 'EMPLOYMENT_ACT_1955',
    scheme: 'EMPLOYMENT_ACT',
    authority: 'AGC / JTKSM',
    document: 'D9 — Employment Act 1955 (Act 265), payroll extract',
    section: 'ss. 18A, 60, 60A, 60D, 60I',
    effectiveFrom: OCT_2025,
    effectiveTo: null,
    verification: 'OFFICIAL_SOURCE_VERIFIED',
    evidence:
      'Divisors and multipliers read off the sections themselves — s.60I(1A) ÷26 for the ordinary rate, s.18A for an incomplete month, which JTKSM confirms covers leave of absence without pay as well as joiners and leavers. The Act publishes no worked example.',
    contentHash: hashOf({
      monthly: MONTHLY_ORP_DIVISOR,
      weekly: WEEKLY_ORP_DIVISOR,
      overtime: OVERTIME_MULTIPLIERS,
    }),
  },
  {
    id: 'EA_FIRST_SCHEDULE_2023_01',
    scheme: 'EA_FIRST_SCHEDULE',
    authority: 'AGC / JTKSM',
    document: 'D10 — Employment Act 1955, First Schedule, as amended by the Employment (Amendment) Act 2022',
    section: 'First Schedule — limitation of ss. 60, 60A and 60D by wages',
    effectiveFrom: FIRST_SCHEDULE_EFFECTIVE_FROM,
    effectiveTo: null,
    verification: 'OFFICIAL_SOURCE_VERIFIED',
    evidence:
      'Current JTKSM material, relayed by the account holder: the Act reaches all employees from 1 January 2023, but the hours-and-overtime provisions are limited to wages not exceeding RM4,000 a month.',
    contentHash: hashOf({ ceiling: FIRST_SCHEDULE_WAGE_CEILING_CENTS, from: FIRST_SCHEDULE_EFFECTIVE_FROM.toISOString() }),
  },
];

/**
 * WHAT IS NOT SETTLED, named rather than left silent.
 *
 * Two different shapes of gap, and both matter enough to be data rather than a
 * comment in a document nobody opens:
 *
 *  - A SCHEME with no schedule at all. Anything needing it cannot be
 *    calculated and must block.
 *  - A RULE that is implemented in part, where the unimplemented part could
 *    change an answer for some employees and silently does not. That is the
 *    more dangerous kind, because the figure it produces looks finished.
 *
 * Nothing here may be resolved by generalising from what IS implemented. A gap
 * closes when a document settles it, and not before.
 */
export type StatutoryGapKind = 'NO_SCHEDULE' | 'PARTIAL_RULE';

export interface StatutoryGap {
  readonly scheme: string;
  readonly kind: StatutoryGapKind;
  readonly reason: string;
  /** What would close it. Named so the gap is actionable rather than a lament. */
  readonly needs: string;
  /** Who it could affect, so a clinic can tell whether it touches them. */
  readonly affects: string;
}

export const SCHEMES_WITHOUT_A_SCHEDULE: readonly StatutoryGap[] = [
  {
    scheme: 'LINDUNG 24 JAM',
    kind: 'NO_SCHEDULE',
    reason:
      'No PERKESO document for it was supplied. D6 covers SKBBK as an Act 4 column, which is implemented; whether LINDUNG 24 JAM is that same programme under a public-facing name or a separate scheme with its own participation rules is not established, and guessing either way would be a fabricated contribution.',
    needs: 'PERKESO’s own schedule and participation guidance for the programme.',
    affects: 'Any employee, if it is a separate scheme. Nothing is contributed for it today.',
  },
  {
    scheme: 'Employment Act First Schedule — special categories',
    kind: 'PARTIAL_RULE',
    reason:
      'The RM4,000 wage limitation on ss.60, 60A and 60D is implemented and tested. The First Schedule ALSO reaches employees by the KIND of work they do regardless of what they earn, and it treats domestic employees separately again. Neither is modelled, and no employee can be classified into them — so an employee who falls in one is currently judged by wages alone. That produces a finished-looking overtime figure that may be wrong in either direction, which is worse than a blank.',
    needs:
      'The First Schedule’s own text for the work-category paragraphs and the domestic-employee provisions, so each can be transcribed rather than inferred from the wage limb that is held.',
    affects:
      'Employees engaged in the specified categories of work, and domestic employees. A clinic employing nobody in those categories is unaffected; one that does must not rely on their overtime figures until this is closed.',
  },
];

/** Every schedule in force for a scheme at an instant, newest first. */
export function schedulesFor(scheme: StatutoryScheme, on: Date): StatutorySchedule[] {
  return STATUTORY_SCHEDULES.filter(
    (s) => s.scheme === scheme && s.effectiveFrom <= on && (s.effectiveTo === null || s.effectiveTo > on),
  ).sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime());
}

/**
 * The one schedule that governs a scheme on a date.
 *
 * Null when none does — which is a real answer for a period before a schedule's
 * effective date, and the caller must block rather than reach for the nearest
 * one. Reaching for the nearest one is how a September run acquires October's
 * rates.
 */
export function scheduleFor(scheme: StatutoryScheme, on: Date): StatutorySchedule | null {
  return schedulesFor(scheme, on)[0] ?? null;
}

/** One scheme's line in a run's stamp. */
export interface ScheduleStamp {
  readonly scheme: StatutoryScheme;
  readonly scheduleId: string | null;
  readonly contentHash: string | null;
  readonly verification: VerificationState | null;
  readonly document: string | null;
  readonly effectiveFrom: string | null;
  /** Absent when no schedule governs the period; the reason belongs on screen. */
  readonly missing: boolean;
}

export interface StatutoryStamp {
  /** The date the schedules were resolved against — the period end, not today. */
  readonly resolvedAt: string;
  readonly schedules: readonly ScheduleStamp[];
  /** True when every scheme the run needs resolved to an approvable schedule. */
  readonly approvable: boolean;
  /** Why not, when not. One line per failing scheme. */
  readonly blockers: readonly string[];
}

/**
 * The immutable record of what a run was calculated against.
 *
 * Written onto the run at calculation and never recomputed for display: a
 * payslip reprinted next year must show the schedule that produced it, not the
 * one in force when somebody pressed print.
 */
export function stampFor(schemes: readonly StatutoryScheme[], on: Date): StatutoryStamp {
  const blockers: string[] = [];
  const schedules = schemes.map<ScheduleStamp>((scheme) => {
    const schedule = scheduleFor(scheme, on);
    if (!schedule) {
      blockers.push(`No ${scheme} schedule is in force for ${on.toISOString().slice(0, 10)}.`);
      return {
        scheme,
        scheduleId: null,
        contentHash: null,
        verification: null,
        document: null,
        effectiveFrom: null,
        missing: true,
      };
    }
    if (!meetsApprovalBar(schedule.verification)) {
      blockers.push(
        `The ${scheme} schedule (${schedule.id}) is ${schedule.verification}, which is below the ${MINIMUM_STATE_FOR_APPROVAL} bar for approval.`,
      );
    }
    return {
      scheme,
      scheduleId: schedule.id,
      contentHash: schedule.contentHash,
      verification: schedule.verification,
      document: schedule.document,
      effectiveFrom: schedule.effectiveFrom.toISOString(),
      missing: false,
    };
  });
  return { resolvedAt: on.toISOString(), schedules, approvable: blockers.length === 0, blockers };
}
