import { ReactNode } from 'react';

/**
 * THE CONTROL ROW every operational screen carries: period, branch, status,
 * then an export or a primary action on the right.
 *
 * The reference sheet puts the same row in the same place on Attendance,
 * Roster, Leave, Claims, the payroll register and Reports. That consistency is
 * the point: somebody who has learned that the branch filter is second from
 * the left on Attendance should not have to look for it on Claims.
 *
 * It wraps rather than scrolls, and on a narrow screen the right-hand group
 * drops to its own line instead of squeezing the filters into unusability.
 */
export function FilterBar({ children, right }: { children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="kw-filterBar">
      <div className="kw-filterBar__filters">{children}</div>
      {right ? <div className="kw-filterBar__right">{right}</div> : null}
    </div>
  );
}

/** A labelled control. The label is above on desktop and inline on mobile. */
export function Filter({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="kw-filter">
      <span className="kw-filter__label">{label}</span>
      {children}
    </label>
  );
}
