import { ACT_OVERTIME_MULTIPLIERS, OvertimeMultipliers } from '../statutory/employment-act';
import { ClinicRates } from './overtime-pricing';
import { WorkforceCategory } from './workforce-category';
import { MoneyLike, toCents } from '../finance/money';

/**
 * WHICH RULE SET PRICES AN EMPLOYEE'S EXTRA HOURS.
 *
 * Settings › Payroll policies holds one rule set per group of the workforce
 * — doctors on clinic rates, everybody else on the Act — and an employee can
 * be put on a particular rule set by hand. Resolved in this order, and the
 * order is the whole point:
 *
 *   1. ASSIGNED  — `employee_profiles.payroll_policy_id`. The person's own
 *                  record is the most specific answer there is.
 *   2. CATEGORY  — the rule set naming their workforce category, for their
 *                  employing company first and then tenant-wide.
 *   3. DEFAULT   — the tenant's default rule set.
 *   4. NONE      — no rule set: the Act's formula, as every run did before.
 *
 * Pure, so the same function answers both the payroll run and the Settings
 * screen's "n employees on this rule set" — two surfaces that must not count
 * differently.
 */
export interface ResolvablePolicy {
  readonly id: string;
  readonly name: string;
  readonly isDefault: boolean;
  readonly legalEmployerId: string | null;
  readonly workforceCategory: string | null;
  readonly overtimeMode: 'STATUTORY' | 'CLINIC_RATE';
  readonly clinicOvertimeHourly: MoneyLike | null;
  readonly clinicPublicHolidayShift: MoneyLike | null;
  /** Absent as well as null means the public holiday shift. */
  readonly clinicFestiveHolidayShift?: MoneyLike | null;
  readonly clinicRestDayShift: MoneyLike | null;
  readonly clinicSessionRate: MoneyLike | null;
  /** Absent as well as null means the Act's — a caller that predates these need not restate them. */
  readonly overtimeMultiplier?: MoneyLike | null;
  readonly restDayMultiplier?: MoneyLike | null;
  readonly publicHolidayMultiplier?: MoneyLike | null;
  /** The hours on a festive public holiday. Absent as well as null means the public holiday multiplier. */
  readonly festiveHolidayMultiplier?: MoneyLike | null;
  /** How the rest of the year is estimated for monthly tax. Absent means Y1. */
  readonly pcbProjectionBasis?: 'CURRENT_MONTH' | 'BASIC_ONLY' | 'CONTRACTUAL_MONTHLY' | null;
}

export type PolicyResolutionHow = 'ASSIGNED' | 'CATEGORY' | 'DEFAULT' | 'NONE';

export interface PolicyResolution<P extends ResolvablePolicy> {
  readonly policy: P | null;
  readonly how: PolicyResolutionHow;
}

export function resolvePayrollPolicy<P extends ResolvablePolicy>(
  policies: readonly P[],
  employee: {
    readonly payrollPolicyId: string | null;
    readonly legalEmployerId: string | null;
    readonly category: WorkforceCategory;
  },
): PolicyResolution<P> {
  if (employee.payrollPolicyId) {
    const assigned = policies.find((policy) => policy.id === employee.payrollPolicyId);
    if (assigned) return { policy: assigned, how: 'ASSIGNED' };
  }
  const forCategory = policies.filter((policy) => policy.workforceCategory === employee.category);
  const forEmployer = employee.legalEmployerId
    ? forCategory.find((policy) => policy.legalEmployerId === employee.legalEmployerId)
    : undefined;
  if (forEmployer) return { policy: forEmployer, how: 'CATEGORY' };
  const tenantWide = forCategory.find((policy) => policy.legalEmployerId === null);
  if (tenantWide) return { policy: tenantWide, how: 'CATEGORY' };
  const fallback = policies.find((policy) => policy.isDefault);
  if (fallback) return { policy: fallback, how: 'DEFAULT' };
  return { policy: null, how: 'NONE' };
}

const cents = (value: MoneyLike | null): number | null => (value === null || value === undefined ? null : toCents(value));

/**
 * The multipliers a rule set prices its extra hours at.
 *
 * Each falls back to the Act's on its own, so a clinic that raised only
 * overtime keeps the Act's rest-day and public-holiday rates rather than
 * having to restate them. Applied in BOTH modes: a clinic-rate rule set with
 * no amount for a kind of day falls back to the Act's formula, and that
 * fallback should land on the clinic's own answer.
 */
export function multipliersOf(policy: ResolvablePolicy | null): OvertimeMultipliers {
  const pick = (value: MoneyLike | null | undefined, act: number): number => {
    if (value === null || value === undefined) return act;
    const chosen = Number(value);
    return Number.isFinite(chosen) && chosen > 0 ? chosen : act;
  };
  if (!policy) return ACT_OVERTIME_MULTIPLIERS;
  const publicHolidayExcess = pick(policy.publicHolidayMultiplier, ACT_OVERTIME_MULTIPLIERS.publicHolidayExcess);
  return {
    normalDay: pick(policy.overtimeMultiplier, ACT_OVERTIME_MULTIPLIERS.normalDay),
    restDayExcess: pick(policy.restDayMultiplier, ACT_OVERTIME_MULTIPLIERS.restDayExcess),
    publicHolidayExcess,
    // A festive day left blank is priced as the public holiday the clinic set, not as the Act's.
    festiveHolidayExcess: pick(policy.festiveHolidayMultiplier, publicHolidayExcess),
  };
}

/** Mode B's amounts, in cents, or null when the rule set is on the Act's formula. */
export function clinicRatesOf(policy: ResolvablePolicy | null): ClinicRates | null {
  if (!policy || policy.overtimeMode !== 'CLINIC_RATE') return null;
  return {
    ruleSet: policy.name,
    overtimeHourlyCents: cents(policy.clinicOvertimeHourly),
    publicHolidayShiftCents: cents(policy.clinicPublicHolidayShift),
    festiveHolidayShiftCents: cents(policy.clinicFestiveHolidayShift ?? null),
    restDayShiftCents: cents(policy.clinicRestDayShift),
    sessionCents: cents(policy.clinicSessionRate),
  };
}

/**
 * The rule set's PCB projection, or the specification's own default.
 *
 * A rule set that names none — and a run with no rule set at all — projects
 * this month's normal remuneration, which is what every run did before the
 * setting existed. Nothing moves because a clinic has not opened the screen.
 */
export function pcbProjectionOf(policy: ResolvablePolicy | null): 'CURRENT_MONTH' | 'BASIC_ONLY' | 'CONTRACTUAL_MONTHLY' {
  return policy?.pcbProjectionBasis ?? 'CURRENT_MONTH';
}
