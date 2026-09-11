import type { ReactNode } from 'react';

/**
 * One figure, said once.
 *
 * `tone` is for the figure that needs a person to look at it — gold for
 * waiting, red for blocking, teal for money in hand. A figure with nothing
 * wrong with it stays ink-coloured, so the coloured ones mean something.
 */
export type StatTone = 'plain' | 'gold' | 'red' | 'teal';

export function StatCard({
  label,
  value,
  sub,
  tone = 'plain',
  icon,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  icon?: ReactNode;
}) {
  return (
    <div className="hr-stat">
      <div className="hr-stat__label">
        {icon}
        {label}
      </div>
      <div className={tone === 'plain' ? 'hr-stat__value' : `hr-stat__value hr-stat__value--${tone}`}>{value}</div>
      {sub ? <div className="hr-stat__sub">{sub}</div> : null}
    </div>
  );
}

/** Four across on a desktop, two on a tablet. */
export function StatRow({ children }: { children: ReactNode }) {
  return <div className="hr-stats">{children}</div>;
}
