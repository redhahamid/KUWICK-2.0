import { MoneyLike, fromCents, percentOfCents, toCents } from '../finance/money';

/**
 * PAYROLL ARITHMETIC — and the rule that shapes the whole module.
 *
 * OWNER BRIEF §15.7: "Do not calculate statutory payroll figures with
 * unverified hard-coded assumptions."
 *
 * There is therefore NO Malaysian rate anywhere in this file. Not an EPF
 * percentage, not a SOCSO bracket, not a PCB schedule. Every statutory figure
 * is computed from a `StatutoryRuleSet` the tenant configured and dated, and
 * when no rule set covers the period the result is NOT zero — it is ABSENT,
 * and the run says so.
 *
 * The distinction matters because a payslip showing "EPF: RM0.00" is a
 * statement that no EPF is due. A payslip showing "EPF: not configured" is a
 * statement that the system does not know. Only the second one is true of a
 * clinic that has not set its rates up, and only the second one causes somebody
 * to go and set them up.
 */

// ---------------------------------------------------------------------------
// The rule shapes. Deliberately permissive: these mirror what a tenant types
// in, and this module VALIDATES rather than assumes.
// ---------------------------------------------------------------------------

export interface EpfRules {
  /** Percentage of wages the employee contributes. */
  employeeRate?: MoneyLike;
  employerRate?: MoneyLike;
  /** Wages above this are not contributed on. Omit for no ceiling. */
  wageCeiling?: MoneyLike;
  /** Contributions are rounded UP to the next ringgit under EPF's own rules;
   *  whether that applies is the tenant's configuration, not our assumption. */
  roundUpToRinggit?: boolean;
}

export interface BracketRule {
  /** Inclusive lower bound of the wage band. */
  from: MoneyLike;
  /** Inclusive upper bound. Omit for the open-ended top band. */
  to?: MoneyLike;
  employee: MoneyLike;
  employer: MoneyLike;
}

export interface BracketRules {
  brackets?: BracketRule[];
}

export interface PcbBracket {
  from: MoneyLike;
  to?: MoneyLike;
  /** A flat amount for the band, plus a percentage of the excess over `from`. */
  baseAmount?: MoneyLike;
  percentOfExcess?: MoneyLike;
}

export interface PcbRules {
  brackets?: PcbBracket[];
  /** A flat monthly relief subtracted from chargeable income before the table. */
  monthlyRelief?: MoneyLike;
}

export interface StatutoryRules {
  epfRules?: EpfRules | null;
  socsoRules?: BracketRules | null;
  eisRules?: BracketRules | null;
  pcbRules?: PcbRules | null;
}

export type StatutoryStatusName = 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL';

export interface StatutoryContribution {
  employeeCents: number | null;
  employerCents: number | null;
  /** Why a figure is absent, when it is. Rendered on the payslip verbatim. */
  note?: string;
}

export interface StatutoryResult {
  epf: StatutoryContribution;
  socso: StatutoryContribution;
  eis: StatutoryContribution;
  pcbCents: number | null;
  pcbNote?: string;
}

const NOT_CONFIGURED: StatutoryContribution = {
  employeeCents: null,
  employerCents: null,
  note: 'No statutory rate configured for this period.',
};

function bracketFor<T extends { from: MoneyLike; to?: MoneyLike }>(brackets: T[], wageCents: number): T | null {
  for (const bracket of brackets) {
    const from = toCents(bracket.from);
    const to = bracket.to === undefined || bracket.to === null ? Infinity : toCents(bracket.to);
    if (wageCents >= from && wageCents <= to) return bracket;
  }
  return null;
}

/** EPF from a configured rate pair. Returns absent contributions if unconfigured. */
export function computeEpf(wageCents: number, rules: EpfRules | null | undefined): StatutoryContribution {
  if (!rules || rules.employeeRate === undefined || rules.employerRate === undefined) {
    return NOT_CONFIGURED;
  }
  const ceiling = rules.wageCeiling === undefined || rules.wageCeiling === null ? Infinity : toCents(rules.wageCeiling);
  const contributable = Math.min(wageCents, ceiling);

  const round = (cents: number) => (rules.roundUpToRinggit ? Math.ceil(cents / 100) * 100 : cents);

  return {
    employeeCents: round(percentOfCents(contributable, rules.employeeRate)),
    employerCents: round(percentOfCents(contributable, rules.employerRate)),
  };
}

/** SOCSO / EIS from a configured bracket table. */
export function computeBracketContribution(
  wageCents: number,
  rules: BracketRules | null | undefined,
): StatutoryContribution {
  if (!rules?.brackets?.length) return NOT_CONFIGURED;
  const bracket = bracketFor(rules.brackets, wageCents);
  if (!bracket) {
    // A wage outside every configured band is a configuration GAP. Returning
    // zero would silently under-contribute for somebody paid above the top
    // band the tenant happened to enter.
    return {
      employeeCents: null,
      employerCents: null,
      note: 'Wage falls outside every configured contribution band.',
    };
  }
  return { employeeCents: toCents(bracket.employee), employerCents: toCents(bracket.employer) };
}

/** PCB from a configured schedule. Absent unless configured — the common case. */
export function computePcb(chargeableCents: number, rules: PcbRules | null | undefined): { cents: number | null; note?: string } {
  if (!rules?.brackets?.length) {
    return {
      cents: null,
      note: 'No PCB schedule configured. Monthly tax deduction is not calculated by this system.',
    };
  }
  const relief = rules.monthlyRelief === undefined ? 0 : toCents(rules.monthlyRelief);
  const taxable = Math.max(0, chargeableCents - relief);
  const bracket = bracketFor(rules.brackets, taxable);
  if (!bracket) {
    return { cents: null, note: 'Income falls outside every configured PCB band.' };
  }
  const base = bracket.baseAmount === undefined ? 0 : toCents(bracket.baseAmount);
  const excess = Math.max(0, taxable - toCents(bracket.from));
  const marginal = bracket.percentOfExcess === undefined ? 0 : percentOfCents(excess, bracket.percentOfExcess);
  return { cents: base + marginal };
}

export function computeStatutory(
  wageCents: number,
  rules: StatutoryRules | null | undefined,
  applicability: { epf?: boolean; socso?: boolean; eis?: boolean; pcb?: boolean } = {},
): StatutoryResult {
  // An employee explicitly outside a scheme contributes ZERO, and that zero is
  // a fact rather than a gap — a foreign locum on a service contract is
  // genuinely outside EPF, and reporting "not configured" for them would send
  // somebody looking for a rate that will never apply.
  const outside: StatutoryContribution = {
    employeeCents: 0,
    employerCents: 0,
    note: 'This employee is recorded as outside the scheme.',
  };

  const epf = applicability.epf === false ? outside : computeEpf(wageCents, rules?.epfRules);
  const socso = applicability.socso === false ? outside : computeBracketContribution(wageCents, rules?.socsoRules);
  const eis = applicability.eis === false ? outside : computeBracketContribution(wageCents, rules?.eisRules);
  const pcb =
    applicability.pcb === false
      ? { cents: 0, note: 'This employee is recorded as outside PCB.' }
      : computePcb(wageCents, rules?.pcbRules);

  return { epf, socso, eis, pcbCents: pcb.cents, pcbNote: pcb.note };
}

/** Whether a rule set is complete enough to be described as CONFIGURED. */
export function statutoryStatusOf(rules: StatutoryRules | null | undefined, verified: boolean): StatutoryStatusName {
  if (!rules) return 'NOT_CONFIGURED';
  const hasAny =
    Boolean(rules.epfRules?.employeeRate !== undefined && rules.epfRules?.employerRate !== undefined) ||
    Boolean(rules.socsoRules?.brackets?.length) ||
    Boolean(rules.eisRules?.brackets?.length) ||
    Boolean(rules.pcbRules?.brackets?.length);
  if (!hasAny) return 'NOT_CONFIGURED';
  return verified ? 'CONFIGURED' : 'PROVISIONAL';
}

// ---------------------------------------------------------------------------
// The payslip
// ---------------------------------------------------------------------------

export interface PayrollInput {
  basicSalary: MoneyLike;
  allowances?: MoneyLike;
  overtimePay?: MoneyLike;
  incentives?: MoneyLike;
  bonus?: MoneyLike;
  unpaidLeaveDeduction?: MoneyLike;
  otherDeductions?: MoneyLike;
}

export interface PayslipResult {
  grossCents: number;
  /** Wages the statutory schemes are computed on. */
  statutoryWageCents: number;
  statutory: StatutoryResult;
  employeeDeductionCents: number;
  employerContributionCents: number;
  netCents: number;
  /** Total cost to the clinic: gross plus employer contributions. */
  employerCostCents: number;
  /** True when a statutory figure could not be computed. */
  incomplete: boolean;
  /** PCB, or null when it could not be computed. A named reader so callers do
   *  not reach into `statutory` and accidentally coerce the null. */
  pcbOrNull(): number | null;
}

/**
 * One payslip.
 *
 * TWO THINGS THIS DELIBERATELY DOES NOT DO:
 *
 *  1. It does not fall back to zero for an uncomputable statutory figure. An
 *     absent contribution stays absent, `incomplete` is true, and the net pay
 *     is computed WITHOUT it — which is visibly a draft rather than a plausible
 *     final number.
 *
 *  2. It does not decide what counts as statutory wages beyond the documented
 *     rule below. Whether a bonus attracts EPF is a question of law and of the
 *     bonus's nature; the tenant's rule set answers it by what it is applied
 *     to, and here that is BASIC + ALLOWANCES + OVERTIME — the ordinary
 *     monthly wage — with bonus and incentive excluded and stated as such.
 */
export function computePayslip(
  input: PayrollInput,
  rules: StatutoryRules | null | undefined,
  applicability: { epf?: boolean; socso?: boolean; eis?: boolean; pcb?: boolean } = {},
): PayslipResult {
  const basic = toCents(input.basicSalary);
  const allowances = toCents(input.allowances ?? 0);
  const overtime = toCents(input.overtimePay ?? 0);
  const incentives = toCents(input.incentives ?? 0);
  const bonus = toCents(input.bonus ?? 0);
  const unpaidLeave = toCents(input.unpaidLeaveDeduction ?? 0);
  const other = toCents(input.otherDeductions ?? 0);

  const grossCents = basic + allowances + overtime + incentives + bonus - unpaidLeave;

  // The ordinary monthly wage, which is what a rate table is written against.
  // Bonus and incentive are excluded and the exclusion is stated, because
  // including them silently would over-contribute in a month with a bonus.
  const statutoryWageCents = Math.max(0, basic + allowances + overtime - unpaidLeave);

  const statutory = computeStatutory(statutoryWageCents, rules, applicability);

  const employeeDeductionCents =
    (statutory.epf.employeeCents ?? 0) +
    (statutory.socso.employeeCents ?? 0) +
    (statutory.eis.employeeCents ?? 0) +
    (statutory.pcbCents ?? 0) +
    other;

  const employerContributionCents =
    (statutory.epf.employerCents ?? 0) + (statutory.socso.employerCents ?? 0) + (statutory.eis.employerCents ?? 0);

  const incomplete =
    statutory.epf.employeeCents === null ||
    statutory.socso.employeeCents === null ||
    statutory.eis.employeeCents === null ||
    statutory.pcbCents === null;

  return {
    grossCents,
    statutoryWageCents,
    statutory,
    employeeDeductionCents,
    employerContributionCents,
    netCents: grossCents - employeeDeductionCents,
    employerCostCents: grossCents + employerContributionCents,
    incomplete,
    pcbOrNull: () => statutory.pcbCents,
  };
}

/**
 * A day's pay, for unpaid-leave deductions.
 *
 * Divided by the CALENDAR days in the month, which is the convention Malaysian
 * clinics generally use for a monthly-rated employee. It is stated here so
 * that a clinic using working days instead changes one function with one test
 * rather than hunting through a payroll service.
 */
export function dailyRateCents(monthlySalaryCents: number, daysInMonth: number): number {
  if (daysInMonth <= 0) return 0;
  return Math.round(monthlySalaryCents / daysInMonth);
}

/**
 * Overtime pay from approved overtime minutes.
 *
 * The MULTIPLIER is a parameter, not a constant: 1.5× on a normal day and 2×
 * on a rest day are contractual terms, and hardcoding either would be exactly
 * the "unverified assumption" the brief forbids.
 */
export function overtimePayCents(
  hourlyRateCents: number,
  overtimeMinutes: number,
  multiplier: number,
): number {
  return Math.round((hourlyRateCents * overtimeMinutes * multiplier) / 60);
}

export { fromCents, toCents };
