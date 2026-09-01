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
 * THE SIX STEPS.
 *
 * Every step a clinic owner can see at once, with the ones behind them ticked.
 * A stepper rather than tabs because the order is real: earnings cannot be
 * reviewed before attendance is settled, and a tab strip says otherwise.
 *
 * Steps are NOT locked. An owner who wants to look ahead at Review before
 * settling the timesheet should be able to; what stops them finalising is the
 * approval gate, not a disabled tab. Locking navigation to enforce a rule the
 * gate already enforces just makes the product feel like it distrusts them.
 */
export function PayrollStepper({
  current,
  onChange,
}: {
  current: StepKey;
  onChange: (key: StepKey) => void;
}) {
  const currentIndex = STEPS.findIndex((step) => step.key === current);

  return (
    <nav className="kw-stepper" aria-label="Payroll steps">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <button
            key={step.key}
            type="button"
            className={`kw-stepper__step${active ? ' kw-stepper__step--active' : ''}${done ? ' kw-stepper__step--done' : ''}`}
            aria-current={active ? 'step' : undefined}
            onClick={() => onChange(step.key)}
          >
            <span className="kw-stepper__mark">
              {done ? (
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
