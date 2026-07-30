import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// First real use of the frontend test framework SYSTEM_ARCHITECTURE.md §2
// already designates (Vitest) — separate from vite.config.ts so the
// production build config stays untouched by test-only concerns.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
  },
});
