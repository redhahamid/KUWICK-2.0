import { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * THE WORKSPACE PANEL — the card the reference sheet's Overview is built from.
 *
 * `AdminSection` is the page-level container: a full-bleed band with a grey
 * head, used for one big thing (a table, a form). A Panel is smaller and sits
 * in a grid with three siblings, so its head is lighter and it can carry a
 * "see all" link on the right rather than a button.
 *
 * They share the same border, radius and surface tokens deliberately. Two
 * container treatments is the most a module can carry before the reader stops
 * being able to tell which level of the page they are looking at.
 */
export function Panel({
  title,
  hint,
  action,
  children,
  padded = true,
  tone,
  footer,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  /** Top-right. A link or a small button — never a primary action. */
  action?: ReactNode;
  children: ReactNode;
  padded?: boolean;
  /** A left edge, for a panel whose whole subject is a problem. */
  tone?: 'attention' | 'blocked' | 'ok';
  footer?: ReactNode;
}) {
  return (
    <section className={`kw-panel${tone ? ` kw-panel--${tone}` : ''}`}>
      {title || action ? (
        <header className="kw-panel__head">
          <div className="kw-panel__headText">
            <h3 className="kw-panel__title">{title}</h3>
            {hint ? <p className="kw-panel__hint">{hint}</p> : null}
          </div>
          {action ? <div className="kw-panel__action">{action}</div> : null}
        </header>
      ) : null}
      <div className={padded ? 'kw-panel__body' : 'kw-panel__body kw-panel__body--flush'}>{children}</div>
      {footer ? <footer className="kw-panel__foot">{footer}</footer> : null}
    </section>
  );
}

/** The quiet "see all →" a panel head carries instead of a button. */
export function PanelLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link className="kw-panel__link" to={to}>
      {children} <span aria-hidden>→</span>
    </Link>
  );
}

/**
 * LABEL AND VALUE, in the two-column shape the employee profile is made of.
 *
 * A missing value renders "—" rather than being omitted, because a profile
 * card that silently drops the fields nobody filled in is a card that cannot
 * be used to find out what is missing — which is most of what an HR profile
 * is opened for.
 */
export function DefinitionList({
  items,
  columns = 2,
}: {
  items: { label: ReactNode; value: ReactNode; span?: boolean }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl className={`kw-defs kw-defs--${columns}`}>
      {items.map((item, index) => (
        <div key={index} className={item.span ? 'kw-defs__pair kw-defs__pair--span' : 'kw-defs__pair'}>
          <dt>{item.label}</dt>
          <dd>{item.value === null || item.value === undefined || item.value === '' ? <span className="kw-muted">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * ONE EMPTY STATE for the module.
 *
 * A title that says what is absent, one line saying whether that is good or
 * unfinished, and — where there is one — the action that fills it. antd's
 * default `Empty` says "No data", which does not distinguish "nobody is on
 * leave today" from "this failed to load".
 */
export function EmptyState({ title, hint, action }: { title: ReactNode; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="kw-empty">
      <p className="kw-empty__title">{title}</p>
      {hint ? <p className="kw-empty__hint">{hint}</p> : null}
      {action ? <div className="kw-empty__action">{action}</div> : null}
    </div>
  );
}

/**
 * A ROW INSIDE A PANEL — the list shape used by Today's Workforce, Leave This
 * Week, Needs Attention and Recent Activity.
 *
 * These are lists, not tables: four columns of headers above six rows costs
 * more than it explains. A row is a leading element, a stack of two lines, and
 * something on the right.
 */
export function PanelRow({
  lead,
  title,
  meta,
  right,
  onClick,
  to,
}: {
  lead?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  to?: string;
}) {
  const inner = (
    <>
      {lead ? <div className="kw-panelRow__lead">{lead}</div> : null}
      <div className="kw-panelRow__text">
        <span className="kw-panelRow__title">{title}</span>
        {meta ? <span className="kw-panelRow__meta">{meta}</span> : null}
      </div>
      {right ? <div className="kw-panelRow__right">{right}</div> : null}
    </>
  );
  if (to) {
    return (
      <Link className="kw-panelRow kw-panelRow--clickable" to={to}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" className="kw-panelRow kw-panelRow--clickable" onClick={onClick}>
        {inner}
      </button>
    );
  }
  return <div className="kw-panelRow">{inner}</div>;
}

export function PanelList({ children }: { children: ReactNode }) {
  return <div className="kw-panelList">{children}</div>;
}
