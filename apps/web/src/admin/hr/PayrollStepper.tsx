export type StepKey = 'employees' | 'attendance' | 'earnings' | 'deductions' | 'review' | 'approve';

export const STEPS: { key: StepKey; label: string; heading: string; blurb: string }[] = [
  {
    key: 'employees',
    label: 'Employees',
    heading: 'Who is being paid',
    blurb: 'Who is included, who joined, who left, and whose setup is not finished.',
  },
  {
    key: 'attendance',
    label: 'Attendance & leave',
    heading: 'What people worked',
    blurb: 'What people worked this month, and anything still waiting on a manager.',
  },
  {
    key: 'earnings',
    label: 'Earnings',
    heading: 'What each person earns',
    blurb: 'Salary, allowances, overtime, incentives and approved claims.',
  },
  {
    key: 'deductions',
    label: 'Deductions',
    heading: 'What comes off',
    blurb: 'Statutory contributions, monthly tax, and anything the clinic is recovering.',
  },
  {
    key: 'review',
    label: 'Review',
    heading: 'Review',
    blurb: 'The whole month in three numbers, and everything still standing in the way.',
  },
  {
    key: 'approve',
    label: 'Approve',
    heading: 'Approve & finalise',
    blurb: 'What you are signing off, and what happens when you do.',
  },
];

/**
 * WHICH STEP EACH BLOCKER BELONGS TO.
 *
 * The exception's own code decides, so the stepper and the Review screen can
 * never disagree about where a problem lives. Anything unrecognised lands on
 * Review, which is where everything is listed anyway — an unmapped code must
 * not vanish from the stepper.
 */
const STEP_OF_CODE: Record<string, StepKey> = {
  NO_SALARY: 'employees',
  SALARY_CHANGED_MID_PERIOD: 'employees',
  SALARY_BASIS_UNSUPPORTED: 'employees',
  NO_DOB: 'employees',
  NO_LEGAL_EMPLOYER: 'employees',
  UNAPPROVED_OVERTIME: 'attendance',
  MISSING_PUNCH: 'attendance',
  UNKNOWN_COMPONENT: 'earnings',
  PCB_MISSING: 'deductions',
  STATUTORY_BAND_GAP: 'deductions',
};

export function stepsWithProblems(
  attention: { code: string; blocksApproval: boolean }[],
): Set<StepKey> {
  const steps = new Set<StepKey>();
  for (const item of attention) {
    if (!item.blocksApproval) continue;
    steps.add(STEP_OF_CODE[item.code] ?? 'review');
  }
  return steps;
}

/**
 * THE SIX STEPS.
 *
 * Every step a clinic owner can see at once. A stepper rather than tabs
 * because the order is real: earnings cannot be reviewed before attendance is
 * settled, and a tab strip says otherwise.
 *
 * A TICK MEANS SETTLED, NOT VISITED.
 *
 * It used to mean "behind where you are", which put a green tick beside
 * Employees while somebody on that step had no salary on file, and beside
 * Review while four things were blocking the run. A tick is the strongest
 * "this is fine" a screen has; spending it on "you have scrolled past this"
 * is how the design review's own mockups ended up showing a row of green
 * ticks over a run that could not be paid. A step someone has passed that
 * still holds a blocker is marked as needing attention instead.
 *
 * Steps are NOT locked. An owner who wants to look ahead at Review before
 * settling the timesheet should be able to; what stops them finalising is the
 * approval gate, not a disabled tab. Locking navigation to enforce a rule the
 * gate already enforces just makes the product feel like it distrusts them.
 */
export function PayrollStepper({
  current,
  onChange,
  problemSteps,
}: {
  current: StepKey;
  onChange: (key: StepKey) => void;
  /** Steps carrying something that blocks approval. Omitted = nothing known. */
  problemSteps?: Set<StepKey>;
}) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);

  return (
    <nav className="kw-stepper" aria-label="Payroll steps">
      {STEPS.map((step, index) => {
        const behind = index < currentIndex;
        const active = index === currentIndex;
        const blocked = problemSteps?.has(step.key) ?? false;
        const done = behind && !blocked;
        return (
          <button
            key={step.key}
            type="button"
            className={
              `kw-stepper__step${active ? ' kw-stepper__step--active' : ''}` +
              `${done ? ' kw-stepper__step--done' : ''}` +
              `${blocked ? ' kw-stepper__step--blocked' : ''}`
            }
            aria-current={active ? 'step' : undefined}
            aria-label={blocked ? `${step.label} — needs attention` : step.label}
            onClick={() => onChange(step.key)}
          >
            <span className="kw-stepper__mark">
              {blocked ? (
                '!'
              ) : done ? (
                <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
                  <path d="M5 10.5 8.5 14 15 6.5" />
                </svg>
              ) : (
                index + 1
              )}
            </span>
            <span className="kw-stepper__label">{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
