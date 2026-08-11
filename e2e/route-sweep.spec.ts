import { test } from '@playwright/test';
import { ACCOUNTS, collectConsoleErrors, login } from './support/app';

// A1 SWEEP TOOL — gated, like SCAFFOLD: drive every main route as the owner
// and print what the console complains about. The golden path enforces zero
// errors on its own path; this is how the rest of the app gets checked when
// working an A1 unit. Its first run found the TrendChart duplicate-key defect.
//
//   E2E_SWEEP=1 npx playwright test route-sweep

const ROUTES = [
  '/queue',
  '/patients',
  '/dispensary',
  '/appointments',
  '/reports',
  '/management',
  '/rooms',
  '/inventory',
  '/panel-claims',
  '/settings',
  '/staff',
  '/documents',
];

test('SWEEP: console errors per route', async ({ page }) => {
  test.skip(!process.env.E2E_SWEEP, 'a sweep tool, not a guardrail');
  const errors = collectConsoleErrors(page);
  await login(page, ACCOUNTS.owner);
  for (const route of ROUTES) {
    const before = errors.length;
    await page.goto(route);
    await page.waitForTimeout(2500);
    const added = errors.slice(before);
    console.log(`ROUTE ${route}: ${added.length === 0 ? 'clean' : ''}`);
    for (const line of added) console.log(`  ${line}`);
  }
});
