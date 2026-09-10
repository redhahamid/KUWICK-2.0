// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// Vite's ?raw import gives the file's SOURCE. Several of these guards are about
// what the screens are WIRED to, which rendering alone cannot prove.
import runSource from './PayrollRunPage.tsx?raw';
// The per-person money detail moved out of the run page's two reading steps
// and into the drawer the register opens, so the guards that pin "this screen
// renders the engine and computes nothing" follow it there.
import drawerSource from './PayrollEmployeeDrawer.tsx?raw';
import gridSource from './PayrollGrid.tsx?raw';
import homeSource from './PayrollHomePage.tsx?raw';
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
  it('renders the residual the server derived rather than subtracting to find it', () => {
    /*
     * BASIC + ALLOWANCES + OVERTIME + INCENTIVES + BONUS DOES NOT ALWAYS REACH
     * GROSS. A reimbursed claim and a mileage payment are earnings belonging to
     * none of those five, so a register without the residual is a money table
     * that visibly fails to add up across — the defect two earlier versions of
     * the earnings table had.
     *
     * The register carries the column and the run page fills it from
     * `pay.rows[].otherEarnings`, which the engine worked out from the line's
     * own gross. Neither file subtracts anything to find it.
     */
    expect(code(runSource)).toMatch(/row\.otherEarnings/);
    expect(code(gridSource)).toMatch(/otherEarnings/);
    expect(code(gridSource)).toMatch(/Claims & other/);
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
    expect(code(runSource)).toMatch(/not calculated/);
  });

  it('shows unpaid leave as a reduction of salary, never as an invisible difference', () => {
    // The month-level statement is on the Review stage; the per-person one is
    // in the drawer, beside the figure it explains.
    expect(code(runSource)).toMatch(/Unpaid leave is not a deduction/);
    // And in the drawer it sits with the EARNINGS it reduces, because gross
    // has already absorbed it — listed under Deductions it was a total that
    // never touches net pay.
    expect(code(drawerSource)).toMatch(/Less unpaid leave/);
    expect(code(drawerSource)).toMatch(/wages are smaller, not deducted twice/);
    expect(code(drawerSource)).toMatch(/const deductionTotal = line\.otherDeductions;/);
  });

  it('surfaces a run whose lines do not reach its own totals rather than tidying it up', () => {
    expect(code(runSource)).toMatch(/totals\.addsUp/);
    expect(code(runSource)).toMatch(/totals\.discrepancy/);
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
  it('reads the API delta rather than recomputing it from two numbers on screen', () => {
    expect(code(runSource)).toMatch(/line\.deltaCents/);
    // The mockup defect: a comparison month carrying the current month's totals.
    expect(code(runSource)).not.toMatch(/currentCents\s*-\s*previousCents/);
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

  it('refuses to finalise from a phone', () => {
    expect(code(runSource)).toMatch(/canFinaliseHere/);
    expect(code(runSource)).toMatch(/Finalising is done on a computer/);
  });

  it('acknowledges the statutory gap explicitly rather than approving quietly', () => {
    expect(code(runSource)).toMatch(/acknowledgeStatutoryGap: provisional/);
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
    expect(code(claimsSource)).toMatch(/const everyClaim = useStaffClaims\(\{\}\)/);
    expect(code(claimsSource)).toMatch(/const all = everyClaim\.data \?\? \[\]/);
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
  it('says so on the employee drawer, beside the figure it explains', () => {
    expect(code(drawerSource)).toMatch(/Corrected where it was recorded, not here/);
    // And the provenance the materialiser wrote travels with every derived
    // amount, which is the whole reason the drawer replaced a row expansion.
    expect(code(drawerSource)).toMatch(/item\.provenance/);
  });

  it('sends the owner to the timesheet and the leave record rather than offering an edit', () => {
    expect(code(runSource)).toMatch(/\/admin\/hr\/(attendance|time)/);
    expect(code(runSource)).toMatch(/Open timesheet/);
  });
});
