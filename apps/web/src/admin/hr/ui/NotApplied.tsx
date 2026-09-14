import type { ReactNode } from 'react';
import { StatusChip } from './StatusChip';

/**
 * A SETTING THAT SAVES AND IS NOT OBEYED, saying so where it is set.
 *
 * The September 2026 audit (docs/HR_SETTINGS_AUDIT_2026-09.md) found fourteen
 * fields a clinic can set that no calculation reads. A field like that is not
 * inert on the screen: it is typed, it saves, it reads back, and every one of
 * those is a reason to believe it is working. This clinic's numbers happen to
 * match the defaults the engine uses instead, which is what has kept it
 * invisible rather than harmless — the next clinic's will not.
 *
 * THREE ANSWERS, AND THIS IS THE THIRD. Applying a dead setting changes what
 * somebody is paid and is the account holder's decision, not a tidy-up on the
 * way past. Deleting it throws away an answer a clinic may already have
 * recorded. Until that decision is made, the field stays exactly as it is and
 * stops claiming to work.
 *
 * The tone is `attn` rather than `muted` on purpose: this is not a settled
 * fact, it is a decision waiting for the account holder.
 */
export function NotApplied({ children }: { children?: ReactNode }) {
  return (
    <span className="hr-inert">
      <StatusChip tone="attn">Not applied</StatusChip>
      {children ? <span className="hr-inert__why">{children}</span> : null}
    </span>
  );
}
