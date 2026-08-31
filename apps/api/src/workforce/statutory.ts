import { MoneyLike, toCents } from '../finance/money';

/**
 * MALAYSIAN STATUTORY CONTRIBUTIONS — band tables, not percentages.
 *
 * The engine this replaces computed EPF as `wage x rate`. That is wrong, and
 * it is wrong on almost every wage. The EPF Third Schedule is a TABLE: wages
 * fall in a band, and the contribution is computed on the BAND CEILING and
 * rounded up to the next ringgit. For a wage of RM1,741.94 the employee's
 * share is not `1741.94 x 11% = 191.61`; it is `ceil(1760 x 11%) = RM194`,
 * because RM1,741.94 sits in the band 1,740.01-1,760.00. Every row of the
 * clinic's own payroll spreadsheet confirms this.
 *
 * SOCSO and EIS are also tables, but built differently again: the contribution
 * is a percentage of the band MIDPOINT rounded to five sen. Reproducing either
 * scheme by arithmetic instead of by table produces figures that are close
 * enough to look right and wrong enough to be under-contribution.
 *
 * Three further things this module exists to get right, all of which the
 * previous single-`statutoryWage` model could not express:
 *
 *  - THE THREE BASES ARE DIFFERENT. The EPF Act 1991 s.2 definition of wages
 *    expressly EXCLUDES overtime; the SOCSO and EIS definitions INCLUDE it. A
 *    payroll that computes one "gross" and hands it to all three schemes is
 *    over-contributing EPF for anyone who worked overtime.
 *
 *  - AGE CHANGES THE SCHEME, not just the rate. At 60 the employee's EPF share
 *    goes to zero and the employer's to 4%; SOCSO moves from First Category to
 *    Second Category (employer only); EIS ceases entirely.
 *
 *  - AN UNCOMPUTABLE FIGURE IS NULL, NEVER ZERO. Zero is a statement that
 *    nothing is due. Null is a statement that we do not know. Only the second
 *    is true of a clinic that has not configured its rates, and only the second
 *    sends somebody to configure them.
 *
 * NO RATE IS HARDCODED HERE. Every number comes from a dated, versioned
 * `StatutoryRuleSet` row. See docs/MALAYSIA_PAYROLL_STATUTORY_SOURCES.md for
 * what is verified and what is merely corroborated.
 */

// ---------------------------------------------------------------------------
// Band tables
// ---------------------------------------------------------------------------

/** One row of a contribution schedule. Amounts are the whole band's, in cents. */
export interface ContributionBand {
  /** Inclusive lower bound, cents. */
  min: number;
  /** Inclusive upper bound, cents. `null` for an open-ended top band. */
  max: number | null;
  employer: number;
  employee: number;
}

/**
 * What happens above the tabulated range. EPF stops tabulating at RM20,000 and
 * reverts to an exact percentage rounded up to the ringgit; SOCSO and EIS
 * simply cap, which is expressed as an open-ended top band instead.
 */
export interface AboveTableRule {
  /** Wages strictly above this use the percentage rule. */
  threshold: MoneyLike;
  employerPercent: MoneyLike;
  employeePercent: MoneyLike;
  /** EPF rounds each side UP to the next whole ringgit. */
  roundUpToRinggit?: boolean;
}

export interface BandTable {
  bands: ContributionBand[];
  aboveTable?: AboveTableRule | null;
}

/** EPF: two employee elections under 60 (11% statutory, 9% reduced), one table at 60+. */
export interface EpfRules {
  /** Keyed by the employee's elected rate as a string: "11" | "9". */
  under60?: Record<string, BandTable>;
  over60?: BandTable;
}

/** SOCSO: First Category under 60 (injury + invalidity), Second Category at 60+ (injury only). */
export interface SocsoRules {
  firstCategory?: BandTable;
  secondCategory?: BandTable;
}

/** EIS: nil at 60+, but expressed as a table so the rule is data rather than code. */
export interface EisRules {
  under60?: BandTable;
  over60?: BandTable;
}

export interface StatutoryRules {
  epfRules?: EpfRules | null;
  socsoRules?: SocsoRules | null;
  eisRules?: EisRules | null;
  /**
   * PCB is deliberately opaque here. The official method is LHDN's Computerised
   * Calculation, which needs year-to-date figures this function is never given.
   * Presence of a rule set is checked; nothing is computed from it. See
   * `PCB_NOT_IMPLEMENTED` below.
   */
  pcbRules?: unknown;
}

export type VerificationStatus = 'DRAFT' | 'CORROBORATED' | 'VERIFIED';

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface Contribution {
  employeeCents: number | null;
  employerCents: number | null;
  /** Why a figure is absent, when it is. Rendered on the payslip verbatim. */
  note?: string;
}

const notConfigured = (what: string): Contribution => ({
  employeeCents: null,
  employerCents: null,
  note: `No ${what} schedule is configured for this period.`,
});

function roundUpRinggit(cents: number): number {
  return Math.ceil(cents / 100) * 100;
}

function percentOf(cents: number, percent: MoneyLike): number {
  return Math.round((cents * Number(percent)) / 100);
}

/**
 * The band a wage falls in.
 *
 * Bands are treated as INCLUSIVE at both ends and are expected to be
 * contiguous, which is how every Malaysian schedule is published (…1,740.01 to
 * 1,760.00, then 1,760.01 to 1,780.00…). A wage that matches no band is not
 * silently floored to the top one — that is how a wage above a partially
 * entered table quietly under-contributes.
 */
export function bandFor(table: BandTable, wageCents: number): ContributionBand | null {
  for (const band of table.bands) {
    const max = band.max === null ? Number.POSITIVE_INFINITY : band.max;
    if (wageCents >= band.min && wageCents <= max) return band;
  }
  return null;
}

/** One scheme's contribution for one wage, from one table. */
export function contributionFrom(table: BandTable | undefined | null, wageCents: number, scheme: string): Contribution {
  if (!table?.bands?.length) return notConfigured(scheme);

  if (table.aboveTable) {
    const threshold = toCents(table.aboveTable.threshold);
    if (wageCents > threshold) {
      const round = table.aboveTable.roundUpToRinggit ? roundUpRinggit : (c: number) => c;
      return {
        employerCents: round(percentOf(wageCents, table.aboveTable.employerPercent)),
        employeeCents: round(percentOf(wageCents, table.aboveTable.employeePercent)),
      };
    }
  }

  const band = bandFor(table, wageCents);
  if (!band) {
    return {
      employeeCents: null,
      employerCents: null,
      // Deliberately not zero. A wage outside every configured band means the
      // table is incomplete, and the only safe answer is to say so.
      note: `Wage falls outside every configured ${scheme} band. The schedule is incomplete.`,
    };
  }
  return { employeeCents: band.employee, employerCents: band.employer };
}

// ---------------------------------------------------------------------------
// The schemes
// ---------------------------------------------------------------------------

export interface EmployeeStatutoryProfile {
  /** Age in completed years at the payroll period end. Drives every branch. */
  age?: number | null;
  /** The employee's elected EPF rate, 11 or 9. Defaults to 11. */
  epfEmployeeRate?: number | null;
  epfApplicable?: boolean;
  socsoApplicable?: boolean;
  eisApplicable?: boolean;
  pcbApplicable?: boolean;
}

/** Someone explicitly outside a scheme contributes zero, and that zero is a fact. */
const OUTSIDE = (scheme: string): Contribution => ({
  employeeCents: 0,
  employerCents: 0,
  note: `This employee is recorded as outside ${scheme}.`,
});

/**
 * The age branch is a real cliff, not a taper: on the day somebody turns 60
 * their EPF employee share becomes nil and the employer's becomes 4%. When age
 * is unknown we do NOT guess "under 60" — an unknown age is a gap, and it says
 * so, because guessing wrong under-contributes for the whole workforce.
 */
function isOver60(age: number | null | undefined): boolean | null {
  if (age === null || age === undefined || Number.isNaN(age)) return null;
  return age >= 60;
}

export function computeEpf(
  wageCents: number,
  rules: EpfRules | null | undefined,
  profile: EmployeeStatutoryProfile,
): Contribution {
  if (profile.epfApplicable === false) return OUTSIDE('EPF');
  const over60 = isOver60(profile.age);
  if (over60 === null) {
    return {
      employeeCents: null,
      employerCents: null,
      note: 'Date of birth is not recorded, and EPF rates differ at age 60.',
    };
  }
  if (!rules) return notConfigured('EPF');

  if (over60) return contributionFrom(rules.over60, wageCents, 'EPF (age 60+)');

  const election = String(profile.epfEmployeeRate ?? 11);
  const table = rules.under60?.[election];
  if (!table) {
    return {
      employeeCents: null,
      employerCents: null,
      note: `No EPF schedule is configured for an employee rate of ${election}%.`,
    };
  }
  return contributionFrom(table, wageCents, 'EPF');
}

export function computeSocso(
  wageCents: number,
  rules: SocsoRules | null | undefined,
  profile: EmployeeStatutoryProfile,
): Contribution {
  if (profile.socsoApplicable === false) return OUTSIDE('SOCSO');
  const over60 = isOver60(profile.age);
  if (over60 === null) {
    return {
      employeeCents: null,
      employerCents: null,
      note: 'Date of birth is not recorded, and SOCSO moves to the Second Category at age 60.',
    };
  }
  if (!rules) return notConfigured('SOCSO');
  return over60
    ? contributionFrom(rules.secondCategory, wageCents, 'SOCSO Second Category')
    : contributionFrom(rules.firstCategory, wageCents, 'SOCSO First Category');
}

export function computeEis(
  wageCents: number,
  rules: EisRules | null | undefined,
  profile: EmployeeStatutoryProfile,
): Contribution {
  if (profile.eisApplicable === false) return OUTSIDE('EIS');
  const over60 = isOver60(profile.age);
  if (over60 === null) {
    return {
      employeeCents: null,
      employerCents: null,
      note: 'Date of birth is not recorded, and EIS does not apply from age 60.',
    };
  }
  if (!rules) return notConfigured('EIS');
  return over60 ? contributionFrom(rules.over60, wageCents, 'EIS (age 60+)') : contributionFrom(rules.under60, wageCents, 'EIS');
}

/**
 * PCB / MTD — NOT IMPLEMENTED, ON PURPOSE.
 *
 * The lawful methods are LHDN's Computerised Calculation and the published
 * Jadual PCB. The first needs year-to-date remuneration, prior PCB paid, EPF
 * relief to the RM4,000 cap, zakat paid, marital and child reliefs, the number
 * of months remaining in the year, and a separate treatment for ADDITIONAL
 * remuneration (bonus and annual incentives) — none of which a single monthly
 * wage figure carries.
 *
 * The engine this replaces had a `baseAmount + percentOfExcess` bracket walk.
 * That is not either lawful method; it is a plausible-looking approximation,
 * and the owner brief is explicit that it must not drive live payroll. So it is
 * gone, and nothing has been put in its place: every employee raises a blocking
 * exception until a verified PCB rule set exists.
 */
export const PCB_NOT_IMPLEMENTED =
  'PCB is not calculated by this system. Monthly tax deduction requires the LHDN Computerised ' +
  'Calculation method, which is not implemented. Enter PCB as a payroll input or file it separately.';

export function computePcb(profile: EmployeeStatutoryProfile): { cents: number | null; note: string } {
  if (profile.pcbApplicable === false) {
    return { cents: 0, note: 'This employee is recorded as outside PCB.' };
  }
  return { cents: null, note: PCB_NOT_IMPLEMENTED };
}

// ---------------------------------------------------------------------------
// Putting the three schemes together
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
}

export function computeStatutory(
  bases: StatutoryBases,
  rules: StatutoryRules | null | undefined,
  profile: EmployeeStatutoryProfile,
): StatutoryResult {
  const pcb = computePcb(profile);
  return {
    epf: computeEpf(bases.epfCents, rules?.epfRules, profile),
    socso: computeSocso(bases.socsoCents, rules?.socsoRules, profile),
    eis: computeEis(bases.eisCents, rules?.eisRules, profile),
    pcbCents: pcb.cents,
    pcbNote: pcb.note,
    bases,
  };
}

/**
 * Whether a rule set may drive a run that somebody signs off.
 *
 * `VERIFIED` means a person opened the authority's published schedule and
 * compared it. Nothing else does — not "the numbers look right", not "they came
 * from the clinic's own spreadsheet". A run calculated against anything less
 * is PROVISIONAL and cannot be approved.
 */
export function statutoryStatusOf(
  rules: StatutoryRules | null | undefined,
  verification: VerificationStatus | null | undefined,
): 'CONFIGURED' | 'NOT_CONFIGURED' | 'PROVISIONAL' {
  if (!rules) return 'NOT_CONFIGURED';
  const hasAny =
    Boolean(rules.epfRules?.under60 && Object.keys(rules.epfRules.under60).length) ||
    Boolean(rules.socsoRules?.firstCategory?.bands?.length) ||
    Boolean(rules.eisRules?.under60?.bands?.length);
  if (!hasAny) return 'NOT_CONFIGURED';
  return verification === 'VERIFIED' ? 'CONFIGURED' : 'PROVISIONAL';
}
