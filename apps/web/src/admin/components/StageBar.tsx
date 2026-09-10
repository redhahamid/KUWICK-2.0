import { ReactNode } from 'react';

/**
 * NUMBERED STAGES — the "1 Payroll Details · 2 Review · 3 Approve · 4 Finalise"
 * strip from the reference sheet, and the same component behind Add Employee's
 * four stages.
 *
 * antd's `Steps` was what these screens used, and it is the wrong shape twice
 * over: it spends about 90px of vertical space on four words, and its "finish"
 * state is a tick that looks identical whether the stage was completed or
 * skipped. This is a single 40px row where the current stage is filled, done
 * stages are quiet with a tick, and future stages are outlined.
 *
 * A stage is CLICKABLE only when `onSelect` is given. Payroll's stages are
 * reachable backwards (you may re-read Review after approving) but not
 * forwards past work that has not happened, and that rule belongs to the
 * screen, not to the strip.
 */
export interface Stage {
  key: string;
  label: string;
  /** A word under the label — "6 employees", "3 blockers". */
  hint?: ReactNode;
  done?: boolean;
  /** Carries something that needs sorting. Drawn amber, and readable when the
      hint is hidden at narrow widths. */
  attention?: boolean;
  onSelect?: () => void;
  /** Greyed and unclickable, with the reason on hover. */
  disabledReason?: string;
}

export function StageBar({ stages, current }: { stages: Stage[]; current: string }) {
  return (
    <ol className="kw-stages" aria-label="Progress">
      {stages.map((stage, index) => {
        const active = stage.key === current;
        const state = active ? 'active' : stage.done ? 'done' : 'todo';
        const attention = stage.attention ? ' kw-stage--attention' : '';
        const clickable = Boolean(stage.onSelect) && !stage.disabledReason && !active;
        const Element = clickable ? 'button' : 'div';
        return (
          <li key={stage.key} className={`kw-stage kw-stage--${state}${attention}`}>
            <Element
              {...(clickable ? { type: 'button' as const, onClick: stage.onSelect } : {})}
              className="kw-stage__button"
              title={stage.disabledReason}
              aria-current={active ? 'step' : undefined}
            >
              <span className="kw-stage__num">{stage.done && !active ? '✓' : index + 1}</span>
              <span className="kw-stage__text">
                <span className="kw-stage__label">{stage.label}</span>
                {stage.hint ? <span className="kw-stage__hint">{stage.hint}</span> : null}
              </span>
            </Element>
          </li>
        );
      })}
    </ol>
  );
}
