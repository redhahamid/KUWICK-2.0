import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Node-environment files (the pure-logic suites) have no window; the DOM
// shims below are jsdom-only. The matcher import above is environment-safe —
// it only extends `expect`.
if (typeof window !== 'undefined') {
  // jsdom implements neither of these, and antd's responsive components and
  // every scroll-to-section handler in the workspace call them.
  window.matchMedia =
    window.matchMedia ??
    ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList);

  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
}

/**
 * THE TEARDOWN RACE — what is known, and what was ruled OUT.
 *
 * Symptom: a full `vitest run` exits 1 while reporting every test passed, with
 * one unhandled `ReferenceError: window is not defined` at
 * `react-dom` → `Immediate.performWorkUntilDeadline`, blamed on whichever file
 * happened to be running. The file named moves between runs
 * (diagnosisSearchField → allergyQuickRecord → copyRxModal), which is the tell
 * that it belongs to none of them: React scheduled work, the file's jsdom was
 * torn down, and the queued Immediate fired afterwards.
 *
 * RULED OUT, 2026-08-13: that the work is scheduled by `cleanup()` itself.
 * Awaiting a `setImmediate` here — draining the queue on React's own task
 * queue while the environment is still alive — did NOT fix it. So the work is
 * scheduled AFTER this hook, which points at something resolving late rather
 * than at unmounting: a mocked request settling after its test ended, or a
 * React Query observer on a per-test `QueryClient` that no test ever clears.
 * **Start the next investigation there, not at cleanup.** (Also note
 * `setImmediate` is untyped in this app's tsconfig — it has no node types — so
 * a fix using it must be typed or use a different primitive.)
 *
 * It is NOT a failing test, and CI has been green on it throughout; it
 * reproduces locally under load. Do not "fix" it by silencing the reporter.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
