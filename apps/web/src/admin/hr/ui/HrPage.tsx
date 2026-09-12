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
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** "Settings / Payroll items" — drawn above the title, where the mockups put it. */
  crumb?: ReactNode;
  error?: string | null;
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
        {actions ? <div className="hr-pageHead__actions">{actions}</div> : null}
      </div>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} /> : null}
      {children}
    </>
  );
}
