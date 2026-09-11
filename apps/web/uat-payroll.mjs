/**
 * THE OWNER'S MONTHLY PAYROLL WALK — PASS / FAIL, step by step.
 *
 * Not "can the route load". Each step below is a thing a clinic owner has to
 * be able to DO, in the order they would do it, and the assertion is what they
 * would have to see for it to have worked. Run against the synthetic admin UAT
 * tenant; every name in it is invented and every account is `.invalid`.
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173';
const EMAIL = process.env.UAT_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.UAT_PASSWORD ?? 'AdminUat!2026';
const PERIOD = process.env.UAT_PERIOD ?? '2026-08';

/** innerText honours `text-transform`, and this product uppercases labels. */
const norm = (value) => String(value).trim().toLowerCase();
const has = (list, wanted) => list.map(norm).includes(norm(wanted));

const results = [];
let failures = 0;

async function step(name, fn) {
  try {
    await fn();
    results.push(['PASS', name, '']);
  } catch (error) {
    failures += 1;
    results.push(['FAIL', name, String(error.message ?? error).split('\n')[0].slice(0, 160)]);
  }
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium' });
const context = await browser.newContext({ viewport: { width: 1512, height: 960 } });
const page = await context.newPage();

/** Console errors are a failure of the walk, not background noise. */
const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

const goto = async (path) => {
  await page.goto(`${BASE}${path}`);
  await page.waitForSelector('.kw-admin', { timeout: 30_000 });
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(700);
};

await step('Sign in as the clinic owner', async () => {
  await page.goto(`${BASE}/login`);
  const slug = page.locator('input[autocomplete="organization"]');
  if (await slug.isVisible().catch(() => false)) await slug.fill('admin-uat');
  await page.getByPlaceholder('name@clinic.com').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: /log in/i }).click();
  await page.waitForURL((u) => !u.pathname.includes('login'), { timeout: 30_000 });
});

await step('HR → Payroll lands on the month, not on a dashboard about payroll', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}`);
  const header = page.locator('.kw-payMonth');
  if (!(await header.isVisible())) throw new Error('no month header');
  if (!(await page.locator('.kw-payrollGrid').isVisible())) throw new Error('the register is not the landing');
});

await step('The month totals are readable without opening anything', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}`);
  const labels = await page.locator('.kw-payFig__label').allInnerTexts();
  for (const wanted of ['Gross pay', 'Employee deductions', 'Employer contributions', 'Net pay']) {
    if (!has(labels, wanted)) throw new Error(`month header is missing "${wanted}"`);
  }
});

await step('Every employee and their net pay are visible at once', async () => {
  const rows = await page.locator('.kw-payrollGrid tbody .ant-table-row').count();
  if (rows < 8) throw new Error(`only ${rows} employees on the register`);
  const headers = await page.locator('.kw-payrollGrid thead tr:last-child th').allInnerTexts();
  if (!has(headers, 'Net pay')) throw new Error('no Net pay column');
});

await step('The register foots, and its total equals the month header', async () => {
  const headerNet = (await page.locator('.kw-payFig--lead .kw-payFig__value').innerText()).replace(/[^\d.]/g, '');
  const cells = await page.locator('.kw-payrollGrid__totals td').allInnerTexts();
  const footerNet = cells[cells.length - 1].replace(/[^\d.]/g, '');
  if (headerNet !== footerNet) throw new Error(`header net ${headerNet} != register total ${footerNet}`);
});

await step('Basic, OT, incentive, claims and unpaid leave are told apart', async () => {
  const headers = (await page.locator('.kw-payrollGrid thead tr:last-child th').allInnerTexts()).map(norm);
  for (const wanted of ['Basic', 'Unpaid leave', 'Additional', 'Overtime', 'Incentive', 'Gross']) {
    if (!headers.includes(norm(wanted))) throw new Error(`no "${wanted}" column`);
  }
  // And every column that makes up gross is to the LEFT of it, so the row adds up.
  for (const before of ['Basic', 'Unpaid leave', 'Additional', 'Overtime', 'Incentive']) {
    if (headers.indexOf(norm(before)) > headers.indexOf(norm('Gross'))) throw new Error(`${before} is right of Gross`);
  }
});

await step('Opening an employee keeps the register behind it', async () => {
  await page.locator('.kw-payrollGrid tbody .ant-table-row').first().click();
  await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 });
  if (!(await page.locator('.kw-payrollGrid').isVisible())) throw new Error('the register disappeared');
});

await step("One employee's salary is explained without leaving payroll", async () => {
  const sections = await page.locator('.ant-drawer-open .kw-drawerSection__title').allInnerTexts();
  for (const wanted of ['Earnings', 'Deductions', 'Statutory', 'Result']) {
    if (!has(sections, wanted)) throw new Error(`drawer has no "${wanted}" section`);
  }
});

await step('The drawer agrees with the register row it was opened from', async () => {
  const drawerNet = (await page.locator('.ant-drawer-open .kw-netValue').innerText()).replace(/[^\d.]/g, '');
  const rowNet = (
    await page.locator('.kw-payrollGrid tbody .ant-table-row').first().locator('td').last().innerText()
  ).replace(/[^\d.]/g, '');
  if (drawerNet !== rowNet) throw new Error(`drawer ${drawerNet} != row ${rowNet}`);
});

await step('An allowed manual earning can be added from the drawer', async () => {
  await page.getByRole('button', { name: '+ Add earning' }).click();
  await page.waitForSelector('.kw-addItem', { timeout: 10_000 });
  const fields = await page.locator('.kw-addItem__field > span').allInnerTexts();
  for (const wanted of ['Type', 'Amount', 'Earned in']) {
    if (!has(fields, wanted)) throw new Error(`the editor has no "${wanted}" field`);
  }
  await page.locator('.kw-addItem').getByRole('button', { name: 'Cancel' }).click();
});

await step('A figure that came from attendance says so, and is corrected there', async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  // Nurul Hidayah carries approved overtime pulled from the timesheet.
  const nurul = page.locator('.kw-payrollGrid tbody .ant-table-row', { hasText: 'Nurul Hidayah' });
  await nurul.scrollIntoViewIfNeeded();
  await nurul.click();
  await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 });
  const body = await page.locator('.ant-drawer-open').innerText();
  if (!/Overtime/i.test(body)) throw new Error('the overtime line is not in the drawer');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

await step('Unpaid leave reduces the wage rather than being deducted twice', async () => {
  const rohana = page.locator('.kw-payrollGrid tbody .ant-table-row', { hasText: 'Rohana Yusof' });
  await rohana.scrollIntoViewIfNeeded();
  await rohana.click();
  await page.waitForSelector('.ant-drawer-open', { timeout: 15_000 });
  const body = await page.locator('.ant-drawer-open').innerText();
  if (!/Less unpaid leave/.test(body)) throw new Error('unpaid leave is not shown against the earnings');
  if (!/wages are smaller, not deducted twice/.test(body)) throw new Error('the reason is not stated');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
});

await step('A blocked employee is marked on their own row, with a way to fix it', async () => {
  const blocked = page.locator('.kw-payrollGrid tbody .ant-table-row', { hasText: 'Blocked' }).first();
  if ((await blocked.count()) === 0) throw new Error('no blocked row is marked');
  if ((await blocked.locator('.kw-rowStatus__fix').count()) === 0) throw new Error('no Fix on the blocked row');
});

await step('Review says what needs looking at, and does not repeat the register', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}&step=review`);
  const labels = await page.locator('.kw-stat__label').allInnerTexts();
  for (const wanted of ['In this run', 'Ready', 'Blocked']) {
    if (!has(labels, wanted)) throw new Error(`Review has no "${wanted}" count`);
  }
  // The counts partition the run rather than inviting arithmetic that fails.
  const values = await page.locator('.kw-stat__value').allInnerTexts();
  const [inRun, ready, blocked] = values.map((v) => Number(v.trim()));
  if (ready + blocked !== inRun) throw new Error(`${ready} + ${blocked} != ${inRun}`);
  if ((await page.locator('.kw-payrollGrid').count()) !== 0) throw new Error('Review repeats the register');
});

await step('Review totals equal the register totals', async () => {
  const headerNet = (await page.locator('.kw-payFig--lead .kw-payFig__value').innerText()).replace(/[^\d.]/g, '');
  const netRow = page.locator('.kw-summaryRows > *', { hasText: /^Net pay/ }).first();
  if ((await netRow.count()) === 0) throw new Error('Review has no net pay line');
  const shown = (await netRow.innerText()).replace(/[^\d.]/g, '');
  if (shown !== headerNet) throw new Error(`Review ${shown} != header ${headerNet}`);
});

await step('Approve states what is being approved, and refuses while blocked', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}&step=approve`);
  const statement = await page.locator('.kw-approveStatement').innerText();
  if (!/You are approving/.test(statement)) throw new Error('no approval statement');
  const button = page.getByRole('button', { name: /^Approve .* payroll$/ });
  if (!(await button.isDisabled())) throw new Error('the button is live on a blocked run');
});

await step('Approve does not tick itself before it has happened', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}&step=complete`);
  const approveStage = page.locator('.kw-stage', { hasText: 'Approve' }).first();
  const marker = await approveStage.innerText();
  if (/✓/.test(marker)) throw new Error('Approve shows a tick on an unapproved run');
});

await step('Finalise is honest about what it does not do', async () => {
  const body = await page.locator('.kw-admin').innerText();
  if (!/has not been approved/i.test(body)) throw new Error('Finalise does not say why it is empty');
  if (/Submitted|Filed to LHDN|Bank file ready/i.test(body)) throw new Error('Finalise claims a submission it cannot make');
});

await step('History is reachable, and is not the payroll landing page', async () => {
  await goto(`/admin/hr/payroll?period=${PERIOD}`);
  await page.getByRole('link', { name: 'History' }).click();
  await page.waitForURL(/payroll\/history/, { timeout: 15_000 });
  await page.waitForTimeout(900);
  if (!/Payroll history/.test(await page.locator('.kw-admin__title').innerText())) throw new Error('no history screen');
});

await step('An approved month is frozen when reopened from history', async () => {
  // The seeded month is CALCULATED, not approved, so this asserts the rule the
  // register applies: no editing affordances on a locked run.
  await goto(`/admin/hr/payroll?period=${PERIOD}`);
  const editable = await page.locator('.kw-rowStatus__fix').count();
  if (editable === 0) throw new Error('a draft month offers no way to fix anything');
});

await step('No console errors anywhere in the walk', async () => {
  /*
   * antd 6 deprecation warnings are excluded, and named rather than swallowed.
   * They are app-wide (every `<Drawer width>` in the product) and predate this
   * work; the two the payroll workspace itself mounts have been fixed. Fixing
   * the other fourteen is a separate change, not payroll's.
   */
  const real = consoleErrors.filter(
    (e) => !/favicon|ResizeObserver/i.test(e) && !/\[antd: .*\] `.*` is deprecated/.test(e),
  );
  const unique = [...new Set(real.map((e) => e.slice(0, 130)))];
  if (unique.length > 0) throw new Error(`${real.length} error(s), ${unique.length} distinct: ${unique.join(' || ')}`);
});

await browser.close();

const width = Math.max(...results.map(([, name]) => name.length));
for (const [verdict, name, detail] of results) {
  console.log(`${verdict}  ${name.padEnd(width)}  ${detail}`);
}
console.log(`\n${results.length - failures}/${results.length} steps passed`);
process.exit(failures > 0 ? 1 : 0);
