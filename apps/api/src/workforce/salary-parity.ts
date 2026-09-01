import { SalaryRow, resolveSalaryForPayroll } from './salary-resolution';

/**
 * THE CUTOVER PROOF.
 *
 * Payroll now resolves `employee_salaries` and no longer reads
 * `EmployeeProfile.basicSalary`. That is only safe if the two agree for every
 * employee at the moment of cutover — otherwise somebody quietly starts being
 * paid a different number, and the first anyone hears of it is a payslip.
 *
 * This compares them and classifies every difference. It never repairs one:
 * an automatic fix would be a silent salary change, which is the exact failure
 * the cutover exists to prevent.
 */

export type ParityVerdict =
  | 'MATCH'
  | 'LEGACY_ONLY'
  | 'CANONICAL_ONLY'
  | 'AMOUNT_DIFFERS'
  | 'CHANGED_MID_PERIOD'
  | 'BASIS_UNSUPPORTED'
  | 'NEITHER';

export interface ParityInput {
  staffId: string;
  name: string;
  /** `EmployeeProfile.basicSalary` in cents, or null. */
  legacyCents: number | null;
  salaryRows: SalaryRow[];
}

export interface ParityLine {
  staffId: string;
  name: string;
  verdict: ParityVerdict;
  legacyCents: number | null;
  canonicalCents: number | null;
  differenceCents: number | null;
  explanation: string;
}

export interface ParityReport {
  period: string;
  total: number;
  matched: number;
  /** Anything that is not a clean MATCH. The cutover is clean at zero. */
  mismatched: number;
  byVerdict: Record<ParityVerdict, number>;
  lines: ParityLine[];
  clean: boolean;
  summary: string;
}

/**
 * `NEITHER` is a match, not a mismatch: an employee with no salary anywhere is
 * consistently unpayable under both readings, and the run raises NO_SALARY for
 * them either way. It is reported separately so it cannot be mistaken for a
 * successful cutover of somebody who does get paid.
 */
export function salaryParity(
  inputs: ParityInput[],
  periodStart: Date,
  periodEnd: Date,
): ParityReport {
  const lines: ParityLine[] = inputs.map((input) => {
    const resolved = resolveSalaryForPayroll(input.salaryRows, periodStart, periodEnd);
    const base = { staffId: input.staffId, name: input.name, legacyCents: input.legacyCents };

    if (resolved.kind === 'CHANGED_MID_PERIOD') {
      return {
        ...base,
        verdict: 'CHANGED_MID_PERIOD' as const,
        canonicalCents: null,
        differenceCents: null,
        explanation:
          `Two or more rates apply to this period (changed on ` +
          `${resolved.changedOn.toISOString().slice(0, 10)}). Payroll refuses to choose one, so there ` +
          'is nothing to compare the legacy figure against.',
      };
    }

    if (resolved.kind === 'NO_SALARY') {
      return input.legacyCents === null
        ? {
            ...base,
            verdict: 'NEITHER' as const,
            canonicalCents: null,
            differenceCents: null,
            explanation: 'No salary on either side. This employee cannot be paid under the old reading or the new one.',
          }
        : {
            ...base,
            verdict: 'LEGACY_ONLY' as const,
            canonicalCents: null,
            differenceCents: null,
            explanation:
              'A basic salary is on the employee profile but no effective-dated row covers this period. ' +
              'After the cutover this employee raises NO_SALARY and is left out of the run.',
          };
    }

    if (resolved.row.basis !== 'MONTHLY') {
      return {
        ...base,
        verdict: 'BASIS_UNSUPPORTED' as const,
        canonicalCents: resolved.row.amountCents,
        differenceCents: null,
        explanation: `The effective-dated rate is ${resolved.row.basis}, which this build does not calculate.`,
      };
    }

    if (input.legacyCents === null) {
      return {
        ...base,
        verdict: 'CANONICAL_ONLY' as const,
        canonicalCents: resolved.row.amountCents,
        differenceCents: null,
        explanation:
          'An effective-dated salary exists where the legacy column was empty. The cutover starts paying ' +
          'this employee where the old reading could not.',
      };
    }

    const difference = resolved.row.amountCents - input.legacyCents;
    return {
      ...base,
      verdict: difference === 0 ? ('MATCH' as const) : ('AMOUNT_DIFFERS' as const),
      canonicalCents: resolved.row.amountCents,
      differenceCents: difference,
      explanation:
        difference === 0
          ? 'The effective-dated rate equals the legacy basic salary.'
          : `The effective-dated rate differs from the legacy basic salary by ${(difference / 100).toFixed(2)}. ` +
            'After the cutover this employee is paid the effective-dated figure.',
    };
  });

  const byVerdict = lines.reduce(
    (acc, line) => {
      acc[line.verdict] += 1;
      return acc;
    },
    {
      MATCH: 0,
      LEGACY_ONLY: 0,
      CANONICAL_ONLY: 0,
      AMOUNT_DIFFERS: 0,
      CHANGED_MID_PERIOD: 0,
      BASIS_UNSUPPORTED: 0,
      NEITHER: 0,
    } as Record<ParityVerdict, number>,
  );

  const matched = byVerdict.MATCH + byVerdict.NEITHER;
  const mismatched = lines.length - matched;

  return {
    period: periodStart.toISOString().slice(0, 10),
    total: lines.length,
    matched,
    mismatched,
    byVerdict,
    lines,
    clean: mismatched === 0,
    summary:
      mismatched === 0
        ? `All ${lines.length} employee(s) resolve to the same salary under both readings.`
        : `${mismatched} of ${lines.length} employee(s) would be paid differently after the cutover. ` +
          'Every one needs a human decision before this run is approved.',
  };
}
