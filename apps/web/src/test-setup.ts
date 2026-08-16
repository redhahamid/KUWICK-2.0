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
 * THE TEARDOWN RACE IS FIXED — see `test-scheduler-lifetime.ts`, which runs
 * before this file and holds the whole story.
 *
 * Short version, because the answer is counter-intuitive enough to be worth
 * repeating where the hook lives: the unhandled `ReferenceError: window is not
 * defined` was never about cleanup, and no hook here could have fixed it. It
 * was measured arriving AFTER this `afterEach` had completed — React takes
 * updates on a microtask past every hook a file can register — and it survived
 * teardown because React's work loop hopped across Node's process-global
 * `setImmediate` rather than anything the document owns. The 2026-08-13 attempt
 * to drain the queue from here failed for exactly that reason; do not retry it.
 */
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
