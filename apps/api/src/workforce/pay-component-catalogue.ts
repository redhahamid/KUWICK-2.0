/**
 * THE SEEDED PAY-COMPONENT CATALOGUE.
 *
 * `DEFAULT_COMPONENT_LIABILITY` is a TypeScript constant, so a clinic that adds
 * an allowance needs a deployment. This is the same information as rows, which
 * a clinic can extend and which can be effective-dated and versioned.
 *
 * TWO THINGS THIS FILE DELIBERATELY DOES NOT DO.
 *
 * 1. IT DOES NOT ASSERT THAT ANY FLAG IS CORRECT. Every row ships `DRAFT`,
 *    which the statutory register reads as UNVERIFIED. Which values Malaysian
 *    law requires is a Stage 3 question blocked on KWSP, PERKESO, HASiL, HRD
 *    Corp and JTKSM.
 *
 * 2. IT DOES NOT SILENTLY CORRECT THE ORP BASE. `computeBases` derives an
 *    ordinary-rate base from every ORP-liable component, and nothing reads it:
 *    the service uses basic salary alone. So the code and its own comment
 *    disagree, and the `ordinaryRateOfPay` flag is dead data.
 *
 *    The fix is NOT to switch the base on here. Employment Act 1955 s60I
 *    defines the ordinary rate of pay statutorily, and that definition — and
 *    which employees it covers — has not been read. Turning the flag on for
 *    allowances would change every overtime and unpaid-leave figure the moment
 *    this migration ran, on nothing but a guess.
 *
 *    So `includeInOrpBase` is seeded TRUE FOR BASIC PAY ONLY, which reproduces
 *    today's arithmetic exactly. The base becomes live and configurable; the
 *    question of what belongs in it stays open, recorded as register EA-01, and
 *    becomes a configuration change rather than a code change once s60I is
 *    mapped.
 */

export type SeedComponentType = 'ADDITION' | 'DEDUCTION' | 'OVERTIME';
export type SeedComponentCategory =
  | 'REMUNERATION'
  | 'ALLOWANCE'
  | 'BENEFIT_IN_KIND'
  | 'PERQUISITE'
  | 'TAX_DEDUCTION'
  | 'PAYROLL_DEDUCTION';
export type SeedIncludeIn = 'GROSS_AND_NET' | 'GROSS_ONLY' | 'NET_ONLY' | 'NONE';

export interface SeedPayComponent {
  code: string;
  name: string;
  type: SeedComponentType;
  category: SeedComponentCategory;
  includeIn: SeedIncludeIn;
  pcbLiable: boolean;
  epfLiable: boolean;
  socsoLiable: boolean;
  eisLiable: boolean;
  /** HRD Corp leviable wage. Independent: the levy base is not gross. */
  hrdLiable: boolean;
  includeInOrpBase: boolean;
  includeInUnpaidLeaveBase: boolean;
  additionalRemuneration: boolean;
  prorated: boolean;
  employerSide: boolean;
}

/**
 * The 15 components the engine already knows, expressed as rows.
 *
 * `hrdLiable` follows the shape of HRD Corp's own worked guidance — basic pay
 * less unpaid leave, plus FIXED allowances — so overtime, incentives and
 * commission are false here. That shape is recorded as register HRD-02 and is
 * UNVERIFIED; no calculation in Stage 1 or 2 reads this flag.
 */
export const SEED_PAY_COMPONENTS: SeedPayComponent[] = [
  {
    code: 'BASIC', name: 'Basic pay', type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: true,
    // The ONLY component seeded into the ORP base — see the header.
    includeInOrpBase: true, includeInUnpaidLeaveBase: true,
    additionalRemuneration: false, prorated: true, employerSide: false,
  },
  {
    code: 'ALLOWANCE', name: 'Allowance', type: 'ADDITION', category: 'ALLOWANCE',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: true,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'ATTENDANCE_ALLOWANCE', name: 'Attendance allowance', type: 'ADDITION', category: 'ALLOWANCE',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true,
    // Variable attendance allowance is named in HRD Corp guidance as excluded.
    hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'COMMISSION', name: 'Commission', type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'OVERTIME', name: 'Overtime', type: 'OVERTIME', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: false, socsoLiable: true, eisLiable: true, hrdLiable: false,
    // Never. An hour of overtime must not raise the rate paid for the next one.
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'MILEAGE', name: 'Mileage / travelling allowance', type: 'ADDITION', category: 'ALLOWANCE',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'BONUS', name: 'Bonus', type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: true, prorated: false, employerSide: false,
  },
  {
    code: 'INCENTIVE', name: 'Incentive', type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: true, prorated: false, employerSide: false,
  },
  {
    code: 'DIRECTOR_FEE', name: "Director's fee", type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'LOCUM_FEE', name: 'Locum fee', type: 'ADDITION', category: 'REMUNERATION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'UNPAID_LEAVE', name: 'Unpaid leave', type: 'DEDUCTION', category: 'PAYROLL_DEDUCTION',
    includeIn: 'GROSS_AND_NET',
    pcbLiable: true, epfLiable: true, socsoLiable: true, eisLiable: true, hrdLiable: true,
    includeInOrpBase: true, includeInUnpaidLeaveBase: true,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'ZAKAT', name: 'Zakat', type: 'DEDUCTION', category: 'TAX_DEDUCTION',
    includeIn: 'NET_ONLY',
    pcbLiable: false, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'ADVANCE_RECOVERY', name: 'Salary advance recovery', type: 'DEDUCTION', category: 'PAYROLL_DEDUCTION',
    includeIn: 'NET_ONLY',
    pcbLiable: false, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'UNIFORM', name: 'Uniform deduction', type: 'DEDUCTION', category: 'PAYROLL_DEDUCTION',
    includeIn: 'NET_ONLY',
    pcbLiable: false, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'OTHER_DEDUCTION', name: 'Other deduction', type: 'DEDUCTION', category: 'PAYROLL_DEDUCTION',
    includeIn: 'NET_ONLY',
    pcbLiable: false, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
  {
    code: 'PCB', name: 'PCB (monthly tax deduction)', type: 'DEDUCTION', category: 'TAX_DEDUCTION',
    includeIn: 'NET_ONLY',
    pcbLiable: false, epfLiable: false, socsoLiable: false, eisLiable: false, hrdLiable: false,
    includeInOrpBase: false, includeInUnpaidLeaveBase: false,
    additionalRemuneration: false, prorated: false, employerSide: false,
  },
];

/** The liability shape the existing calculation consumes. */
export interface ResolvedLiability {
  epf: boolean;
  socso: boolean;
  eis: boolean;
  pcb: boolean;
  ordinaryRateOfPay: boolean;
  additionalRemuneration?: boolean;
}

/**
 * A seeded row, as the calculation's own liability shape.
 *
 * This is the bridge that lets the run read components from the database
 * without touching the arithmetic that consumes them.
 */
export function liabilityOf(component: {
  epfLiable: boolean;
  socsoLiable: boolean;
  eisLiable: boolean;
  pcbLiable: boolean;
  includeInOrpBase: boolean;
  additionalRemuneration: boolean;
}): ResolvedLiability {
  return {
    epf: component.epfLiable,
    socso: component.socsoLiable,
    eis: component.eisLiable,
    pcb: component.pcbLiable,
    ordinaryRateOfPay: component.includeInOrpBase,
    additionalRemuneration: component.additionalRemuneration,
  };
}
