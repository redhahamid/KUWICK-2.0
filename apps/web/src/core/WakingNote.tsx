import { useEffect, useState } from 'react';

/**
 * A FRIENDLY WAIT (new-clinic UAT #2, item 56). The staging server sleeps when
 * nobody uses it, and its first answer can take up to a minute; a bare
 * "Loading…" for that long reads as broken. After a few seconds the note says
 * what is happening.
 */
export const WAKING_AFTER_MS = 4000;
export const WAKING_TEXT = 'Kuwick is waking up. The first visit after a quiet spell can take up to a minute.';

/** True once `busy` has lasted longer than `afterMs`. */
export function useSlow(busy: boolean, afterMs = WAKING_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [busy, afterMs]);
  return slow;
}

export function WakingNote({ className = 'hr-note' }: { className?: string }) {
  const slow = useSlow(true);
  return (
    <div className={className} role="status">
      {slow ? WAKING_TEXT : 'Getting your page ready…'}
    </div>
  );
}
