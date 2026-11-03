import { expect, test, type Browser, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

/**
 * PAYROLL A–Z, THROUGH THE SCREENS (owner's request, 3 November 2026).
 *
 * The walk a new clinic owner takes, from the first login to a Borang EA,
 * with one screenshot per step for the owner/HR guide
 * (docs/guides/payroll-a-z-*.md). Not part of the guardrail suite: it makes
 * a clinic's whole first two months every time it runs. Run by hand against
 * a fresh, empty tenant ("Klinik Panduan"):
 *
 *   GUIDE_OWNER_EMAIL=… GUIDE_OWNER_PASSWORD=… GUIDE_STAFF_PASSWORD=… \
 *   E2E_WEB_URL=… GUIDE_API_URL=… npx playwright test --config playwright.uat.config.ts payroll-a-z
 *
 * A step that fails does not stop the walk: it is screenshotted as it stood,
 * written to steps.json with what went wrong, and the walk goes on, because
 * the guide's "Issues found" list is part of what it is for. Demo names and
 * made-up numbers only.
 */
const API = (process.env.GUIDE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const OUT = process.env.GUIDE_OUT ?? 'docs/guides/img/payroll-a-z';
const OWNER_EMAIL = process.env.GUIDE_OWNER_EMAIL ?? '';
const OWNER_PASSWORD = process.env.GUIDE_OWNER_PASSWORD ?? '';
const STAFF_PASSWORD = process.env.GUIDE_STAFF_PASSWORD ?? '';
/** For a practice run: stop after this part (a, b, c…), or start at this step id on a tenant already walked that far. */
const UNTIL = process.env.GUIDE_UNTIL ?? '';
const FROM = process.env.GUIDE_FROM ?? '';
const STAFF_EMAIL = process.env.GUIDE_STAFF_EMAIL ?? 'jururawat@klinikpanduan.kuwick.test';

/** Today in the clinic's time zone (Malaysia, UTC+8), and the time of day there. */
const clinicNow = () => new Date(Date.now() + 8 * 3_600_000);
const TODAY = clinicNow().toISOString().slice(0, 10);
const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
/** Today's shift: started about ten minutes before the walk gets to the clock-in, nine hours long. */
const lateShift = (() => {
  const now = clinicNow();
  const start = Math.floor((now.getUTCHours() * 60 + now.getUTCMinutes()) / 5) * 5 - 10;
  // Never past midnight: a walk run late in the day gets a shorter shift.
  return {
    start: hhmm(start),
    end: hhmm(Math.min(start + 9 * 60, 23 * 60 + 55)),
  };
})();
/** The day the nurse forgot to clock in and out, and asked for a fix. */
const FIX_DAY = '2026-11-02';

/** The month the walk pays first, and the one it compares against it. */
const FIRST = { period: '2026-10', label: 'October 2026' };
const SECOND = { period: '2026-11', label: 'November 2026' };

type StepRecord = {
  id: string;
  title: string;
  ok: boolean;
  problem?: string;
  note?: string;
  path: string;
};
const steps: StepRecord[] = [];

const save = () => writeFileSync(`${OUT}/steps.json`, `${JSON.stringify(steps, null, 2)}\n`);

/**
 * ONE STEP OF THE GUIDE: do it, then take its picture. A failure is kept,
 * pictured and written down, and the walk carries on.
 */
async function step(page: Page, id: string, title: string, run: () => Promise<string | void>, after?: () => Promise<unknown>) {
  if ((FROM && id < FROM) || (UNTIL && id.charAt(0) > UNTIL)) return;
  const path = `${id}.png`;
  try {
    const note = await run();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${path}`, fullPage: false });
    steps.push({ id, title, ok: true, path, ...(note ? { note } : {}) });
  } catch (error) {
    await page.screenshot({ path: `${OUT}/${path}`, fullPage: false }).catch(() => undefined);
    const problem = (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);
    steps.push({ id, title, ok: false, path, problem });
  }
  save();
  // What the step's screen is left to do once pictured (Save, Next…); a failure here shows in the next step.
  if (after) {
    await after().catch(() => undefined);
    await page.waitForTimeout(1500);
  }
}

/** Say something odd about a step without failing it: it goes in the issues list too. */
function remark(id: string, note: string) {
  const row = steps.find((candidate) => candidate.id === id);
  if (row) row.note = row.note ? `${row.note} ${note}` : note;
  save();
}

const openDropdown = (page: Page) => page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').last();

/** An antd Select, found by the field around it: open it and pick the option by its text. */
async function pick(page: Page, combobox: ReturnType<Page['locator']>, option: string | RegExp) {
  await combobox.click();
  const item = openDropdown(page).locator('.ant-select-item-option').filter({ hasText: option }).first();
  await item.click();
}

/** A searchable antd Select: type to find the option, then pick it. */
async function pickSearch(page: Page, combobox: ReturnType<Page['locator']>, text: string, option: string | RegExp = text) {
  await combobox.click();
  await page.keyboard.type(text);
  await openDropdown(page).locator('.ant-select-item-option').filter({ hasText: option }).first().click();
}

/** Scroll so this is at the top of the screen (a phone screenshot shows little else). */
const toTop = (locator: ReturnType<Page['locator']>) => locator.first().evaluate((element) => element.scrollIntoView({ block: 'start' }));

/** A form Select by its field id (`#role`), as antd renders it. */
const selectById = (page: Page, id: string) => page.locator(`.ant-select:has(#${id})`);

/** An antd DatePicker: type the value in the format it prints and commit. */
async function typeDate(page: Page, input: ReturnType<Page['locator']>, value: string) {
  await input.click();
  await input.fill(value);
  await page.keyboard.press('Enter');
}

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

/** The owner's API token, for the few facts the walk reads rather than does (ids, never data). */
async function apiToken(email: string, password: string): Promise<string> {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

async function wizardStep(page: Page, title: string) {
  await page.goto(`/admin/hr/settings?setup=1`);
  await page.locator('.hr-wiz__steps .hr-wizStep', { hasText: title }).first().click();
  await expect(page.locator('#hr-wiz-title')).toHaveText(title);
}

test.describe.configure({ mode: 'serial' });
// As a clinic in Malaysia sees it: its time zone and day-month-year dates.
test.use({ timezoneId: 'Asia/Kuala_Lumpur', locale: 'en-MY' });

test('payroll A–Z for a new clinic', async ({ page, browser }) => {
  test.setTimeout(3_600_000);
  if (!OWNER_EMAIL || !OWNER_PASSWORD) throw new Error('GUIDE_OWNER_EMAIL and GUIDE_OWNER_PASSWORD are required.');
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  page.setDefaultTimeout(15_000);

  // ---------------------------------------------------------------------
  // A. FIRST LOGIN AND THE SET UP PAYROLL WIZARD
  // ---------------------------------------------------------------------
  await step(page, 'a01-login', 'Log in', async () => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(OWNER_EMAIL);
  });
  await login(page, OWNER_EMAIL, OWNER_PASSWORD);

  await step(page, 'a02-hr-opens-on-setup', 'HR opens on Set up payroll', async () => {
    await page.goto('/admin/hr');
    await expect(page).toHaveURL(/\/admin\/hr\/settings/, {
      timeout: 60_000,
    });
    await expect(page.locator('#hr-wiz-title')).toBeVisible({
      timeout: 60_000,
    });
  });

  await step(
    page,
    'a03-company',
    'Step 1: company and statutory numbers',
    async () => {
      await wizardStep(page, 'Company & statutory numbers');
      const fill = async (placeholder: string, value: string) => {
        const box = page.getByPlaceholder(placeholder, { exact: true });
        await box.fill('');
        await box.fill(value);
      };
      await fill('Registered name, as on the SSM certificate', 'Klinik Panduan Sdn Bhd');
      await fill('e.g. 202001012345', '202601000123');
      await fill('e.g. 012345678', '099990001');
      await fill('e.g. A3100012345X', 'A3100099991X');
      await fill('e.g. E 1234567890', 'E 9999000111');
      await fill('e.g. 03-1234 5678', '03-8900 0000');
      await fill('Street and number', 'No. 1, Jalan Panduan 1/1');
      await fill('e.g. 43000', '43650');
      await fill('Name of the officer who signs Borang EA', 'Pengarah Panduan');
      await fill('e.g. Pengarah', 'Pengarah');
      await pick(page, page.locator('.hr-wizField', { hasText: 'HRD Corp registration' }).locator('.ant-select'), /By choice/);
      await page.waitForTimeout(800); // the postcode fills the town and state
      await page.locator('#hr-wiz-title').scrollIntoViewIfNeeded();
    },
    () => page.getByRole('button', { name: 'Save & next' }).click(),
  );

  await step(
    page,
    'a04-bank',
    'Step 2: company bank account',
    async () => {
      await wizardStep(page, 'Company bank account');
      await pickSearch(page, page.locator('.hr-wizField', { hasText: 'Bank' }).first().locator('.ant-select'), 'Maybank', /^Maybank$/);
      await page.getByPlaceholder('e.g. 512345678901').fill('514400001111');
    },
    () => page.getByRole('button', { name: /Save & next|Save & finish setup/ }).click(),
  );

  await step(page, 'a05-pay-rules', 'Step 3: pay rules', async () => {
    await wizardStep(page, 'Pay rules');
  });

  await step(page, 'a06-items', 'Step 4: payroll items, "Add default items"', async () => {
    await wizardStep(page, 'Payroll items');
    await page.getByRole('button', { name: 'Add default items' }).click();
    await expect(page.locator('.hr-wizStep', { hasText: 'Payroll items' }).locator('.hr-wizStep__sum')).toContainText('in use', { timeout: 30_000 });
  });

  await step(
    page,
    'a07-holidays',
    'Step 5: public holidays for Selangor',
    async () => {
      await wizardStep(page, 'Public holidays');
      await pick(page, page.locator('.hr-wizField', { hasText: 'Clinic’s state' }).locator('.ant-select'), 'Selangor');
      await expect(page.locator('.hr-holidayList li').first()).toBeVisible({
        timeout: 30_000,
      });
    },
    () => page.getByRole('button', { name: /Add \d+ holidays/ }).click(),
  );

  await step(
    page,
    'a08-opening',
    'Step 6: opening balances',
    async () => {
      await wizardStep(page, 'Opening balances');
      await page
        .getByRole('radio', {
          name: 'No, Kuwick is our first payroll this year',
        })
        .click();
    },
    () => page.getByRole('button', { name: /Save ·/ }).click(),
  );

  await step(page, 'a09-employees-step', 'Step 7: employees', async () => {
    await wizardStep(page, 'Employees');
    await expect(page.getByRole('link', { name: 'Add your first employee' })).toBeVisible();
  });

  await step(
    page,
    'a10-rates',
    'Step 8: statutory rates, acknowledged',
    async () => {
      await wizardStep(page, 'Statutory rates');
    },
    () => page.getByRole('button', { name: /Acknowledge/ }).click(),
  );

  // ---------------------------------------------------------------------
  // B. THREE PEOPLE: a doctor and a nurse on payroll, a locum who is not
  // ---------------------------------------------------------------------
  type Person = {
    id: string;
    name: string;
    role: string;
    ic: string;
    gender: 'Male' | 'Female';
    title: string;
    started: string;
    salary: string;
    bankAccount: string;
    epf: string;
    socso: string;
    tax?: string;
    login?: { email: string; password: string };
  };
  const addPerson = async (person: Person, shots: boolean) => {
    await page.goto('/admin/hr/employees/new');
    await page.locator('#fullName').fill(person.name);
    await pick(page, selectById(page, 'role'), person.role);
    await page.locator('#identifierValue').fill(person.ic);
    await page.locator('#identifierValue').blur();
    await pick(page, selectById(page, 'gender'), person.gender);
    if (shots) await shot(`${person.id}-1-personal`, `Add ${person.name}: who they are`);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.locator('#jobTitleId').click();
    const preset = openDropdown(page).locator('.ant-select-item-option').filter({ hasText: person.title });
    if ((await preset.count()) > 0) {
      await preset.first().click();
    } else {
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Add a job title' }).click();
      await page.getByLabel('New job title').fill(person.title);
      await page.getByRole('button', { name: 'Add', exact: true }).click();
    }
    await typeDate(page, page.locator('#startDate'), person.started);
    if (person.login) {
      await page.locator('#wantsLogin').click();
      await page.locator('#loginEmail').fill(person.login.email);
      await page.locator('#loginPassword').fill(person.login.password);
    }
    if (shots) await shot(`${person.id}-2-employment`, `Add ${person.name}: the job`);
    await page.getByRole('button', { name: 'Continue' }).click();

    await page.locator('#salaryAmount').fill(person.salary);
    await pickSearch(page, selectById(page, 'bankName'), 'Maybank', /^Maybank$/);
    await page.locator('#bankAccountNo').fill(person.bankAccount);
    await pick(page, selectById(page, 'restDayOfWeek'), 'Sunday');
    await pick(page, selectById(page, 'epfMembership'), /Malaysian citizen/);
    await pick(page, selectById(page, 'pcbCategory'), /Category 1/);
    await pick(page, selectById(page, 'taxResidence'), /^Resident/);
    await page.locator('#epfNumber').fill(person.epf);
    await page.locator('#socsoNumber').fill(person.socso);
    if (person.tax) await page.locator('#taxNumber').fill(person.tax);
    if (shots) await shot(`${person.id}-3-pay`, `Add ${person.name}: pay and statutory`);
    await page.getByRole('button', { name: 'Continue' }).click();
    if (shots) await shot(`${person.id}-4-review`, `Add ${person.name}: review`);
    await page.getByRole('button', { name: 'Add employee' }).click();
    await expect(page).toHaveURL(/\/admin\/hr\/employees\/[^/]+$/, {
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: person.name }).first()).toBeVisible({ timeout: 60_000 });
  };
  /** A screenshot inside a larger step, recorded as its own step. */
  const shot = async (id: string, title: string) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${id}.png`, fullPage: false });
    steps.push({ id, title, ok: true, path: `${id}.png` });
    save();
  };

  const doctor: Person = {
    id: 'b02-doctor',
    name: 'Dr Amin Contoh',
    role: 'Doctor (resident)',
    ic: '850101-10-5011',
    gender: 'Male',
    title: 'Medical officer',
    started: '1 Oct 2026',
    salary: '9000',
    bankAccount: '514400002222',
    epf: '19990001',
    socso: '850101105011',
    tax: 'SG 10000000001',
  };
  const nurse: Person = {
    id: 'b03-nurse',
    name: 'Siti Contoh',
    role: 'Front desk / clinical staff',
    ic: '960505-10-5022',
    gender: 'Female',
    title: 'Staff nurse',
    started: '15 Oct 2026',
    salary: '2600',
    bankAccount: '514400003333',
    epf: '19990002',
    socso: '960505105022',
    // No income tax number yet: the walk shows the warning it raises before Approve.
    login: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
  };

  await step(page, 'b01-employees-empty', 'Employees, before anybody is added', async () => {
    await page.goto('/admin/hr/employees');
    await expect(page.locator('.hr-pageHead, .kw-admin').first()).toBeVisible({ timeout: 60_000 });
  });
  await step(page, 'b02-doctor-5-record', 'The doctor’s record, saved', async () => {
    await addPerson(doctor, true);
  });
  await step(page, 'b03-nurse-5-record', 'The nurse’s record, saved, with a login for My Kuwick', async () => {
    await addPerson(nurse, true);
  });
  await step(page, 'b04-locum-hourly', 'A locum paid by the hour: what the Review step says', async () => {
    await page.goto('/admin/hr/employees/new');
    await page.locator('#fullName').fill('Dr Lim Contoh');
    await pick(page, selectById(page, 'role'), 'Doctor (locum)');
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await page.locator('#salaryAmount').fill('120');
    await pick(page, selectById(page, 'salaryBasis'), 'Hourly');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText(/Paid daily or hourly/)).toBeVisible();
    return 'Not saved: Kuwick pays monthly salaries only, so a sessional locum is put on the roster by name and paid outside payroll.';
  });
  await step(page, 'b05-employees-list', 'Employees, with the two staff', async () => {
    await page.goto('/admin/hr/employees');
    await expect(page.getByText(nurse.name).first()).toBeVisible({
      timeout: 60_000,
    });
  });

  if (UNTIL === 'b') return;
  // ---------------------------------------------------------------------
  // C. SHIFTS AND THE ROSTER FOR NOVEMBER
  // ---------------------------------------------------------------------
  const addTemplate = async (section: 'Doctor shifts' | 'Staff shifts', name: string, start: string, end: string) => {
    await page.goto('/admin/hr/settings/shifts');
    // Two "Add shift" buttons: the doctors' panel first, the staff's second.
    await page
      .getByRole('button', { name: 'Add shift' })
      .nth(section === 'Doctor shifts' ? 0 : 1)
      .click();
    await page.locator('#shift-name').fill(name);
    await typeDate(page, page.locator('#shift-start'), start);
    await typeDate(page, page.locator('#shift-end'), end);
    await page.locator('#shift-break').fill('60');
  };
  await step(
    page,
    'c01-shift-staff',
    'Settings → Shifts: a staff shift, 8:00 to 17:00',
    async () => {
      await addTemplate('Staff shifts', 'Pagi', '08:00', '17:00');
    },
    () => page.getByRole('button', { name: 'Save', exact: true }).last().click(),
  );
  await step(
    page,
    'c02-shift-doctor',
    'A doctor shift, 9:00 to 18:00',
    async () => {
      await addTemplate('Doctor shifts', 'Klinik', '09:00', '18:00');
    },
    () => page.getByRole('button', { name: 'Save', exact: true }).last().click(),
  );
  await step(page, 'c03-shifts', 'Both shifts on the Shifts page', async () => {
    await page.goto('/admin/hr/settings/shifts');
    await expect(page.getByText('Pagi').first()).toBeVisible({
      timeout: 30_000,
    });
  });

  /** Working days of November 2026 from the 2nd, Monday to Saturday. */
  const novemberWorkdays = Array.from({ length: 29 }, (_, i) => `2026-11-${String(i + 2).padStart(2, '0')}`).filter(
    (date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0,
  );
  const rosterRow = (name: string) =>
    page.locator('tr', {
      has: page.locator('.kw-roster-provider-name', { hasText: name }),
    });
  const cellIndex = async (date: string) => {
    const day = Number(date.slice(8));
    const headers = await page.locator('.kw-roster thead th').allInnerTexts();
    return headers.findIndex((text) => text.trim().split(/\s+/)[0] === String(day));
  };
  const rosterMonth = async (name: string, dates: string[], shift: string) => {
    await page.goto('/admin/hr/attendance/roster');
    await expect(page.getByTestId('roster-page')).toBeVisible({
      timeout: 60_000,
    });
    await page
      .getByRole('radio', { name: /Everyone · month/ })
      .click()
      .catch(() => undefined);
    for (const date of dates) {
      const index = await cellIndex(date);
      await rosterRow(name)
        .locator('td')
        .nth(index - 1)
        .click();
    }
    await page.getByRole('button', { name: /Add shift to \d+ date/ }).click();
    await pick(
      page,
      page.locator('.ant-modal .ant-select', {
        has: page.locator('[aria-label="Shift"]'),
      }),
      shift,
    );
  };
  await step(
    page,
    'c04-roster-select',
    'Roster: pick the nurse’s working days, then Add shift',
    async () => {
      await rosterMonth(
        nurse.name,
        novemberWorkdays.filter((date) => date !== TODAY),
        'Pagi',
      );
    },
    () => page.locator('.ant-modal').getByRole('button', { name: 'Add shift', exact: true }).click(),
  );
  // Today's shift for the nurse started a few minutes ago, so her scan in part D is a real late arrival.
  await step(
    page,
    'c04b-roster-today',
    `Today's shift for ${nurse.name}: custom times`,
    async () => {
      await rosterMonth(nurse.name, [TODAY], 'Custom times');
      await typeDate(page, page.locator('.ant-modal #startTime'), lateShift.start);
      await typeDate(page, page.locator('.ant-modal #endTime'), lateShift.end);
    },
    () => page.locator('.ant-modal').getByRole('button', { name: 'Add shift', exact: true }).click(),
  );
  await step(
    page,
    'c05-roster-doctor',
    'The doctor’s November shifts',
    async () => {
      await rosterMonth(
        doctor.name,
        novemberWorkdays.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 6),
        'Klinik',
      );
    },
    () => page.locator('.ant-modal').getByRole('button', { name: 'Add shift', exact: true }).click(),
  );
  await step(page, 'c06-roster-locum', 'An external locum on Saturdays, by name', async () => {
    await page.goto('/admin/hr/attendance/roster');
    await expect(page.getByTestId('roster-page')).toBeVisible({
      timeout: 60_000,
    });
    const saturdays = novemberWorkdays.filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 6);
    const locums = page.locator('tr.kw-roster-locums');
    for (const date of saturdays)
      await locums
        .locator('td')
        .nth((await cellIndex(date)) - 1)
        .click();
    await page.getByRole('button', { name: /Add shift to \d+ date/ }).click();
  });
  await page.waitForTimeout(500);
  await step(
    page,
    'c07-roster-locum-name',
    'The locum’s name and hours',
    async () => {
      await page.getByLabel("Locum's name").fill('Dr Lim Contoh');
      await pick(
        page,
        page.locator('.ant-modal .ant-select', {
          has: page.locator('[aria-label="Locum shift"]'),
        }),
        'Klinik',
      );
    },
    () => page.locator('.ant-modal').getByRole('button', { name: 'Add locum', exact: true }).click(),
  );
  await step(page, 'c08-roster-month', 'November’s roster, before it is published', async () => {
    await page.goto('/admin/hr/attendance/roster');
    await expect(page.getByTestId('roster-page')).toBeVisible({
      timeout: 60_000,
    });
  });
  await step(page, 'c09-roster-published', 'Publish November: staff now see their shifts', async () => {
    await page.getByRole('button', { name: /Publish (November|again)/ }).click();
    await expect(page.getByText(/is published to My Kuwick/)).toBeVisible({
      timeout: 30_000,
    });
  });

  if (UNTIL === 'c') return;
  // ---------------------------------------------------------------------
  // D. ATTENDANCE: a QR clock-in from the phone (late), a fix, overtime
  // ---------------------------------------------------------------------
  const WEB = (process.env.E2E_WEB_URL ?? 'http://localhost:5173').replace(/\/$/, '');
  const phoneContext = await browser.newContext({
    baseURL: WEB,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    timezoneId: 'Asia/Kuala_Lumpur',
    locale: 'en-MY',
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 2.9667, longitude: 101.7833 },
  });
  // THE PHONE'S CAMERA, pointed at the clinic screen: a picture of the kiosk's
  // current code, blurred for the first two seconds as a camera focusing is.
  await phoneContext.addInitScript(() => {
    const w = window as unknown as { __kioskSvg?: string };
    const media = navigator.mediaDevices ?? ({} as MediaDevices);
    if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', { value: media });
    media.getUserMedia = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 640;
      const context = canvas.getContext('2d') as CanvasRenderingContext2D;
      const image = new Image();
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(w.__kioskSvg ?? '<svg xmlns="http://www.w3.org/2000/svg"/>')}`;
      await image.decode().catch(() => undefined);
      const began = Date.now();
      const draw = () => {
        context.filter = Date.now() - began < 2000 ? 'blur(6px)' : 'none';
        context.fillStyle = '#d0d5dd';
        context.fillRect(0, 0, 640, 640);
        context.fillStyle = '#ffffff';
        context.fillRect(100, 100, 440, 440);
        context.drawImage(image, 140, 140, 360, 360);
      };
      draw();
      setInterval(draw, 100);
      return canvas.captureStream(10);
    };
  });
  const phone = await phoneContext.newPage();
  phone.setDefaultTimeout(15_000);
  await login(phone, STAFF_EMAIL, STAFF_PASSWORD);

  /** Back to the Attendance timesheet, on one day. */
  const timesheetOn = async (date: string) => {
    await page.goto('/admin/hr/attendance');
    await expect(page.getByRole('tab', { name: /Timesheet/ })).toBeVisible({
      timeout: 60_000,
    });
    const back = Math.round((Date.parse(`${TODAY}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
    for (let i = 0; i < back; i += 1) await page.getByRole('button', { name: 'Previous day' }).click();
    await page.waitForTimeout(800);
  };
  const nurseRow = () => page.locator('tr', { hasText: nurse.name }).first();

  let kioskUrl = '';
  await step(page, 'd01-kiosk', 'Attendance → Open kiosk screen: the code on the clinic tablet', async () => {
    await timesheetOn(TODAY);
    kioskUrl = (await page.getByRole('link', { name: 'Open kiosk screen' }).getAttribute('href')) ?? '';
    await page.goto(kioskUrl);
    await expect(page.locator('.kw-kiosk__code svg')).toBeVisible({
      timeout: 30_000,
    });
  });
  await step(phone, 'd02-phone-attendance', 'My Kuwick on the nurse’s phone: Attendance', async () => {
    await phone.goto('/my/attendance');
    await expect(phone.getByRole('button', { name: 'Scan to clock in' })).toBeVisible({ timeout: 60_000 });
  });
  await step(phone, 'd03-phone-scan', 'Scan to clock in: point the camera at the code', async () => {
    if (!page.url().includes('/kiosk/')) await page.goto(kioskUrl);
    const svg = await page.locator('.kw-kiosk__code').innerHTML();
    await phone.evaluate((code) => ((window as unknown as { __kioskSvg?: string }).__kioskSvg = code), svg);
    await phone.getByRole('button', { name: 'Scan to clock in' }).click();
    await phone.waitForTimeout(900);
  });
  await step(phone, 'd04-phone-clocked-in', 'Clocked in: the time is shown, and the day is marked late', async () => {
    await expect(phone.getByText(/Clocked in at/)).toBeVisible({
      timeout: 30_000,
    });
  });
  await step(page, 'd05-timesheet-late', `Attendance today: ${nurse.name} late`, async () => {
    await timesheetOn(TODAY);
    await expect(nurseRow()).toContainText(/late/i, { timeout: 30_000 });
  });
  await step(
    page,
    'd06-hr-records-clock-in',
    `${FIX_DAY}: she forgot her phone, so HR records the clock-in`,
    async () => {
      await timesheetOn(FIX_DAY);
      await nurseRow().getByRole('button', { name: 'Fix' }).click();
      await page.locator('#fix-in').fill('08:00');
    },
    () => page.getByRole('button', { name: 'Record the clock-in' }).click(),
  );
  await step(
    phone,
    'd07-phone-ask-fix',
    'In My Kuwick she asks for the missing clock-out to be fixed',
    async () => {
      await phone.goto('/my/attendance');
      const day = phone.locator('tr', { hasText: 'Mon 2 Nov' });
      await day.getByRole('button', { name: 'Ask for a fix' }).click();
      await phone.locator('#fix-out').fill('19:00');
      await phone.locator('#fix-reason').fill('Stayed with a late patient until 7 pm, then forgot to clock out.');
    },
    () => phone.getByRole('button', { name: 'Send to my manager' }).click(),
  );
  await step(
    page,
    'd08-hr-correction',
    'Attendance → Corrections: the manager approves the fix',
    async () => {
      await page.goto('/admin/hr/attendance');
      await page.getByRole('tab', { name: /Corrections/ }).click();
      await expect(page.locator('tr', { hasText: nurse.name }).first()).toBeVisible({ timeout: 30_000 });
    },
    () => page.locator('tr', { hasText: nurse.name }).first().getByRole('button', { name: 'Approve' }).click(),
  );
  await step(
    page,
    'd09-overtime-pending',
    `${FIX_DAY}: two hours past the shift, waiting for approval`,
    async () => {
      await timesheetOn(FIX_DAY);
      await expect(nurseRow().getByRole('button', { name: /Pending · approve/ })).toBeVisible({ timeout: 30_000 });
    },
    () =>
      nurseRow()
        .getByRole('button', { name: /Pending · approve/ })
        .click(),
  );
  await step(page, 'd10-overtime-approved', 'Overtime approved: it goes to November’s payroll', async () => {
    await expect(nurseRow()).toContainText('Approved', { timeout: 30_000 });
  });

  if (UNTIL === 'd') return;
  // ---------------------------------------------------------------------
  // E. LEAVE: one annual, one unpaid, asked for in My Kuwick, approved by HR
  // ---------------------------------------------------------------------
  const askLeave = async (kind: RegExp, date: string, reason: string) => {
    await phone.goto('/my/leave');
    const option = phone.locator('#leave-type option').filter({ hasText: kind }).first();
    await phone.locator('#leave-type').selectOption((await option.getAttribute('value')) ?? '');
    await phone.locator('#leave-from').fill(date);
    await phone.locator('#leave-to').fill(date);
    await phone.locator('#leave-reason').fill(reason);
    await phone.waitForTimeout(800);
    await toTop(phone.locator('label[for="leave-from"]'));
  };
  const submitLeave = async () => {
    await phone.getByRole('button', { name: 'Submit request' }).click();
    await phone.waitForTimeout(1500);
  };
  await step(
    phone,
    'e01-phone-annual',
    'My Kuwick → Leave: one day of annual leave',
    async () => askLeave(/annual/i, '2026-11-10', 'Family event.'),
    submitLeave,
  );
  await step(
    phone,
    'e02-phone-unpaid',
    'And one day of unpaid leave',
    async () => askLeave(/unpaid/i, '2026-11-12', 'Personal matter.'),
    submitLeave,
  );
  await step(phone, 'e03-phone-requests', 'Both requests, waiting for a decision', async () => {
    await phone.goto('/my/leave');
    await toTop(phone.getByText('My requests', { exact: true }));
  });
  const decideLeave = async (kind: RegExp) => {
    await page.goto('/admin/hr/leave');
    await page.locator('tr', { hasText: nurse.name }).filter({ hasText: kind }).first().getByRole('button', { name: 'Review' }).click();
  };
  const approveInDrawer = async () => {
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await page.waitForTimeout(1500);
  };
  await step(page, 'e04-hr-leave-list', 'HR → Leave: two requests waiting', async () => {
    await page.goto('/admin/hr/leave');
    await expect(page.locator('tr', { hasText: nurse.name }).first()).toBeVisible({ timeout: 30_000 });
  });
  await step(
    page,
    'e05-hr-annual',
    'Review the annual leave: balance and clashes, then Approve',
    async () => decideLeave(/annual/i),
    approveInDrawer,
  );
  await step(page, 'e06-hr-unpaid', 'Approve the unpaid leave: payroll deducts it', async () => decideLeave(/unpaid/i), approveInDrawer);
  await step(page, 'e07-hr-leave-approved', 'Both approved', async () => {
    await page.goto('/admin/hr/leave');
  });

  if (UNTIL === 'e') return;
  // ---------------------------------------------------------------------
  // F. CLAIMS: mileage and a receipt, submitted in My Kuwick, approved by HR
  // ---------------------------------------------------------------------
  mkdirSync(`${OUT}/downloads`, { recursive: true });
  const receiptPath = `${OUT}/downloads/receipt-demo.png`;
  await step(
    phone,
    'f01-phone-mileage',
    'My Kuwick → Claims: mileage, priced by Kuwick',
    async () => {
      await phone.goto('/my/claims');
      await phone.locator('#claim-type').selectOption('MILEAGE');
      await phone.locator('#claim-date').fill('2026-11-05');
      await phone.locator('#claim-from').fill('Klinik Panduan');
      await phone.locator('#claim-to').fill('Hospital Kajang');
      await phone.locator('#claim-km').fill('24');
      await phone.locator('#claim-purpose').fill('Took a patient’s referral letter to the hospital.');
    },
    () => phone.getByRole('button', { name: 'Submit claim' }).click(),
  );
  await step(
    phone,
    'f02-phone-receipt',
    'A claim with a receipt photo',
    async () => {
      // A made-up receipt, drawn here: no real document is used.
      const png = await phone.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 360;
        canvas.height = 480;
        const context = canvas.getContext('2d') as CanvasRenderingContext2D;
        context.fillStyle = '#fff';
        context.fillRect(0, 0, 360, 480);
        context.fillStyle = '#111';
        context.font = '20px monospace';
        ['DEMO RECEIPT', 'Kedai Contoh', '05/11/2026', '', 'Parking   RM 12.00', '', 'TOTAL     RM 12.00', '', 'Not a real receipt'].forEach(
          (line, i) => context.fillText(line, 30, 50 + i * 40),
        );
        return canvas.toDataURL('image/png').split(',')[1];
      });
      writeFileSync(receiptPath, Buffer.from(png, 'base64'));
      await phone.goto('/my/claims');
      await phone.locator('#claim-type').selectOption('TRAVEL');
      await phone.locator('#claim-date').fill('2026-11-05');
      await phone.locator('#claim-amount').fill('12');
      await phone.locator('#claim-purpose').fill('Hospital parking for the referral trip.');
      await phone.locator('#claim-receipt').setInputFiles(receiptPath);
      await toTop(phone.locator('label[for="claim-amount"]'));
    },
    () => phone.getByRole('button', { name: 'Submit claim' }).click(),
  );
  await step(phone, 'f03-phone-claims', 'Both claims, submitted', async () => {
    await phone.goto('/my/claims');
    await phone.waitForTimeout(800);
    await toTop(phone.getByText('My claims', { exact: true }));
  });
  const reviewClaim = async (text: RegExp) => {
    await page.goto('/admin/hr/claims');
    await page.locator('tr', { hasText: nurse.name }).filter({ hasText: text }).first().getByRole('button', { name: 'Review' }).click();
  };
  const approveClaim = async () => {
    await page.getByRole('button', { name: /^Approve RM/ }).click();
    await page.waitForTimeout(1500);
  };
  await step(page, 'f04-hr-claims', 'HR → Claims: two waiting', async () => {
    await page.goto('/admin/hr/claims');
    await expect(page.locator('tr', { hasText: nurse.name }).first()).toBeVisible({ timeout: 30_000 });
  });
  await step(page, 'f05-hr-mileage', 'Review the mileage claim, then Approve', async () => reviewClaim(/Mileage/i), approveClaim);
  await step(page, 'f06-hr-receipt', 'Review the receipt claim: the photo is attached', async () => reviewClaim(/Travel/i), approveClaim);
  await step(page, 'f07-hr-claims-approved', 'Approved: they are paid with the next payroll', async () => {
    await page.goto('/admin/hr/claims');
  });

  if (UNTIL === 'f') return;
  // ---------------------------------------------------------------------
  // G. PAYROLL: October first (both joined in October), then November
  // ---------------------------------------------------------------------
  const stage = (name: 'Prepare' | 'Review' | 'Approve' | 'Pay', sub: RegExp) =>
    page
      .getByRole('button', { name: new RegExp(name) })
      .filter({ hasText: sub })
      .first();
  const toStage = async (name: 'Prepare' | 'Review' | 'Approve' | 'Pay') => {
    const subs = {
      Prepare: /blocked|ready|worked out/i,
      Review: /record|Compare/i,
      Approve: /Locks the month/,
      Pay: /Bank listing/,
    };
    await stage(name, subs[name]).click();
    await page.waitForTimeout(1500);
  };
  const openMonth = async (period: string) => {
    await page.goto(`/admin/hr/payroll?period=${period}`);
    await page.waitForTimeout(2500);
  };
  const acknowledgeAll = async () => {
    for (let i = 0; i < 5; i += 1) {
      const button = page.getByRole('button', { name: 'Acknowledge', exact: true }).first();
      if (!(await button.isVisible().catch(() => false))) break;
      await button.click();
      await page.getByPlaceholder('Reason').fill('Tax number applied for at LHDN; HR adds it to her record when it arrives.');
      await page.getByRole('button', { name: 'Record and pass' }).click();
      await page.waitForTimeout(1500);
    }
  };
  const approveMonth = async (label: string) => {
    await page
      .getByRole('button', { name: `Approve ${label} payroll` })
      .last()
      .click();
    await page.locator('.ant-modal').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByText(/This month is approved/)).toBeVisible({
      timeout: 60_000,
    });
  };
  const saveDownload = async (button: ReturnType<Page['locator']>, name: string) => {
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), button.click()]);
    await download.saveAs(`${OUT}/downloads/${name}`);
  };
  /** Pay: prepare the listing(s), download each, and open "Record the transfer" for the first. A month with two pay dates has two. */
  const prepareAndRecord = async (period: string, reference: string) => {
    await openMonth(period);
    await toStage('Pay');
    const prepare = page.getByRole('button', { name: /Prepare the payment (batch|listings)/ });
    if (await prepare.isVisible().catch(() => false)) {
      await prepare.click();
      await page.waitForTimeout(2500);
    }
    const listings = page.getByRole('button', { name: /Download instruction listing/ });
    const count = await listings.count();
    for (let i = 0; i < count; i += 1) await saveDownload(listings.nth(i), `payment-listing-${period}${count > 1 ? `-${i + 1}` : ''}.csv`);
    await page.getByRole('button', { name: 'Record the transfer' }).first().click();
    await page.getByPlaceholder(/IBG-/).fill(reference);
  };
  /** Record the open transfer, then any other date's, each with its own reference. */
  const recordAll = (reference: string) => async () => {
    await page.locator('.ant-modal').getByRole('button', { name: 'Record it' }).click();
    await page.waitForTimeout(2000);
    for (let i = 2; i <= 4; i += 1) {
      const next = page.getByRole('button', { name: 'Record the transfer' }).first();
      if (!(await next.isVisible().catch(() => false))) break;
      await next.click();
      await page.getByPlaceholder(/IBG-/).fill(`${reference}-${i}`);
      await page.locator('.ant-modal').getByRole('button', { name: 'Record it' }).click();
      await page.waitForTimeout(2000);
    }
  };

  await step(page, 'g01-payroll-november-first', 'Payroll opens on this month, and says October was never run', async () => {
    await page.goto('/admin/hr/payroll');
    await expect(page.getByText(/Oct has no payroll/)).toBeVisible({
      timeout: 60_000,
    });
  });
  await step(
    page,
    'g02-october-start',
    'Run October first: Start October 2026 payroll',
    async () => {
      await page
        .getByRole('link', { name: /Run October payroll/ })
        .or(page.getByRole('button', { name: /Run October payroll/ }))
        .first()
        .click();
      await expect(page.getByRole('button', { name: /Start October 2026 payroll/ })).toBeVisible({ timeout: 30_000 });
    },
    () => page.getByRole('button', { name: /Start October 2026 payroll/ }).click(),
  );
  await step(page, 'g03-october-grid', 'October worked out: the nurse is paid from 15 October', async () => {
    await expect(page.getByRole('button', { name: 'Continue to review' })).toBeVisible({ timeout: 60_000 });
  });
  await step(
    page,
    'g04-october-acknowledge',
    'Review: one warning to acknowledge (no income tax number for the nurse)',
    async () => {
      await toStage('Review');
      await page.getByRole('button', { name: 'Acknowledge', exact: true }).first().click();
      await page.getByPlaceholder('Reason').fill('Tax number applied for at LHDN; HR adds it to her record when it arrives.');
    },
    async () => {
      await page.getByRole('button', { name: 'Record and pass' }).click();
      await page.waitForTimeout(1500);
      await acknowledgeAll();
    },
  );
  await step(
    page,
    'g05-october-approve',
    'Approve: the checklist, then Approve October 2026 payroll',
    async () => {
      await toStage('Approve');
      await expect(page.getByRole('button', { name: 'Approve October 2026 payroll' }).last()).toBeVisible();
    },
    () => approveMonth('October 2026'),
  );
  await step(
    page,
    'g06-october-transfer',
    'Pay: download the listing, pay at the bank, record the transfer',
    async () => {
      await prepareAndRecord(FIRST.period, 'IBG-DEMO-OKT-0001');
    },
    recordAll('IBG-DEMO-OKT'),
  );

  await step(
    page,
    'g07-november-start',
    'November: Start November 2026 payroll',
    async () => {
      await openMonth(SECOND.period);
      await expect(page.getByRole('button', { name: /Start November 2026 payroll/ })).toBeVisible({ timeout: 30_000 });
    },
    () => page.getByRole('button', { name: /Start November 2026 payroll/ }).click(),
  );
  await step(page, 'g08-november-grid', 'The grid: overtime (OT h, OT RM), unpaid leave (Unpaid d, Unpaid RM) and claims', async () => {
    await expect(page.getByRole('button', { name: 'Continue to review' })).toBeVisible({ timeout: 60_000 });
    await page.locator('tr', { hasText: nurse.name }).first().scrollIntoViewIfNeeded();
  });
  await step(page, 'g09-november-nurse', `${nurse.name}'s November: where each figure comes from`, async () => {
    await page.locator('tr', { hasText: nurse.name }).first().getByRole('link', { name: nurse.name }).click();
    await expect(page).toHaveURL(/\/employees\//, { timeout: 30_000 });
    await page.waitForTimeout(1500);
  });
  await step(page, 'g10-november-review', 'Review: November compared with October', async () => {
    await openMonth(SECOND.period);
    await toStage('Review');
    await acknowledgeAll();
    // The table that sets November beside October, row by row.
    const compare = page.getByTestId('month-comparison');
    await compare.scrollIntoViewIfNeeded();
    await page.mouse.wheel(0, -120);
  });
  await step(
    page,
    'g11-november-approve',
    'Approve November',
    async () => {
      await toStage('Approve');
      await expect(page.getByRole('button', { name: 'Approve November 2026 payroll' }).last()).toBeVisible();
    },
    () => approveMonth('November 2026'),
  );
  await step(page, 'g12-november-payslips', 'Pay: payslips, one per person (Print or PDF)', async () => {
    await toStage('Pay');
    await saveDownload(
      page.locator('tr', { hasText: nurse.name }).first().getByRole('button', { name: 'PDF' }),
      `payslip-${SECOND.period}-nurse.pdf`,
    );
    await page.getByText('Payslips', { exact: true }).first().scrollIntoViewIfNeeded();
  });
  await step(
    page,
    'g13-november-transfer',
    'Two pay dates this month (claims on the 15th, salary on the 30th): a listing (CSV) and a recorded transfer for each',
    async () => {
      await prepareAndRecord(SECOND.period, 'IBG-DEMO-NOV-0001');
    },
    recordAll('IBG-DEMO-NOV'),
  );
  await step(page, 'g14-november-paid', 'Both transfers recorded', async () => {
    await expect(page.getByText(/Transfer recorded/).first()).toBeVisible({
      timeout: 30_000,
    });
    await page
      .getByText(/Transfer recorded/)
      .first()
      .scrollIntoViewIfNeeded();
  });
  for (const [index, tab] of (['KWSP', 'PERKESO', 'LHDN', 'HRD'] as const).entries()) {
    await step(page, `g${15 + index}-filing-${tab.toLowerCase()}`, `Statutory filing helper: ${tab}`, async () => {
      if (index === 0) {
        await openMonth(SECOND.period);
        await toStage('Pay');
        await page.getByRole('link', { name: /Statutory filing helper/ }).click();
        await expect(page).toHaveURL(/\/filing$/, { timeout: 30_000 });
      }
      await page
        .getByRole('tab', { name: tab, exact: true })
        .or(page.getByText(tab, { exact: true }))
        .first()
        .click();
      await page.waitForTimeout(1000);
    });
  }
  await step(
    page,
    'g19-filing-recorded',
    'After paying at the portal: Mark as submitted, with its reference',
    async () => {
      await page
        .getByRole('tab', { name: 'KWSP', exact: true })
        .or(page.getByText('KWSP', { exact: true }))
        .first()
        .click();
      await page.getByRole('button', { name: 'Mark as submitted' }).first().click();
      await page.getByLabel('Reference from the portal').fill('KWSP-DEMO-112026');
    },
    async () => {
      await page.getByRole('button', { name: 'Record submission' }).click();
      await page.waitForTimeout(1500);
    },
  );
  await step(phone, 'g20-phone-payslip', 'The nurse sees her payslip in My Kuwick', async () => {
    await phone.goto('/my/payslips');
    await phone.waitForTimeout(2000);
  });

  if (UNTIL === 'g') return;
  // ---------------------------------------------------------------------
  // H. YEAR END: Borang EA
  // ---------------------------------------------------------------------
  await step(page, 'h01-year-end', 'Reports → Year-end forms: Borang EA for 2026', async () => {
    await page.goto('/admin/hr/reports/year-end');
    await expect(page.locator('tr', { hasText: doctor.name }).first()).toBeVisible({ timeout: 60_000 });
    await saveDownload(page.locator('tr', { hasText: doctor.name }).first().getByRole('button', { name: 'PDF' }), 'borang-ea-2026-doctor.pdf');
  });
  await phoneContext.close();
});
