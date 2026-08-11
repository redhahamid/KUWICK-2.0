import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * G4.5d6 — clinical notes save themselves.
 *
 * The old workflow asked a doctor to press Save and then Sign. In a clinic
 * running 100–200 patients a day the second button was pressed in a batch at
 * the end of a session, from memory — or it held a paid-up patient at the
 * counter while somebody went to find the doctor. Autosave removes the
 * ceremony without removing the record: the note is written continuously, and
 * the visit's completion is what makes it immutable.
 *
 * AFTER INACTIVITY, NOT ON EVERY KEYSTROKE. A consultation note is typed in
 * bursts between looking at the patient, so the timer restarts on each change
 * and fires once the doctor stops. Saving mid-sentence would put a stream of
 * half-written clinical text into the record's revision history.
 */
export const AUTOSAVE_IDLE_MS = 30_000;

export type AutosaveState = 'IDLE' | 'SAVING' | 'SAVED' | 'FAILED';

export interface AutosaveStatus {
  state: AutosaveState;
  /** When the last successful save landed. */
  savedAt: Date | null;
  /** Present only while state is FAILED. */
  error: string | null;
}

/** "Saved 14:32" — the reassurance a doctor needs, and nothing more. */
export function autosaveLabel(status: AutosaveStatus, now = new Date()): string {
  switch (status.state) {
    case 'SAVING':
      return 'Saving…';
    case 'SAVED': {
      const at = status.savedAt ?? now;
      const pad = (n: number) => String(n).padStart(2, '0');
      return `Saved ${pad(at.getHours())}:${pad(at.getMinutes())}`;
    }
    case 'FAILED':
      return 'Save failed';
    case 'IDLE':
    default:
      return '';
  }
}

export interface UseAutosaveOptions {
  /** The current content. A change restarts the idle timer. */
  value: string;
  /** True when `value` differs from what the server holds. */
  dirty: boolean;
  /** Autosave is off for a finalized note, or where the actor may not edit. */
  enabled: boolean;
  onSave: (value: string) => Promise<unknown>;
  idleMs?: number;
}

/**
 * Returns the status to display and a `flush` for the moments a timer is the
 * wrong mechanism — leaving the record, or closing the visit.
 */
export function useAutosave({
  value,
  dirty,
  enabled,
  onSave,
  idleMs = AUTOSAVE_IDLE_MS,
}: UseAutosaveOptions) {
  const [status, setStatus] = useState<AutosaveStatus>({ state: 'IDLE', savedAt: null, error: null });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Read inside the timer so a fired save always writes the LATEST text, not
  // whatever was on screen when the timer was armed.
  const latest = useRef(value);
  const saving = useRef(false);
  latest.current = value;

  const save = useCallback(async () => {
    if (saving.current) return;
    saving.current = true;
    setStatus((s) => ({ ...s, state: 'SAVING', error: null }));
    try {
      await onSave(latest.current);
      setStatus({ state: 'SAVED', savedAt: new Date(), error: null });
    } catch (error) {
      // Never silently. A doctor who believes a note is saved and finds it
      // empty tomorrow is the failure this state exists to prevent.
      setStatus((s) => ({
        state: 'FAILED',
        savedAt: s.savedAt,
        error: error instanceof Error ? error.message : 'Could not save',
      }));
    } finally {
      saving.current = false;
    }
  }, [onSave]);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!enabled || !dirty) return undefined;
    timer.current = setTimeout(() => void save(), idleMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, dirty, enabled, idleMs, save]);

  /** Save now — used when the timer would be too late to matter. */
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (enabled && dirty) await save();
  }, [enabled, dirty, save]);

  return { status, flush, retry: save };
}
