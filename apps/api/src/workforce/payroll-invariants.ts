/**
 * PAYROLL INVARIANTS — the arithmetic that must hold, checked rather than hoped.
 *
 * The design review of the Stage 2.5 mockups found five internal
 * contradictions in a set of screens whose only job was to be consistent: a
 * take-home headline that did not equal the sum of the rows beneath it, summary
 * strips that disagreed with their own tables, a comparison month carrying the
 * current month's totals, and two different rosters of "the same five people".
 *
 * Those were mockups. The same class of defect in the running product is a
 * payslip that does not add up, and nobody would find it by looking — a wrong
 * total looks exactly like a right one.
 *
 * So the relationships are stated here as checkable propositions and asserted
 * on every calculation. A violation is a BUG, not a data problem: it means the
 * calculation and the totals it wrote disagree, and the run must not be
 * presented as if it were sound.
 */

export interface EmployeeFigures {
  staffId: string;
  name: string;
  grossCents: number;
  /** Everything withheld from the employee: statutory plus other deductions. */
  employeeDeductionCents: number;
  netCents: number;
  employerContributionCents: number;
  employerCostCents: number;
}

export interface RunTotals {
  grossCents: number;
  deductionCents: number;
  netCents: number;
  employerCostCents: number;
  employeeCount: number;
}

export interface InvariantViolation {
  code: string;
  /** The employee it concerns, where it concerns one. */
  staffId: string | null;
  message: string;
  expectedCents: number;
  actualCents: number;
}

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * Every relationship the run's own numbers must satisfy.
 *
 * Cents throughout — the whole point is exactness, and a check written in
 * floating-point ringgit would report violations that are only rounding, or
 * miss ones that are not.
 */
export function checkPayrollInvariants(
  employees: EmployeeFigures[],
  totals: RunTotals,
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];

  // 1. PER EMPLOYEE: gross - deductions = net.
  for (const e of employees) {
    const expected = e.grossCents - e.employeeDeductionCents;
    if (expected !== e.netCents) {
      violations.push({
        code: 'EMPLOYEE_NET_MISMATCH',
        staffId: e.staffId,
        message:
          `${e.name}: gross ${money(e.grossCents)} minus deductions ${money(e.employeeDeductionCents)} ` +
          `should be ${money(expected)}, but net pay is ${money(e.netCents)}.`,
        expectedCents: expected,
        actualCents: e.netCents,
      });
    }
  }

  // 2. PER EMPLOYEE: gross + employer contributions = employer cost.
  //    The clinic's cost is what it pays out, not what the employee receives —
  //    a screen that shows one and labels it the other is how a clinic
  //    under-budgets by the whole employer contribution.
  for (const e of employees) {
    const expected = e.grossCents + e.employerContributionCents;
    if (expected !== e.employerCostCents) {
      violations.push({
        code: 'EMPLOYER_COST_MISMATCH',
        staffId: e.staffId,
        message:
          `${e.name}: gross ${money(e.grossCents)} plus employer contributions ` +
          `${money(e.employerContributionCents)} should be ${money(expected)}, but employer cost is ` +
          `${money(e.employerCostCents)}.`,
        expectedCents: expected,
        actualCents: e.employerCostCents,
      });
    }
  }

  // 3–6. RUN TOTALS ARE SUMS OF THE ROWS. Every one of these was a real defect
  //      in the mockups: a headline nobody had added up.
  const sums = employees.reduce(
    (acc, e) => ({
      gross: acc.gross + e.grossCents,
      deductions: acc.deductions + e.employeeDeductionCents,
      net: acc.net + e.netCents,
      employerCost: acc.employerCost + e.employerCostCents,
    }),
    { gross: 0, deductions: 0, net: 0, employerCost: 0 },
  );

  const totalChecks: [string, string, number, number][] = [
    ['RUN_GROSS_MISMATCH', 'gross', sums.gross, totals.grossCents],
    ['RUN_DEDUCTION_MISMATCH', 'deductions', sums.deductions, totals.deductionCents],
    ['RUN_NET_MISMATCH', 'take-home pay', sums.net, totals.netCents],
    ['RUN_EMPLOYER_COST_MISMATCH', 'cost to the clinic', sums.employerCost, totals.employerCostCents],
  ];
  for (const [code, label, expected, actual] of totalChecks) {
    if (expected !== actual) {
      violations.push({
        code,
        staffId: null,
        message:
          `Run total for ${label} is ${money(actual)}, but the ${employees.length} employee row(s) sum to ` +
          `${money(expected)}.`,
        expectedCents: expected,
        actualCents: actual,
      });
    }
  }

  // 7. THE HEADCOUNT IS THE NUMBER OF ROWS. A count that drifts from the rows
  //    is how "5 employees" appears above four payslips.
  if (employees.length !== totals.employeeCount) {
    violations.push({
      code: 'RUN_HEADCOUNT_MISMATCH',
      staffId: null,
      message: `The run says ${totals.employeeCount} employee(s) but wrote ${employees.length} payslip(s).`,
      expectedCents: employees.length,
      actualCents: totals.employeeCount,
    });
  }

  return violations;
}

/**
 * MEMBERSHIP IS THE SAME AT EVERY STEP.
 *
 * The six-step journey shows a roster on step 1 and figures on steps 2 to 5.
 * If those are different sets of people, the owner is reviewing one month and
 * approving another. Anybody left out must be left out for a REASON the screen
 * can state — an exception with their name on it.
 */
export function checkMembership(
  included: string[],
  excluded: { staffId: string; reason: string }[],
  considered: string[],
): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const includedSet = new Set(included);
  const excludedSet = new Set(excluded.map((e) => e.staffId));

  for (const staffId of considered) {
    if (!includedSet.has(staffId) && !excludedSet.has(staffId)) {
      violations.push({
        code: 'UNEXPLAINED_EXCLUSION',
        staffId,
        message:
          'This employee was considered for the run but is neither paid nor accounted for by an exception. ' +
          'Somebody is missing from payroll with no reason on screen.',
        expectedCents: 0,
        actualCents: 0,
      });
    }
  }

  for (const staffId of included) {
    if (excludedSet.has(staffId)) {
      violations.push({
        code: 'INCLUDED_AND_EXCLUDED',
        staffId,
        message: 'This employee is both paid by the run and listed as excluded from it.',
        expectedCents: 0,
        actualCents: 0,
      });
    }
  }

  return violations;
}

/**
 * VARIANCE IS A SUBTRACTION, not a separately computed number.
 *
 * The mockups showed a comparison month carrying the current month's exact
 * totals beside four non-zero month-on-month changes. Stating the relationship
 * makes that impossible: the displayed movement must equal current minus
 * comparison, for every employee and for the run.
 */
export function checkVariance(
  lines: { staffId: string; name: string; currentCents: number; previousCents: number; displayedDeltaCents: number }[],
): InvariantViolation[] {
  return lines.flatMap((line) => {
    const expected = line.currentCents - line.previousCents;
    if (expected === line.displayedDeltaCents) return [];
    return [{
      code: 'VARIANCE_MISMATCH',
      staffId: line.staffId,
      message:
        `${line.name}: ${money(line.currentCents)} this period minus ${money(line.previousCents)} last ` +
        `should show ${money(expected)}, but the movement shown is ${money(line.displayedDeltaCents)}.`,
      expectedCents: expected,
      actualCents: line.displayedDeltaCents,
    }];
  });
}

/** A one-line summary for a log or an exception row. */
export function describeViolations(violations: InvariantViolation[]): string {
  if (violations.length === 0) return 'All payroll invariants hold.';
  const codes = [...new Set(violations.map((v) => v.code))].join(', ');
  return `${violations.length} payroll invariant violation(s): ${codes}. ` +
    'These are arithmetic contradictions inside the run, not data problems — the figures on screen cannot all be true.';
}
