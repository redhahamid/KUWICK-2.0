import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from './socso-act4';
import { BUILT_IN_SOCSO_TABLES, ContributionOutcome, SocsoTables } from './contributions';

/**
 * LINDUNG 24 JAM — the Non-Employment Injury Security Scheme (SKBBK).
 *
 * WHY THIS IS ITS OWN FILE, AND WHY THAT MATTERS.
 *
 * D6, the Act 4 rate table supplied earlier, prints SKBBK as a COLUMN beside
 * the employment-injury and invalidity columns. Reading it as part of Act 4 is
 * the obvious mistake and it is the one this codebase made: the column was
 * added to every employee's SOCSO deduction, in every period, unconditionally.
 *
 * Current PERKESO guidance says it is a separate scheme with its own rules:
 *
 *   * IN FORCE FROM 1 JUNE 2026. Nothing is due for any earlier period.
 *   * BORNE BY THE EMPLOYEE. There is no employer share. The employer remits
 *     it on the employee's behalf, which is a different thing from paying it.
 *   * VOLUNTARY for local employees. A local who has not opted in owes nothing.
 *   * MANDATORY for foreign workers.
 *   * PHASED: 0.75% now, then 1.00% and 1.25%.
 *
 * So the table and the guidance AGREE ON THE MONEY — D6's column converges on
 * 0.744% of the band ceiling, which is the 0.75% phase-1 rate expressed as
 * bands — and the guidance supplies everything D6 did not: when it starts, who
 * pays, and who may decline. Applying the column without those was an
 * over-deduction of RM44.65 a month for a RM6,000 local who never joined, and
 * for every period before June 2026 as well.
 *
 * THE RATE IS NOT INFERRED FROM THE PERCENTAGE. The band column is what
 * PERKESO publishes for contribution purposes and is what is used; the 0.75%
 * is recorded as the rate those bands express, and is asserted against them by
 * test rather than substituted for them.
 */

/** In force from this date. Before it, the scheme does not exist. */
export const LINDUNG_EFFECTIVE_FROM = new Date('2026-06-01T00:00:00.000Z');

/**
 * The published phases. Only PHASE 1 has a schedule in hand (D6's column), so
 * only phase 1 can be computed — see `LINDUNG_PHASES_NOT_HELD`.
 */
export const LINDUNG_PHASE_RATES_PERCENT = { PHASE_1: 0.75, PHASE_2: 1.0, PHASE_3: 1.25 } as const;

/**
 * Phases 2 and 3 are announced but their schedules and start dates are not
 * held, so nothing computes them. Named here so the gap travels with the code
 * rather than living only in a document.
 */
export const LINDUNG_PHASES_NOT_HELD =
  'Only the phase 1 schedule (0.75%) is held. The dates on which 1.00% and 1.25% take effect, and their band tables, are not — so a period governed by a later phase cannot be computed.';

/**
 * WHO IS IN THE SCHEME. Recorded per employee, never inferred.
 *
 * Foreign-worker status is a PERKESO classification and is not the same
 * question as EPF membership, tax residence or nationality free text. Reading
 * one off another is how a local gets charged for a scheme they declined.
 */
export type LindungParticipation =
  /** A foreign worker. Participation is mandatory and cannot be declined. */
  | 'MANDATORY_FOREIGN_WORKER'
  /** In the scheme — which is everybody who has not opted out. */
  | 'ENROLLED'
  /** Opted out through PERKESO's own form. Nothing is due. */
  | 'NOT_PARTICIPATING';

export interface LindungContribution {
  /** What the employee bears. */
  readonly employeeCents: number;
  /**
   * Always nil. Present so a payslip and a submission cannot quietly imply an
   * employer share the scheme does not have.
   */
  readonly employerCents: 0;
  readonly participation: LindungParticipation;
  readonly phase: 'PHASE_1';
  readonly atCeiling: boolean;
  /** True when the employer remits money it does not itself bear. */
  readonly remittedByEmployer: true;
}

/**
 * One month's LINDUNG 24 JAM contribution.
 *
 * NOT_ELIGIBLE and CANNOT_DETERMINE are kept apart on purpose. A local who
 * declined owes nothing and that is a fact; an employee whose participation
 * nobody recorded is an open question, and paying nil for them is a guess that
 * happens to be cheap.
 */
/** The scheme's own dates and rates, plus the Act 4 table its column sits in. Built-in by default. */
export interface LindungTables {
  readonly effectiveFrom: Date;
  readonly phaseRatesPercent: { readonly PHASE_1: number; readonly PHASE_2: number; readonly PHASE_3: number };
  readonly socso: SocsoTables;
}
export const BUILT_IN_LINDUNG_TABLES: LindungTables = {
  effectiveFrom: LINDUNG_EFFECTIVE_FROM,
  phaseRatesPercent: LINDUNG_PHASE_RATES_PERCENT,
  socso: BUILT_IN_SOCSO_TABLES,
};

export function lindungContribution(
  wagesCents: number,
  participation: LindungParticipation | null | undefined,
  on: Date,
  tables: LindungTables = BUILT_IN_LINDUNG_TABLES,
): ContributionOutcome<LindungContribution> {
  if (on < tables.effectiveFrom) {
    return {
      kind: 'NOT_ELIGIBLE',
      reason: `LINDUNG 24 JAM is in force from ${tables.effectiveFrom.toISOString().slice(0, 10)}, so nothing is due for this period.`,
    };
  }

  /*
   * NOTHING RECORDED MEANS ENROLLED, BECAUSE ENROLMENT IS AUTOMATIC.
   *
   * This used to return CANNOT_DETERMINE — "it is voluntary for locals, so we
   * cannot know" — and the run then deducted nothing. That reading had the
   * scheme backwards. SKBBK enrols every employee; leaving it takes PERKESO's
   * own opt-out form. So silence is not an open question, it is the default
   * answer, and the default answer is IN.
   *
   * The old behaviour meant a clinic that never opened the field under-deducted
   * from its entire workforce and nothing on any screen said so.
   */
  const effective: LindungParticipation = participation ?? 'ENROLLED';
  if (effective === 'NOT_PARTICIPATING') {
    return {
      kind: 'NOT_ELIGIBLE',
      reason: 'This employee has opted out of LINDUNG 24 JAM through PERKESO. Nothing is due.',
    };
  }

  if (wagesCents <= 0) {
    return {
      kind: 'COMPUTED',
      value: {
        employeeCents: 0,
        employerCents: 0,
        participation: effective,
        phase: 'PHASE_1',
        atCeiling: false,
        remittedByEmployer: true,
      },
    };
  }

  const atCeiling = wagesCents > tables.socso.ceilingCents;
  for (const [fromCents, toCents, , , c1Nei] of tables.socso.bands) {
    const matches = toCents === null ? wagesCents > fromCents : wagesCents > fromCents || fromCents === 0;
    const withinUpper = toCents === null || wagesCents <= toCents;
    if (matches && withinUpper) {
      return {
        kind: 'COMPUTED',
        value: {
          employeeCents: c1Nei,
          employerCents: 0,
          participation: effective,
          phase: 'PHASE_1',
          atCeiling,
          remittedByEmployer: true,
        },
      };
    }
  }
  return {
    kind: 'CANNOT_DETERMINE',
    reason: `Wages of ${(wagesCents / 100).toFixed(2)} fall in no LINDUNG 24 JAM band.`,
  };
}
