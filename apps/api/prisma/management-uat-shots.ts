/**
 * INTEGRATED MANAGEMENT UAT — the whole Administration surface, photographed.
 *
 * Walks the six Management domains a clinic owner is being asked to accept —
 * Operation, Stock, Panel, HR, Payroll and Finance — against the seeded
 * synthetic clinic, at desktop and iPad width. It is deliberately a BREADTH
 * walk: the Payroll journey already has its own 46-frame depth pack in
 * docs/payroll-final-uat, and repeating it here would not tell anybody
 * anything new.
 *
 *   npx tsx prisma/management-uat-shots.ts
 *
 * Every frame is captioned into manifest.md, which the pack README indexes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, BrowserContext, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'management-integrated-uat');
const CHROME = process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium';

const DESKTOP = { width: 1680, height: 1050 };
const TABLET = { width: 1024, height: 1366 };

let shot = 0;
const manifest: string[] = [];
/** Console errors seen while walking — a dead screen usually says so here. */
const consoleErrors: string[] = [];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(700);
}

async function capture(page: Page, name: string, note: string) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  manifest.push(`${file} — ${note}`);
  console.log(`  ${file}`);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function go(page: Page, path: string) {
  await page.goto(`${WEB}${path}`);
  await page.locator('.kw-admin').waitFor({ timeout: 30_000 }).catch(() => {});
  await settle(page);
}

/**
 * A route that renders an empty shell, an error boundary or nothing at all is
 * a UAT blocker, not a screenshot. Recorded per frame so the walk itself is
 * the smoke test rather than a separate one.
 */
async function healthOf(page: Page, path: string): Promise<string> {
  const bodyText = (await page.locator('body').innerText().catch(() => '')) ?? '';
  if (/something went wrong|unexpected error|failed to fetch/i.test(bodyText)) return `ERROR TEXT on ${path}`;
  if (bodyText.trim().length < 80) return `NEARLY EMPTY on ${path}`;
  return 'ok';
}

/** Pick a branch in the hub header, the way a person does. */
async function chooseBranch(page: Page, name: string) {
  const picker = page.getByRole('combobox', { name: 'Branch' }).first();
  if ((await picker.count()) === 0) return;
  await picker.click();
  await page.locator('.ant-select-item-option', { hasText: name }).first().click();
  await settle(page);
}

const problems: string[] = [];

async function walk(page: Page, path: string, name: string, note: string) {
  await go(page, path);
  const health = await healthOf(page, path);
  if (health !== 'ok') problems.push(health);
  await capture(page, name, note);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({ executablePath: CHROME });

  const desktop: BrowserContext = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 1 });
  const page = await desktop.newPage();
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
  });
  await signIn(page);

  // 1 · The shell itself: the five Management areas a clinic owner navigates.
  await walk(page, '/admin', 'admin-home', 'Administration — the Management landing and its five areas');

  // 2 · OPERATION — management operations, never the queue.
  await walk(page, '/admin/operation', 'operation-overview', 'Operation — visits, patients, mix and workload for the period');
  await walk(page, '/admin/operation/doctors', 'operation-doctors', 'Operation — provider workload, described rather than ranked punitively');
  await walk(page, '/admin/operation/patients', 'operation-patients', 'Operation — new vs returning and the patient-flow view');
  await walk(page, '/admin/operation/procedures', 'operation-procedures', 'Operation — service and procedure volume');
  await walk(page, '/admin/operation/wait-times', 'operation-wait-times', 'Operation — waiting-time indicators and their coverage');

  // 3 · STOCK.
  await walk(page, '/admin/stock', 'stock-overview', 'Stock — the inventory position and what needs attention');
  await walk(page, '/admin/stock/items', 'stock-items', 'Stock — the item master with unit and balance');
  await walk(page, '/admin/stock/movements', 'stock-movements', 'Stock — the movement ledger: every quantity change with its cause');
  await walk(page, '/admin/stock/purchase-orders', 'stock-purchase-orders', 'Stock — purchase orders and their receiving state');
  await walk(page, '/admin/stock/near-expiry', 'stock-near-expiry', 'Stock — batch and expiry watch (FEFO support)');
  await walk(page, '/admin/stock/value', 'stock-valuation', 'Stock — valuation, stating its costing method rather than implying precision');
  await walk(page, '/admin/stock/stock-take', 'stock-take', 'Stock — stock takes and the variance they record');

  // 4 · PANEL.
  await walk(page, '/admin/panel', 'panel-workspace', 'Panel — the claim workspace: what is claimable, claimed, awaiting and outstanding');
  await walk(page, '/admin/panel/companies', 'panel-companies', 'Panel — the panel master');
  await walk(page, '/admin/panel/configuration', 'panel-configuration', 'Panel — fee treatment: withheld, added, none, or deliberately unconfigured');
  await walk(page, '/admin/panel/batches', 'panel-batches', 'Panel — claim batches and their submission record');

  // 5 · HR (Payroll has its own depth pack).
  await walk(page, '/admin/hr', 'hr-today', 'HR — the day at a glance');
  await walk(page, '/admin/hr/employees', 'hr-employees', 'HR — the employee directory, deliberately without a salary column');
  await walk(page, '/admin/hr/attendance', 'hr-attendance', 'HR — timesheets, with unapproved overtime shown apart and unpaid');
  await walk(page, '/admin/hr/leave', 'hr-leave', 'HR — leave and its balances');
  await walk(page, '/admin/hr/claims', 'hr-claims', 'HR — staff claims and their payment route');
  await walk(page, '/admin/hr/incentives', 'hr-incentives', 'HR — doctor incentives');
  await walk(page, '/admin/hr/locum', 'hr-locum', 'HR — locum sessions');
  await walk(page, '/admin/hr/roster', 'hr-roster', 'HR — the roster');
  await walk(page, '/admin/hr/payroll', 'hr-payroll-home', 'HR → Payroll — the month, and what it needs before anybody is paid');
  await walk(page, '/admin/hr/reports', 'hr-reports', 'HR → Payroll — the report catalogue');

  // 6 · FINANCE.
  await walk(page, '/admin/finance', 'finance-overview', 'Finance — the overview: billed, collected, and what is still owed');
  await walk(page, '/admin/finance/sales', 'finance-sales', 'Finance — sales, cash vs panel');
  await walk(page, '/admin/finance/payments', 'finance-payments', 'Finance — collections and their tender');
  await walk(page, '/admin/finance/receivables', 'finance-receivables', 'Finance — patient receivables');
  await walk(page, '/admin/finance/panel-money', 'finance-panel-money', 'Finance — the panel position, consumed from Panel rather than recomputed');
  await walk(
    page,
    '/admin/finance/day-end',
    'finance-day-end-choose-branch',
    'Finance — day end on "All branches": a drawer belongs to ONE branch, so the screen asks which rather than drawing somebody\u2019s zeros',
  );
  // …and then the screen doing its job, with a branch named. Both frames are
  // in the pack deliberately: the first is what an owner sees on landing, the
  // second is the one they will actually work in.
  await chooseBranch(page, 'Contoh Central');
  await capture(page, 'finance-day-end', 'Finance — day end: counted, closed, reopenable with a reason');
  await chooseBranch(page, 'All branches');
  await walk(page, '/admin/finance/payables', 'finance-payables', 'Finance — supplier payables from procurement');
  await walk(page, '/admin/finance/credit-notes', 'finance-credit-notes', 'Finance — credit notes');
  await walk(page, '/admin/finance/profitability', 'finance-profitability', 'Finance — profitability, and what it does not claim to include');

  await desktop.close();

  // 7 · iPad — the width a clinic owner actually reviews on.
  const tablet = await browser.newContext({ viewport: TABLET, deviceScaleFactor: 1 });
  const tab = await tablet.newPage();
  await signIn(tab);
  for (const [path, name, note] of [
    ['/admin', 'tablet-admin-home', 'iPad — the Management landing'],
    ['/admin/operation', 'tablet-operation', 'iPad — Operation'],
    ['/admin/stock', 'tablet-stock', 'iPad — Stock'],
    ['/admin/panel', 'tablet-panel', 'iPad — Panel'],
    ['/admin/hr/payroll', 'tablet-hr-payroll', 'iPad — HR → Payroll'],
    ['/admin/finance', 'tablet-finance', 'iPad — Finance'],
  ] as const) {
    await go(tab, path);
    const health = await healthOf(tab, path);
    if (health !== 'ok') problems.push(`[tablet] ${health}`);
    await capture(tab, name, note);
  }
  await tablet.close();

  await browser.close();
  writeFileSync(join(OUT, 'manifest.md'), `${manifest.map((m) => `- ${m}`).join('\n')}\n`);
  console.log(`\n${shot} frames → ${OUT}`);
  if (problems.length) {
    console.log('\nSCREEN PROBLEMS:');
    for (const p of problems) console.log(`  ! ${p}`);
  }
  const noisy = [...new Set(consoleErrors)];
  if (noisy.length) {
    console.log(`\nCONSOLE ERRORS (${noisy.length} distinct):`);
    for (const e of noisy.slice(0, 25)) console.log(`  ! ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
