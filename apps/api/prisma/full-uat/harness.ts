/**
 * THE FULL VISUAL UAT PACK — shared harness.
 *
 * The owner's finding on the last pack was that contact sheets are not
 * reviewable: "each screenshot should be readable independently without zooming
 * into a giant contact sheet". So every capture here is a SEPARATE file at
 * 1680x1050 with deviceScaleFactor 2 — a 3360px-wide image in which a RM figure
 * and a column header are legible at 100%.
 *
 * Two rules this harness enforces, because both were broken before:
 *
 *  - A CAPTURE THAT CANNOT BE TAKEN IS REPORTED, NEVER SKIPPED. A missing image
 *    in a 150-shot pack is invisible; a named failure is a question the owner
 *    can ask. `step()` records and continues.
 *  - NOTHING IS STAGED. Every figure comes from the API, computed by the same
 *    code path a user drives. Where a workflow needs an action performed, the
 *    script performs it in the browser rather than seeding the end state.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Browser, Page, chromium } from 'playwright-core';

export const WEB = process.env.UAT_WEB ?? 'http://localhost:5173';
export const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
export const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
export const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';
export const OUT =
  process.env.UAT_DIR ?? join(process.cwd(), '..', '..', 'docs', 'screenshots', 'admin', 'full-uat');

/** The width the product is designed and reviewed at, at 2x density. */
export const DESKTOP = { width: 1680, height: 1050 };
export const IPAD_LANDSCAPE = { width: 1194, height: 834 };
export const IPAD_PORTRAIT = { width: 834, height: 1194 };

export const captured: string[] = [];
export const failures: string[] = [];

export function ensureOut(): void {
  mkdirSync(OUT, { recursive: true });
}

export async function settle(page: Page, extra = 700): Promise<void> {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(extra);
}

/**
 * One image. `full` captures the whole scrollable page — right for a screen —
 * and `viewport` captures what is on screen, which is what a modal or drawer
 * actually occupies. A full-page shot of a modal is mostly dimmed overlay.
 */
export async function shot(page: Page, name: string, opts: { viewport?: boolean } = {}): Promise<void> {
  // PARK THE POINTER FIRST. Wherever the script last clicked, the cursor is
  // still hovering, and antd shows a tooltip after a beat — which lands on top
  // of the very column headers the shot exists to show. Moving to the corner
  // and waiting for the tooltip to leave costs a moment and removes a whole
  // class of unreadable capture.
  await page.mouse.move(2, 2);
  await page.locator('.ant-tooltip:not(.ant-tooltip-hidden)').waitFor({ state: 'detached', timeout: 3_000 }).catch(() => {});
  // AND SCROLL BACK TO THE TOP. The Admin header is sticky, so a full-page
  // capture taken while scrolled paints that header over whatever is beneath
  // it — which on the payroll screens was the NOT-READY banner, clipped
  // mid-sentence. Full-page shots belong at scroll position zero.
  if (!opts.viewport) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: !opts.viewport });
  captured.push(name);
  console.log(`  ${name}`);
}

export async function step(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const message = (error as Error).message.split('\n')[0].slice(0, 160);
    failures.push(`${name}: ${message}`);
    console.log(`  ${name}  NOT CAPTURED: ${message}`);
  }
}

export async function signIn(page: Page, email: string = EMAIL): Promise<void> {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 30_000 });
}

/** Pin the branch, so a shot is never silently group-wide. */
export async function chooseBranch(page: Page, name: string): Promise<void> {
  const picker = page.getByLabel('Branch');
  // THROW RATHER THAN RETURN. This used to return quietly when the picker was
  // absent, and the caller went on to photograph whatever branch it was
  // already on under the other branch's name. A branch that cannot be chosen
  // is a failed capture, which `step()` will name.
  if ((await picker.count()) === 0) {
    throw new Error(`No branch picker on this screen — cannot switch to ${name}`);
  }
  await picker.first().click();
  await page.locator('.ant-select-item-option', { hasText: name }).first().click();
  await settle(page);
}

export async function open(page: Page, route: string): Promise<void> {
  await page.goto(`${WEB}${route}`);
  await settle(page);
}

/** A plain page capture: navigate, settle, shoot. */
export async function pageShot(page: Page, name: string, route: string): Promise<void> {
  await step(name, async () => {
    await open(page, route);
    await shot(page, name);
  });
}

/**
 * Show a table with every optional column on, at whatever width that needs.
 * A 1680 viewport clips the right-hand columns of the wide tables, which
 * defeats the purpose of an all-columns capture; widening the canvas for the
 * shot and restoring it afterwards keeps the rest of the pack consistent.
 */
export async function wideShot(page: Page, name: string, width = 2400): Promise<void> {
  await page.setViewportSize({ width, height: DESKTOP.height });
  await settle(page, 500);
  await shot(page, name);
  await page.setViewportSize(DESKTOP);
  await settle(page, 300);
}

export async function launch(): Promise<{ browser: Browser; page: Page }> {
  const browser = await chromium.launch({ executablePath: CHROME });
  const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await signIn(page);
  return { browser, page };
}

export function writeManifest(file: string): void {
  writeFileSync(
    join(OUT, file),
    JSON.stringify({ captured, failures, at: new Date().toISOString() }, null, 2),
  );
  console.log(`\n${captured.length} captured, ${failures.length} not captured`);
  for (const failure of failures) console.log(`  - ${failure}`);
}
