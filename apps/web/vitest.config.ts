import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// First real use of the frontend test framework SYSTEM_ARCHITECTURE.md §2
// already designates (Vitest) — separate from vite.config.ts so the
// production build config stays untouched by test-only concerns.
//
// G4.5d3c-3a (D-089) — the suite was pure-logic only until now, and most of
// it still is (default environment: node). The Consultation Footer added the
// first requirements that are not expressible as a pure function — that no
// completion action renders before eligibility is known, that a cancelled
// confirmation writes nothing, and that no footer state can reach the
// Clinical Note editor's text. Those are DOM facts; DOM test files opt in
// per-file with a `@vitest-environment jsdom` docblock.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    setupFiles: ['./src/test-setup.ts'],
  },
});
