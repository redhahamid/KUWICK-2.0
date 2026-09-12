import type { ReactNode } from 'react';
import { Steps } from './ui';

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
 * approve it, pay it — the words payroll.html uses. The earnings and
 * deductions detail did not go anywhere: it is on each person's own payroll
 * page, next to the figure it explains, which is where somebody asks.
 *
 * The old keys still resolve (see `normaliseStep`) because links to
 * `?step=earnings` are in exception remedies and in the guide.
 */
export const STEPS: { key: StepKey; label: string; heading: string; blurb: string }[] = [
  {
    key: 'prepare',
    label: 'Prepare',
    heading: 'The month, employee by employee',
    blurb: 'Grey cells come from records or are worked out for you; white cells you can edit. Save each row.',
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
    blurb: 'What you are signing off, and what happens when you do. Approving locks the month.',
  },
  {
    key: 'complete',
    label: 'Pay',
    heading: 'Bank listing and payslips',
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
    case 'pay':
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
  NO_STATUTORY_CLASSIFICATION: 'prepare',
  NO_REST_DAY: 'prepare',
  OVERTIME_ENTITLEMENT_UNRECORDED: 'prepare',
  CLINIC_RATE_BELOW_STATUTORY: 'prepare',
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
 * THE FOUR STAGES, on the kit's step strip (payroll.html).
 *
 * A TICK MEANS SETTLED, NOT VISITED. It used to mean "behind where you are",
 * which put a green tick beside the register while somebody on it had no
 * salary on file. A tick is the strongest "this is fine" a screen has;
 * spending it on "you have scrolled past this" is how a row of green ticks
 * ends up over a run that cannot be paid. Each stage answers its own
 * question:
 *
 *   Prepare   the month has been worked out and nothing here blocks
 *   Review    nothing at all blocks approval
 *   Approve   the run is actually approved
 *   Pay       it has been paid
 *
 * Stages are NOT locked. An owner who wants to look ahead should be able to;
 * what stops them approving is the gate, not a disabled tab.
 */
export function PayrollStepper({
  current,
  onChange,
  problemSteps,
  status,
  canApprove,
  subs,
}: {
  current: StepKey;
  onChange: (key: StepKey) => void;
  /** Stages carrying something that blocks approval. Omitted = nothing known. */
  problemSteps?: Set<StepKey>;
  /** The run's own status — what "approved" and "paid" actually mean. */
  status?: string;
  /** Whether the approval gate is open. */
  canApprove?: boolean;
  /** The line under each stage's name: "2 blocked, 1 to check", "Locks the month". */
  subs?: Partial<Record<StepKey, ReactNode>>;
}) {
  const approved = status === 'APPROVED' || status === 'PAID';
  const isDone = (key: StepKey, blocked: boolean): boolean => {
    switch (key) {
      case 'prepare':
        return !blocked && status !== undefined && status !== 'DRAFT';
      case 'review':
        return canApprove === true;
      case 'approve':
        return approved;
      case 'complete':
        return status === 'PAID';
    }
  };

  return (
    <Steps
      current={current}
      onSelect={(key) => onChange(key as StepKey)}
      steps={STEPS.map((step) => {
        const blocked = problemSteps?.has(step.key) ?? false;
        return {
          key: step.key,
          label: step.label,
          sub: subs?.[step.key] ?? (blocked ? 'Needs attention' : undefined),
          done: isDone(step.key, blocked),
        };
      })}
    />
  );
}
