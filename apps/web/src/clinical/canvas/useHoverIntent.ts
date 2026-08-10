import { useCallback, useEffect, useRef, useState } from 'react';
import { HOVER_INTENT_MS } from './visitPreview';

/**
 * Kuwick 2.0 Canvas — hover INTENT, not hover.
 *
 * A pointer travelling from the queue to the note crosses every card in the
 * rail. Opening on contact would fire four requests and flash four panels for
 * a gesture that meant none of them, and the doctor would learn to route the
 * mouse around the rail — which is the opposite of putting history on screen.
 *
 * The delay applies to KEYBOARD FOCUS as well, deliberately. Tabbing to the
 * note passes through the same cards, and a panel that appears under every
 * intermediate stop is the same defect with a different input device.
 *
 * Closing is immediate. A delay before opening is patience; a delay before
 * closing is a panel that follows you across the screen.
 */
export interface HoverIntent {
  activeId: string | null;
  /** Arm the delay for this id. Re-arming cancels any pending one. */
  open: (id: string) => void;
  /** Close now, and cancel anything armed. */
  close: () => void;
}

export function useHoverIntent(delayMs: number = HOVER_INTENT_MS): HoverIntent {
  const [activeId, setActiveId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending timer that fires after unmount would set state on a dead
  // component; one that fires after the doctor has navigated away would open
  // a panel over a different patient's record.
  useEffect(() => disarm, [disarm]);

  const open = useCallback(
    (id: string) => {
      disarm();
      timer.current = setTimeout(() => {
        timer.current = null;
        setActiveId(id);
      }, delayMs);
    },
    [disarm, delayMs],
  );

  const close = useCallback(() => {
    disarm();
    setActiveId(null);
  }, [disarm]);

  return { activeId, open, close };
}
