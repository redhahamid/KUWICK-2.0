import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * b1 PHASE B — the one place a modal decides whether it may close.
 *
 * Escape, the X, Cancel and the backdrop are four routes to the same decision,
 * and a modal holding typed clinical data must answer all four the same way.
 * Every one of them funnels through `requestClose` here, so a call site cannot
 * wire three of them and quietly leave the fourth able to discard a
 * half-written prescription.
 *
 * THE BACKDROP IS DECIDED ON MOUSEDOWN, NOT CLICK.
 *
 * A `click` fires on the element the press and release share — but the browser
 * resolves that to the nearest common ancestor, so selecting text inside the
 * modal and releasing the mouse a few pixels outside it lands a click on the
 * mask. The modal then closes because the doctor highlighted a dose to re-read
 * it. `mousedown` is where the intent actually is: a press that STARTS on the
 * backdrop is someone clicking away, and a press that starts inside is not,
 * whatever happens next.
 *
 * DIRTY MEANS ASK, ON EVERY ROUTE INCLUDING THE BACKDROP.
 *
 * The backdrop used to be inert while dirty — safe, but it left a doctor
 * clicking a dead area with nothing explaining why. Asking is both safer and
 * honest: no route silently discards, and no route silently does nothing.
 */

export interface DismissableModal {
  /** Ask to close. Escape, X, Cancel and the backdrop all call this. */
  requestClose: () => void;
  /** True while the "discard?" confirmation is up. */
  confirming: boolean;
  /** The confirmation's "Discard" action. */
  confirmDiscard: () => void;
  /** The confirmation's "Keep editing" action. */
  cancelDiscard: () => void;
  /**
   * Spread onto the element that IS the backdrop — the one whose own area is
   * the click-away target. It closes only on a gesture that both starts and
   * ends there.
   */
  backdropProps: {
    onMouseDown: (event: BackdropEvent) => void;
    onMouseUp: (event: BackdropEvent) => void;
  };
}

/** Only the two fields the backdrop decision reads. */
interface BackdropEvent {
  target: EventTarget | null;
  currentTarget: EventTarget | null;
}

export function useDismissableModal(options: {
  open: boolean;
  /** Differs from the initial / prefilled state. */
  isDirty: boolean;
  onClose: () => void;
  /** While true nothing closes: a save is in flight and the record is mid-write. */
  busy?: boolean;
}): DismissableModal {
  const { open, isDirty, onClose, busy = false } = options;
  const [confirming, setConfirming] = useState(false);

  /** True while the press currently in progress began on the backdrop itself. */
  const pressBeganOnBackdrop = useRef(false);

  useEffect(() => {
    if (open) return;
    // A modal reopened after being discarded must not come back mid-question.
    setConfirming(false);
    pressBeganOnBackdrop.current = false;
  }, [open]);

  const requestClose = useCallback(() => {
    if (busy) return;
    if (isDirty) {
      setConfirming(true);
      return;
    }
    onClose();
  }, [busy, isDirty, onClose]);

  const onMouseDown = useCallback((event: BackdropEvent) => {
    pressBeganOnBackdrop.current = event.target === event.currentTarget;
  }, []);

  const onMouseUp = useCallback(
    (event: BackdropEvent) => {
      // BOTH ends outside. A drag that began on the dose field and finished
      // over the backdrop is a text selection, not a dismissal.
      const both = pressBeganOnBackdrop.current && event.target === event.currentTarget;
      pressBeganOnBackdrop.current = false;
      if (both) requestClose();
    },
    [requestClose],
  );

  const confirmDiscard = useCallback(() => {
    setConfirming(false);
    onClose();
  }, [onClose]);

  return {
    requestClose,
    confirming,
    confirmDiscard,
    cancelDiscard: () => setConfirming(false),
    backdropProps: { onMouseDown, onMouseUp },
  };
}
