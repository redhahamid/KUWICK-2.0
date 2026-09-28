import { expect, test } from "@playwright/test";
import {
  ADMIN_ACCOUNTS,
  collectAdminConsoleErrors,
  currentPayrollPeriod,
  deleteRuleSetsNamed,
  gotoAdmin,
  loginAdmin,
  seededPayrollPeriod,
  statValue,
} from "./support/admin";

/**
 * SCENARIO 6 — an employee, their hours, and a payroll run.
 *
 * The assertion this module lives or dies on is the one about statutory
 * figures. Malaysian EPF, SOCSO, EIS and PCB rates are not built into Kuwick,
 * they are configuration a clinic owns and dates, and no rate table exists in
 * this tenant. A payroll screen that filled those columns with plausible
 * numbers would be worse than one that refuses, because somebody would file
 * them. So the refusal is tested as a feature.
 */
test.describe("HR", () => {
  test("the landing page says who is here and what is blocked on a manager", async ({
    page,
  }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/today");

    await expect(
      page.getByRole("heading", { name: "Today", exact: true }),
    ).toBeVisible();

    // Somebody is actually on the floor, and the roster is read from the
    // canonical provider roster rather than a second HR-only schedule.
    await expect(statValue(page, "ON DUTY NOW")).not.toHaveText("0");
    await expect(
      page.getByText(/Read from the provider roster/i),
    ).toBeVisible();
    await expect(
      page.getByText(/changing a shift happens there, not here/i),
    ).toBeVisible();

    /*
     * WHAT NEEDS ATTENTION IS NAMED, not counted.
     *
     * This asserted three exception TILES by label. The tiles are gone: twelve
     * counters at the top of a screen told a manager they had work and nothing
     * about whose it was. Needs Attention is a list of named rows now, and a
     * clean clinic gets one sentence rather than a row of zeroes — so what is
     * pinned here is the guarantee (every outstanding item is named and opens
     * the work), not a fixed set of labels.
     */
    const attention = page.locator(".kw-panel", { hasText: "Needs attention" });
    await expect(attention).toBeVisible();
    const rows = attention.locator(".kw-panelRow");
    const count = await rows.count();
    if (count === 0) {
      await expect(attention).toContainText(/Nothing is waiting on you/i);
    } else {
      for (let index = 0; index < count; index += 1) {
        // A row that names work and goes nowhere is the failure this replaced.
        await expect(rows.nth(index)).toHaveAttribute("href", /\/admin\/hr\//);
      }
    }

    expect(errors).toEqual([]);
  });

  test("account, employment and clinical credential stay three separate facts", async ({
    page,
  }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/employees");

    await expect(
      page.getByRole("heading", { name: "Employees", exact: true }),
    ).toBeVisible();

    /*
     * THE DISTINCTION IS SHOWN, NOT EXPLAINED.
     *
     * This asserted the subtitle "account, employment and clinical credential
     * are three separate facts about one person" — which was accurate, and was
     * the schema describing itself to somebody who came here to look up a
     * receptionist's phone number. The sentence is gone; the guarantee is not,
     * and the two assertions below are what it actually amounts to.
     *
     * A doctor is an employee AND a credentialed clinician; a stock controller
     * is an employee and not a clinician. Collapsing those is how a clinic ends
     * up letting the wrong person sign a prescription.
     */
    await expect(
      page.getByRole("row", { name: /Dr Aisyah Rahman/ }),
    ).toContainText(/may sign/);
    await expect(page.getByRole("row", { name: /Hafiz Osman/ })).toContainText(
      /Not a clinician/,
    );

    expect(errors).toEqual([]);
  });

  test("unapproved overtime is shown separately and is not paid", async ({
    page,
  }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/attendance");

    await expect(
      page.getByRole("heading", { name: "Attendance", exact: true }),
    ).toBeVisible();
    // The GUARANTEE, not one wording of it. The subtitle was shortened when
    // the copy was cut back — "shown separately and is not paid" became "is not
    // paid" — and a test that pins the sentence rather than the promise breaks
    // on every edit while proving nothing extra. What must stay true is that
    // unapproved overtime is named as unpaid AND counted in its own column.
    await expect(
      page.getByText(/Overtime nobody has approved is not paid/i),
    ).toBeVisible();

    /*
     * TWO COLUMNS, DELIBERATELY — and they are the sheet's now, not the
     * summary's.
     *
     * The summary strip carries the reference sheet's five figures (scheduled,
     * present, late, missing punch, OT pending), so approved overtime moved to
     * where it is compared with the pending hours: the per-person row. The
     * guarantee is unchanged — approved and unapproved overtime are never one
     * number — and this pins it where it now lives.
     */
    /*
     * Piece 3e put the screen on the Slate kit and made the DAY the unit, so
     * the two figures live in two places now and both are pinned here:
     *
     *   - the day sheet names what is waiting on a manager, per person, in its
     *     own column, with the approval as the control ("Pending · approve");
     *   - the month, behind the fourth tab, keeps approved and unapproved
     *     overtime in two columns, which is the guarantee itself.
     */
    await expect(page.getByText(/pending approval ·/i)).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "OT status" }),
    ).toBeVisible();

    await page.getByRole("tab", { name: "Monthly summary" }).click();
    await expect(
      page.getByRole("columnheader", { name: "OT approved" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "OT pending" }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("the seeded month reads as what it is, and the month nobody started says so", async ({
    page,
  }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);

    /*
     * THE PERIOD COMES FROM THE SEED'S OWN ARITHMETIC, not from a month
     * somebody typed in.
     *
     * This spec used to open `?period=2026-08` with a comment explaining that
     * hardcoding it removed a shelf life. It did the opposite. `seed-hr-uat.ts`
     * runs `[-3, -2, -1]` RELATIVE TO TODAY, so the month it pays moves every
     * time the calendar does; pinning the spec to August only moved the shelf
     * life from the seed to the assertion, and on 1 September 2026 the spec
     * began failing against a freshly seeded world while still passing against
     * a stale database — the worst of both, because the red only appears once
     * somebody re-seeds and then looks like their own change broke it.
     *
     * `seededPayrollPeriod()` already existed for exactly this, and nothing
     * used it.
     */
    const seeded = seededPayrollPeriod();
    await gotoAdmin(page, `/admin/hr/payroll?period=${seeded}`);

    await expect(
      page.getByRole("heading", { name: "Payroll", exact: true }),
    ).toBeVisible();
    // The month IS the landing screen — no dashboard between an owner and it.
    await expect(page.locator(".hr-stats")).toBeVisible();
    await expect(page.locator(".kw-payrollGrid")).toBeVisible();

    /*
     * THE STATUS IS THE ONE THE SEED ACTUALLY LEFT BEHIND: Paid.
     *
     * The seed does not stop at calculated. It drives every one of its three
     * months create → calculate → approve → prepare the payment → record it
     * paid, and it REFUSES to continue if a month carries a blocking exception
     * (`seed-hr-uat.ts`: "the seed must complete the record instead"). So a
     * seeded month is paid and clean by construction, and a spec asserting a
     * `Calculated` chip here was asserting a state this world cannot reach.
     *
     * A chip rather than an antd tag, and sentence case rather than the enum:
     * HR speaks one status vocabulary now (see components/Chip.tsx), and a
     * screen that prints the status is talking to the database.
     */
    await expect(
      page.locator(".hr-chip", { hasText: "Paid" }).first(),
    ).toBeVisible();
    // Every stage behind it is done, which is what paid MEANS on this screen.
    for (const stage of ["Prepare", "Review", "Approve", "Pay"]) {
      await expect(
        page.locator(".hr-step", { hasText: stage }).first(),
      ).toBeVisible();
    }

    /*
     * THE ONE SAFETY INDICATOR — honest in BOTH directions. This spec used to
     * assert a page of red copy including "PCB is not calculated at all" —
     * statements that became FALSE when the MTD engine shipped. It then
     * asserted the one-line "not yet production-ready" banner, which became
     * the same defect the other way up: the banner read the run's STORED
     * status while the registry's schedules covered the period in full, so it
     * cried wolf over every fully covered month. The landing now serves the
     * period's own registry answer, and for the seeded month — every schedule
     * OFFICIAL_SOURCE_VERIFIED — the banner must be ABSENT. A warning that
     * overstates is the same defect as one that understates: the reader who
     * catches it wrong once stops believing the rest of it.
     */
    await expect(
      page.getByText(/Payroll statutory setup is not yet production-ready/i),
    ).toHaveCount(0);
    await expect(
      page.getByText(/must not be used to pay staff or file a return/i),
    ).toHaveCount(0);

    /*
     * NOTHING BLOCKED MEANS NOTHING BLOCKED, and the rows still admit which
     * ones a human should look at.
     *
     * This is what replaced the old half of this spec. It used to open the
     * Review stage and assert a named blocked employee ("Wan Azman — Salary
     * setup is incomplete"). That employee now has a salary and the seed
     * cannot leave a blocker behind at all, so the assertion described a world
     * the seed no longer builds. The virtue it was defending survives in a
     * form this world can actually prove: a run that says it is clean says so
     * without also flattening the rows that need a second look into "Ready".
     *
     * "Needs attention" is the chip's word, and it is the server's own name
     * for the state (NEEDS_ATTENTION). It used to read "Check", which said how
     * serious the row was and never what was wrong with it — so the reason now
     * sits on the row beneath the chip, and this asserts both.
     */
    await expect(page.getByText(/Nothing blocked/i).first()).toBeVisible();
    const attention = page.locator(".hr-chip", { hasText: "Needs attention" }).first();
    await expect(attention).toBeVisible();
    // The reason, on the row — not only in a hover a phone cannot perform.
    await expect(
      page.locator(".hr-standing").filter({ has: attention }).locator(".hr-standing__why").first(),
    ).not.toBeEmpty();

    /*
     * The month's own totals are real computed figures — net pay and employer
     * cost, not zeroes behind an honest-looking banner.
     */
    await expect(page.locator(".hr-stats")).toContainText(/RM[\d,]+\.\d\d/);

    /*
     * AND THE MONTH NOBODY STARTED SAYS SO, rather than inventing figures for
     * it. The old spec's own comment promised this was "asserted separately
     * below" and it never was.
     */
    const current = currentPayrollPeriod();
    await gotoAdmin(page, `/admin/hr/payroll?period=${current}`);
    await expect(page.getByText(/has not been started/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /Start .* payroll/i }),
    ).toBeVisible();
    // No run means no status chip to read, and no totals to misread.
    await expect(page.locator(".hr-chip", { hasText: "Paid" })).toHaveCount(0);

    expect(errors).toEqual([]);
  });

  test("a paid incentive is never recalculated with today rules", async ({
    page,
  }) => {
    const errors = collectAdminConsoleErrors(page);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/incentives");

    await expect(
      page.getByRole("heading", { name: "Doctor Incentives" }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /versioned so a paid incentive is never recalculated with today's rules/i,
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("row", { name: /APPROVED/ }).first(),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});

/**
 * A REFUSAL THE PERSON WHO CAUSED IT CAN SEE, AT THE WIDTH THEY SAW IT.
 *
 * Staging UAT, twice. First: typing an overtime divisor of 30 was correctly
 * refused and the refusal was INVISIBLE — the drawer body scrolls and Save
 * sits in a pinned footer outside it, so the reason rendered at the top of a
 * body already scrolled past. The fix put the reason under the three-up
 * divisor row, measured at 1440, and shipped.
 *
 * Second: on an iPad the reason appeared nowhere near the divisor. The row is
 * only a row above 992px — `.hr-grid3` collapses to a single column below it —
 * so "under the row" meant under a STACK, and a complaint about the overtime
 * divisor printed below the unpaid-leave box two fields down.
 *
 * Which is why this runs at 390px. The unit tests pin the structure; only a
 * browser can say how far apart two boxes actually are, and the first fix
 * passed every test it had while being wrong on the screen it was used on.
 */
test.describe("a refused rule set says why, beside the box that is wrong", () => {
  const PHONE = { width: 390, height: 844 };
  // Every rule set this block saves carries the prefix, and goes again after
  // each test — a run pointed at a shared database used to leave two behind.
  const PREFIX = "E2E rule set";
  test.beforeAll(async ({ request }) => {
    await deleteRuleSetsNamed(request, PREFIX);
  });
  test.afterEach(async ({ request }) => {
    await deleteRuleSetsNamed(request, PREFIX);
  });

  test("puts the reason directly under the divisor on a phone-width screen", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/settings/payroll");

    await page.getByRole("button", { name: "Add rule set" }).click();
    await page.getByLabel("Name").fill(`${PREFIX} phone width ${Date.now()}`);
    const divisor = page.locator("#orp-ot-days");
    await divisor.fill("30");
    await page.getByRole("button", { name: "Add rule set" }).last().click();

    // Section 60I(1A) sets 26. Above it every hour of overtime is worth less.
    const reason = page.getByText(
      /makes a day worth less than section 60I\(1A\)/i,
    );
    await expect(reason).toBeVisible();

    const box = await divisor.boundingBox();
    const said = await reason.boundingBox();
    expect(box).not.toBeNull();
    expect(said).not.toBeNull();
    // Directly under the box, not under the group. One short gap, never the
    // height of two more fields — which is what "under the row" measured at
    // this width.
    const gap = said!.y - (box!.y + box!.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(40);

    // And the caret is back in the box that has to change, so the next
    // keystroke fixes it.
    await expect(divisor).toBeFocused();
  });

  /*
   * BELOW THE ACT IS A DECISION, NOT A MISTAKE.
   *
   * It used to be refused outright. An employer may choose to pay under the
   * Act and owe the difference, and a product that overrules that is deciding
   * something that is not its to decide. What it owes instead is that nobody
   * does it by accident: the section, the minimum and the word BELOW before
   * Save, a tick, a reason, and a mark that outlives the drawer.
   */
  test("warns about a multiplier below the Act and asks for more than a Save", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/settings/payroll");

    await page.getByRole("button", { name: "Add rule set" }).click();
    await page.getByLabel("Name").fill(`${PREFIX} below the Act ${Date.now()}`);
    await page.locator("#ruleset-ot-multiplier").fill("1.25");

    // The warning is there BEFORE Save, naming the section and the minimum.
    const notice = page.locator("#below-act-confirm");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("BELOW");
    await expect(notice).toContainText("1.5×");
    await expect(notice).toContainText("Section 60A(3)(a)");

    // Pressing Save on its own is not the confirmation.
    await page.getByRole("button", { name: "Add rule set" }).last().click();
    await expect(
      page.getByText(/Confirm that it is deliberate/i),
    ).toBeVisible();

    // Ticking without a reason is not either.
    await notice.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Add rule set" }).last().click();
    await expect(
      page.getByText(/Say why this rule set pays below the Act/i),
    ).toBeVisible();
  });

  test("stores the choice once it is made, and marks the row for good", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/settings/payroll");

    const name = `${PREFIX} paid below ${Date.now()}`;
    await page.getByRole("button", { name: "Add rule set" }).click();
    await page.getByLabel("Name").fill(name);
    await page.locator("#ruleset-ot-multiplier").fill("1.25");
    await page.locator("#below-act-confirm").getByRole("checkbox").check();
    await page
      .locator("#below-act-why")
      .fill("Agreed in the employment contracts");
    await page.getByRole("button", { name: "Add rule set" }).last().click();

    // The permanent mark: the chip is on the row, not only in the drawer that
    // has since closed, so whoever opens this screen next sees the choice.
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Below the Act");
  });

  test("accepts a multiplier above the Act, because that pays more", async ({
    page,
  }) => {
    await page.setViewportSize(PHONE);
    await loginAdmin(page, ADMIN_ACCOUNTS.owner);
    await gotoAdmin(page, "/admin/hr/settings/payroll");

    await page.getByRole("button", { name: "Add rule set" }).click();
    const name = `${PREFIX} overtime at two ${Date.now()}`;
    await page.getByLabel("Name").fill(name);
    await page.locator("#ruleset-ot-multiplier").fill("2");
    await page.getByRole("button", { name: "Add rule set" }).last().click();

    // The rule set list says whose multipliers are in force, so nobody reads
    // the Act's figure over a clinic's own. Scoped to this test's own row:
    // every run adds one (and removes it afterwards), and a page-wide match
    // would pass on somebody else's.
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(row).toContainText("Clinic multipliers: 2×");
    // Above the Act carries no mark — there is nothing to warn about.
    await expect(row).not.toContainText("Below the Act");
  });
});
