import { defineConfig, devices } from '@playwright/test';

/**
 * THE BY-HAND UAT RUN, separate from the guardrail on purpose.
 *
 * `playwright.config.ts` only picks up `*.spec.ts`, so a walkthrough that
 * creates a branch and three people on every run cannot leak into the gate.
 * This config exists to run those `*.uat.ts` files deliberately, against the
 * same dev servers.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.uat\.ts/,
  timeout: 900_000,
  expect: { timeout: 20_000 },
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: WEB,
    viewport: { width: 1680, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    actionTimeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1680, height: 1000 },
        launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
      },
    },
  ],
});
