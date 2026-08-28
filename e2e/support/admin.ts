import { Page, expect } from '@playwright/test';

/**
 * THE ADMIN GUARDRAIL — shared moves.
 *
 * Thin for the same reason `app.ts` is thin: a page-object layer thick enough
 * to hide the UI is a layer thick enough to keep passing while the UI is
 * broken. Everything here is a login, a wait, or a piece of vocabulary the
 * specs would otherwise repeat.
 *
 * These specs run against the SYNTHETIC ADMIN TENANT seeded by
 * `apps/api/prisma/seed-admin-uat.ts` — a different clinic from the golden
 * path's, with its own history: two branches, three panels, a rejected claim,
 * a transfer discrepancy, a payroll run that refuses to guess a statutory
 * figure. Every name in it is invented and every address is `.invalid`.
 */

export const ADMIN_ACCOUNTS = {
  owner: 'owner@admin-uat.kuwick.invalid',
  finance: 'finance@admin-uat.kuwick.invalid',
  stock: 'stock@admin-uat.kuwick.invalid',
  panel: 'panel@admin-uat.kuwick.invalid',
} as const;

export const ADMIN_PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';

/** Every page in the five modules, in rail order. */
export const ADMIN_ROUTES = [
  { path: '/admin/operation', module: 'Operation', heading: 'Operations' },
  { path: '/admin/operation/segments', module: 'Operation', heading: 'Segment P&L' },
  { path: '/admin/operation/programmes', module: 'Operation', heading: 'Programmes' },
  { path: '/admin/operation/marketing', module: 'Operation', heading: 'Marketing' },
  { path: '/admin/stock', module: 'Stock', heading: 'Stock' },
  { path: '/admin/stock/transfers', module: 'Stock', heading: 'Stock Transfers' },
  { path: '/admin/stock/stock-take', module: 'Stock', heading: 'Stock Take' },
  { path: '/admin/stock/movements', module: 'Stock', heading: 'Movement Ledger' },
  { path: '/admin/panel', module: 'Panel', heading: 'Panel Claims' },
  { path: '/admin/panel/configuration', module: 'Panel', heading: 'Panel Configuration' },
  { path: '/admin/hr', module: 'HR', heading: 'Workforce' },
  { path: '/admin/hr/employees', module: 'HR', heading: 'Employees' },
  { path: '/admin/hr/attendance', module: 'HR', heading: 'Timesheets' },
  { path: '/admin/hr/payroll', module: 'HR', heading: 'Payroll' },
  { path: '/admin/hr/incentives', module: 'HR', heading: 'Doctor Incentives' },
  { path: '/admin/finance', module: 'Finance', heading: 'Finance' },
  { path: '/admin/finance/day-end', module: 'Finance', heading: 'Day-End Closing' },
  { path: '/admin/finance/payments', module: 'Finance', heading: 'Payments' },
  { path: '/admin/finance/receivables', module: 'Finance', heading: 'Outstanding' },
  { path: '/admin/finance/credit-notes', module: 'Finance', heading: 'Credit Notes' },
] as const;

export async function loginAdmin(page: Page, email: string = ADMIN_ACCOUNTS.owner): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 30_000 });
}

/**
 * Navigate to an admin page and wait for its data, not just its frame.
 *
 * The heading renders before the queries resolve, so asserting on the heading
 * alone passes against a page that is still spinning — which is precisely the
 * class of "green build, broken screen" these specs exist to catch. Waiting
 * for the loading state to CLEAR is the honest wait.
 */
export async function gotoAdmin(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('.kw-admin')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
}

/**
 * Pick a branch, for an account that has no home clinic.
 *
 * The finance controller covers both branches, so nothing resolves a clinic
 * for them and every branch-scoped screen has to be told which one. Real
 * users do this once from the header; specs do it after the first navigation,
 * because the picker only exists inside the hub shell.
 */
export async function chooseBranch(page: Page, name: string): Promise<void> {
  const picker = page.getByRole('combobox').first();
  if (await picker.count() === 0) return;
  await picker.click();
  await page.locator('.ant-select-item-option', { hasText: name }).first().click();
  await expect(page.locator('.ant-spin-spinning')).toHaveCount(0, { timeout: 30_000 });
}

/** The value under a StatStrip label, e.g. statValue(page, 'NET') -> 'RM762.70'. */
export function statValue(page: Page, label: string) {
  return page
    .locator('.kw-stat', { has: page.locator('.kw-stat__label', { hasText: new RegExp(`^${label}$`, 'i') }) })
    .locator('.kw-stat__value')
    .first();
}

/**
 * Console errors, same policy as the golden path: real defects only.
 * See collectConsoleErrors in ./app.ts for why each exclusion is here.
 */
export function collectAdminConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/Failed to load resource/.test(text)) return;
    if (/^Warning: \[antd:/.test(text)) return;
    if (/Instance created by `useForm` is not connected/.test(text)) return;
    errors.push(`[${page.url()}] ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${String(error.message ?? error).slice(0, 300)}`));
  return errors;
}
