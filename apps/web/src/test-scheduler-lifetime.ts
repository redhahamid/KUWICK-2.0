/**
 * THE TEARDOWN RACE — the cause, and the fix. (2026-08-16)
 *
 * SYMPTOM. A full `vitest run` reported every test passing and then exited 1 on
 * a single unhandled `ReferenceError: window is not defined`, thrown at
 * `react-dom` → `performWorkOnRootViaSchedulerTask` →
 * `Immediate.performWorkUntilDeadline` → `processImmediate`. The file it blamed
 * moved between runs — `prescriptionVocabulary`, `patientProfileSlideOver`,
 * `allergyQuickRecord`, `medicineSearchFirst` — which is the tell that it
 * belonged to none of them. A guardrail that goes red at random is one people
 * learn to re-run without reading, so it is worth the cost of the real fix.
 *
 * CAUSE, measured rather than reasoned about. Instrumenting `setImmediate` with
 * the stack of whatever scheduled each callback produced this, at the end of
 * one file:
 *
 *     --- afterEach complete in patientProfileSlideOver.test.tsx
 *     SCHED  scheduleTaskForRootDuringMicrotask → processRootScheduleInMicrotask
 *     SCHED  performWorkUntilDeadline (re-scheduling itself)
 *     SCHED  performWorkUntilDeadline (re-scheduling itself)
 *     !!! THREW ReferenceError: window is not defined
 *
 * Two facts fall out of that trace, and both are needed:
 *
 *   1. React takes an update AFTER the last `afterEach` has completed — it
 *      arrives on a microtask, past every hook a test file can register. This
 *      is why the 2026-08-13 attempt failed and why no hook-based drain can be
 *      the whole answer: there is no hook left to drain from.
 *
 *   2. React's work loop then hops across `setImmediate`. It yields every 5ms
 *      and re-schedules itself, so even one render can span three ticks. And
 *      `setImmediate` is NODE's queue — process-global, with no relationship to
 *      the jsdom window the work is rendering into. Vitest tears that window
 *      down between files; the queued callback fires anyway, reads
 *      `window.event` (react-dom-client.development.js:18937, the first
 *      statement of `performWorkOnRootViaSchedulerTask`) and throws into a
 *      process where nothing is listening.
 *
 * The defect is (2): the SCHEDULING PRIMITIVE OUTLIVES THE DOM IT SCHEDULES
 * WORK FOR. React picks that primitive once, at `scheduler` module init:
 *
 *     if (typeof setImmediate === 'function')  -> setImmediate   <- Node's
 *     else if (typeof MessageChannel !== ...)  -> MessageChannel <- also Node's
 *     else                                     -> setTimeout     <- also Node's
 *
 * All three are Node's. jsdom 26 implements no `setImmediate` and no
 * `MessageChannel`, and vitest deliberately puts Node's timers on the global
 * window so that fake timers work — so `window.setTimeout` is Node's too, and
 * measurably does NOT die with the document (the first version of this fix
 * routed through it and the race survived, on `listOnTimeout` instead of
 * `processImmediate`).
 *
 * The only timer jsdom itself owns and cancels is the one on its OWN window,
 * reachable through the handle vitest publishes as `globalThis.jsdom`. Its
 * `close()` runs `stopAllTimers()`, and scheduling after close is already a
 * no-op there (`if (!methodContext._document) return 0`). That is the lifetime
 * React's work should have had all along.
 *
 * THE FIX. Give React a `setImmediate` backed by that timer. React binds it
 * during the import below and keeps it for the rest of the file; Node's real
 * `setImmediate` is handed straight back, so nothing else is affected.
 *
 * This is not a suppression, and deliberately so. Nothing is caught, no error
 * is ignored, and no reporter is silenced: React work still runs, still renders
 * and still throws if it is genuinely broken — and jsdom routes such a throw to
 * the window error handler vitest already listens on, so it fails the run.
 * What changes is that work scheduled against a document is discarded WITH that
 * document instead of running against its corpse, which is the behaviour a
 * browser has always had and the one the test environment was missing.
 *
 * Must load BEFORE `test-setup.ts`: that file imports `@testing-library/react`,
 * which pulls in react-dom, and the scheduler binds its host callback the
 * moment it is imported. Hence a separate setup file, listed first, with no
 * static React import of its own.
 */

/** Counts host callbacks React scheduled through the document's own timer. */
export const environmentScheduler = { calls: 0 };

interface VitestJsdomHandle {
  window: { setTimeout: (fn: () => void, ms: number) => number };
}

interface PatchableGlobal {
  jsdom?: VitestJsdomHandle;
  setImmediate?: (fn: (...args: unknown[]) => void, ...args: unknown[]) => unknown;
}

const patchable = globalThis as unknown as PatchableGlobal;

// Absent in the node-environment files (the pure-logic suites), which never
// render and have no document to tie anything to. Absent too if a future
// vitest stops publishing the handle — in which case nothing is patched and
// the race returns as a visible red run rather than as something subtler.
const documentTimer = patchable.jsdom?.window.setTimeout;

if (documentTimer) {
  const nodeSetImmediate = patchable.setImmediate;

  patchable.setImmediate = ((fn: (...args: unknown[]) => void, ...args: unknown[]) => {
    environmentScheduler.calls += 1;
    return documentTimer(() => fn(...args), 0);
  }) as PatchableGlobal['setImmediate'];

  // The binding happens here, at module init, inside `scheduler`.
  await import('react-dom/client');

  // Everything else keeps Node's. Only React holds the wrapper, because only
  // React captured it.
  patchable.setImmediate = nodeSetImmediate;
}
