/**
 * SECTION 3 — PANEL, every screen and every workflow state.
 *
 * The seeded clinic carries three panel companies with deliberately different
 * rules — one with a percentage admin fee and a 45-day term, one flat-fee on 30
 * days, one with no fee on 60 — so the same screens can be seen handling
 * different panel workflows, which is what the owner asked for.
 *
 * WHAT THIS SCRIPT CANNOT CAPTURE, and the inventory says so: there is no UI
 * for recording a panel remittance (the endpoint and the hook exist, the screen
 * does not), and no UI for a claim's event timeline. Both are recorded as gaps
 * rather than approximated with a screenshot of something else.
 */
import { ensureOut, launch, open, pageShot, settle, shot, step, wideShot, writeManifest } from './harness';

/** The workspace's three views are one route driven by a button group. */
async function view(page: import('playwright-core').Page, label: string) {
  await open(page, '/admin/panel');
  await page.getByRole('button', { name: new RegExp(label, 'i') }).click();
  await settle(page);
}

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  // --- Submission side ---------------------------------------------------
  await pageShot(page, '40-panel-submission-queue', '/admin/panel');

  // THE READINESS CHECKLIST. A claim is checked against that panel's own
  // requirements BEFORE anybody opens a portal — the "not ready" rows carry
  // the reason, which is the whole point of the screen.
  await step('41-panel-claim-readiness-checklist', async () => {
    await view(page, 'To submit');
    const notReady = page.locator('.ant-table-tbody tr.ant-table-row').filter({ hasText: /Missing|missing/ });
    if (await notReady.count() > 0) await notReady.first().hover();
    await settle(page, 500);
    await shot(page, '41-panel-claim-readiness-checklist');
  });

  await step('42-panel-mark-submitted-modal', async () => {
    await view(page, 'To submit');
    await page.getByRole('button', { name: /Mark submitted/i }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '42-panel-mark-submitted-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- Work queue: rejected, partially approved, overdue -----------------
  await step('43-panel-work-queue', async () => {
    await view(page, 'Work queue');
    await shot(page, '43-panel-work-queue');
  });

  // THE FULL RE-CLAIM CHAIN, which the default queue correctly hides: a claim
  // settled by being re-claimed must not be chased twice. Ticking the box is
  // how somebody answers "what happened to that one".
  await step('44-panel-work-queue-include-resolved', async () => {
    await view(page, 'Work queue');
    await page.getByLabel('Include resolved').check();
    await settle(page);
    await shot(page, '44-panel-work-queue-include-resolved');
  });

  // Scrolled to the re-claim columns: original claim number, replacement,
  // resubmission date, resolved date — the Google Sheet's own layout.
  await step('45-panel-reclaim-chain-columns', async () => {
    await view(page, 'Work queue');
    await page.getByLabel('Include resolved').check();
    await settle(page);
    await page.locator('.ant-table-body, .ant-table-content').first()
      .evaluate((node) => node.scrollTo(node.scrollWidth, 0));
    await settle(page, 800);
    await shot(page, '45-panel-reclaim-chain-columns');
  });

  await step('46-panel-record-outcome-modal', async () => {
    await view(page, 'Work queue');
    await page.getByRole('button', { name: /Record outcome/i }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '46-panel-record-outcome-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await step('47-panel-write-off-modal', async () => {
    await view(page, 'Work queue');
    await page.getByRole('button', { name: /Write off/i }).first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '47-panel-write-off-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // A RE-CLAIM ON A CLAIM THAT HAS NOT ALREADY HAD ONE. The seed's other
  // rejection was re-claimed the next day, and the workspace correctly refuses
  // a second replacement for one rejection — so this uses MC-2026-00204, which
  // was rejected eleven days ago and is still waiting on a decision.
  await step('48-panel-reclaim-modal', async () => {
    await view(page, 'Work queue');
    await page.getByRole('button', { name: /Re-claim/i }).first().click({ timeout: 8_000 });
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '48-panel-reclaim-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- Reconciliation and aging -----------------------------------------
  await step('49-panel-reconciliation', async () => {
    await view(page, 'Reconciliation');
    await shot(page, '49-panel-reconciliation');
  });

  // --- Configuration: three panels, three different rule sets ------------
  await pageShot(page, '50-panel-configuration', '/admin/panel/configuration');

  // The optional columns hold the rules the owner listed: claim-number format,
  // account reference, per-panel instructions. Turning them on is how a person
  // sees them, so the capture turns them on.
  await step('51-panel-configuration-all-columns', async () => {
    await open(page, '/admin/panel/configuration');
    // antd's column dropdown CLOSES on each click, so the picker is reopened
    // per column rather than toggled in one pass. That is also what a person
    // does, one hidden column at a time.
    const picker = page.getByTitle('Columns').first();
    await picker.click();
    await settle(page, 400);
    const total = await page.locator('.ant-dropdown .ant-checkbox-wrapper').count();
    await page.keyboard.press('Escape');
    for (let i = 0; i < total; i += 1) {
      await picker.click();
      await page.waitForTimeout(250);
      const label = page.locator('.ant-dropdown .ant-checkbox-wrapper').nth(i);
      const on = await label.locator('input').isChecked().catch(() => true);
      if (!on) await label.click({ timeout: 5_000 }).catch(() => {});
      await page.keyboard.press('Escape');
      await page.waitForTimeout(150);
    }
    await settle(page, 600);
    await wideShot(page, '51-panel-configuration-all-columns');
  });

  await pageShot(page, '52-panel-companies', '/admin/panel/companies');
  await pageShot(page, '53-panel-claim-batches', '/admin/panel/batches');

  await browser.close();
  writeManifest('manifest-02-panel.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
