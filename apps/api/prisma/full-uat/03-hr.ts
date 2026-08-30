/**
 * SECTION 4 — HR, the owner's "especially important" module.
 *
 * The brief compares this to a practical Malaysian SME HR/payroll system and
 * asks to see EVERYTHING that currently exists. So this script captures every
 * HR screen and every state it can reach, and the inventory that accompanies it
 * says plainly which of the owner's list is IMPLEMENTED, which is ENGINE EXISTS
 * BUT NOT READY, and which is NOT IMPLEMENTED.
 *
 * The four the script cannot capture, because there is nothing to photograph:
 *
 *   - ADD/EDIT EMPLOYEE from inside Admin. `useUpsertEmployee` exists and the
 *     endpoint exists; no Admin screen calls either. The legacy Management
 *     staff page has the form, so this script captures it AT ITS OWN URL and
 *     the inventory records that it is not reachable from the Admin rail.
 *   - LEAVE POLICY / LEAVE TYPE configuration. Endpoints exist, no UI.
 *   - STATUTORY RATE-TABLE configuration. Read-only list, no create form.
 *   - INCENTIVE RULE configuration. Read-only list, no create form.
 *   - PAYSLIP. Nothing generates one anywhere in the product.
 */
import { ensureOut, launch, open, pageShot, settle, shot, step, wideShot, writeManifest } from './harness';

async function main() {
  ensureOut();
  const { browser, page } = await launch();

  // --- A. Workforce ------------------------------------------------------
  await pageShot(page, '60-hr-today-dashboard', '/admin/hr');
  await pageShot(page, '61-hr-employee-directory', '/admin/hr/employees');

  // THE EMPLOYEE RECORD, in two frames because it is taller than the drawer.
  await step('62-hr-employee-profile-top', async () => {
    await open(page, '/admin/hr/employees');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await shot(page, '62-hr-employee-profile-top', { viewport: true });
  });

  await step('63-hr-employee-profile-payroll-history', async () => {
    const body = page.locator('.ant-drawer-body').first();
    await body.evaluate((node) => node.scrollTo(0, node.scrollHeight));
    await settle(page, 600);
    await shot(page, '63-hr-employee-profile-payroll-history', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // ADD / EDIT EMPLOYEE lives only in the legacy Management staff page. It is
  // captured at that URL so the owner can see it exists, and the inventory
  // records that Admin has no door to it.
  await pageShot(page, '64-hr-staff-management-legacy', '/management/hr/staff');

  await step('65-hr-add-staff-form-legacy', async () => {
    await open(page, '/management/hr/staff');
    await page.getByRole('button', { name: /Add Staff/i }).click();
    await page.locator('.ant-drawer-content, [role="dialog"]').first().waitFor({ timeout: 15_000 });
    await settle(page, 700);
    await shot(page, '65-hr-add-staff-form-legacy', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- B. Attendance -----------------------------------------------------
  await pageShot(page, '66-hr-attendance-timesheets', '/admin/hr/attendance');

  // Unapproved overtime is shown separately and is NOT paid until somebody
  // other than the claimant approves it. That control is the screenshot.
  await step('67-hr-attendance-overtime-approval', async () => {
    await open(page, '/admin/hr/attendance');
    const approve = page.getByRole('button', { name: /Approve/i }).first();
    if (await approve.count() > 0) await approve.hover();
    await settle(page, 400);
    await shot(page, '67-hr-attendance-overtime-approval');
  });

  // --- C. Leave ----------------------------------------------------------
  await pageShot(page, '68-hr-leave-requests', '/admin/hr/leave');

  await step('69-hr-leave-request-form', async () => {
    await open(page, '/admin/hr/leave');
    await page.getByRole('button', { name: /Request Leave|New request|Add/i }).first().click({ timeout: 8_000 });
    await page.locator('.ant-drawer-content, [role="dialog"]').first().waitFor({ timeout: 15_000 });
    await settle(page, 700);
    await shot(page, '69-hr-leave-request-form', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- D. Roster ---------------------------------------------------------
  await pageShot(page, '70-hr-roster-month', '/admin/hr/roster');

  // EDITING A SHIFT is a two-step move on this board and the capture follows
  // it: clicking a day CELL picks that date (the board supports picking several
  // at once), which is what enables "Add shift" and opens the editor.
  await step('71-hr-roster-shift-edit', async () => {
    await open(page, '/admin/hr/roster');
    await page.locator('td.kw-roster-cell').first().click({ timeout: 8_000 });
    await settle(page, 400);
    await page.getByRole('button', { name: /Add shift/i }).click({ timeout: 8_000 });
    await page.locator('.ant-modal-content, .ant-drawer-content, [role="dialog"]').first()
      .waitFor({ timeout: 15_000 });
    await settle(page, 700);
    await shot(page, '71-hr-roster-shift-edit', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // --- E. Payroll — the section the owner asked for LARGE screenshots of ---
  await pageShot(page, '72-hr-payroll-landing', '/admin/hr/payroll');

  await step('73-hr-payroll-new-run-modal', async () => {
    await open(page, '/admin/hr/payroll');
    await page.getByRole('button', { name: /New payroll run/i }).click();
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 });
    await settle(page, 600);
    await shot(page, '73-hr-payroll-new-run-modal', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // THE RUN DETAIL: employee-by-employee, with the statutory columns BLANK
  // rather than zero and the exception that blocks approval named.
  await step('74-hr-payroll-run-detail', async () => {
    await open(page, '/admin/hr/payroll');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 1000);
    await shot(page, '74-hr-payroll-run-detail');
  });

  // The payslip-level breakdown for ONE employee, which on this screen is the
  // per-employee row with every column shown. Turning the optional columns on
  // is what makes basic/OT/allowance/incentive/deduction/employer cost visible.
  await step('75-hr-payroll-employee-breakdown', async () => {
    await open(page, '/admin/hr/payroll');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 900);
    // antd's column dropdown CLOSES on each click, so the picker is reopened
    // per column. `.last()` is the payslip table's own picker — the runs table
    // above it has one too.
    const picker = page.getByTitle('Columns').last();
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
    await settle(page, 700);
    await wideShot(page, '75-hr-payroll-employee-breakdown');
  });

  // The statutory rate-set list — READ ONLY. There is no create form, which is
  // why payroll cannot be made ready from inside the product.
  await step('76-hr-payroll-statutory-notready-banner', async () => {
    await open(page, '/admin/hr/payroll');
    await shot(page, '76-hr-payroll-statutory-notready-banner', { viewport: true });
  });

  // --- F. Doctor incentives ----------------------------------------------
  await pageShot(page, '77-hr-incentives-overview', '/admin/hr/incentives');

  await step('78-hr-incentive-run-detail', async () => {
    await open(page, '/admin/hr/incentives');
    await page.locator('.ant-table-tbody tr.ant-table-row').first().click();
    await settle(page, 1000);
    await shot(page, '78-hr-incentive-run-detail');
  });

  await step('79-hr-incentive-rules', async () => {
    await open(page, '/admin/hr/incentives');
    const rules = page.locator('.kw-adminSection', { hasText: /rule/i }).first();
    if (await rules.count() > 0) await rules.scrollIntoViewIfNeeded();
    await settle(page, 500);
    await shot(page, '79-hr-incentive-rules');
  });

  // --- G. Staff benefits --------------------------------------------------
  await pageShot(page, '80-hr-staff-benefits', '/admin/hr/benefits');

  await step('81-hr-staff-benefit-member-detail', async () => {
    await open(page, '/admin/hr/benefits');
    await page.locator('.ant-table-row-expand-icon').first().click({ timeout: 8_000 });
    await settle(page, 700);
    await shot(page, '81-hr-staff-benefit-member-detail');
  });

  // --- H. Roles & access --------------------------------------------------
  await pageShot(page, '82-hr-roles-and-access', '/admin/hr/access');

  await step('83-hr-custom-role-permission-matrix', async () => {
    await open(page, '/admin/hr/access');
    await page.getByRole('button', { name: /New role/i }).click();
    await page.locator('.ant-drawer-content, [role="dialog"]').first().waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await shot(page, '83-hr-custom-role-permission-matrix', { viewport: true });
    await page.keyboard.press('Escape');
  });

  // PER-STAFF ACCESS: which roles a person holds and the one-off grants on top.
  // Reachable from the legacy staff page, not from Admin — recorded as such.
  await step('84-hr-staff-access-drawer-legacy', async () => {
    await open(page, '/management/hr/staff');
    await page.locator('[data-testid="open-access"]').first().click({ timeout: 8_000 });
    // BY ITS OWN TITLE. The staff page mounts several drawers, and the
    // Add-Staff one is in the DOM (closed) from the earlier capture — waiting
    // on `.ant-drawer-content` matched that one and then timed out on content
    // that was never going to appear.
    await page.locator('.ant-drawer-title', { hasText: /^Access —/ }).waitFor({ timeout: 15_000 });
    await settle(page, 800);
    await shot(page, '84-hr-staff-access-drawer-legacy', { viewport: true });
    await page.keyboard.press('Escape');
  });

  await browser.close();
  writeManifest('manifest-03-hr.json');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
