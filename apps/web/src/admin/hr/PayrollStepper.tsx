import { StageBar } from '../components/StageBar';

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
    // THE REFERENCE SHEET'S NAMES, where the domain does not contradict them:
    // Payroll Details · Review · Approve · Finalise. "Prepare" and "Complete"
    // were mine; these are the words a payroll clerk already uses.
    label: 'Payroll Details',
    heading: 'The month, employee by employee',
    blurb: 'Every figure that makes up every payslip. Open a row for one person’s detail.',
  },
  {
    key: 'review',
    label: 'Review',
    heading: 'What needs looking at',
    blurb: 'What blocks this run, what is worth a look, and what the month adds up to.',
  },
  {
    key: 'approve',
    label: 'Approve',
    heading: 'Approve the month',
    blurb: 'What you are signing off, and what happens when you do.',
  },
  {
    key: 'complete',
    label: 'Finalise',
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
 * THE FOUR STAGES, on the shared stage strip.
 *
 * It had its own bespoke stepper markup, which meant payroll's stages and Add
 * Employee's stages looked like two different products doing the same thing.
 * `StageBar` is one component and one set of styles; what stays here is the
 * only thing payroll knows that the strip does not — which stage is carrying a
 * blocker.
 *
 * A TICK MEANS SETTLED, NOT VISITED.
 *
 * It used to mean "behind where you are", which put a green tick beside
 * Payroll Details while somebody on that stage had no salary on file. A tick
 * is the strongest "this is fine" a screen has; spending it on "you have
 * scrolled past this" is how a row of green ticks ends up over a run that
 * cannot be paid.
 *
 * Stages are NOT locked. An owner who wants to look ahead should be able to;
 * what stops them finalising is the approval gate, not a disabled tab.
 */
export function PayrollStepper({
  current,
  onChange,
  problemSteps,
}: {
  current: StepKey;
  onChange: (key: StepKey) => void;
  /** Stages carrying something that blocks approval. Omitted = nothing known. */
  problemSteps?: Set<StepKey>;
}) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);

  return (
    <StageBar
      current={current}
      stages={STEPS.map((step, index) => {
        const blocked = problemSteps?.has(step.key) ?? false;
        return {
          key: step.key,
          label: step.label,
          hint: blocked ? 'Needs attention' : undefined,
          attention: blocked,
          done: index < currentIndex && !blocked,
          onSelect: () => onChange(step.key),
        };
      })}
    />
  );
}
