export type StepKey = 'prepare' | 'review' | 'approve' | 'complete';

/**
 * FOUR STAGES, NOT SIX STEPS.
 *
 * This was Employees · Attendance & leave · Earnings · Deductions · Review ·
 * Approve, and each one was a screen the owner had to walk through to reach
 * the next. Four of the six were READING screens — they showed figures the
 * engine had already worked out, asked for nothing, and existed because the
 * domain has four kinds of input. Somebody paying five people clicked through
 * four pages that wanted nothing from them.
 *
 * The stages below are the decisions instead: get it ready, look at it,
 * approve it, finish it. The earnings and deductions detail did not go
 * anywhere — it is under the register's own rows, next to the figure it
 * explains, which is where somebody asks the question.
 *
 * The old keys still resolve (see `normaliseStep`) because links to
 * `?step=earnings` are in exception remedies and in the guide.
 */
export const STEPS: { key: StepKey; label: string; heading: string; blurb: string }[] = [
  {
    key: 'prepare',
    label: 'Prepare',
    heading: 'Getting the month ready',
    blurb: 'Who is being paid, what they worked, and anything still waiting on somebody.',
  },
  {
    key: 'review',
    label: 'Review payroll',
    heading: 'The month, employee by employee',
    blurb: 'Every figure that makes up every payslip. Open a row to see where each amount came from.',
  },
  {
    key: 'approve',
    label: 'Approve',
    heading: 'Approve & finalise',
    blurb: 'What you are signing off, and what happens when you do.',
  },
  {
    key: 'complete',
    label: 'Complete',
    heading: 'Payslips and payment',
    blurb: 'Payslips, the payment listing, and the statutory figures to file.',
  },
];

/**
 * The six-step vocabulary, mapped onto the four stages.
 *
 * Anything unrecognised lands on Prepare rather than throwing somebody into a
 * blank screen.
 */
export function normaliseStep(raw: string | null): StepKey {
  switch (raw) {
    case 'prepare':
    case 'employees':
    case 'attendance':
      return 'prepare';
    case 'review':
    case 'earnings':
    case 'deductions':
      return 'review';
    case 'approve':
      return 'approve';
    case 'complete':
      return 'complete';
    default:
      return 'prepare';
  }
}

/**
 * WHICH STEP EACH BLOCKER BELONGS TO.
 *
 * The exception's own code decides, so the stepper and the Review screen can
 * never disagree about where a problem lives. Anything unrecognised lands on
 * Review, which is where everything is listed anyway — an unmapped code must
 * not vanish from the stepper.
 */
const STEP_OF_CODE: Record<string, StepKey> = {
  // Everything that has to be SORTED OUT before the month is worth reading is
  // Prepare; everything that is a judgement about the figures themselves is
  // Review. That is the whole division now the six became four.
  NO_SALARY: 'prepare',
  SALARY_CHANGED_MID_PERIOD: 'prepare',
  SALARY_BASIS_UNSUPPORTED: 'prepare',
  NO_DOB: 'prepare',
  NO_LEGAL_EMPLOYER: 'prepare',
  UNAPPROVED_OVERTIME: 'prepare',
  MISSING_PUNCH: 'prepare',
  UNKNOWN_COMPONENT: 'review',
  PCB_MISSING: 'review',
  STATUTORY_UNKNOWN: 'review',
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
