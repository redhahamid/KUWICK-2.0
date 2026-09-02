import { EPF_PARTS, EPF_TABLE_CEILING_CENTS, EpfPart } from './epf-third-schedule';
import { EIS_BANDS, EIS_WAGE_CEILING_CENTS } from './eis-act800';
import { SOCSO_BANDS, SOCSO_WAGE_CEILING_CENTS } from './socso-act4';

/**
 * THE CONTRIBUTION ENGINES — EPF, SOCSO AND EIS.
 *
 * ELIGIBILITY IS A SEPARATE QUESTION FROM AMOUNT, and each scheme answers it
 * for itself. The old model had one `socsoApplicable` boolean standing in for
 * four different schemes under two different Acts, so an employee inside
 * Employment Injury but outside Invalidity had nowhere to be represented.
 *
 * Every function here returns a RESULT OBJECT rather than a number, because
 * "we could not work this out" and "the answer is nil" are different facts and
 * the payroll run must be able to block on the first while paying the second.
 */

/** What a scheme concluded, and why. */
export type ContributionOutcome<T> =
  | { readonly kind: 'COMPUTED'; readonly value: T }
  | { readonly kind: 'NOT_ELIGIBLE'; readonly reason: string }
  | { readonly kind: 'CANNOT_DETERMINE'; readonly reason: string };

// ---------------------------------------------------------------------------
// EPF — Employees Provident Fund Act 1991, Third Schedule.
// ---------------------------------------------------------------------------

/** The Schedule's own division of employees, which decides the Part. */
export type EpfMembership =
  | 'MALAYSIAN_CITIZEN'
  | 'PERMANENT_RESIDENT'
  /** A non-citizen who elected to contribute before 1 August 1998. */
  | 'NON_CITIZEN_ELECTED_PRE_1998'
  /** Any other non-citizen. Part F. */
  | 'NON_CITIZEN';

export interface EpfContribution {
  readonly employerCents: number;
  readonly employeeCents: number;
  /** The Schedule Part this came from, for the payslip and the audit. */
  readonly part: EpfPart['part'];
  /** True when the percentage above RM20,000 was used rather than a band. */
  readonly abovePercentage: boolean;
}

/**
 * Which Part of the Third Schedule applies.
 *
 * Age 60 is the Schedule's own dividing line ("until the employees attain the
 * age of sixty years"), and a Malaysian citizen at 60 moves to Part E rather
 * than Part C — the citizen limb of Part C was deleted by P.U. (A) 370/2018.
 */
export function epfPartFor(membership: EpfMembership, ageYears: number): EpfPart['part'] {
  const sixtyOrOver = ageYears >= 60;
  switch (membership) {
    case 'MALAYSIAN_CITIZEN':
      return sixtyOrOver ? 'E' : 'A';
    case 'PERMANENT_RESIDENT':
    case 'NON_CITIZEN_ELECTED_PRE_1998':
      return sixtyOrOver ? 'C' : 'A';
    case 'NON_CITIZEN':
      // Part F states one rate with no age or band distinction.
      return 'F';
  }
}

/**
 * "The total contribution which includes cents shall be rounded to the next
 * ringgit." On the TOTAL, and upward — so the shares are computed, summed,
 * the sum is rounded up, and the difference lands on the employer, which is
 * the only place it can go without changing what the employee was told.
 */
function roundTotalToNextRinggit(employerCents: number, employeeCents: number): {
  employerCents: number;
  employeeCents: number;
} {
  const total = employerCents + employeeCents;
  const rounded = Math.ceil(total / 100) * 100;
  return { employerCents: employerCents + (rounded - total), employeeCents };
}

export function epfContribution(
  wagesCents: number,
  membership: EpfMembership,
  ageYears: number | null,
): ContributionOutcome<EpfContribution> {
  if (ageYears === null) {
    // Age decides the Part, so an unknown date of birth is not a nil
    // contribution — it is an unanswerable question.
    return {
      kind: 'CANNOT_DETERMINE',
      reason:
        'EPF rates change at age 60, so a date of birth is needed before this employee’s contribution can be worked out.',
    };
  }
  if (wagesCents <= 0) {
    return { kind: 'COMPUTED', value: { employerCents: 0, employeeCents: 0, part: epfPartFor(membership, ageYears), abovePercentage: false } };
  }

  const partLetter = epfPartFor(membership, ageYears);
  const part = EPF_PARTS.find((candidate) => candidate.part === partLetter);
  if (!part) {
    return { kind: 'CANNOT_DETERMINE', reason: `No Third Schedule Part is defined for ${membership}.` };
  }

  // Part F has no band table: the Schedule states a flat percentage.
  if (part.bands.length === 0 || wagesCents > EPF_TABLE_CEILING_CENTS) {
    const employer = wagesCents * (part.aboveCeiling.employerPercent / 100);
    const employee = wagesCents * (part.aboveCeiling.employeePercent / 100);
    const rounded = roundTotalToNextRinggit(Math.round(employer), Math.round(employee));
    return { kind: 'COMPUTED', value: { ...rounded, part: partLetter, abovePercentage: true } };
  }

  for (const [fromCents, toCents, employerCents, employeeCents] of part.bands) {
    if (wagesCents >= fromCents && wagesCents <= toCents) {
      // A band's figures are already whole ringgit in the Schedule; no rounding.
      return { kind: 'COMPUTED', value: { employerCents, employeeCents, part: partLetter, abovePercentage: false } };
    }
  }

  return {
    kind: 'CANNOT_DETERMINE',
    reason: `Wages of ${(wagesCents / 100).toFixed(2)} fall in no band of Third Schedule Part ${partLetter}.`,
  };
}

// ---------------------------------------------------------------------------
// SOCSO — Employees' Social Security Act 1969, including SKBBK.
// ---------------------------------------------------------------------------

/**
 * The Act's two categories.
 *
 * FIRST covers Employment Injury, Invalidity and Non-Employment Injury.
 * SECOND covers Employment Injury and Non-Employment Injury, without
 * Invalidity — so the employee's share is smaller but, since SKBBK, no longer
 * nil.
 */
export type SocsoCategory = 'FIRST' | 'SECOND';

export interface SocsoContribution {
  readonly employerCents: number;
  readonly employeeCents: number;
  /** The employee's share, split as the Act's own columns split it. */
  readonly employeeInvalidityCents: number;
  readonly employeeNonEmploymentInjuryCents: number;
  readonly category: SocsoCategory;
  readonly atCeiling: boolean;
}

export function socsoContribution(wagesCents: number, category: SocsoCategory): ContributionOutcome<SocsoContribution> {
  if (wagesCents <= 0) {
    return {
      kind: 'COMPUTED',
      value: {
        employerCents: 0, employeeCents: 0, employeeInvalidityCents: 0,
        employeeNonEmploymentInjuryCents: 0, category, atCeiling: false,
      },
    };
  }
  const atCeiling = wagesCents > SOCSO_WAGE_CEILING_CENTS;
  for (const [fromCents, toCents, c1Er, c1Inv, c1Nei, c2Er, c2Nei] of SOCSO_BANDS) {
    const matches = toCents === null ? wagesCents > fromCents : wagesCents > fromCents || fromCents === 0;
    const withinUpper = toCents === null || wagesCents <= toCents;
    if (matches && withinUpper) {
      return {
        kind: 'COMPUTED',
        value:
          category === 'FIRST'
            ? {
                employerCents: c1Er,
                employeeCents: c1Inv + c1Nei,
                employeeInvalidityCents: c1Inv,
                employeeNonEmploymentInjuryCents: c1Nei,
                category,
                atCeiling,
              }
            : {
                employerCents: c2Er,
                employeeCents: c2Nei,
                employeeInvalidityCents: 0,
                employeeNonEmploymentInjuryCents: c2Nei,
                category,
                atCeiling,
              },
      };
    }
  }
  return { kind: 'CANNOT_DETERMINE', reason: `Wages of ${(wagesCents / 100).toFixed(2)} fall in no Act 4 band.` };
}

// ---------------------------------------------------------------------------
// EIS — Employment Insurance System Act 800.
// ---------------------------------------------------------------------------

export interface EisContribution {
  readonly employerCents: number;
  readonly employeeCents: number;
  readonly atCeiling: boolean;
}

export function eisContribution(wagesCents: number): ContributionOutcome<EisContribution> {
  if (wagesCents <= 0) {
    return { kind: 'COMPUTED', value: { employerCents: 0, employeeCents: 0, atCeiling: false } };
  }
  const atCeiling = wagesCents > EIS_WAGE_CEILING_CENTS;
  for (const [fromCents, toCents, employerCents, employeeCents] of EIS_BANDS) {
    const aboveLower = fromCents === 0 ? true : wagesCents > fromCents;
    const withinUpper = toCents === null || wagesCents <= toCents;
    if (aboveLower && withinUpper) {
      return { kind: 'COMPUTED', value: { employerCents, employeeCents, atCeiling } };
    }
  }
  return { kind: 'CANNOT_DETERMINE', reason: `Wages of ${(wagesCents / 100).toFixed(2)} fall in no Act 800 band.` };
}
