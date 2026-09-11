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
  error,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <>
      <div className="hr-pageHead">
        <div>
          <h1>{title}</h1>
          {sub ? <div className="hr-sub">{sub}</div> : null}
        </div>
        {actions ? <div className="hr-pageHead__actions">{actions}</div> : null}
      </div>
      {error ? <Alert type="error" showIcon message={error} style={{ marginBottom: 18 }} /> : null}
      {children}
    </>
  );
}
