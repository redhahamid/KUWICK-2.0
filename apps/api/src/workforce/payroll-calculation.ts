import { MoneyLike, fromCents, toCents } from '../finance/money';
import { hrdLevyCents } from '../statutory/hrd-levy';
import { SEED_PAY_COMPONENTS } from './pay-component-catalogue';
import {
  Contribution,
  EmployeeStatutoryProfile,
  PcbYearToDate,
  StatutoryBases,
  StatutoryContext,
  StatutoryResult,
  Tp1MonthCapture,
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

/**
 * THREE KINDS, NOT TWO — and the third is the one s.18A forced into the open.
 *
 * A day of unpaid leave REDUCES THE WAGES. Section 18A says what an incomplete
 * month's wages ARE; it does not describe something withheld from a full
 * month's. Zakat, a uniform charge or an advance recovery are the opposite:
 * the wages are whole and something is taken out of them.
 *
 * Both were modelled as `DEDUCTION`, which made the payslip's own arithmetic
 * contradict itself — gross was quietly reduced by the leave AND the leave was
 * counted again among the deductions, so gross minus deductions did not equal
 * net. The run-level invariant caught it the first time a full run met an
 * employee with unpaid leave.
 */
export type ComponentKind = 'EARNING' | 'DEDUCTION' | 'WAGE_REDUCTION';

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
   * Inside HRD Corp's leviable wage — (basic − unpaid leave) + FIXED
   * allowances. Overtime, variable allowances, bonuses and commissions are
   * outside it by the guideline's own list, so this is NOT "everything EPF
   * takes". Optional because the levy postdates the shape; absent reads false.
   */
  hrd?: boolean;
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
 * THE SAME TREATMENT THE CATALOGUE HOLDS, derived from it rather than restated.
 *
 * This used to be a hand-maintained map, and it drifted: eight of its sixteen
 * entries disagreed with the catalogue rows a clinic can actually see and
 * configure. Two of those disagreements moved money — the ordinary-rate base
 * for allowances, and a zakat deduction that reduced the taxable base while the
 * MTD engine ALSO applied zakat as relief, under-deducting tax twice over.
 *
 * Derived now, so the two cannot diverge again. The RUN reads the effective-
 * dated `pay_components` rows; this exists for the basic-pay line and for tests
 * that need a treatment without a database.
 */
export const DEFAULT_COMPONENT_LIABILITY: Record<string, ComponentLiability> = Object.fromEntries(
  SEED_PAY_COMPONENTS.map((component) => [
    component.code,
    {
      epf: component.epfLiable,
      socso: component.socsoLiable,
      eis: component.eisLiable,
      pcb: component.pcbLiable,
      ordinaryRateOfPay: component.includeInOrpBase,
      additionalRemuneration: component.additionalRemuneration,
      hrd: component.hrdLiable,
    },
  ]),
);

// ---------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------

export interface BasesResult extends StatutoryBases {
  grossCents: number;
  /** Earnings that count toward the Ordinary Rate of Pay. */
  ordinaryRateBaseCents: number;
  pcbNormalCents: number;
  pcbAdditionalCents: number;
  /** HRD Corp's leviable wage: (basic − unpaid leave) + fixed allowances. */
  hrdCents: number;
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
  let hrd = 0;

  for (const line of lines) {
    const amount = toCents(line.amount);
    const sign = line.kind === 'EARNING' ? 1 : -1;
    // A withholding does NOT reduce the wages — it comes out of them. Only an
    // earning or a wage reduction moves gross.
    if (line.kind !== 'DEDUCTION') gross += sign * amount;
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
    // The unpaid-leave wage reduction is hrd-liable, so its −1 sign is what
    // makes this base "(basic − unpaid leave) + fixed allowances" — the
    // guideline's own formula — rather than a fifth per-scheme special case.
    if (line.liability.hrd) hrd += sign * amount;
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
    hrdCents: Math.max(0, hrd),
  };
}

// ---------------------------------------------------------------------------
// Ordinary Rate of Pay, overtime, unpaid leave
// ---------------------------------------------------------------------------

/**
 * ONE OF THESE IS POLICY AND THE OTHER IS NOT, which is why they are commented
 * apart rather than presented as a matched pair of settings.
 *
 * `overtimeDaysPerMonth` prices the ordinary rate under s.60I(1A). The Act
 * fixes it at 26 and s.60I(2) lets an employer use another method only where
 * the result is no lower, so this is a floor a clinic may better and never
 * worsen.
 *
 * `unpaidLeaveDaysPerMonth` is GONE from the calculation. It configured a fixed
 * divisor for unpaid leave, and s.18A leaves nothing to configure: an
 * incomplete month — expressly including leave of absence without pay — is
 * priced on the actual days in that wage period. The field remains on the run
 * so historical runs still say what they applied, and nothing reads it.
 */
export interface OrdinaryRateConfig {
  overtimeDaysPerMonth: number;
  /** @deprecated s.18A governs unpaid leave; kept only on historical runs. */
  unpaidLeaveDaysPerMonth: number;
  hoursPerDay: number;
}

export interface OrdinaryRates {
  /**
   * Daily rate for unpaid leave, from s.18A — monthly wages over the ACTUAL
   * days in this wage period, not a configured divisor.
   */
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
export function ordinaryRates(
  orpBaseCents: number,
  config: OrdinaryRateConfig,
  daysInWagePeriod: number,
): OrdinaryRates {
  // s.18A, not policy: the divisor is the length of THIS month.
  const upl = daysInWagePeriod > 0 ? orpBaseCents / daysInWagePeriod : 0;
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

/**
 * s.18A — the wages a day of unpaid leave costs.
 *
 * `rates.unpaidLeaveDailyCents` is already `monthly / days in this month`, so
 * this is the Act's formula expressed as a deduction. Rounding happens once,
 * here, on the total rather than per day.
 */
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
  /** Employer EPF + SOCSO + EIS, plus the HRD levy. Never withheld. */
  employerContributionCents: number;
  netCents: number;
  /** Gross plus employer contributions plus any other employer-borne cost. */
  employerCostCents: number;
  /**
   * HRD Corp levy on this employee's leviable wages. Employer cost. NULL when
   * it could not be worked out — the registration or the citizenship-bearing
   * EPF membership is unrecorded — and the reason is in `hrdNote`.
   */
  hrdLevyCents: number | null;
  hrdNote: string | null;
  /** True when any statutory figure could not be computed. */
  incomplete: boolean;
  /** Every reason a figure is missing, for the exception list and the payslip. */
  notes: string[];
}

/**
 * The levy for one payslip. The FORMULA lives in `statutory/hrd-levy.ts`;
 * this resolves the two context questions the engine cannot answer — is the
 * employer's registration on record, and does the employee's recorded EPF
 * membership carry the citizenship the Act's s.2 turns on.
 *
 * Domestic servants and directors paid fees only are outside this product's
 * employee model: everyone on a run is clinic staff engaged as an EMPLOYEE
 * under a contract of service (a fee-only director or locum is a CONTRACTOR
 * and never reaches a payroll line), so those two engine flags are false by
 * construction rather than by guess.
 */
function hrdLevyForPayslip(
  leviableCents: number,
  profile: EmployeeStatutoryProfile,
): { cents: number | null; note: string | null } {
  const registration = profile.hrdRegistration;
  if (registration === undefined || registration === null) {
    return {
      cents: null,
      note:
        'Whether this employer is registered with HRD Corp is not recorded, so the levy is not included in ' +
        'employer cost. Record the registration class and recalculate.',
    };
  }
  if (registration !== 'NOT_REGISTERED' && !profile.epfMembership) {
    return {
      cents: null,
      note:
        'The levy covers Malaysian citizens only, and this employee’s EPF membership — which records ' +
        'citizenship — is not on file.',
    };
  }
  const result = hrdLevyCents({
    registration,
    eligibility: {
      isMalaysianCitizen: profile.epfMembership === 'MALAYSIAN_CITIZEN',
      isFullTime: profile.hrdFullTimeEmployment ?? false,
      isDomesticServant: false,
      isDirectorPaidFeesOnly: false,
    },
    basicSalaryCents: leviableCents,
    unpaidLeaveCents: 0,
    fixedAllowanceCents: 0,
  });
  return { cents: result.levyCents, note: result.reason };
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
  tp1: Tp1MonthCapture | null = null,
): PayslipResult {
  const bases = computeBases(lines);
  // Zakat paid THIS month reduces this month's MTD, so it is read off the
  // component rather than passed in separately — there is one place a
  // payroll-deducted zakat figure can come from and this is it. Zakat the
  // employee paid THEMSELVES rides in on the TP1 capture instead.
  const zakatThisMonthCents = lines
    .filter((line) => line.code === 'ZAKAT' && line.kind === 'DEDUCTION')
    .reduce((sum, line) => sum + toCents(line.amount), 0);
  const statutory = computeStatutory(bases, context, profile, ytd, zakatThisMonthCents, tp1);

  // LINDUNG is EMPLOYEE-borne and EMPLOYER-remitted — both statements are only
  // true at once if the contribution is withheld from pay. It used to be
  // recorded on the line and left out of this sum, so a participating
  // employee's net was overstated by exactly the amount the employer went on
  // to remit for them.
  const employeeStatutory =
    (statutory.epf.employeeCents ?? 0) +
    (statutory.socso.employeeCents ?? 0) +
    (statutory.eis.employeeCents ?? 0) +
    (statutory.lindung.employeeCents ?? 0) +
    (statutory.pcbCents ?? 0);

  // Withholdings only. A wage reduction has already come off gross and
  // counting it here as well would take it twice.
  const nonStatutoryDeductions = lines
    .filter((line) => line.kind === 'DEDUCTION')
    .reduce((sum, line) => sum + toCents(line.amount), 0);

  // The HRD levy is employer-borne money the run owes on this employee's
  // leviable wages, so it rides in the employer contribution — which is what
  // keeps invariant 3, employerCost = gross + employerContribution, true
  // without a side channel.
  const hrd = hrdLevyForPayslip(bases.hrdCents, profile);

  const employerContributionCents =
    (statutory.epf.employerCents ?? 0) +
    (statutory.socso.employerCents ?? 0) +
    (statutory.eis.employerCents ?? 0) +
    (hrd.cents ?? 0);

  const notes = [
    statutory.epf.note,
    statutory.socso.note,
    statutory.eis.note,
    statutory.lindung.employeeCents === null ? statutory.lindung.note : undefined,
    statutory.pcbCents === null ? statutory.pcbNote : undefined,
  ].filter((note): note is string => Boolean(note));

  const incomplete =
    statutory.epf.employeeCents === null ||
    statutory.socso.employeeCents === null ||
    statutory.eis.employeeCents === null ||
    statutory.lindung.employeeCents === null ||
    statutory.pcbCents === null;

  // `bases.grossCents` is wages — earnings less any WAGE REDUCTION such as
  // unpaid leave. Everything withheld comes off it once, here.
  const netCents = bases.grossCents - employeeStatutory - nonStatutoryDeductions;

  return {
    lines,
    bases,
    statutory,
    grossCents: bases.grossCents,
    employeeDeductionCents: employeeStatutory + nonStatutoryDeductions,
    employerContributionCents,
    netCents,
    employerCostCents: bases.grossCents + employerContributionCents,
    hrdLevyCents: hrd.cents,
    hrdNote: hrd.note,
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
