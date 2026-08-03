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

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
