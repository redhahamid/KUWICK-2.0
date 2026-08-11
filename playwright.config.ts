import { defineConfig, devices } from '@playwright/test';

/**
 * THE GUARDRAIL — end-to-end config.
 *
 * These specs drive the real UI against a real API and a real database. They
 * exist because the unit suites kept passing while the consult flow was broken
 * end to end: an editor that would not accept keystrokes, a header that did
 * not update, a banner that would not go away. None of those are visible to a
 * test that never opens a browser.
 *
 * Servers are started OUTSIDE this config (see .github/workflows/ci.yml, and
 * `npm run dev:api` / `npm run dev:web` locally). A `webServer` block here
 * would hide a failed start inside a test timeout, and the API has to be
 * migrated and seeded before the first test runs anyway.
 */
const WEB = process.env.E2E_WEB_URL ?? 'http://localhost:5173';

export default defineConfig({
  testDir: './e2e',
  // The golden path is one long flow; giving it room is cheaper than chasing
  // flakes caused by a slow first render on a cold CI runner.
  timeout: 180_000,
  expect: { timeout: 15_000 },
  // Serial on purpose. The specs share one clinic and one queue, and two
  // browsers racing through the same waiting room is not a test, it is a
  // different feature.
  workers: 1,
  fullyParallel: false,
  // A retry in CI absorbs runner noise; locally a flake should be seen.
  retries: process.env.CI ? 1 : 0,
  // Never let a `.only` left in a spec quietly shrink the guardrail.
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: WEB,
    // The width the canvas is designed and reviewed at.
    viewport: { width: 1680, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'retain-on-failure' : 'off',
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1680, height: 1000 },
        // This container ships Chromium at a fixed path and must never run
        // `playwright install`; CI installs it the normal way and leaves
        // CHROME_PATH unset.
        launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
      },
    },
  ],
});
