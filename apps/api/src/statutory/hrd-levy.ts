/**
 * HRD CORP — THE HUMAN RESOURCES DEVELOPMENT LEVY.
 *
 * SOURCE (Tier A): HRD Corp, "Levy Calculation Guideline", citing sections 2,
 * 14 and 15 of the Pembangunan Sumber Manusia Berhad Act 2001. Supplied by the
 * account holder.
 *
 * NOT A PERCENTAGE OF PAYROLL.
 *
 * The guideline states the formula outright:
 *
 *     LEVY = [(BASIC SALARY − UNPAID LEAVE) + FIXED ALLOWANCE] × 1%
 *
 * so the base is basic salary net of unpaid leave, plus FIXED allowances only.
 * Overtime, night and shift allowances, an attendance allowance whose amount
 * changes month to month, production incentive, bonuses, commissions,
 * gratuity, travel and petrol allowances and benefit-fund contributions are
 * all outside it. Levying 1% of gross payroll would overcharge a clinic every
 * month an employee worked overtime.
 *
 * WHO COUNTS. Section 2 defines an employee as a CITIZEN OF MALAYSIA employed
 * for wages under a contract of service in full-time employment, whether
 * contract or permanent, excluding a domestic servant. A non-citizen is not an
 * employee for levy purposes at all — which is the opposite of EPF, where a
 * non-citizen contributes under Part F. A director paid a salary is an
 * employee; a director paid only director's fees is not.
 *
 * THE RATE IS THE EMPLOYER'S REGISTRATION CLASS, not a property of the
 * employee: 1% under section 14, or 0.5% under section 15 for an employer
 * below the minimum headcount that opted to register.
 *
 * This is an EMPLOYER COST. It is never deducted from anybody's pay.
 */

/** Section 14 — the mandatory class. */
export const HRD_LEVY_RATE_MANDATORY_PERCENT = 1;
/** Section 15 — an employer below the minimum headcount that opted in. */
export const HRD_LEVY_RATE_OPTIONAL_PERCENT = 0.5;

export type HrdRegistrationClass = 'MANDATORY_SECTION_14' | 'OPTIONAL_SECTION_15' | 'NOT_REGISTERED';

export function hrdLevyRatePercent(registration: HrdRegistrationClass): number {
  switch (registration) {
    case 'MANDATORY_SECTION_14':
      return HRD_LEVY_RATE_MANDATORY_PERCENT;
    case 'OPTIONAL_SECTION_15':
      return HRD_LEVY_RATE_OPTIONAL_PERCENT;
    case 'NOT_REGISTERED':
      return 0;
  }
}

/**
 * Whether this person is an employee for levy purposes.
 *
 * Deliberately a separate question from the amount. An employee can be
 * ineligible for a reason that has nothing to do with their pay, and the two
 * were run together in the old model.
 */
export interface HrdEligibility {
  readonly isMalaysianCitizen: boolean;
  readonly isFullTime: boolean;
  readonly isDomesticServant: boolean;
  /** A director paid only fees, with no salary, is not an employee. */
  readonly isDirectorPaidFeesOnly: boolean;
}

export function isLeviableEmployee(who: HrdEligibility): boolean {
  if (!who.isMalaysianCitizen) return false;
  if (!who.isFullTime) return false;
  if (who.isDomesticServant) return false;
  if (who.isDirectorPaidFeesOnly) return false;
  return true;
}

/** Why somebody is outside the levy, in words a clinic owner can act on. */
export function leviabilityReason(who: HrdEligibility): string | null {
  if (!who.isMalaysianCitizen) return 'The levy covers Malaysian citizens only.';
  if (!who.isFullTime) return 'The levy covers full-time employees only, whether on contract or permanent.';
  if (who.isDomesticServant) return 'A domestic servant is outside the levy.';
  if (who.isDirectorPaidFeesOnly) {
    return 'A director who receives only director’s fees is not an employee for levy purposes.';
  }
  return null;
}

/**
 * The leviable wage, in cents.
 *
 * `fixedAllowanceCents` must carry FIXED allowances only. Whether a given
 * component is fixed is a property of the component, decided once in the pay
 * component's statutory treatment, rather than guessed here from its name.
 */
export function leviableWagesCents(input: {
  readonly basicSalaryCents: number;
  readonly unpaidLeaveCents: number;
  readonly fixedAllowanceCents: number;
}): number {
  const base = input.basicSalaryCents - input.unpaidLeaveCents;
  return Math.max(0, base) + input.fixedAllowanceCents;
}

/**
 * The levy for one employee for one month, in cents.
 *
 * The guideline says "**2 decimal place", so the result is rounded to the cent
 * rather than truncated — this is a cost the employer owes, not a deduction
 * from somebody's pay, and the guideline gives no truncation rule.
 */
export function hrdLevyCents(input: {
  readonly registration: HrdRegistrationClass;
  readonly eligibility: HrdEligibility;
  readonly basicSalaryCents: number;
  readonly unpaidLeaveCents: number;
  readonly fixedAllowanceCents: number;
}): { readonly levyCents: number; readonly leviableWagesCents: number; readonly reason: string | null } {
  const reason = leviabilityReason(input.eligibility);
  if (reason !== null || input.registration === 'NOT_REGISTERED') {
    return {
      levyCents: 0,
      leviableWagesCents: 0,
      reason: reason ?? 'This employer is not registered with HRD Corp, so no levy is payable.',
    };
  }
  const wages = leviableWagesCents(input);
  const rate = hrdLevyRatePercent(input.registration);
  return { levyCents: Math.round(wages * (rate / 100)), leviableWagesCents: wages, reason: null };
}

/**
 * The guideline's own examples of what is OUTSIDE the leviable wage, kept as
 * data so a pay component's default treatment can cite them and a settings
 * screen can show a clinic why a component was excluded.
 */
export const HRD_EXCLUDED_EXAMPLES: readonly string[] = [
  'Bonuses and commissions',
  'Gratuity on discharge or retirement',
  'Contributions to any pension, retrenchment, or employee benefit or welfare fund or scheme',
  'Travelling allowance or the value of any travelling concession, including petrol and transport allowances',
  'Allowances paid under an apprentice contract',
  'Special expenses',
  'Overtime payment',
  'Night work allowance',
  'Shift allowance',
  'Attendance allowance whose amount changes from month to month',
  'Production incentive',
] as const;
