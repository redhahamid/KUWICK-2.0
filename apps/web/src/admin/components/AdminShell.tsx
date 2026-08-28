import { ReactNode } from 'react';
import { Typography } from 'antd';

const { Title, Text } = Typography;

/**
 * THE PAGE FRAME every admin screen sits in.
 *
 * One frame rather than each page inventing its own header, because the five
 * modules have to feel like one product — the brief's first structural
 * requirement — and a shared frame is what makes that true without anybody
 * having to remember a spacing value.
 */
export function AdminShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="kw-admin">
      <header className="kw-admin__head">
        <div className="kw-admin__headText">
          <Title level={4} className="kw-admin__title">
            {title}
          </Title>
          {subtitle ? (
            <Text type="secondary" className="kw-admin__subtitle">
              {subtitle}
            </Text>
          ) : null}
        </div>
        {actions ? <div className="kw-admin__actions">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}

/**
 * A section within a page. Hairline border, no shadow, no card-on-card.
 *
 * The brief is explicit about "no giant gradient cards" and "excessive cards";
 * this is the one container, and it is deliberately quiet so the DATA is what
 * the eye lands on.
 */
export function AdminSection({
  title,
  description,
  actions,
  children,
  padded = true,
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  padded?: boolean;
}) {
  return (
    <section className="kw-adminSection">
      {(title || actions) && (
        <div className="kw-adminSection__head">
          <div>
            {title ? <h3 className="kw-adminSection__title">{title}</h3> : null}
            {description ? <p className="kw-adminSection__desc">{description}</p> : null}
          </div>
          {actions ? <div className="kw-adminSection__actions">{actions}</div> : null}
        </div>
      )}
      <div className={padded ? 'kw-adminSection__body' : 'kw-adminSection__body kw-adminSection__body--flush'}>
        {children}
      </div>
    </section>
  );
}

/**
 * A NOTICE THE SYSTEM OWES THE READER.
 *
 * Used for the sentences this system insists on saying out loud: that a
 * statutory figure was not computed, that a value is potential rather than
 * profit, that a message was prepared rather than sent. They are rendered as a
 * quiet band rather than an alert, because they are permanent facts about the
 * screen rather than problems to dismiss.
 */
export function AdminNotice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return <p className={`kw-adminNotice kw-adminNotice--${tone}`}>{children}</p>;
}
