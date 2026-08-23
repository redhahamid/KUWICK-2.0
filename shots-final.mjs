// THE ACCEPTANCE PACK, captured reproducibly.
//
// Run from the REPO ROOT (module resolution for @playwright/test lives here)
// against a production build served by `vite preview` on :5173 with the API
// on :3000 over the seeded QA world:
//
//   node shots-final.mjs
//   SHOT_OUT=docs/redesign-screenshots/final node shots-final.mjs
//
// It logs in as the UAT owner, walks every surface the owner named, and
// finishes on the deliberately BUSY day (26 Aug 2026) — six providers, each
// on their own persisted calendar colour, which is what proves the identity
// system rather than asserting it.
import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:5173';
const OUT = process.env.SHOT_OUT || '/tmp/claude-0/-home-user-KUWICK-2-0/0a214caa-9d38-5203-924e-744c9652cec7/scratchpad/shots';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await b.newPage({ viewport:{width:1512,height:960} });
const shot = async (name) => { await page.mouse.move(4,4); await page.waitForTimeout(1400); await page.evaluate(()=>document.fonts.ready); await page.waitForTimeout(400); await page.screenshot({path:`${OUT}/${name}.png`}); console.log(name); };

await page.goto(`${BASE}/login`);
const slug = page.locator('input[autocomplete="organization"]');
if (await slug.isVisible().catch(()=>false)) await slug.fill('uat-clinic');
await page.getByPlaceholder('name@clinic.com').fill('owner@uat.kuwick.invalid');
await page.locator('input[type="password"]').fill('CiOnly!2026');
await page.getByRole('button',{name:/log in/i}).click();
await page.waitForURL(u=>!u.pathname.includes('login'),{timeout:20000});

const view = async (v) => {
  await page.locator('.kw-calendar-toolbar .ant-segmented-item-label',{hasText:v}).click();
  await page.waitForTimeout(2000);
};
const goDate = async (iso) => {
  const picker = page.locator('.kw-calendar-toolbar input[placeholder]').first();
  await picker.click(); await picker.fill(iso); await page.keyboard.press('Enter');
  await page.waitForTimeout(2200);
};

await page.goto(`${BASE}/appointments/calendar`);
await page.waitForSelector('[data-testid="calendar-workspace"]');
await page.waitForTimeout(1800);

await view('Month');  await shot('01-calendar-month');
await view('Week');   await shot('02-calendar-week');
await view('Day');    await shot('03-calendar-day');
await view('Providers'); await page.waitForSelector('[data-testid="provider-rail"]'); await shot('04-calendar-providers');

// 11 — the deliberately BUSY state: the QA world's heavy Wednesday, six
// providers, each on their own persisted colour.
await goDate('26 Aug 2026');
await view('Day');    await shot('11-busy-day');
await view('Providers'); await page.waitForTimeout(1500); await shot('11b-busy-providers');
// The mockup's provider WORKSPACE: one doctor selected, rail + grid + mini
// calendar + summary (utilisation included where the roster has minutes).
await page.locator('.kw-provider-rail-row',{hasText:'Nurul Aisyah'}).first().click();
await page.waitForTimeout(2000); await shot('04-calendar-providers');
await view('Week');   await shot('11c-busy-week');

await page.goto(`${BASE}/appointments/list`);
await page.waitForTimeout(2600); await shot('05-appointment-list');

const checkin = page.getByRole('button',{name:/check in/i}).first();
if (await checkin.isVisible().catch(()=>false)) {
  await checkin.click();
  await page.waitForSelector('[data-testid="checkin-registration-drawer"]',{timeout:15000});
  await page.waitForTimeout(1600); await shot('06-checkin-patient-details');
  await page.getByRole('tab',{name:/visit info/i}).click();
  await page.waitForTimeout(900); await shot('07-checkin-visit-info');
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
}
await page.locator('td').filter({hasText:/Density|GP|Dental/}).first().click().catch(()=>{});
await page.waitForTimeout(1600); await shot('08-appointment-detail');
await page.keyboard.press('Escape'); await page.waitForTimeout(600);

await page.goto(`${BASE}/settings/scheduling/communication`);
await page.waitForTimeout(2600); await shot('09-communication-centre');

// The Reminder Centre opens from the List's own button.
await page.goto(`${BASE}/appointments/list`);
await page.waitForTimeout(2400);
await page.getByRole('button',{name:/reminder/i}).first().click();
await page.waitForTimeout(2200); await shot('10-reminder-centre');
console.log('done');
await b.close();
