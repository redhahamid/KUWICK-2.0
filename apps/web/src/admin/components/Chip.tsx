import { ReactNode } from 'react';

/**
 * ONE STATUS VOCABULARY for the whole HR module.
 *
 * Before this, six screens each reached for antd's `Tag` with whatever colour
 * name felt right: `green` for Ready here, `success` for Approved there, `gold`
 * for both "on probation" and "needs attention". A reader learns a colour
 * language from a screen and then carries it to the next one, so two screens
 * disagreeing about what amber means is worse than either being wrong alone.
 *
 * The tones are MEANINGS, not colours:
 *
 *   ok       — settled, complete, healthy. Teal-green.
 *   attention— true but not blocking. Amber. A warning is not a blocker.
 *   blocked  — this stops the work. Red, and used sparingly enough to mean it.
 *   info     — in progress, informational. Kuwick blue.
 *   neutral  — a fact with no health to it. Grey.
 *
 * `dot` renders the small leading dot the reference sheet uses inside tables,
 * where a filled pill on every row would be louder than the data.
 */
export type ChipTone = 'ok' | 'attention' | 'blocked' | 'info' | 'neutral';

export function StatusChip({
  tone = 'neutral',
  children,
  dot = false,
  title,
}: {
  tone?: ChipTone;
  children: ReactNode;
  dot?: boolean;
  title?: string;
}) {
  return (
    <span className={`kw-chip kw-chip--${tone}${dot ? ' kw-chip--dot' : ''}`} title={title}>
      {dot ? <i className="kw-chip__dot" aria-hidden /> : null}
      {children}
    </span>
  );
}

/**
 * The employment-status vocabulary, decided once.
 *
 * PROBATION is `attention` rather than `ok`: it is a real fact with a date
 * attached that somebody has to act on. RESIGNED and TERMINATED are `neutral`,
 * not `blocked` — a person leaving is not an error, and painting it red on the
 * directory is how a screen cries wolf.
 */
export function employmentTone(status: string | null | undefined): ChipTone {
  switch (status) {
    case 'ACTIVE':
      return 'ok';
    case 'PROBATION':
      return 'attention';
    case 'SUSPENDED':
      return 'blocked';
    default:
      return 'neutral';
  }
}

/** Sentence case from a SCREAMING_CASE enum, for display only. */
export function humanise(value: string | null | undefined): string {
  if (!value) return '—';
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase());
}
