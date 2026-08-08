// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_IDLE_MS, autosaveLabel, useAutosave } from './useAutosave';

// ===========================================================================
// G4.5d6 — CLINICAL NOTES SAVE THEMSELVES
//
// The manual Sign button is gone, so the record's integrity now rests on the
// note actually being written. These tests pin the two ways that could fail
// quietly: a save that never fires, and a failure the doctor never sees.
// ===========================================================================

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (over: Partial<Parameters<typeof useAutosave>[0]> = {}) => {
  const onSave = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook((props: Parameters<typeof useAutosave>[0]) => useAutosave(props), {
    initialProps: { value: 'note text', dirty: true, enabled: true, onSave, ...over },
  });
  return { hook, onSave };
};

describe('when it fires', () => {
  it('1. saves after the doctor stops typing, not on every keystroke', async () => {
    const { onSave } = setup();
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('2. the idle window is roughly 30 seconds', () => {
    expect(AUTOSAVE_IDLE_MS).toBe(30_000);
  });

  it('3. more typing restarts the window — no mid-sentence save', async () => {
    const { hook, onSave } = setup();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 1_000);
    });
    hook.rerender({ value: 'note text and more', dirty: true, enabled: true, onSave });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS - 1_000);
    });
    // A half-written clinical sentence has not been committed.
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('4. a clean note never saves', async () => {
    const { onSave } = setup({ dirty: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 2);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('5. a finalized or read-only note never saves', async () => {
    // Autosave must not be the route that edits a locked record.
    const { onSave } = setup({ enabled: false });
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS * 2);
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it('6. flush saves immediately, for leaving the record', async () => {
    const { hook, onSave } = setup();
    await act(async () => {
      await hook.result.current.flush();
    });
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('what the doctor is told', () => {
  it('7. saving, then saved with a time', async () => {
    const { hook } = setup();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(hook.result.current.status.state).toBe('SAVED');
    expect(autosaveLabel(hook.result.current.status)).toMatch(/^Saved \d{2}:\d{2}$/);
  });

  it('8. a failure is stated, never swallowed', async () => {
    // A doctor who believes a note is saved and finds it empty tomorrow is
    // the exact failure this state exists to prevent.
    const onSave = vi.fn().mockRejectedValue(new Error('Network error'));
    const hook = renderHook(() =>
      useAutosave({ value: 'x', dirty: true, enabled: true, onSave }),
    );
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(hook.result.current.status.state).toBe('FAILED');
    expect(autosaveLabel(hook.result.current.status)).toBe('Save failed');
    expect(hook.result.current.status.error).toBe('Network error');
  });

  it('9. retry after a failure can succeed', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(undefined);
    const hook = renderHook(() => useAutosave({ value: 'x', dirty: true, enabled: true, onSave }));
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_IDLE_MS);
    });
    expect(hook.result.current.status.state).toBe('FAILED');
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current.status.state).toBe('SAVED');
  });

  it('10. an idle editor says nothing at all', () => {
    expect(autosaveLabel({ state: 'IDLE', savedAt: null, error: null })).toBe('');
  });

  it('11. no wording leaks an enum', () => {
    for (const state of ['IDLE', 'SAVING', 'SAVED', 'FAILED'] as const) {
      const label = autosaveLabel({ state, savedAt: new Date(), error: null });
      expect(label).not.toMatch(/[A-Z]{2,}_?[A-Z]*$/);
    }
  });
});
