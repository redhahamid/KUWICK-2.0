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
  // Added by the integration pass. These are Admin-native pages like the
  // twenty above — same `AdminShell`, same heading element.
  { path: '/admin/stock/value', module: 'Stock', heading: 'Stock Value' },
  { path: '/admin/hr/roster', module: 'HR', heading: 'Roster' },
  { path: '/admin/hr/benefits', module: 'HR', heading: 'Staff Benefits' },
  { path: '/admin/finance/tax', module: 'Finance', heading: 'Tax / SST' },
  { path: '/admin/finance/profitability', module: 'Finance', heading: 'Profitability' },
  { path: '/admin/finance/inter-company', module: 'Finance', heading: 'Inter-company' },
  { path: '/admin/finance/e-invoice', module: 'Finance', heading: 'e-Invoice (LHDN)' },
] as const;

/**
 * THE MOUNTED SCREENS — the ones written for another hub.
 *
 * Each renders a component built for /management, /settings or /appointments.
 * They are listed SEPARATELY from the routes above for one honest reason: they
 * do not use `AdminShell`, so they have no `.kw-admin__title` to assert on.
 * What they must prove instead is the thing the owner actually complained
 * about — that arriving at one does not feel like leaving Admin. So the spec
 * checks the Admin rail is present, the right sub-tab is lit, and the screen
 * itself rendered something identifiable.
 *
 * `owns` records which hub originally built the screen. It is documentation
 * for whoever reads a failure, not something asserted.
 */
export const ADMIN_MOUNTED_ROUTES = [
  { path: '/admin/operation/patients', module: 'Operation', tab: 'Patient Analysis', marker: 'Unique Patients', owns: 'management' },
  { path: '/admin/operation/procedures', module: 'Operation', tab: 'Procedure Analysis', marker: 'Procedures Done', owns: 'management' },
  { path: '/admin/operation/doctors', module: 'Operation', tab: 'Doctor Performance', marker: 'Doctor', owns: 'management' },
  { path: '/admin/operation/wait-times', module: 'Operation', tab: 'Waiting Times', marker: 'Avg Wait to Be Called', owns: 'management' },
  { path: '/admin/stock/items', module: 'Stock', tab: 'Items & Pricing', marker: 'Inventory', owns: 'management' },
  { path: '/admin/stock/locations', module: 'Stock', tab: 'Stock by Location', marker: 'Stock Levels', owns: 'management' },
  { path: '/admin/stock/purchase-orders', module: 'Stock', tab: 'Purchase Orders', marker: 'Purchase Orders', owns: 'management' },
  { path: '/admin/stock/procurement-requests', module: 'Stock', tab: 'Procurement Requests', marker: 'Procurement Requests', owns: 'management' },
  { path: '/admin/stock/suppliers', module: 'Stock', tab: 'Suppliers', marker: 'Suppliers', owns: 'management' },
  { path: '/admin/panel/batches', module: 'Panel', tab: 'Claim batches', marker: 'Panel Claims', owns: 'management' },
  { path: '/admin/panel/companies', module: 'Panel', tab: 'Panel companies', marker: 'Panel Companies', owns: 'management' },
  { path: '/admin/hr/leave', module: 'HR', tab: 'Leave', marker: 'Leave Requests', owns: 'management' },
  { path: '/admin/finance/sales', module: 'Finance', tab: 'Sales', marker: 'Total Sales', owns: 'management' },
  { path: '/admin/finance/invoices', module: 'Finance', tab: 'Invoices', marker: 'Invoice', owns: 'management' },
] as const;

/**
 * MOUNTED, BUT REACHED BY LINK RATHER THAN BY THE RAIL.
 *
 * `/admin/hr/access` used to sit in the HR rail between Payroll and Staff
 * benefits. It was taken out deliberately — see the comment in
 * `AdminLayout.tsx`: the HR rail is the monthly payroll walk, and making the
 * owner pass two configuration screens to reach the one they open every month
 * was turning it into an admin console. The screen is still mounted and still
 * reachable, from Payroll settings.
 *
 * So there is no sub-tab to light, and asserting one was this fixture
 * describing a rail that no longer exists. What still has to be true is
 * everything else: the route resolves, the Admin rail is intact, the right
 * MODULE is lit, and the screen draws. The sub-tab that lights is the module's
 * landing page, which is the honest answer for a leaf with no rail entry.
 */
export const ADMIN_LINKED_ROUTES = [
  { path: '/admin/hr/access', module: 'HR', marker: 'Roles & permissions', from: '/admin/hr/settings', owns: 'settings' },
] as const;

/**
 * The two Admin routes that render an existing page with a PROP rather than a
 * copy. Both open the attention board on a particular view.
 */
export const ADMIN_VIEW_ROUTES = [
  { path: '/admin/stock/near-expiry', tab: 'Near Expiry' },
  { path: '/admin/stock/slow-moving', tab: 'Slow Moving' },
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

/**
 * THE PAYROLL PERIOD THE SEED CREATES, derived rather than written down.
 *
 * `seed-admin-uat.ts` builds its payroll run with `monthStart(-1)` — a payroll
 * run is for a month that has finished. A spec that hardcodes the answer is
 * correct for exactly one month and then silently becomes a lie about the
 * calendar: `2026-07` passed every day of August 2026 and failed on 1 September,
 * with an error that pointed at the payroll screen rather than at the date.
 *
 * Same rule, same UTC arithmetic, one source.
 */
export function seededPayrollPeriod(): string {
  const now = new Date();
  const priorMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return `${priorMonth.getUTCFullYear()}-${String(priorMonth.getUTCMonth() + 1).padStart(2, '0')}`;
}
