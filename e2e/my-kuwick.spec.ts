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

const ROUTES = [
  { path: '/my', marker: 'My Kuwick' },
  { path: '/my/schedule', marker: 'My schedule' },
  { path: '/my/attendance', marker: 'My attendance' },
  { path: '/my/leave', marker: 'My leave' },
  { path: '/my/claims', marker: 'My claims' },
  { path: '/my/payslips', marker: 'My payslips' },
  { path: '/my/profile', marker: 'My profile' },
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

  test('the bottom navigation reaches every daily destination on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await goMy(page, '/my');

    for (const label of ['Home', 'Schedule', 'Attendance', 'Leave', 'Claims']) {
      const tab = page.locator('.kw-my__tab', { hasText: label });
      await expect(tab).toBeVisible();
      const box = await tab.boundingBox();
      // Truncated tabs — "Attendan…" — are the failure this checks for.
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('shift times are the CLINIC’s, not the browser’s', async ({ page }) => {
    // The container runs in UTC. A Malaysian 09:00 shift rendered through the
    // browser's zone reads 01:00, which is the bug this guards: the clinic's
    // zone is the truth, and it comes from the server.
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await goMy(page, '/my/schedule');

    const times = await page.locator('.kw-my-row__detail').allInnerTexts();
    const shiftTimes = times.filter((text) => /^\d{2}:\d{2} – \d{2}:\d{2}/.test(text));
    // Whatever the roster holds, nothing may render as a UTC-shifted small hour
    // when the clinic runs office hours: a 00:00–08:00 or 01:00–09:00 row is
    // the signature of the browser's zone winning.
    for (const text of shiftTimes) {
      expect(text).not.toMatch(/^0[0-2]:\d{2} – 0[7-9]:\d{2}/);
    }
  });
});
