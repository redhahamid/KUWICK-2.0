import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Alert } from 'antd';

/**
 * A PAGE INSIDE THE HR MODULE.
 *
 * `AdminShell` does this job for the other four modules and for the HR screens
 * that have not moved to Slate yet. It is not restyled in place: twenty-three
 * screens outside HR draw themselves with it, and repainting those is exactly
 * what this piece of work is not allowed to do. So HR gets its own, and the
 * two live side by side until the last HR screen has moved.
 */
export function HrPage({
  title,
  sub,
  actions,
  crumb,
  error,
  helpTo = '/admin/hr/help',
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** "Settings / Payroll items" — drawn above the title, where the mockups put it. */
  crumb?: ReactNode;
  error?: string | null;
  /**
   * WHERE "HELP" GOES, or `null` for a page that has no guide yet.
   *
   * Defaulted to HR's guide because HR is every current caller. Panel reuses
   * this kit (owner decision, 3 November 2026) and has no guide written, and a
   * Help button landing on the HR guide from a panel claim screen is worse
   * than no button: it reads as a wrong link rather than as a missing page.
   */
  helpTo?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      {crumb ? <div className="hr-crumb">{crumb}</div> : null}
      <div className="hr-pageHead">
        <div>
          {/* `kw-admin__title` is the hook the browser walk finds a page's title
              by. It carries no styling here — the old rule only binds with
              `.ant-typography` beside it — so the name is borrowed, not the look. */}
          <h1 className="kw-admin__title">{title}</h1>
          {sub ? <div className="hr-sub">{sub}</div> : null}
        </div>
        <div className="hr-pageHead__actions">
          {actions}
          {/* Help on every HR page: the owner/HR guide (testing, 15 October 2026). */}
          {helpTo ? (
            <Link to={helpTo} className="hr-btn hr-btn--ghost hr-helpLink">
              Help
            </Link>
          ) : null}
        </div>
      </div>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} /> : null}
      {children}
    </>
  );
}
