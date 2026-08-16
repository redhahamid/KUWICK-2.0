// @vitest-environment jsdom
import { unstable_NormalPriority, unstable_scheduleCallback } from 'scheduler';
import { describe, expect, it } from 'vitest';
import { environmentScheduler } from './test-scheduler-lifetime';

// ===========================================================================
// THE TEARDOWN RACE, PINNED.
//
// A full run used to pass 1307 tests and then exit 1 on one unhandled
// `ReferenceError: window is not defined`, blaming a different file each time.
// The cause was that React scheduled its work on Node's `setImmediate` — a
// process-global queue that outlives the jsdom window the work renders into —
// so a callback queued at the end of one file fired after that window was
// destroyed.
//
// These tests hold the fix in place. Both would have passed before it and fail
// after any change that reintroduces it: a React or scheduler upgrade that
// picks a different host callback, or a setup-file order that lets react-dom
// load before the binding.
// ===========================================================================

describe('React work cannot outlive the document it renders into', () => {
  it("schedules through the environment's own timer, not Node's setImmediate", () => {
    // Reaching into the scheduler directly rather than rendering: React routes
    // work through `act`'s queue inside a test, which is exactly the path that
    // is NOT at risk. The at-risk path is an update that lands outside act —
    // the one measured arriving after the final `afterEach` — and this is that
    // path, called deterministically.
    const before = environmentScheduler.calls;
    unstable_scheduleCallback(unstable_NormalPriority, () => {});
    expect(environmentScheduler.calls).toBeGreaterThan(before);
  });

  it('hands Node its own setImmediate back afterwards', () => {
    // The wrapper is for React alone. Anything else asking for a Node
    // immediate — vitest itself included — must get the real one, or the fix
    // would be trading one cross-environment surprise for another.
    const immediate = (globalThis as unknown as { setImmediate?: { name?: string } }).setImmediate;
    expect(typeof immediate).toBe('function');
    expect(immediate?.name).toBe('setImmediate');
  });
});
