// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
// Vite's ?raw import gives the file's SOURCE. Several of these guards are about
// what the screens are WIRED to, which rendering alone cannot prove.
import runSource from './PayrollRunPage.tsx?raw';
import homeSource from './PayrollHomePage.tsx?raw';
import claimsSource from './ClaimsPage.tsx?raw';
import locumSource from './LocumPage.tsx?raw';
import { STEPS, stepsWithProblems } from './PayrollStepper';
import { money, ringgit, group } from '../components/DataTable';

/** Comments name the defects deliberately; a guard must not read them as code. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('the six-step journey', () => {
  it('is the six steps the owner approved, in order', () => {
    expect(STEPS.map((step) => step.key)).toEqual([
      'employees', 'attendance', 'earnings', 'deductions', 'review', 'approve',
    ]);
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

describe('the earnings table cannot fail to add up', () => {
  /**
   * Two earlier versions of this table were wrong in the same way: columns
   * that did not reach their own row total. The fix is a RESIDUAL last
   * addition column, so this asserts the residual is still computed from gross
   * rather than from a named list of components.
   */
  it('derives the last addition column as the residual of gross', () => {
    expect(code(runSource)).toMatch(/gross - salaryEarned - allowances - overtime - incentive/);
  });

  it('takes its figures from the payslip fields, not from a re-derivation of the input rows', () => {
    expect(code(runSource)).toMatch(/Number\(row\.grossPay\)/);
    expect(code(runSource)).toMatch(/Number\(row\.allowances\)/);
  });

  it('shows unpaid leave as a reduction of salary, never as an invisible difference', () => {
    expect(code(runSource)).toMatch(/salaryEarned = Number\(row\.basicSalary\) - unpaid/);
    expect(code(runSource)).toMatch(/unpaid leave/);
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
    expect(steps.has('employees')).toBe(true);
    expect(steps.has('deductions')).toBe(true);
    // A warning does not block, so it does not take a tick away.
    expect(steps.has('attendance')).toBe(false);
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
  it('says so on the earnings drill-down', () => {
    expect(code(runSource)).toMatch(/Corrected where it was recorded, not here/);
  });

  it('sends the owner to the timesheet and the leave record rather than offering an edit', () => {
    expect(code(runSource)).toMatch(/\/admin\/hr\/attendance/);
    expect(code(runSource)).toMatch(/Open timesheet/);
  });
});
