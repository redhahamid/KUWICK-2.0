import type { ReactNode } from 'react';

/** A white card with a hairline and the kit's one shadow. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={className ? `hr-panel ${className}` : 'hr-panel'}>{children}</section>;
}

/**
 * The panel's own heading row: what this is, one sentence about it, and
 * whatever you can do to it — pushed right so the sentence keeps its width.
 */
export function PanelHead({
  title,
  sub,
  actions,
  rule,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  /** A hairline above: the second and later sections of one panel. */
  rule?: boolean;
}) {
  return (
    <div className={rule ? 'hr-panelHead hr-panelHead--rule' : 'hr-panelHead'}>
      <div>
        <h2>{title}</h2>
        {sub ? <div className="hr-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="hr-panelHead__actions">{actions}</div> : null}
    </div>
  );
}
