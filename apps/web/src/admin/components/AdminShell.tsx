import { ReactNode } from 'react';
import { Alert, Typography } from 'antd';

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
  error,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /**
   * The first failed query on this page, from `firstError(...)` below.
   *
   * NOT optional in spirit, only in types. A finance screen whose query 404s
   * and renders RM0.00 tells the reader everything is settled, which is worse
   * than telling them nothing — it is the one failure mode that gets acted on.
   * Every page in the five modules passes this.
   */
  error?: unknown;
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
      {error ? (
        <Alert
          type="error"
          showIcon
          className="kw-adminError"
          message="This page could not load its figures"
          description={
            <>
              {errorMessage(error)}
              <br />
              Every number below is missing rather than zero. Do not read this screen as a result.
            </>
          }
        />
      ) : null}
      {children}
    </div>
  );
}

/**
 * The first error among a page's queries, or undefined.
 *
 * A page runs three to six queries and any one of them failing makes the whole
 * screen untrustworthy, so they are reported together rather than each pretending
 * independently that it has an answer.
 */
export function firstError(...queries: { isError?: boolean; error?: unknown }[]): unknown {
  return queries.find((query) => query?.isError)?.error;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = String((error as { message?: unknown }).message ?? '').trim();
    if (message) return message;
  }
  return 'The server did not return an answer.';
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
  // A DIV, not a P. Several notices carry a LIST — the payroll exceptions that
  // block approval, named one per line — and a <ul> inside a <p> is invalid
  // HTML that React reports as an error on every render. The browser then
  // closes the paragraph early and the list escapes the band it is supposed to
  // sit in, so the markup mattered visually as well as in the console.
  return <div className={`kw-adminNotice kw-adminNotice--${tone}`}>{children}</div>;
}
