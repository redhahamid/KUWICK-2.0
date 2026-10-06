// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// Vite's ?raw import gives the file's SOURCE. Several of these guards are about
// what the screens are WIRED to, which rendering alone cannot prove.
import runSource from './PayrollRunPage.tsx?raw';
// The per-person money detail is its own page (employee-payroll.html), so the
// guards that pin "this screen renders the engine and computes nothing" live
// against it.
import drawerSource from './PayrollEmployeePage.tsx?raw';
import gridSource from './PayrollGrid.tsx?raw';
import homeSource from './PayrollMonthPage.tsx?raw';
import centreSource from './PayrollExceptionCentre.tsx?raw';
import reportsSource from './PayrollReportsPage.tsx?raw';
import typesSource from '../types.ts?raw';
import claimsSource from './ClaimsPage.tsx?raw';
import locumSource from './LocumPage.tsx?raw';
import { STEPS, normaliseStep, stepsWithProblems } from './PayrollStepper';
import { money, ringgit, group } from '../components/DataTable';

/** Comments name the defects deliberately; a guard must not read them as code. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the payroll journey', () => {
  it('is FOUR stages — the decisions, not the domain\'s four kinds of input', () => {
    // It was six: Employees, Attendance & leave, Earnings, Deductions, Review,
    // Approve. Four of those were READING screens that asked for nothing and
    // existed because the engine has four kinds of input, so somebody paying
    // five people clicked through four pages that wanted nothing from them.
    expect(STEPS.map((step) => step.key)).toEqual(['prepare', 'review', 'approve', 'complete']);
  });

  it('still resolves every one of the old six-step links', () => {
    // `?step=earnings` is in exception remedies and in the user guide. A link
    // that lands on a blank screen is how somebody concludes the run is broken.
    expect(normaliseStep('employees')).toBe('prepare');
    expect(normaliseStep('attendance')).toBe('prepare');
    expect(normaliseStep('earnings')).toBe('review');
    expect(normaliseStep('deductions')).toBe('review');
    expect(normaliseStep('review')).toBe('review');
    expect(normaliseStep('approve')).toBe('approve');
  });

  it('lands anything unrecognised on Prepare rather than on nothing', () => {
    expect(normaliseStep(null)).toBe('prepare');
    expect(normaliseStep('something-added-later')).toBe('prepare');
  });

  it('gives every step a heading and a sentence saying what it is for', () => {
    for (const step of STEPS) {
      expect(step.heading.length).toBeGreaterThan(0);
      expect(step.blurb.length).toBeGreaterThan(20);
    }
  });
});

describe('money is grouped', () => {
  it('reads RM34,171.20 rather than RM34171.20 — the figure the eye goes to first', () => {
    expect(money(34171.2)).toBe('RM34,171.20');
    expect(ringgit('34171.20')).toBe('RM34,171.20');
    expect(group('40264')).toBe('40,264');
  });

  it('keeps small amounts unchanged and renders a real minus for negatives', () => {
    expect(money(86.4)).toBe('RM86.40');
    expect(ringgit('-135.48')).toBe('−RM135.48');
  });

  it('says "—" for an absent figure rather than zero', () => {
    expect(money(null)).toBe('—');
    expect(ringgit(null)).toBe('—');
  });

  it('does NOT format through the browser locale — a de-DE machine must not render RM34.171,20', () => {
    expect(code(money.toString())).not.toMatch(/toLocaleString/);
  });
});

describe('the money steps render the engine and compute nothing', () => {
  /**
   * Two earlier versions of the earnings table were wrong in the same way:
   * columns that did not reach their own row total. A third fixed that with a
   * residual — computed IN THE BROWSER, along with every subtotal, and on the
   * deductions step a statutory figure that was never calculated was summed
   * as zero. The grouping now comes from the journey payload; these guards
   * assert the screens read it and no longer do arithmetic of their own.
   */
  it('renders the "other income" and "claims" the server derived rather than subtracting to find them', () => {
    /*
     * BASIC + OVERTIME + CLAIMS DOES NOT REACH GROSS. Allowances, incentives,
     * a bonus and the recurring items are "other income" — the grid's own
     * column — and the journey service works it out as a residual of the
     * line's own gross, so the row cannot fail to add up across. The grid
     * carries the column and fills it from `pay.rows[].otherIncome`; it never
     * subtracts anything to find it.
     */
    expect(code(gridSource)).toMatch(/field: 'otherIncome'/);
    expect(code(gridSource)).toMatch(/field: 'claims'/);
    // Each column names the totals key it foots on — the stat cards and the
    // export read the same keys — never a difference the grid works out.
    expect(code(gridSource)).toMatch(/total: 'otherIncome'/);
    expect(code(gridSource)).toMatch(/total: 'claims'/);
    expect(code(gridSource)).not.toMatch(/grossCents\s*-/);
  });

  it('takes every total from data.pay.totals, never from a sum over the rows on screen', () => {
    expect(code(runSource)).toMatch(/data\.pay\.totals/);
    expect(code(runSource)).toMatch(/totals\.gross/);
    expect(code(runSource)).toMatch(/totals\.deductions/);
    // The exact shapes the browser arithmetic lived in. If either comes back,
    // the screen is a second payroll implementation again.
    expect(code(runSource)).not.toMatch(/\.reduce\(\(sum/);
    expect(code(runSource)).not.toMatch(/\?\? 0\)/);
  });

  it('says how many statutory figures were NOT calculated instead of summing them as zero', () => {
    expect(code(runSource)).toMatch(/statutoryNotCalculated/);
    // "Not worked out" is the phrase this product uses everywhere a figure is
    // unknown rather than nil, on the month header, the register cell and here.
    expect(code(runSource)).toMatch(/not worked out/i);
  });

  it('shows unpaid leave as a reduction of salary, never as an invisible difference', () => {
    /*
     * THE REGISTER SAYS IT BY ITS SHAPE, not by a paragraph.
     *
     * A sentence on the Review screen explaining that unpaid leave is not a
     * deduction was the old answer, and it was needed because the column sat
     * on the wrong side of Gross. The column is now declared before Gross in
     * the one list the register builds itself from, so the row visibly adds
     * up and the paragraph is not needed. Asserted on the source ORDER,
     * because that is the property that makes the arithmetic work.
     */
    const grid = code(gridSource);
    expect(grid.indexOf("field: 'unpaidDays'")).toBeGreaterThan(-1);
    expect(grid.indexOf("field: 'unpaidDays'")).toBeLessThan(grid.indexOf("field: 'grossPay'"));

    // And on the person's page it sits with the EARNINGS it reduces, because
    // gross has already absorbed it — listed under Deductions it was a total
    // that never touches net pay.
    expect(code(drawerSource)).toMatch(/Unpaid leave —/);
    expect(code(drawerSource)).toMatch(/wages are smaller, not deducted twice/);
    // The deductions total is the line's OWN figure. Anything that folded
    // unpaid leave back in here would charge it twice.
    expect(code(drawerSource)).toMatch(/label="Other deductions"/);
    expect(code(drawerSource)).toMatch(/row\.deductionTotal/);
  });

  it('surfaces a run whose lines do not reach its own totals rather than tidying it up', () => {
    expect(code(runSource)).toMatch(/totals\.addsUp/);
    expect(code(runSource)).toMatch(/totals\.discrepancy/);
  });
});

/*
 * EXCEPTION STATE HAS EXACTLY ONE SOURCE.
 *
 * Moved here from `payrollExceptionSource.test.tsx`, which drove the old
 * `PayrollPage` — a screen no route reaches any more. The guarantee is not
 * about that screen: it is that the run detail carries no exception field for
 * a UI to read, and that every surface asking "what is wrong with this month?"
 * asks the SAME query. Two stores is how a banner said five and a table said
 * three, and the Approve button believed whichever it had read last.
 */
describe('the second store cannot come back', () => {
  it('the run detail payload carries no exception field for the UI to read', () => {
    // A compile-time guarantee as well as a runtime one: `PayrollRunDetail` has
    // no `exceptions` member, so a component that tried to read one would not
    // typecheck. Asserted on the type declaration, which is where it is true.
    const detail = code(typesSource).slice(
      code(typesSource).indexOf('interface PayrollRunDetail'),
      code(typesSource).indexOf('interface PayrollRunDetail') + 1800,
    );
    expect(detail).not.toMatch(/^\s*exceptions\??:/m);
  });

  it('no payroll screen reads exception state off the run detail', () => {
    // The exact expressions that made the two stores disagree. If any of them
    // reappears, exception state has a second source again.
    for (const source of [runSource, gridSource, drawerSource]) {
      expect(code(source)).not.toMatch(/run[?]?\.exceptions/);
      expect(code(source)).not.toMatch(/hasExceptions/);
    }
  });

  it('the workspace and the exception centre read the same query key', () => {
    // Same hook, so the same TanStack cache entry — not two fetches that could
    // land at different times and show different numbers. The workspace passes
    // the run id straight to the centre, which owns the read.
    expect(code(runSource)).toMatch(/<PayrollExceptionCentre[^>]*runId=/);
    expect(code(centreSource)).toMatch(/usePayrollExceptions\(/);
  });

  /*
   * AND THE GATE NEVER FAILS OPEN. An unknown gate means "do not let this be
   * approved yet", never "approve away". The old page spelled this
   * `gate ? !gate.canApprove : true`; the workspace reads the server's own
   * `review.gate`, which is never undefined once the journey has loaded, and
   * the button is disabled on `!gate.canApprove`.
   */
  it('disables approval on the gate rather than on the absence of a problem', () => {
    expect(code(runSource)).toMatch(/disabled=\{!gate\.canApprove/);
  });
});

describe('the exception centre is on the run itself', () => {
  it('the review step renders the centre, wired to the same rows as the stepper and the gate', () => {
    expect(code(runSource)).toMatch(/<PayrollExceptionCentre/);
    // And the remedy for a missing PCB opens the inputs drawer on this
    // screen, for this employee, instead of routing the reader away.
    expect(code(runSource)).toMatch(/<PayrollInputsDrawer/);
    expect(code(runSource)).toMatch(/onFixInputs/);
  });
});

describe('the variance shown is a subtraction the API already did', () => {
  /*
   * WHERE THIS LIVES NOW. Review used to carry a second person-by-person table
   * with a "vs last period" column, directly under the register that had just
   * shown the same people with more detail. Review answers "is anything
   * stopping me approving this?", so the comparison moved to the panel and the
   * report that exist to answer "what changed?".
   *
   * The guarantee is unchanged and still worth pinning: the movement is a
   * subtraction the API already did, never one worked out from two figures on
   * screen.
   */
  it('reads the API delta rather than recomputing it from two numbers on screen', () => {
    // The month-on-month comparison lives in Reports, which is where somebody
    // goes to ask "what changed?". It was briefly pinned to a panel no route
    // reached — a guarantee guarding code nobody could open.
    const reports = code(reportsSource);
    expect(reports).toMatch(/movement/);
    // The mockup defect: a comparison month carrying the current month's totals.
    expect(reports).not.toMatch(/currentCents\s*-\s*previousCents/);
    // And Review no longer repeats the register at all.
    expect(code(runSource)).not.toMatch(/vs last period/);
  });
});

/*
 * A TICK MEANS SETTLED, NOT VISITED.
 *
 * The design review found a mockup showing a row of green ticks over a run
 * that could not be paid. The running product did the same thing for the same
 * reason: the stepper ticked every step behind the current one, so scrolling
 * to Review put a green tick on an Employees step where somebody had no
 * salary on file.
 */
describe('the stepper does not tick a step that still has a blocker', () => {
  it('sends a blocking exception to the step it belongs to', () => {
    const steps = stepsWithProblems([
      { code: 'NO_SALARY', blocksApproval: true },
      { code: 'PCB_MISSING', blocksApproval: true },
      { code: 'MISSING_PUNCH', blocksApproval: false },
    ]);
    // Six steps became four stages: anything to SORT OUT is Prepare, anything
    // that is a judgement about the figures is Review.
    expect(steps.has('prepare')).toBe(true);
    expect(steps.has('review')).toBe(true);
    // A warning does not block, so it does not take a tick away — and
    // MISSING_PUNCH is a Prepare code, which is already ticked by NO_SALARY,
    // so this asserts the warning's own step instead.
    expect(stepsWithProblems([{ code: 'MISSING_PUNCH', blocksApproval: false }]).has('prepare')).toBe(false);
  });

  it('never loses an unrecognised code — it lands on Review, where everything is listed', () => {
    const steps = stepsWithProblems([{ code: 'SOMETHING_ADDED_LATER', blocksApproval: true }]);
    expect(steps.has('review')).toBe(true);
  });

  it('ticks nothing when a run is clean of blockers', () => {
    expect(stepsWithProblems([{ code: 'MISSING_PUNCH', blocksApproval: false }]).size).toBe(0);
  });

  it('the run page hands the stepper the SAME rows the Review screen lists', () => {
    // One source. A stepper reading its own count could tick a step the
    // Review screen is showing a blocker on.
    expect(code(runSource)).toMatch(/problemSteps=\{data \? stepsWithProblems\(data\.review\.attention\)/);
  });
});

describe('the approval gate', () => {
  it('says why when records changed since the month was worked out, not "0 things must be sorted"', () => {
    // The journey gate carries recordsChanged; every place that would print a
    // blocker count prints the gate's own reason instead.
    const source = code(runSource);
    expect(source.match(/gate\.recordsChanged/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(source).toMatch(/Locked until the month is worked out again/);
  });

  it('takes canApprove from the API gate, never from a count on the screen', () => {
    expect(code(runSource)).toMatch(/gate\.canApprove/);
    // The button's disabled state derives from the server's gate. It may also
    // read the approval rule (below), but it must never be computed from a
    // count of rows the screen happens to be showing.
    expect(code(runSource)).toMatch(/disabled=\{!gate\.canApprove/);
  });

  /*
   * TWO REASONS THE BUTTON MIGHT NOT WORK, and they are different problems.
   * "This run has problems" is work for the person looking at it; "you are not
   * the one who may approve it" is not, and offering a button the server will
   * refuse wastes a trip through a confirmation dialog to reach a 403.
   */
  it('obeys the approval rule as well as the exception gate, and says which one stopped it', () => {
    expect(code(runSource)).toMatch(/!approval\.youMayApprove/);
    expect(code(runSource)).toMatch(/approval\.whyNot/);
  });

  it('does not call a first-of-two approval a finalisation', () => {
    // A screen that says "finalised" after one of two approvals is how a run
    // gets paid on half the sign-off the clinic asked for.
    expect(code(runSource)).toMatch(/approval\.completesTheRun/);
    expect(code(runSource)).toMatch(/One more is needed/);
  });

  it('refuses to approve a month from a phone', () => {
    // Unchanged guarantee, renamed action: the stage is called Approve on the
    // stage bar, so its copy calls it Approve too. Locking a month's pay needs
    // the whole run in front of the person doing it.
    expect(code(runSource)).toMatch(/canFinaliseHere/);
    expect(code(runSource)).toMatch(/Approving is done on a computer/);
  });

  it('acknowledges the statutory gap explicitly rather than approving quietly', () => {
    expect(code(runSource)).toMatch(/acknowledgeStatutoryGap: provisional/);
  });
});

describe('starting a month', () => {
  /**
   * "Start January 2026 payroll" created the run and stopped. The grid then
   * drew a dash in every cell, RM0.00 in every total and all three employees
   * LEFT OUT — because a run with no lines has nobody in it — and "Continue to
   * review" refused. The only way on was a button called "Save draft", which
   * does not sound like the thing that makes a month appear, while the panel
   * above the start button had already promised that Kuwick would work the
   * payslips out. Found walking a new branch's first January end to end.
   */
  it('works the month out, rather than opening a grid of dashes', () => {
    const source = code(homeSource);
    expect(source).toMatch(/createRun\.mutateAsync/);
    expect(source).toMatch(/calculate\.mutateAsync/);
    // In that order, and not behind a condition the screen decides for itself.
    expect(source.indexOf('createRun.mutateAsync')).toBeLessThan(source.indexOf('calculate.mutateAsync'));
  });
});

describe('the provisional safety indicator', () => {
  it('is on payroll home and on the run, and is not dismissible', () => {
    expect(code(homeSource)).toMatch(/<ProvisionalBanner/);
    expect(code(runSource)).toMatch(/<ProvisionalBanner/);
    expect(code(homeSource)).not.toMatch(/closable|onClose/);
  });
});

describe('counts are not the filter', () => {
  /**
   * The claims page reported "being paid with salary: 0" while claims sat on a
   * payroll run, because the counts were computed from whatever the current tab
   * had fetched. A count that reads zero because of a filter the reader did not
   * apply is worse than no count.
   */
  it('counts every claim, not the ones the current tab fetched', () => {
    /*
     * Piece 3e made this structural rather than careful: the page asks for
     * every claim ONCE and the tab is applied to the rows in memory, so a
     * count cannot be computed from a filtered fetch even by accident. What
     * is pinned here is that shape — the status and the month, which are the
     * things a READER switches, never reaching the query.
     *
     * The BRANCH is not one of those. It scopes the whole screen rather than a
     * tab within it, and it has to reach the query or the server sends other
     * branches' claims down the wire for the page to hide — which is what it
     * did until the branch filter was found to do nothing here. "Every claim"
     * means every claim of the branch being looked at.
     */
    expect(code(claimsSource)).toMatch(/const claims = useStaffClaims\(\{ clinicId \}\)/);
    expect(code(claimsSource)).not.toMatch(/useStaffClaims\(\{[^}]*\bmonth\b/);
    expect(code(claimsSource)).toMatch(/const rows = useMemo\(\(\) => claims\.data \?\? \[\]/);
    expect(code(claimsSource)).not.toMatch(/useStaffClaims\(\{\s*status/);
    expect(code(claimsSource)).toMatch(/const waiting = rows\.filter/);
  });
});

describe('the locum screen never implies payroll', () => {
  it('states the route in words on the page itself', () => {
    expect(code(locumSource)).toMatch(/never payroll/i);
    expect(code(locumSource)).toMatch(/Finance/);
  });

  it('has no statutory columns — a contractor has no EPF, SOCSO or EIS', () => {
    const table = code(locumSource);
    expect(table).not.toMatch(/title: 'EPF/);
    expect(table).not.toMatch(/title: 'SOCSO/);
    expect(table).not.toMatch(/title: 'PCB/);
  });
});

describe('derived figures are corrected upstream, never re-keyed in payroll', () => {
  it('says so on the employee page, beside the figure it explains', () => {
    // A derived figure is not editable here, and the drawer says WHERE it is
    // corrected rather than leaving the reader to guess — the upstream map
    // turns "you cannot edit this" into "edit this in Attendance".
    expect(code(drawerSource)).toMatch(/const UPSTREAM/);
    expect(code(drawerSource)).toMatch(/Edit in \$?\{upstream\.where\}/);
    expect(code(drawerSource)).toMatch(/item\.editable \? null : UPSTREAM\[item\.source\]/);
    // And the provenance the materialiser wrote travels with every derived
    // amount, which is the whole reason the drawer replaced a row expansion.
    expect(code(drawerSource)).toMatch(/item\.provenance/);
  });

  it('sends the owner to the timesheet and the leave record rather than offering an edit', () => {
    expect(code(runSource)).toMatch(/\/admin\/hr\/(attendance|time)/);
    expect(code(runSource)).toMatch(/Open timesheet/);
  });
});
