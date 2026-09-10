import { ReactNode } from 'react';
import type { PayrollReadinessItem } from '../types';

/**
 * PAYROLL READINESS, AS SENTENCES.
 *
 * The rule this exists to enforce, in the brief's own words: never show a user
 * a cryptic 5/8 without explaining what is missing. "Setup 5/8" tells somebody
 * they have a problem and nothing about what it is, which is most of the way
 * to not fixing it — and the information was there the whole time, because the
 * readiness read already returns a plain-English label per item.
 *
 * BLOCKING AND ADVISORY ARE DRAWN DIFFERENTLY. They are different facts: one
 * stops the pay run, the other is worth knowing. Rendering them with the same
 * red cross is how a screen teaches somebody to ignore its red crosses.
 *
 * Done items stay VISIBLE. A checklist that hides what it has ticked cannot be
 * used to confirm that something was done, only that it was not.
 */
export function ReadinessList({
  items,
  onFix,
  max,
}: {
  items: PayrollReadinessItem[];
  /** Where to send somebody to fix one. Omitted where this is a read-only view. */
  onFix?: (item: PayrollReadinessItem) => void;
  /** Show only the first N outstanding, for a panel with a "see all". */
  max?: number;
}) {
  // OUTSTANDING FIRST, BLOCKING BEFORE ADVISORY. What is left to do is the
  // subject; what is done is the reassurance underneath it.
  const ordered = [...items].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.severity !== b.severity) return a.severity === 'BLOCKING' ? -1 : 1;
    return 0;
  });
  const shown = max ? ordered.slice(0, max) : ordered;
  const hidden = ordered.length - shown.length;

  return (
    <ul className="kw-readiness">
      {shown.map((item) => {
        const state = item.done ? 'done' : item.severity === 'BLOCKING' ? 'blocked' : 'advisory';
        return (
          <li key={item.key} className={`kw-readinessItem kw-readinessItem--${state}`}>
            <span className="kw-readinessItem__mark" aria-hidden>
              {item.done ? '✓' : item.severity === 'BLOCKING' ? '✕' : '!'}
            </span>
            <span className="kw-readinessItem__text">
              <span className="kw-readinessItem__label">{item.label}</span>
              {!item.done && item.detail ? (
                <span className="kw-readinessItem__detail">{item.detail}</span>
              ) : null}
            </span>
            {!item.done && onFix ? (
              <button type="button" className="kw-readinessItem__fix" onClick={() => onFix(item)}>
                Fix
              </button>
            ) : null}
          </li>
        );
      })}
      {hidden > 0 ? <li className="kw-readinessItem kw-readinessItem--more">and {hidden} more</li> : null}
    </ul>
  );
}

/**
 * THE ONE-LINE SUMMARY that sits beside a name in a table.
 *
 * Still a count, because a table cell cannot carry eight sentences — but the
 * sentences travel with it as the tooltip, so the count is never the only
 * thing on offer. Where the reader has room, use `ReadinessList` instead.
 */
export function readinessSummary(readiness: {
  done: number;
  total: number;
  ready: boolean;
  items: PayrollReadinessItem[];
}): { label: string; tone: 'ok' | 'attention' | 'blocked'; missing: string[] } {
  const missing = readiness.items.filter((item) => !item.done);
  if (readiness.ready) return { label: 'Ready', tone: 'ok', missing: missing.map((item) => item.label) };
  const blockers = missing.filter((item) => item.severity === 'BLOCKING');
  if (blockers.length > 0) {
    return {
      /*
       * WHAT IS MISSING, NOT HOW MUCH — and said as an absence.
       *
       * The readiness labels are noun phrases ("Salary", "Bank account"), so a
       * chip carrying one bare read as though salary were the STATUS. The word
       * "Missing" is what turns the label back into the fact it describes.
       */
      label: blockers.length === 1 ? `Missing: ${blockers[0].label}` : `${blockers.length} to fix`,
      tone: 'blocked',
      missing: missing.map((item) => item.label),
    };
  }
  return {
    label: missing.length === 1 ? `Check: ${missing[0].label}` : `${missing.length} to check`,
    tone: 'attention',
    missing: missing.map((item) => item.label),
  };
}

/** A compact done/total bar, for a profile header where the list sits below. */
export function ReadinessMeter({ done, total, ready }: { done: number; total: number; ready: boolean }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={`kw-meter kw-meter--${ready ? 'ok' : 'attention'}`}>
      <div className="kw-meter__track">
        <div className="kw-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="kw-meter__text">
        {done} of {total} complete
      </span>
    </div>
  );
}

/** Wraps a value that may be legitimately absent. Never renders 0.00 for null. */
export function OrDash({ children }: { children: ReactNode }) {
  return children === null || children === undefined || children === '' ? (
    <span className="kw-muted">—</span>
  ) : (
    <>{children}</>
  );
}
