import { expect, test, type Page } from '@playwright/test';
import { ADMIN_ACCOUNTS, ADMIN_PASSWORD, loginAdmin } from './support/admin';

/**
 * PROMPT 1, THROUGH THE SCREENS — a fresh branch hiring from 1 January.
 *
 * Not part of the guardrail suite: it creates a branch and three people every
 * time it runs, which is exactly what makes it a UAT and exactly what would
 * make it a bad permanent fixture. Run by hand:
 *
 *   CHROME_PATH=/opt/pw-browsers/chromium npx playwright test \
 *     --config playwright.uat.config.ts
 *
 * Every step below is the one a clinic performs, in the order it performs it,
 * and the screenshots are what the screen actually showed.
 */
const API = process.env.E2E_API_URL ?? 'http://localhost:3000';
const SHOTS = 'docs/screenshots/p1-first-month';
const STAMP = new Date().toISOString().slice(11, 19).replace(/:/g, '');
const BRANCH = `KLINIK HIJRAA BANGI ${STAMP}`;
const JOINED = '1 Jan 2026';
const PEOPLE = [
  { name: 'Amirah Binti Zulkifli', salary: '2800.00', position: 'Clinic Assistant' },
  { name: 'Farhan Bin Rosli', salary: '3200.00', position: 'Senior Clinic Assistant' },
  { name: 'Nabila Binti Idris', salary: '2500.00', position: 'Clinic Assistant' },
];

/*
 * Fields are addressed BY ID, not by label. Two controls on this screen are
 * both called Branch — the shell's filter and the form's own field — and a
 * label lookup cannot tell them apart.
 */
const open = (page: Page) => page.locator('.ant-select-dropdown:not(.ant-slide-up-hidden)').last();

/** antd DatePicker: type the value in the format the field prints, then commit. */
async function pickDate(page: Page, selector: string, value: string) {
  const box = page.locator(selector);
  await box.click();
  await box.fill(value);
  await page.keyboard.press('Enter');
  await expect(box).toHaveValue(value);
}

/** antd Select: open it, then click the option by its own text. */
async function choose(page: Page, selector: string, option: string) {
  await page.locator(selector).click();
  const dropdown = open(page);
  const item = dropdown.getByTitle(option, { exact: true });
  /*
   * antd virtualises a long list: an option below the fold is not in the DOM
   * at all, so it cannot be scrolled to by locator. Every run of this
   * walkthrough leaves another branch behind it, so the branch list is the
   * one that outgrows the window. Wheel the list until the option appears.
   */
  for (let turn = 0; turn < 25 && (await item.count()) === 0; turn += 1) {
    await dropdown.locator('.rc-virtual-list-holder').hover();
    await page.mouse.wheel(0, 160);
    await page.waitForTimeout(80);
  }
  await item.click();
  await expect(open(page)).toBeHidden({ timeout: 10_000 }).catch(() => undefined);
}

test.describe.configure({ mode: 'serial' });

test('a new branch hires from 1 January and pays January', async ({ page, request }) => {
  test.setTimeout(600_000);

  // -------------------------------------------------------------------------
  // A BRANCH NOBODY HAS USED. The clinic makes this in Settings; it is setup
  // here, not the thing under test.
  // -------------------------------------------------------------------------
  const auth = await request.post(`${API}/auth/login`, {
    data: { email: ADMIN_ACCOUNTS.owner, password: ADMIN_PASSWORD },
  });
  expect(auth.ok()).toBeTruthy();
  const headers = { Authorization: `Bearer ${(await auth.json()).accessToken}` };
  const clinic = await request.post(`${API}/clinics`, { headers, data: { name: BRANCH } });
  expect(clinic.ok()).toBeTruthy();

  await loginAdmin(page);

  // -------------------------------------------------------------------------
  // THE ADD EMPLOYEE FORM, as a clinic fills it. Since Batch 2 it also asks
  // for the employing company, the rest day and LINDUNG; this walk leaves
  // those blank on purpose, to show the blocked month below and the fix on
  // the record, which is the path a clinic that skipped them takes.
  // -------------------------------------------------------------------------
  for (const person of PEOPLE) {
    await page.goto('/admin/hr/employees/new');
    await page.locator('#fullName').fill(person.name);
    await choose(page, '#role', 'Front desk / clinical staff');
    await pickDate(page, '#dateOfBirth', '8 Mar 1994');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.locator('#position').fill(person.position);
    await pickDate(page, '#startDate', JOINED);
    await choose(page, '#clinicId', BRANCH);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.locator('#salaryAmount').fill(person.salary);
    await page.locator('#bankName').fill('Maybank');
    await page.locator('#bankAccountNo').fill('512345678901');
    await choose(page, '#epfMembership', 'Malaysian citizen');
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page).toHaveURL(/\/admin\/hr\/employees\/[^/]+$/, { timeout: 30_000 });
  }

  // The branch filter, so every screen below is about this branch alone.
  await page.goto('/admin/hr/employees');
  await choose(page, '.hr-side [aria-label="Branch"]', BRANCH);
  // The name is on screen twice — the "joined this year" card names them too.
  await expect(page.getByText(PEOPLE[0].name).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-three-people-joined-1-jan.png`, fullPage: true });

  // -------------------------------------------------------------------------
  // WHERE JANUARY USED TO STOP. The rest day had no field on Add employee and
  // the standing on the join date could not be corrected, so the month was
  // blocked on facts with no input anywhere. Both have inputs now; the walk
  // still arrives here because it left them blank at hire.
  // -------------------------------------------------------------------------
  await page.goto('/admin/hr/payroll?period=2026-01');
  // The clinic's own words for it: everybody held up, on four facts each, two
  // of which no screen in the product could set.
  await expect(page.getByText(`${PEOPLE.length} people will hold up approval`)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Rest day').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-january-blocked-before.png`, fullPage: true });

  for (const person of PEOPLE) {
    await page.goto('/admin/hr/employees');
    await page.locator('.hr-table').getByText(person.name, { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: person.name })).toBeVisible();

    // --- 1. Employment & salary: the employing company, and the REST DAY,
    //        both on the tab whose own record already prints them.
    await page.getByRole('tab', { name: /Employment/i }).click();
    await page.getByRole('button', { name: /Edit/i }).first().click();
    await expect(page.locator('#ed-rest')).toBeVisible();
    await choose(page, '#ed-rest', 'Sunday');
    const employer = page.locator('#ed-employer');
    if ((await employer.inputValue().catch(() => '')) === '') {
      await employer.click();
      await open(page).locator('.ant-select-item-option').first().click();
    }
    if (person === PEOPLE[0]) {
      await page.screenshot({ path: `${SHOTS}/03-rest-day-in-the-employment-drawer.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeHidden({ timeout: 30_000 });

    // --- 2. Statutory: correct the standing that starts on the join date.
    await page.getByRole('tab', { name: /Statutory/i }).click();
    await page.getByRole('button', { name: /Correct/ }).first().click();
    await expect(page.getByText(`Correct the standing from ${JOINED}`)).toBeVisible();
    await choose(page, '#st-lindung', 'Opted out through PERKESO');
    await choose(page, '#st-residence', 'Resident — progressive table');
    await choose(page, '#st-category', 'Category 1 — single');
    await page.locator('#st-reason').fill('Completing what the Add employee form did not ask for');
    if (person === PEOPLE[0]) {
      await page.screenshot({ path: `${SHOTS}/04-correcting-the-january-standing.png`, fullPage: true });
    }
    await page.getByRole('button', { name: 'Save correction' }).click();

    // BUG 5, in one assertion: the form closes on a save that went through.
    await expect(page.getByText(`Correct the standing from ${JOINED}`)).toBeHidden({ timeout: 30_000 });
    // BUG 3, in one assertion: the answer is on the record after the write.
    await expect(page.getByText('Opted out', { exact: true })).toBeVisible({ timeout: 30_000 });
    // BUG 1 and 2: ONE version, still starting on the join date.
    await expect(page.getByText(`${JOINED} — now`)).toBeVisible();
    if (person === PEOPLE[0]) {
      await page.screenshot({ path: `${SHOTS}/05-january-standing-complete.png`, fullPage: true });
    }
  }

  // -------------------------------------------------------------------------
  // JANUARY.
  // -------------------------------------------------------------------------
  await page.goto('/admin/hr/payroll?period=2026-01');
  const start = page.getByRole('button', { name: /Start January 2026 payroll/i });
  const proceed = page.getByRole('button', { name: 'Continue to review' });
  // Either the month has not been started, or a run is already open on it.
  await expect(start.or(proceed).first()).toBeVisible({ timeout: 120_000 });
  if (await start.count()) await start.click();
  await expect(proceed).toBeEnabled({ timeout: 180_000 });
  await expect(page.getByText('0 blocked')).toBeVisible();
  for (const person of PEOPLE) await expect(page.getByText(person.name).first()).toBeVisible();
  // Real figures, not a month of RM0.00.
  await expect(page.getByText(/8,500\.00/).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-january-ready-to-review.png`, fullPage: true });

  await proceed.click();
  await expect(page).toHaveURL(/step=review/, { timeout: 60_000 });
  await expect(page.getByRole('button', { name: /Approve/i }).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/07-january-review.png`, fullPage: true });
});
