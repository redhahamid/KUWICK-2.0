import { MoneyLike, fromCents, toCents } from '../finance/money';
import {
  Contribution,
  EmployeeStatutoryProfile,
  PcbYearToDate,
  StatutoryBases,
  StatutoryContext,
  StatutoryResult,
  computeStatutory,
  statutoryStatusOf,
} from './statutory';

/**
 * PAYROLL ASSEMBLY — turning components into a payslip.
 *
 * The arithmetic of the three statutory schemes lives in `statutory.ts`. What
 * lives here is the question that comes BEFORE it: which parts of somebody's
 * pay are each scheme computed on?
 *
 * That question has a different answer per scheme and per component, and the
 * previous version of this file could not express it. It computed one
 * `statutoryWage = basic + allowances + overtime` and handed the same figure to
 * EPF, SOCSO and EIS. Overtime is SOCSO and EIS wages but is EXPRESSLY EXCLUDED
 * from EPF wages by s.2 of the EPF Act 1991, so that single figure
 * over-contributed EPF for every employee who worked an hour of overtime.
 *
 * The clinic's own spreadsheet already solves this properly, and the model
 * below is deliberately the same shape: liability is declared once per
 * component, and the three bases fall out of the declaration. See
 * docs/HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md section 1.3.
 */

// ---------------------------------------------------------------------------
// Components and their statutory treatment
// ---------------------------------------------------------------------------

export type ComponentKind = 'EARNING' | 'DEDUCTION';

/**
 * What a component is liable to.
 *
 * `ordinaryRateOfPay` is separate from the three schemes and easy to overlook:
 * it decides whether a component counts toward the Ordinary Rate of Pay that
 * prices overtime and unpaid leave. Overtime itself must NOT count, or an hour
 * of overtime raises the rate at which the next hour is paid.
 */
export interface ComponentLiability {
  epf: boolean;
  socso: boolean;
  eis: boolean;
  /** Liable to monthly tax deduction. Nearly everything is. */
  pcb: boolean;
  ordinaryRateOfPay: boolean;
  /**
   * LHDN treats bonus and once- or twice-yearly incentives as ADDITIONAL
   * remuneration, taxed by a different part of the MTD method from normal
   * monthly remuneration. Carried so that a PCB engine can be implemented
   * later without re-modelling every component.
   */
  additionalRemuneration?: boolean;
}

export interface PayrollComponentLine {
  code: string;
  label: string;
  kind: ComponentKind;
  /** Always positive. `kind` carries the sign. */
  amount: MoneyLike;
  liability: ComponentLiability;
}

/**
 * The five contribution-status codes the clinic's workbook uses, expressed as
 * liability. Kept because they are the vocabulary the clinic already thinks in,
 * and because a migration from the spreadsheet can map straight onto them.
 *
 *   1  No contribution
 *   2  EPF, SOCSO & EIS            (and counts toward ORP)
 *   3  SOCSO & EIS only
 *   4  EPF only, no ORP
 *   5  EPF, SOCSO & EIS, no ORP
 */
export const LIABILITY_BY_STATUS_CODE: Record<string, ComponentLiability> = {
  '1': { epf: false, socso: false, eis: false, pcb: true, ordinaryRateOfPay: false },
  '2': { epf: true, socso: true, eis: true, pcb: true, ordinaryRateOfPay: true },
  '3': { epf: false, socso: true, eis: true, pcb: true, ordinaryRateOfPay: false },
  '4': { epf: true, socso: false, eis: false, pcb: true, ordinaryRateOfPay: false },
  '5': { epf: true, socso: true, eis: true, pcb: true, ordinaryRateOfPay: false },
};

/**
 * Defaults for the components a Malaysian clinic actually runs.
 *
 * NOTE ON ALLOWANCE, ATTENDANCE AND COMMISSION. The clinic's spreadsheet
 * currently exempts all three from EPF. The EPF Act's definition of wages has a
 * CLOSED list of exclusions — service charge, overtime, gratuity, retirement
 * and retrenchment benefits, travelling allowance, and anything gazetted — and
 * commission, bonus and fixed or attendance allowances are not on it. So they
 * default to EPF-liable here. A clinic that believes otherwise must say so
 * deliberately, and that choice is dated and audited rather than inherited from
 * a spreadsheet.
 *
 * Mileage is exempt because travelling allowance IS an express exclusion.
 */
export const DEFAULT_COMPONENT_LIABILITY: Record<string, ComponentLiability> = {
  BASIC: LIABILITY_BY_STATUS_CODE['2'],
  ALLOWANCE: LIABILITY_BY_STATUS_CODE['2'],
  ATTENDANCE_ALLOWANCE: LIABILITY_BY_STATUS_CODE['2'],
  COMMISSION: LIABILITY_BY_STATUS_CODE['5'],
  // Overtime: SOCSO and EIS wages, NOT EPF wages, and never part of ORP.
  OVERTIME: LIABILITY_BY_STATUS_CODE['3'],
  // Travelling allowance is an express EPF exclusion, and SOCSO excludes it too.
  MILEAGE: LIABILITY_BY_STATUS_CODE['1'],
  // Bonus is EPF wages, but is additional remuneration for tax.
  BONUS: { ...LIABILITY_BY_STATUS_CODE['5'], additionalRemuneration: true },
  INCENTIVE: { ...LIABILITY_BY_STATUS_CODE['5'], additionalRemuneration: true },
  // Director's fee is not paid under a contract of service.
  DIRECTOR_FEE: LIABILITY_BY_STATUS_CODE['1'],
  LOCUM_FEE: LIABILITY_BY_STATUS_CODE['1'],
  // Unpaid leave reduces every base as well as pay.
  UNPAID_LEAVE: LIABILITY_BY_STATUS_CODE['2'],
  /*
   * A REIMBURSEMENT OF ACTUAL EXPENDITURE, not remuneration — the clinic is
   * giving back money the employee already spent on its behalf.
   *
   * Seeded to status code 1 (no EPF, SOCSO or EIS) because that reproduces the
   * treatment the clinic already applies to reimbursements in its own workbook.
   * THIS IS NOT A VERIFIED STATUTORY DETERMINATION. Whether a particular
   * reimbursement is wages turns on what it reimburses, and settling that is
   * Stage 3 work against KWSP's and PERKESO's own definitions. It ships
   * unverified like every other flag in this table.
   */
  CLAIM_REIMBURSEMENT: LIABILITY_BY_STATUS_CODE['1'],
  // Pure deductions: they reduce net pay and nothing else.
  ZAKAT: LIABILITY_BY_STATUS_CODE['1'],
  ADVANCE_RECOVERY: LIABILITY_BY_STATUS_CODE['1'],
  UNIFORM: LIABILITY_BY_STATUS_CODE['1'],
  OTHER_DEDUCTION: LIABILITY_BY_STATUS_CODE['1'],
};

// ---------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------

export interface BasesResult extends StatutoryBases {
  grossCents: number;
  /** Earnings that count toward the Ordinary Rate of Pay. */
  ordinaryRateBaseCents: number;
  pcbNormalCents: number;
  pcbAdditionalCents: number;
}

/**
 * The three statutory bases, plus gross and the ORP base, from the component
 * lines.
 *
 * A deduction reduces a base only if the deduction is itself liable to that
 * scheme — which is how unpaid leave reduces EPF wages while a uniform charge
 * does not. Bases are floored at zero: a month whose deductions exceed its
 * earnings is an exception for a human, not a negative contribution.
 */
export function computeBases(lines: PayrollComponentLine[]): BasesResult {
  let gross = 0;
  let epf = 0;
  let epfNormal = 0;
  let socso = 0;
  let eis = 0;
  let orp = 0;
  let pcbNormal = 0;
  let pcbAdditional = 0;

  for (const line of lines) {
    const amount = toCents(line.amount);
    const sign = line.kind === 'EARNING' ? 1 : -1;
    gross += sign * amount;
    if (line.liability.epf) {
      epf += sign * amount;
      // EPF wages excluding additional remuneration, so the MTD method can ask
      // for the contribution "in respect of Y1" on its own.
      if (!line.liability.additionalRemuneration) epfNormal += sign * amount;
    }
    if (line.liability.socso) socso += sign * amount;
    if (line.liability.eis) eis += sign * amount;
    if (line.liability.ordinaryRateOfPay) orp += sign * amount;
    if (line.liability.pcb) {
      if (line.liability.additionalRemuneration) pcbAdditional += sign * amount;
      else pcbNormal += sign * amount;
    }
  }

  return {
    grossCents: gross,
    epfCents: Math.max(0, epf),
    epfNormalCents: Math.max(0, epfNormal),
    socsoCents: Math.max(0, socso),
    eisCents: Math.max(0, eis),
    ordinaryRateBaseCents: Math.max(0, orp),
    pcbNormalCents: Math.max(0, pcbNormal),
    pcbAdditionalCents: Math.max(0, pcbAdditional),
  };
}

// ---------------------------------------------------------------------------
// Ordinary Rate of Pay, overtime, unpaid leave
// ---------------------------------------------------------------------------

/**
 * The divisors are CLINIC POLICY, not law, and the clinic uses two different
 * ones on purpose: overtime is priced on a 26-day month and unpaid leave is
 * deducted on a 31-day month. Both are configurable per employer and neither
 * has a default baked in here.
 */
export interface OrdinaryRateConfig {
  overtimeDaysPerMonth: number;
  unpaidLeaveDaysPerMonth: number;
  hoursPerDay: number;
}

export interface OrdinaryRates {
  /** Daily rate used to deduct unpaid leave. */
  unpaidLeaveDailyCents: number;
  /** Daily rate used to price overtime. */
  overtimeDailyCents: number;
  /** Hourly rate used to price overtime, ROUNDED TO THE SEN before use. */
  overtimeHourlyCents: number;
}

/**
 * The rounding order here is load-bearing. The clinic's spreadsheet computes
 * `ROUND(daily / hours, 2)` and only then multiplies by hours and the
 * multiplier. Rounding at the end instead produces figures a sen or two out on
 * most rows, which is exactly the kind of difference that makes a
 * reconciliation against the old spreadsheet impossible to sign off.
 */
export function ordinaryRates(orpBaseCents: number, config: OrdinaryRateConfig): OrdinaryRates {
  const upl = config.unpaidLeaveDaysPerMonth > 0 ? orpBaseCents / config.unpaidLeaveDaysPerMonth : 0;
  const otDaily = config.overtimeDaysPerMonth > 0 ? orpBaseCents / config.overtimeDaysPerMonth : 0;
  const otHourly = config.hoursPerDay > 0 ? Math.round(otDaily / config.hoursPerDay) : 0;
  return {
    unpaidLeaveDailyCents: Math.round(upl),
    overtimeDailyCents: Math.round(otDaily),
    overtimeHourlyCents: otHourly,
  };
}

/** One overtime tier: either a multiple of the hourly ORP, or a flat rate. */
export interface OvertimeTier {
  label: string;
  hours: number;
  /** e.g. 1.5, 2, 3. Ignored when `flatHourlyRate` is set. */
  multiplier?: number;
  flatHourlyRate?: MoneyLike;
}

export interface OvertimeTierResult extends OvertimeTier {
  hourlyRateCents: number;
  totalCents: number;
}

export function computeOvertime(tiers: OvertimeTier[], hourlyOrpCents: number): { tiers: OvertimeTierResult[]; totalCents: number } {
  const results = tiers.map((tier) => {
    if (tier.hours <= 0) return { ...tier, hourlyRateCents: 0, totalCents: 0 };
    const hourlyRateCents =
      tier.flatHourlyRate !== undefined && tier.flatHourlyRate !== null
        ? toCents(tier.flatHourlyRate)
        : Math.round(hourlyOrpCents * (tier.multiplier ?? 1));
    return { ...tier, hourlyRateCents, totalCents: Math.round(hourlyRateCents * tier.hours) };
  });
  return { tiers: results, totalCents: results.reduce((sum, t) => sum + t.totalCents, 0) };
}

export function unpaidLeaveDeductionCents(days: number, rates: OrdinaryRates): number {
  return Math.round(days * rates.unpaidLeaveDailyCents);
}

// ---------------------------------------------------------------------------
// The payslip
// ---------------------------------------------------------------------------

export interface PayslipResult {
  lines: PayrollComponentLine[];
  bases: BasesResult;
  statutory: StatutoryResult;
  grossCents: number;
  /** Everything withheld from the employee, statutory and otherwise. */
  employeeDeductionCents: number;
  /** Employer EPF + SOCSO + EIS. Never withheld from the employee. */
  employerContributionCents: number;
  netCents: number;
  /** Gross plus employer contributions plus any other employer-borne cost. */
  employerCostCents: number;
  /** True when any statutory figure could not be computed. */
  incomplete: boolean;
  /** Every reason a figure is missing, for the exception list and the payslip. */
  notes: string[];
}

/**
 * One payslip.
 *
 * An uncomputable statutory figure stays ABSENT. Net pay is then computed
 * without it, and `incomplete` is true — so the number on screen is visibly a
 * draft rather than a plausible final figure somebody might pay against. The
 * run cannot be approved while any line is incomplete.
 */
export function computePayslip(
  lines: PayrollComponentLine[],
  context: StatutoryContext,
  profile: EmployeeStatutoryProfile,
  ytd?: PcbYearToDate,
): PayslipResult {
  const bases = computeBases(lines);
  // Zakat paid THIS month reduces this month's MTD, so it is read off the
  // component rather than passed in separately — there is one place a zakat
  // figure can come from and this is it.
  const zakatThisMonthCents = lines
    .filter((line) => line.code === 'ZAKAT' && line.kind === 'DEDUCTION')
    .reduce((sum, line) => sum + toCents(line.amount), 0);
  const statutory = computeStatutory(bases, context, profile, ytd, zakatThisMonthCents);

  const employeeStatutory =
    (statutory.epf.employeeCents ?? 0) +
    (statutory.socso.employeeCents ?? 0) +
    (statutory.eis.employeeCents ?? 0) +
    (statutory.pcbCents ?? 0);

  const nonStatutoryDeductions = lines
    .filter((line) => line.kind === 'DEDUCTION')
    .reduce((sum, line) => sum + toCents(line.amount), 0);

  const employerContributionCents =
    (statutory.epf.employerCents ?? 0) + (statutory.socso.employerCents ?? 0) + (statutory.eis.employerCents ?? 0);

  const notes = [statutory.epf.note, statutory.socso.note, statutory.eis.note, statutory.pcbCents === null ? statutory.pcbNote : undefined]
    .filter((note): note is string => Boolean(note));

  const incomplete =
    statutory.epf.employeeCents === null ||
    statutory.socso.employeeCents === null ||
    statutory.eis.employeeCents === null ||
    statutory.pcbCents === null;

  // `bases.grossCents` is already net of the deduction lines, so the employee's
  // statutory share is the only further withholding.
  const netCents = bases.grossCents - employeeStatutory;

  return {
    lines,
    bases,
    statutory,
    grossCents: bases.grossCents,
    employeeDeductionCents: employeeStatutory + nonStatutoryDeductions,
    employerContributionCents,
    netCents,
    employerCostCents: bases.grossCents + employerContributionCents,
    incomplete,
    notes,
  };
}

/** Completed years of age at a date. Payroll branches on it at 60. */
export function ageAt(dateOfBirth: Date | null | undefined, on: Date): number | null {
  if (!dateOfBirth) return null;
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (on.getUTCMonth() === dateOfBirth.getUTCMonth() && on.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export { fromCents, toCents, statutoryStatusOf };
export type { Contribution, StatutoryResult, StatutoryContext, EmployeeStatutoryProfile, PcbYearToDate };
