import { Link } from 'react-router-dom';

/**
 * THE ONE SAFETY INDICATOR.
 *
 * The owner rejected the giant red and yellow warning walls that used to open
 * every payroll screen, and was equally clear that the gate itself must not be
 * weakened: a run whose statutory rates nobody has checked is not something to
 * pay staff with, and must never be shown as a plain green APPROVED.
 *
 * Those two requirements meet here. One line, non-dismissible, on every payroll
 * surface — and the rest of the honesty lives where it changes a decision: the
 * status tag reads APPROVED · PROVISIONAL, and the finalise step says in full
 * what has not been checked. Repeating the paragraph on six screens is what
 * taught people to scroll past it.
 */
export function ProvisionalBanner({ statutoryStatus }: { statutoryStatus?: string | null }) {
  if (statutoryStatus === 'CONFIGURED') return null;

  return (
    <div className="kw-provisional" role="status">
      <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <circle cx="10" cy="10" r="7.5" />
        <path d="M10 6.4v4.4M10 13.7v.2" />
      </svg>
      <span>
        <strong>Payroll statutory setup is not yet production-ready.</strong> This clinic must not be used to pay staff
        or file a return.
      </span>
      <Link to="/admin/hr/settings" className="kw-provisional__link">
        What is outstanding
      </Link>
    </div>
  );
}
