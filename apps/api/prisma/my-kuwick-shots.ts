/**
 * THE HR/WORKFORCE PASS, PHOTOGRAPHED — both personas.
 *
 * Phone first, then iPad, then desktop, because that is the order of the
 * screens' importance: an employee clocks in on a phone in a doorway. The walk
 * fails any route that renders an error boundary or a near-empty body, so it
 * is a smoke test that happens to produce evidence.
 *
 *   npx tsx prisma/my-kuwick-shots.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, Browser, Page } from 'playwright-core';

const WEB = process.env.SHOTS_WEB ?? 'http://localhost:5173';
const EMAIL = process.env.SHOTS_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const PASSWORD = process.env.ADMIN_UAT_PASSWORD ?? 'AdminUat!2026';
const OUT = process.env.SHOTS_DIR ?? join(process.cwd(), '..', '..', 'docs', 'hr-workforce-uat');

const PHONE = { width: 390, height: 844 };
const TABLET_PORTRAIT = { width: 834, height: 1112 };
const TABLET_LANDSCAPE = { width: 1024, height: 768 };
const DESKTOP = { width: 1440, height: 900 };

let shot = 0;
const manifest: string[] = [];
const problems: string[] = [];
const consoleErrors: string[] = [];

async function settle(page: Page) {
  await page.locator('.ant-spin-spinning').waitFor({ state: 'detached', timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(600);
}

async function signIn(page: Page) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel(/email/i).fill(EMAIL);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await page.waitForFunction(() => !window.location.pathname.includes('/login'), null, { timeout: 30_000 });
}

async function capture(page: Page, name: string, note: string) {
  await settle(page);
  shot += 1;
  const file = `${String(shot).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: join(OUT, file), fullPage: true });
  manifest.push(`${file} — ${note}`);
  console.log(`  ${file}`);
}

async function walk(page: Page, path: string, name: string, note: string, prepare?: Prepare) {
  await page.goto(`${WEB}${path}`);
  await settle(page);
  // A screen that legitimately needs one more choice before it has anything to
  // show gets to make it, so the frame is evidence of the screen rather than
  // evidence of an unanswered question.
  if (prepare) {
    await prepare(page);
    await settle(page);
  }
  const body = (await page.locator('body').innerText().catch(() => '')) ?? '';
  if (/something went wrong|unexpected error|failed to fetch/i.test(body)) problems.push(`ERROR TEXT on ${path}`);
  if (body.trim().length < 60) problems.push(`NEARLY EMPTY on ${path}`);
  await capture(page, name, note);
}

type Prepare = (page: Page) => Promise<void>;

/**
 * The roster is one branch's board, and the Admin hub opens on "All branches",
 * so the screen asks which before it draws anything. Answering it is part of
 * photographing the roster — a picture of the question is not a picture of the
 * roster.
 *
 * AND IT ANSWERS "the branch with the most people on it", by asking each in
 * turn rather than by naming one. The frame exists to evidence that the roster
 * holds the WHOLE workforce; a two-person branch technically shows that and
 * reads like an empty product. A hardcoded branch name would rot the first
 * time somebody renames a clinic.
 */
const chooseBusiestBranch: Prepare = async (page) => {
  const reopen = async () => {
    await page.evaluate(() => window.sessionStorage.removeItem('kuwick.selectedBranch'));
    await page.goto(`${WEB}/admin/hr/roster`);
    await settle(page);
  };

  const buttons = page.locator('.kw-adminNotice button');
  const names: string[] = [];
  for (let index = 0; index < (await buttons.count()); index += 1) {
    names.push((await buttons.nth(index).innerText()).trim());
  }
  if (names.length === 0) return;

  const pick = async (name: string) => {
    await page.locator('.kw-adminNotice button', { hasText: name }).first().click();
    await settle(page);
  };

  let best = { name: names[0], count: -1 };
  for (const name of names) {
    await reopen();
    await pick(name);
    // "Everyone (12)" — the chip that carries the whole board's population.
    const everyone = await page.locator('.kw-roster-filters button').first().innerText().catch(() => '');
    const count = Number(/\((\d+)\)/.exec(everyone)?.[1] ?? 0);
    if (count > best.count) best = { name, count };
  }

  await reopen();
  await pick(best.name);
};

/** The manager's side, in the Administration shell. Desktop and iPad only. */
const OWNER_ROUTES: [string, string, string, Prepare?][] = [
  ['/admin/hr', 'hr-today', 'HR Today — who is on, who is not, and every count that opens the work'],
  ['/admin/hr/employees', 'hr-employees', 'Employees — the directory, with Add Employee and the incomplete-profile queue'],
  ['/admin/hr/roster', 'hr-roster', 'Roster — the whole workforce, filtered by what kind of work they do', chooseBusiestBranch],
  ['/admin/hr/attendance', 'hr-attendance', 'Timesheets — and the attendance fixes staff have asked for'],
  ['/admin/hr/leave', 'hr-leave', 'Leave — waiting, approved, refused'],
  ['/admin/hr/claims', 'hr-claims', 'Claims — and the route decision that decides how each is paid'],
  ['/admin/hr/payroll', 'hr-payroll', 'Payroll — the month and what it needs before anybody is paid'],
];

/**
 * The manager's side again, but as JOURNEYS rather than URLs: the screens PART
 * 18 names that no address reaches on its own — a wizard behind a button, a
 * person behind a row, a payroll run behind a link. Each one navigates itself
 * and captures, and each one says what it could not find rather than quietly
 * photographing an empty page.
 */
const OWNER_FLOWS: [string, string, (page: Page) => Promise<boolean>][] = [
  [
    'hr-add-employee',
    'Add Employee — the guided wizard, opened from the directory',
    async (page) => {
      await page.goto(`${WEB}/admin/hr/employees`);
      await settle(page);
      await page.getByRole('button', { name: '+ Add employee' }).click();
      await settle(page);
      return (await page.locator('.ant-drawer-open').count()) > 0;
    },
  ],
  [
    'hr-employee-detail',
    'One employee — account, employment and clinical credential on one page',
    async (page) => {
      await page.goto(`${WEB}/admin/hr/employees`);
      await settle(page);
      // A row without an employment profile opens the completion form instead
      // of navigating, so try rows until one actually is a person's page.
      const rows = page.locator('.ant-table-row');
      for (let index = 0; index < Math.min(await rows.count(), 8); index += 1) {
        await rows.nth(index).click();
        await settle(page);
        if (/\/admin\/hr\/employees\/[^/]+$/.test(new URL(page.url()).pathname)) return true;
        await page.keyboard.press('Escape');
        await settle(page);
      }
      return false;
    },
  ],
  [
    'hr-attendance-detail',
    'Timesheets — one person opened, day by day, with the exceptions named',
    async (page) => {
      await page.goto(`${WEB}/admin/hr/attendance`);
      await settle(page);
      const row = page.locator('.ant-table-row').first();
      if ((await row.count()) === 0) return false;
      await row.click();
      await settle(page);
      return true;
    },
  ],
  [
    'hr-payroll-run',
    'Payroll — one run opened at the employee review step',
    async (page) => {
      await page.goto(`${WEB}/admin/hr/payroll`);
      await settle(page);
      // BY HREF, not by link text. `/admin/hr/payroll/` also holds `readiness`,
      // `ytd-opening` and `all`, whose wording is free to change; a run's id is
      // a uuid and that shape is not.
      const links = page.locator('a[href^="/admin/hr/payroll/"]');
      for (let index = 0; index < (await links.count()); index += 1) {
        const href = (await links.nth(index).getAttribute('href')) ?? '';
        if (!/^\/admin\/hr\/payroll\/[0-9a-f-]{36}$/.test(href)) continue;
        await links.nth(index).click();
        await settle(page);
        return true;
      }
      return false;
    },
  ],
  [
    'hr-payroll-settings',
    'Payroll settings — the setup checklist, the attendance rules, and what stays outside Kuwick',
    async (page) => {
      await page.goto(`${WEB}/admin/hr/settings`);
      await settle(page);
      return true;
    },
  ],
];

const ROUTES: [string, string, string][] = [
  ['/my', 'my-home', 'My Kuwick — the home screen: clock in, today, what is waiting'],
  ['/my/schedule', 'my-schedule', 'My Kuwick — my shifts, read from the one canonical roster'],
  ['/my/attendance', 'my-attendance', 'My Kuwick — what the clock recorded, and how to ask for a fix'],
  ['/my/leave', 'my-leave', 'My Kuwick — my leave and its decisions'],
  ['/my/claims', 'my-claims', 'My Kuwick — my claims, with where the money is in plain words'],
  ['/my/payslips', 'my-payslips', 'My Kuwick — my payslips, approved months only'],
  ['/my/profile', 'my-profile', 'My Kuwick — who Kuwick thinks I am, and no salary on it'],
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser: Browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
  });

  for (const [viewport, label, suffix] of [
    [PHONE, 'iPhone 390×844', 'phone'],
    [TABLET_PORTRAIT, 'iPad portrait 834×1112', 'ipad'],
    // iPad LANDSCAPE is the width a manager actually holds the thing at while
    // walking a clinic, and it is the one where a sub-navigation rail is most
    // likely to eat its own labels.
    [TABLET_LANDSCAPE, 'iPad landscape 1024×768', 'ipad-landscape'],
    [DESKTOP, 'Desktop 1440×900', 'desktop'],
  ] as const) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: suffix === 'phone', hasTouch: suffix === 'phone' });
    const page = await context.newPage();
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 160)}`);
    });
    await signIn(page);
    console.log(`\n${label}`);
    for (const [path, name, note] of ROUTES) {
      await walk(page, path, `${name}-${suffix}`, `${note} · ${label}`);
    }
    // THE MANAGER'S SIDE is an Administration screen and is not designed for a
    // phone; photographing it at 390px would be evidence of nothing.
    if (suffix !== 'phone') {
      for (const [path, name, note, prepare] of OWNER_ROUTES) {
        // Every manager frame is shot from the hub's default, "All branches",
        // so one screen's answer to "which branch?" does not silently re-filter
        // the next screen's figures and make the pack depend on route order.
        await page.evaluate(() => window.sessionStorage.removeItem('kuwick.selectedBranch'));
        await walk(page, path, `${name}-${suffix}`, `${note} · ${label}`, prepare);
      }
      for (const [name, note, open] of OWNER_FLOWS) {
        await page.evaluate(() => window.sessionStorage.removeItem('kuwick.selectedBranch'));
        const reached = await open(page).catch(() => false);
        if (!reached) {
          // NOT a silent omission. A frame the pack claims and does not have is
          // how a gap survives review.
          problems.push(`COULD NOT REACH ${name} at ${label}`);
          continue;
        }
        await capture(page, `${name}-${suffix}`, `${note} · ${label}`);
      }
    }
    // The two drawers a member of staff actually fills in, on a phone.
    if (suffix === 'phone') {
      await page.goto(`${WEB}/my/leave`);
      await settle(page);
      await page.getByRole('button', { name: 'Request leave' }).click();
      await capture(page, 'my-leave-request-phone', 'My Kuwick — the leave request drawer on a phone');
      await page.keyboard.press('Escape');
      await page.goto(`${WEB}/my/claims`);
      await settle(page);
      await page.getByRole('button', { name: 'New claim' }).click();
      await capture(page, 'my-claim-new-phone', 'My Kuwick — the claim form, with the receipt camera button');
    }
    await context.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'manifest.md'), `${manifest.map((m) => `- ${m}`).join('\n')}\n`);
  console.log(`\n${shot} frames → ${OUT}`);
  if (problems.length) {
    console.log('\nSCREEN PROBLEMS:');
    for (const p of problems) console.log(`  ! ${p}`);
  }
  const noisy = [...new Set(consoleErrors)].filter((e) => !/antd:/.test(e));
  if (noisy.length) {
    console.log(`\nCONSOLE ERRORS (${noisy.length} distinct):`);
    for (const e of noisy.slice(0, 15)) console.log(`  ! ${e}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
