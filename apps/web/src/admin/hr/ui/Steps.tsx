import type { ReactNode } from 'react';

/**
 * WHERE THIS RUN IS, AND WHAT IS LEFT.
 *
 * A step is DONE when it has been finished, CURRENT when you are standing in
 * it, and neither otherwise — never "done because a later step is open". That
 * distinction is the whole point: a green tick against Approve on an
 * unapproved run is a lie about money.
 */
export type Step = { key: string; label: string; sub?: ReactNode; done: boolean };

export function Steps({
  steps,
  current,
  onSelect,
}: {
  steps: Step[];
  current: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <div className="hr-steps">
      {steps.map((step, index) => {
        const state = step.key === current ? ' is-current' : step.done ? ' is-done' : '';
        return (
          <button
            key={step.key}
            type="button"
            className={`hr-step${state}`}
            aria-current={step.key === current ? 'step' : undefined}
            disabled={!onSelect}
            onClick={() => onSelect?.(step.key)}
          >
            <span className="hr-step__mark">{step.done ? '✓' : index + 1}</span>
            <span>
              <b>{step.label}</b>
              {step.sub ? <small>{step.sub}</small> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
