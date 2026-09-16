import { Page, expect } from "@playwright/test";

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
  owner: "owner@admin-uat.kuwick.invalid",
  finance: "finance@admin-uat.kuwick.invalid",
  stock: "stock@admin-uat.kuwick.invalid",
  panel: "panel@admin-uat.kuwick.invalid",
} as const;

export const ADMIN_PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? "AdminUat!2026";

/** Every page in the five modules, in rail order. */
export const ADMIN_ROUTES = [
  { path: "/admin/operation", module: "Operation", heading: "Operations" },
  {
    path: "/admin/operation/segments",
    module: "Operation",
    heading: "Segment P&L",
  },
  {
    path: "/admin/operation/programmes",
    module: "Operation",
    heading: "Programmes",
  },
  {
    path: "/admin/operation/marketing",
    module: "Operation",
    heading: "Marketing",
  },
  { path: "/admin/stock", module: "Stock", heading: "Stock" },
  {
    path: "/admin/stock/transfers",
    module: "Stock",
    heading: "Stock Transfers",
  },
  { path: "/admin/stock/stock-take", module: "Stock", heading: "Stock Take" },
  {
    path: "/admin/stock/movements",
    module: "Stock",
    heading: "Movement Ledger",
  },
  { path: "/admin/panel", module: "Panel", heading: "Panel Claims" },
  {
    path: "/admin/panel/configuration",
    module: "Panel",
    heading: "Panel Configuration",
  },
  { path: "/admin/hr/today", module: "HR", heading: "Today" },
  // The canonical HR paths, under the six-section architecture. Everything
  // they absorbed still resolves — those redirects are asserted in
  // hr-navigation.spec.ts rather than here, so this walk tests SCREENS.
  { path: "/admin/hr/employees", module: "HR", heading: "Employees" },
  {
    path: "/admin/hr/settings/payroll-items",
    module: "HR",
    heading: "Payroll items",
  },
  { path: "/admin/hr/attendance", module: "HR", heading: "Attendance" },
  { path: "/admin/hr/attendance/roster", module: "HR", heading: "Roster" },
  { path: "/admin/hr/leave", module: "HR", heading: "Leave" },
  { path: "/admin/hr/claims", module: "HR", heading: "Claims" },
  // Redirects to Employees ?view=benefits since Piece 3c: the heading is the Employees page's.
  { path: "/admin/hr/benefits", module: "HR", heading: "Employees" },
  { path: "/admin/hr/reports", module: "HR", heading: "Reports" },
  { path: "/admin/hr/payroll", module: "HR", heading: "Payroll" },
  { path: "/admin/hr/incentives", module: "HR", heading: "Doctor Incentives" },
  { path: "/admin/finance", module: "Finance", heading: "Finance" },
  {
    path: "/admin/finance/day-end",
    module: "Finance",
    heading: "Day-End Closing",
  },
  { path: "/admin/finance/payments", module: "Finance", heading: "Payments" },
  {
    path: "/admin/finance/receivables",
    module: "Finance",
    heading: "Outstanding",
  },
  {
    path: "/admin/finance/credit-notes",
    module: "Finance",
    heading: "Credit Notes",
  },
  // Added by the integration pass. These are Admin-native pages like the
  // twenty above — same `AdminShell`, same heading element.
  { path: "/admin/stock/value", module: "Stock", heading: "Stock Value" },
  { path: "/admin/finance/tax", module: "Finance", heading: "Tax / SST" },
  {
    path: "/admin/finance/profitability",
    module: "Finance",
    heading: "Profitability",
  },
  {
    path: "/admin/finance/inter-company",
    module: "Finance",
    heading: "Inter-company",
  },
  {
    path: "/admin/finance/e-invoice",
    module: "Finance",
    heading: "e-Invoice (LHDN)",
  },
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
  {
    path: "/admin/operation/patients",
    module: "Operation",
    tab: "Patient Analysis",
    marker: "Unique Patients",
    owns: "management",
  },
  {
    path: "/admin/operation/procedures",
    module: "Operation",
    tab: "Procedure Analysis",
    marker: "Procedures Done",
    owns: "management",
  },
  {
    path: "/admin/operation/doctors",
    module: "Operation",
    tab: "Doctor Performance",
    marker: "Doctor",
    owns: "management",
  },
  {
    path: "/admin/operation/wait-times",
    module: "Operation",
    tab: "Waiting Times",
    marker: "Avg Wait to Be Called",
    owns: "management",
  },
  {
    path: "/admin/stock/items",
    module: "Stock",
    tab: "Items & Pricing",
    marker: "Inventory",
    owns: "management",
  },
  {
    path: "/admin/stock/locations",
    module: "Stock",
    tab: "Stock by Location",
    marker: "Stock Levels",
    owns: "management",
  },
  {
    path: "/admin/stock/purchase-orders",
    module: "Stock",
    tab: "Purchase Orders",
    marker: "Purchase Orders",
    owns: "management",
  },
  {
    path: "/admin/stock/procurement-requests",
    module: "Stock",
    tab: "Procurement Requests",
    marker: "Procurement Requests",
    owns: "management",
  },
  {
    path: "/admin/stock/suppliers",
    module: "Stock",
    tab: "Suppliers",
    marker: "Suppliers",
    owns: "management",
  },
  {
    path: "/admin/panel/batches",
    module: "Panel",
    tab: "Claim batches",
    marker: "Panel Claims",
    owns: "management",
  },
  {
    path: "/admin/panel/companies",
    module: "Panel",
    tab: "Panel companies",
    marker: "Panel Companies",
    owns: "management",
  },
  // Leave USED to be here — a Management-era screen mounted in the Admin rail.
  // It is not any more, and not because it was moved: it carried an
  // "Approving/Rejecting as" picker whose value the server wrote down as the
  // approver, unchecked, so the screen was REPLACED rather than relocated. Its
  // successor is a native AdminShell page, covered by the ordinary Admin walk
  // that asserts on `.kw-admin__title` — the very thing this list exists to
  // skip for screens that have no such title.
  {
    path: "/admin/finance/sales",
    module: "Finance",
    tab: "Sales",
    marker: "Total Sales",
    owns: "management",
  },
  {
    path: "/admin/finance/invoices",
    module: "Finance",
    tab: "Invoices",
    marker: "Invoice",
    owns: "management",
  },
] as const;

/**
 * MOUNTED, BUT REACHED BY LINK RATHER THAN BY THE RAIL.
 *
 * Empty on purpose, and kept so the spec that walks it keeps its shape.
 *
 * It held `/admin/hr/access`, which rendered the product-wide Roles screen
 * inside the HR hub. Roles are not HR's: having them at two addresses meant
 * two screens could disagree about who may approve a payroll. There is one
 * home now — `/settings/organisation/roles` — and the HR address redirects to
 * it, so it is a redirect to assert rather than a screen to draw.
 */
export const ADMIN_LINKED_ROUTES: {
  path: string;
  module: string;
  marker: string;
  from: string;
  owns: string;
}[] = [];

/**
 * The two Admin routes that render an existing page with a PROP rather than a
 * copy. Both open the attention board on a particular view.
 */
export const ADMIN_VIEW_ROUTES = [
  { path: "/admin/stock/near-expiry", tab: "Near Expiry" },
  { path: "/admin/stock/slow-moving", tab: "Slow Moving" },
] as const;

export async function loginAdmin(
  page: Page,
  email: string = ADMIN_ACCOUNTS.owner,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();
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
  // A page has mounted when its frame is on screen. Two frames exist while HR
  // moves to Slate: `AdminShell` draws `.kw-admin` for the four modules and
  // the HR screens not yet moved; `HrPage` draws `.hr-pageHead` for the ones
  // that have. Either is the same promise — a titled page, not a spinner.
  await expect(page.locator(".kw-admin, .hr-pageHead").first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0, {
    timeout: 30_000,
  });
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
  const picker = page.getByRole("combobox").first();
  if ((await picker.count()) === 0) return;
  await picker.click();
  await page
    .locator(".ant-select-item-option", { hasText: name })
    .first()
    .click();
  await expect(page.locator(".ant-spin-spinning")).toHaveCount(0, {
    timeout: 30_000,
  });
}

/** The value under a StatStrip label, e.g. statValue(page, 'NET') -> 'RM762.70'. */
export function statValue(page: Page, label: string) {
  return page
    .locator(".kw-stat", {
      has: page.locator(".kw-stat__label", {
        hasText: new RegExp(`^${label}$`, "i"),
      }),
    })
    .locator(".kw-stat__value")
    .first();
}

/**
 * Console errors, same policy as the golden path: real defects only.
 * See collectConsoleErrors in ./app.ts for why each exclusion is here.
 */
export function collectAdminConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource/.test(text)) return;
    if (/^Warning: \[antd:/.test(text)) return;
    if (/Instance created by `useForm` is not connected/.test(text)) return;
    errors.push(`[${page.url()}] ${text.slice(0, 300)}`);
  });
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${String(error.message ?? error).slice(0, 300)}`),
  );
  return errors;
}

/**
 * THE CLINIC'S OWN TODAY, which is the only today the seed knows.
 *
 * `seed-hr-uat.ts` derives every date from `Intl.DateTimeFormat` in
 * Asia/Kuala_Lumpur, and a spec that asks UTC instead disagrees with it for
 * eight hours out of every day. On the 1st of a month between midnight and
 * 08:00 in Kuala Lumpur, UTC is still the last day of the month before, so
 * `monthStart(-1)` computed in UTC names a month one earlier than the one the
 * seed actually paid — and the spec fails on a date, at an hour, that nobody
 * would reproduce by re-running it later in the day.
 */
const CLINIC_TIME_ZONE = "Asia/Kuala_Lumpur";

function clinicMonthStart(offset: number): { year: number; month: number } {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: CLINIC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1 + offset, 1));
  return { year: start.getUTCFullYear(), month: start.getUTCMonth() + 1 };
}

function periodKey(offset: number): string {
  const { year, month } = clinicMonthStart(offset);
  return `${year}-${String(month).padStart(2, "0")}`;
}

/**
 * THE LAST MONTH THE SEED TOOK ALL THE WAY TO PAID, derived rather than
 * written down.
 *
 * `seed-hr-uat.ts` runs `[-3, -2, -1]` relative to the clinic's today and
 * drives each one create → calculate → approve → prepare → record paid, so
 * offset -1 is the most recent month with real figures behind it. A spec that
 * hardcodes the answer is correct for exactly one month and then silently
 * becomes a lie about the calendar: `2026-08` passed every day of August 2026
 * and failed on 1 September, with an error that pointed at the payroll screen
 * rather than at the date. That is not a hypothetical — this helper was
 * written for that reason, went unused, and the spec hardcoded the month
 * anyway.
 *
 * Same rule, same arithmetic, same time zone, one source.
 */
export function seededPayrollPeriod(): string {
  return periodKey(-1);
}

/**
 * THE MONTH THE SEED DELIBERATELY LEAVES ALONE.
 *
 * The seed stops at offset -1, so the current month has no run at all. That is
 * the honest not-started screen, and it is worth asserting: a payroll page that
 * invented figures for a month nobody has started would be the worse failure.
 */
export function currentPayrollPeriod(): string {
  return periodKey(0);
}
