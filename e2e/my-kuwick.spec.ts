import { expect, test } from '@playwright/test';
import { ADMIN_ACCOUNTS, ADMIN_PASSWORD, collectAdminConsoleErrors } from './support/admin';

/**
 * MY KUWICK, ON THE DEVICES IT IS FOR.
 *
 * This area is used on a phone in a doorway, and the failure that matters most
 * is not a wrong figure — it is a screen that slides sideways, or a clock
 * button a thumb cannot reach. Those are properties of the rendered layout and
 * nothing but a real browser at a real width can see them.
 */

/*
 * The five tabs of the Slate portal (portal-*.html) plus the profile behind
 * the avatar. `/my/schedule` lands on Attendance, where the roster now lives.
 */
const ROUTES = [
  { path: '/my', marker: 'Quick actions' },
  { path: '/my/schedule', marker: 'Roster' },
  { path: '/my/attendance', marker: 'Roster' },
  { path: '/my/leave', marker: 'Apply for leave' },
  { path: '/my/claims', marker: 'Submit a claim' },
  { path: '/my/payslips', marker: 'Every paid month' },
  { path: '/my/profile', marker: 'Bank account' },
] as const;

const VIEWPORTS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'small-android', width: 360, height: 800 },
  { name: 'ipad-portrait', width: 834, height: 1112 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

async function signIn(page: import('@playwright/test').Page, email: string = ADMIN_ACCOUNTS.owner) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function goMy(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('my-kuwick')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('My Kuwick', () => {
  test('every screen loads inside the staff shell, with no console errors', async ({ page }) => {
    const errors = collectAdminConsoleErrors(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    for (const route of ROUTES) {
      await goMy(page, route.path);
      await expect(page.getByText(route.marker).first()).toBeVisible({ timeout: 20_000 });
      // THE ADMINISTRATION SHELL MUST NOT BE HERE. An employee shown the module
      // rail is being offered controls the server will then refuse.
      await expect(page.locator('.kw-admin')).toHaveCount(0);
      await expect(page.getByRole('tab', { name: 'Finance', exact: true })).toHaveCount(0);
    }
    expect(errors).toEqual([]);
  });

  for (const viewport of VIEWPORTS) {
    test(`nothing scrolls sideways at ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page);

      const offenders: string[] = [];
      for (const route of ROUTES) {
        await goMy(page, route.path);
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return doc.scrollWidth - doc.clientWidth;
        });
        // One pixel of slack for sub-pixel rounding, as elsewhere in the suite.
        if (overflow > 1) offenders.push(`${route.path} overflows by ${overflow}px`);
      }
      expect(offenders).toEqual([]);
    });
  }

  test('the clock button is big enough to hit with a thumb', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page);
    await goMy(page, '/my');

    const clock = page.getByRole('button', { name: /Clock (in|out)/ });
    await expect(clock).toBeVisible();
    const box = await clock.boundingBox();
    // 44px is the accepted minimum touch target; this is the one control the
    // whole area exists for, so it gets more.
    expect(box!.height).toBeGreaterThanOrEqual(48);
    // And it must be inside the viewport, not half off the right edge.
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(361);
  });

  test('the five tabs reach every daily destination on a phone, thumb-sized', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await goMy(page, '/my');

    for (const label of ['Home', 'Payslips', 'Leave', 'Claims', 'Attendance']) {
      const tab = page.locator('.hr-ptabs a', { hasText: label });
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      // Truncated tabs — "Attendan…" — are the failure this checks for.
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('a leave request shows what it would take before it is sent', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page);
    await goMy(page, '/my/leave');

    // The strip under the form is the server's preview: the days the balance
    // engine deducts, and the balance after (or that this kind has none).
    await page.getByLabel('From').fill('2026-09-21');
    await page.getByLabel('To').fill('2026-09-23');
    const strip = page.locator('.hr-preview');
    await expect(strip).toBeVisible({ timeout: 20_000 });
    await expect(strip).toContainText('3 days');
    await expect(strip).toContainText(/Balance after: -?\d+(\.\d+)? of \d+|No balance/);
  });

  test('shift times are the CLINIC’s, not the browser’s', async ({ page }) => {
    // The container runs in UTC. A Malaysian 09:00 shift rendered through the
    // browser's zone reads 01:00, which is the bug this guards: the clinic's
    // zone is the truth, and it comes from the server.
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await goMy(page, '/my/attendance');

    // The roster rows read HH:MM–HH:MM in the clinic's zone; a 01:00–09:00 row
    // would be a UTC rendering of a 09:00–17:00 day.
    const cells = await page.locator('.hr-table td').allInnerTexts();
    const shiftTimes = cells.filter((text) => /^\d{2}:\d{2}–\d{2}:\d{2}/.test(text.trim()));
    for (const text of shiftTimes) {
      expect(text.trim()).not.toMatch(/^0[0-2]:\d{2}–0[7-9]:\d{2}/);
    }
  });
});
