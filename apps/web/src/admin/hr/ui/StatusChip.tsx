import type { ReactNode } from 'react';

/**
 * FIVE TONES, EACH WITH A JOB.
 *
 * The kit allows no decorative colour, so a chip's tone is a claim about what
 * the reader has to do:
 *
 *   done   green   settled, nothing to do
 *   attn   gold    a person has to decide something
 *   block  red     payroll cannot run until this is fixed
 *   muted  grey    a fact, from a record or worked out
 *   info   blue    context, neither good nor bad
 *
 * The dot is drawn from `currentColor`, so colour never carries the meaning
 * alone — the word beside it always does.
 */
export type ChipTone = 'done' | 'attn' | 'block' | 'muted' | 'info';

export function StatusChip({ tone = 'muted', children }: { tone?: ChipTone; children: ReactNode }) {
  return <span className={`hr-chip hr-chip--${tone}`}>{children}</span>;
}
