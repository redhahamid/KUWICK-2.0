import { Page, expect, test } from '@playwright/test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { densityFixtures } from './support/density';
import { ACCOUNTS, login, uniquePatientName } from './support/app';

dayjs.extend(utc);
dayjs.extend(timezone);

const CLINIC_ZONE = 'Asia/Kuala_Lumpur';

/**
 * THE APPOINTMENT MODULE, END TO END.
 *
 * §51's final requirement is the whole path, not its parts:
 *
 *   Public Booking → Appointment → Arrival → Check-In → Visit → Queue
 *
 * Every step of that is composition, and composition is precisely what a unit
 * suite cannot see. The engine's arithmetic has fifty-three unit tests; what
 * these prove is that the PUBLIC PAGE asks that engine, that the booking it
 * makes is an ordinary appointment the front desk can work, and that checking
 * it in produces a real queue ticket rather than a status somebody has to
 * chase.
 */


/**
 * Final-UAT — the DATE step is the colour-coded availability month. Picking a
 * day means clicking its cell (navigating a month forward if the target sits
 * in the next one); the cell is enabled only when the ENGINE says the day has
 * room, which is itself part of what the walk asserts.
 */
async function pickAvailabilityDate(page: Page, when: dayjs.Dayjs): Promise<void> {
  const calendar = page.getByTestId('availability-calendar');
  await expect(calendar).toBeVisible();
  if (when.format('YYYY-MM') !== dayjs().format('YYYY-MM')) {
    await calendar.getByRole('button', { name: /next month/i }).click();
  }
  const cell = calendar.locator(`[data-date="${when.format('YYYY-MM-DD')}"]`);
  await expect(cell, 'the availability month did not offer the fixture day').toBeEnabled({
    timeout: 20_000,
  });
  await cell.click();
}

test.describe('the module opens on the calendar and holds its five surfaces', () => {
  test('every tab renders, and /appointments lands on the diary', async ({ page }) => {
    await login(page, ACCOUNTS.owner);

    // §7 — the receptionist's first question every morning is "who is coming
    // in". A filter form is the answer to a different one.
    await page.goto('/appointments');
    await expect(page).toHaveURL(/\/appointments\/calendar/);
    await expect(page.getByTestId('calendar-workspace')).toBeVisible();
    await expect(page.getByTestId('calendar-metrics')).toBeVisible();

    // The four views, and the Providers grid as its own view rather than a
    // second meaning for Day.
    //
    // Clicked by LABEL, not by role: antd's Segmented hides the real radio
    // input behind a styled span and paints the span, so the accessible node
    // is never clickable. Same reason `chooseRadio` exists in support/app.ts.
    const views = page.locator('.kw-calendar-toolbar .ant-segmented');
    for (const view of ['Day', 'Week', 'Month', 'Providers']) {
      await views.getByText(view, { exact: true }).click();
      await expect(page.getByTestId('calendar-workspace')).toBeVisible();
    }

    await page.getByRole('tab', { name: 'List' }).click();
    await expect(page.getByTestId('appointment-stats')).toBeVisible();
    // §46 — two figures with two different meanings, and neither of them is
    // called "potential sales".
    await expect(page.getByText('Booked value')).toBeVisible();

    await page.getByRole('tab', { name: 'Roster & Availability' }).click();
    await expect(page.getByTestId('roster-page')).toBeVisible();

    await page.getByRole('tab', { name: 'Services' }).click();
    await expect(page.getByTestId('services-page')).toBeVisible();

    await page.getByRole('tab', { name: 'Booking Page' }).click();
    await expect(page.getByTestId('booking-page-settings')).toBeVisible();
  });

  test('the retired settings pages redirect rather than 404', async ({ page }) => {
    // A bookmark that breaks is how somebody concludes a feature was removed.
    await login(page, ACCOUNTS.owner);

    for (const [from, to] of [
      ['/settings/scheduling/doctor-service-mapping', /\/appointments\/services/],
      ['/settings/scheduling/slot-capacity', /\/appointments\/services/],
      ['/settings/scheduling/provider-availability', /\/appointments\/roster/],
      ['/management/operation/doctor-schedules', /\/appointments\/roster/],
    ] as const) {
      await page.goto(from);
      await expect(page, `${from} did not redirect`).toHaveURL(to);
    }
  });

  test('the diary AXIS holds its shape across views, dates, filters, drill-downs and arrows', async ({
    page,
  }) => {
    await walkTheAxis(page);
  });

  test('the diary viewport holds still through drawers, flow steps, filters and iPad widths', async ({
    page,
  }) => {
    // V3.1.2 regression pin. The defect: opening the New-appointment drawer
    // (or an iPad width change) re-rendered the calendar's parent, rbc saw a
    // fresh `scrollToTime` Date identity, and its own scroll-ratio arithmetic
    // — measured from midnight but divided by the min→max span — threw the
    // grid to the ~23:00 rows. The viewport may move ONLY on a view or date
    // change; nothing else here is allowed to touch it by so much as 3px.
    //
    // Day AND Week, because both are the same TimeGrid fed by the same three
    // props, and a fix that only holds in the view the bug was reported from
    // is not a fix.
    await login(page, ACCOUNTS.owner);
    await page.goto('/appointments/calendar');
    await expect(page.getByTestId('calendar-workspace')).toBeVisible();

    const content = page.locator('.kw-calendar-grid .rbc-time-content');
    const readScroll = () => content.evaluate((element) => Math.round(element.scrollTop));

    for (const view of ['Day', 'Week'] as const) {
      await page
        .locator('.kw-calendar-toolbar .ant-segmented')
        .getByText(view, { exact: true })
        .click();
      await expect(content).toBeVisible();

      // A SETTLED baseline — two consecutive readings that agree, so the
      // deliberate placement effect has finished. Every assertion below is a
      // delta from it, which holds whatever hour the diary legitimately
      // opened on for the seeded data of the day.
      await page.waitForTimeout(400);
      let baseline = await readScroll();
      await expect
        .poll(
          async () => {
            const next = await readScroll();
            const settled = next === baseline;
            baseline = next;
            return settled;
          },
          { message: `the ${view} grid scroll never settled` },
        )
        .toBe(true);

      const holds = async (what: string) => {
        const now = await readScroll();
        expect(Math.abs(now - baseline), `${view} view: ${what} moved the diary`).toBeLessThanOrEqual(
          2,
        );
      };

      // 1 — the booking drawer opens over the diary.
      await page.getByRole('button', { name: 'New appointment' }).click();
      await expect(page.getByTestId('staff-booking-flow')).toBeVisible();
      await holds('opening the New appointment drawer');

      // 2 — and its steps advance, each one re-rendering the module page that
      // owns the calendar. Guarded on fixtures: the step only exists to walk
      // if this clinic has a patient and a bookable service to pick.
      const recent = page.locator('.kw-flow-recent-row button');
      if ((await recent.count()) > 0) {
        await recent.first().click();
        await expect(page.getByTestId('flow-patient-card')).toBeVisible();
        await holds('advancing the flow past Patient');

        const services = page.locator('.kw-flow-service');
        if ((await services.count()) > 0) {
          await services.first().click();
          await expect(services.first()).toBeHidden();
          await holds('advancing the flow past Service');
        }
      }

      // 3 — and it closes again.
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('staff-booking-flow')).toBeHidden();
      await holds('closing the New appointment drawer');

      // 4 — an existing booking's own drawer.
      //
      // The card is scrolled into view BY THIS TEST first, and the baseline
      // retaken from where that left the diary. Two reasons, both load-
      // bearing: Playwright scrolls a target into view before clicking it, so
      // clicking an off-screen 23:00 card would move the diary by the test's
      // own hand and then blame the product; and an operator's own scroll is
      // itself a position the product must respect — if the diary snapped
      // back to its opening hour here, that is the same defect wearing a
      // different hat, so that is asserted before anything is clicked.
      const events = content.locator('.rbc-event');
      const eventCount = await events.count();
      if (eventCount === 0) {
        test.info().annotations.push({
          type: 'branch-not-exercised',
          description: `${view} view held no bookings, so the appointment drawer was not opened here`,
        });
      } else {
        await content.evaluate((element) => {
          const card = element.querySelector('.rbc-event') as HTMLElement;
          const host = element.getBoundingClientRect();
          const box = card.getBoundingClientRect();
          element.scrollTop = Math.max(
            0,
            element.scrollTop + (box.top - host.top) - element.clientHeight / 2 + box.height / 2,
          );
        });
        await page.waitForTimeout(300);
        const scrolledTo = await readScroll();
        await page.waitForTimeout(400);
        expect(
          Math.abs((await readScroll()) - scrolledTo),
          `${view} view: the diary snapped back after the operator scrolled it by hand`,
        ).toBeLessThanOrEqual(2);
        baseline = scrolledTo;

        // A REAL appointment, not a cluster marker. `.rbc-event` covers both,
        // and on a busy band the first one is the "+N more" summary — which
        // opens the cluster list, not the drawer. CI starts from a clean
        // database and rarely hits that; a machine that has run the suite a
        // few times hits it every time, and the failure looks like a drawer
        // regression rather than the test picking the wrong box.
        await events.filter({ hasNot: page.locator('.kw-ev-more') }).first().click();
        const drawer = page.getByTestId('appointment-drawer');
        await expect(drawer).toBeVisible();
        await holds('opening an appointment drawer');
        await page.keyboard.press('Escape');
        await expect(drawer).toBeHidden();
        await holds('closing an appointment drawer');
      }

      // 5 — a filter, which re-renders the grid with a different event set.
      const find = page.getByPlaceholder('Find a patient');
      await find.fill('zzz-nobody-by-this-name');
      await page.waitForTimeout(400);
      await holds('filtering the diary to nothing');
      await find.fill('');
      await page.waitForTimeout(400);
      await holds('clearing the filter');

      // 6 — width-only viewport changes: iPad Pro landscape, iPad portrait,
      // iPad landscape, back to the desktop canvas. Height is held constant
      // so the browser has no legitimate clamping reason to move scrollTop.
      for (const width of [1194, 834, 1024, 1680]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.waitForTimeout(350);
        await holds(`resizing the viewport to ${width}px`);
      }
    }
  });
});

test.describe('the diary axis on a Malaysian device', () => {
  // RC BLOCKER pin. The wrapped 11:00 PM → 12:00 AM → … diary only reproduced
  // on a browser whose zone is NOT UTC: rbc's tz-aware dayjsLocalizer shifted
  // every day-column's min/max by the UTC offset, so UTC-based CI could not
  // see what every Malaysian iPad saw. This twin runs the same walk with the
  // browser in the clinic's own zone.
  test.use({ timezoneId: 'Asia/Kuala_Lumpur' });

  test('the axis walk holds in Asia/Kuala_Lumpur exactly as in CI', async ({ page }) => {
    await walkTheAxis(page);
  });
});

/**
 * THE AXIS WALK — one shape, everywhere it could break.
 *
 * Reads the gutter labels, requires them STRICTLY INCREASING through the day
 * (a wrapped 11:00 PM → 12:00 AM sequence fails the monotonic check), then
 * requires the identical shape across: Week, Providers, a different date via
 * the arrows, a Month drill-down (the path that stored a timezone-mode
 * anchor and white-screened the calendar), the arrows AFTER that drill-down,
 * and a filter that empties the diary.
 */
async function walkTheAxis(page: import('@playwright/test').Page) {
  await login(page, ACCOUNTS.owner);
  await page.goto('/appointments/calendar');
  await expect(page.getByTestId('calendar-workspace')).toBeVisible();

  const minutesOf = (label: string) => {
    // The gutter now writes the hour rows as "8 AM" (the approved mockup's
    // own wording) and the half-hour rows as "8:30 AM". Both are read here,
    // and every label the DOM carries is still parsed and ordered — the pin
    // is exactly as strong as it was, it simply understands both spellings.
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(label.trim());
    if (!match) throw new Error(`unreadable gutter label: "${label}"`);
    const hour = (Number(match[1]) % 12) + (match[3].toUpperCase() === 'PM' ? 12 : 0);
    return hour * 60 + Number(match[2] ?? 0);
  };

  const gutterShape = async () => {
    const labels = page.locator('.kw-calendar-grid .rbc-time-gutter .rbc-label');
    await expect(labels.first()).toBeVisible();
    const texts = await labels.allTextContents();
    // CHRONOLOGICAL, WITHIN ONE DAY. This is the no-wrap pin: a diary that
    // renders 11:00 PM and then 12:00 AM is showing two calendar dates on
    // one canvas, which is specifically prohibited.
    const minutes = texts.map(minutesOf);
    for (let i = 1; i < minutes.length; i += 1) {
      expect(
        minutes[i],
        `gutter wraps across midnight: ${texts[i - 1]} → ${texts[i]}`,
      ).toBeGreaterThan(minutes[i - 1]);
    }
    return { first: texts[0], last: texts[texts.length - 1], count: texts.length };
  };
  const views = page.locator('.kw-calendar-toolbar .ant-segmented');

  const dayShape = await gutterShape();
  expect(dayShape.count, 'an empty axis is no axis').toBeGreaterThan(0);

  // Same bounds in Week — one TimeGrid, one axis policy.
  await views.getByText('Week', { exact: true }).click();
  expect(await gutterShape()).toEqual(dayShape);

  // PROVIDERS is the same grid and must wear the same axis; an overnight
  // provider column must not reshape it.
  await views.getByText('Providers', { exact: true }).click();
  expect(await gutterShape()).toEqual(dayShape);

  // A different date does not redefine the day's shape.
  await views.getByText('Day', { exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  expect(await gutterShape()).toEqual(dayShape);
  await page.getByRole('button', { name: 'Today' }).click();

  // The MONTH DRILL-DOWN — the navigation path that used to store a
  // timezone-mode anchor: wrapped bounds on a Malaysian device, an
  // Invalid-array-length white screen on a UTC one.
  await views.getByText('Month', { exact: true }).click();
  await page.locator('.rbc-date-cell.rbc-now button').first().click();
  await expect(page.getByTestId('calendar-workspace')).toBeVisible();
  expect(await gutterShape()).toEqual(dayShape);

  // And the arrows AFTER a drill-down, because the poisoned anchor persisted.
  await page.getByRole('button', { name: 'Next' }).click();
  expect(await gutterShape()).toEqual(dayShape);
  await page.getByRole('button', { name: 'Today' }).click();

  // Filtering the diary to nothing does not reshape it either.
  await page.getByPlaceholder('Find a patient').fill('zzz-nobody-by-this-name');
  await page.waitForTimeout(350);
  expect(await gutterShape()).toEqual(dayShape);
  await page.getByPlaceholder('Find a patient').fill('');
}

test.describe('a patient books themselves in, and the clinic works the booking', () => {
  test('public page → appointment → check-in → visit → queue', async ({ page, context }) => {
    const { booking } = densityFixtures();
    const patientName = uniquePatientName('Public');
    const phone = `0199${Date.now().toString().slice(-6)}`;

    // ---- THE PUBLIC PAGE, WITH NO SESSION AT ALL -------------------------
    // Cleared deliberately: a booking page that behaves differently for a
    // signed-in staff member is a booking page nobody has actually tested.
    await context.clearCookies();
    await page.goto(`/book/${booking.publicPageSlug}`);
    await expect(page.getByTestId('public-booking')).toBeVisible();
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    await expect(page.getByTestId('public-booking')).toBeVisible();
    // The service the fixture made bookable and mapped to a doctor.
    await page.getByText(booking.followUpService, { exact: false }).first().click();

    // THE DOCTOR STEP ANSWERS ITSELF HERE. Exactly one provider is qualified
    // for this fixture service, so the page skips a question whose only
    // possible answer it already has and lands on the date — with that
    // provider chosen. The booking still has to persist a REAL provider,
    // which the "you selected" reveal and the confirmation both check below.
    await expect(page.getByTestId('availability-calendar')).toBeVisible();
    await expect(page.getByTestId('public-progress')).toContainText(/date/i);
    await expect(page.getByRole('radio', { name: /any available doctor/i })).toHaveCount(0);

    // Two days out: inside the fixture roster, past any minimum notice.
    const when = dayjs().add(2, 'day');
    await pickAvailabilityDate(page, when);

    const slot = page.locator('.kw-public-slots button').first();
    await expect(slot, 'the public page offered no times for a rostered day').toBeVisible();
    const chosenTime = (await slot.textContent())?.trim() ?? '';
    await slot.click();
    // The "you selected" reveal names the REAL doctor even on the any-doctor
    // path, and Continue is the explicit step onward.
    await expect(page.getByTestId('selected-slot')).toContainText(/with /i);
    await page.getByTestId('continue-to-details').click();

    await page.getByLabel(/your full name/i).fill(patientName);
    await page.getByLabel(/mobile number/i).fill(phone);
    // §42 — the review step stands between the form and the booking.
    await page.getByRole('button', { name: /review booking/i }).click();
    await expect(page.getByTestId('public-review')).toBeVisible();
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    // The confirmation, and the manage link the patient keeps. The premium
    // pass replaced antd's <Result> with the kw-public-done card; the
    // HEADING carries the verdict and the testid scopes it.
    await expect(
      page
        .getByTestId('public-confirmation')
        .getByRole('heading', { name: /appointment confirmed|request has been sent/i }),
    ).toBeVisible();
    const manageLink = page.getByRole('link', { name: /manage my appointment/i });
    await expect(manageLink).toBeVisible();
    const manageHref = await manageLink.getAttribute('href');
    expect(manageHref, 'no manage-booking link was issued').toBeTruthy();

    // ---- THE CLINIC SEES IT ------------------------------------------------
    await login(page, ACCOUNTS.frontDesk);
    await page.goto('/appointments/list');
    await page.getByPlaceholder(/patient name or phone/i).fill(patientName);

    const row = page.getByRole('row').filter({ hasText: patientName });
    await expect(row, 'the public booking is not in the clinic’s list').toHaveCount(1);
    // §41 — the source is stored apart from the status, and it says where the
    // booking came from.
    await expect(row).toContainText(/booking page/i);
    await expect(row).toContainText(chosenTime.slice(0, 5));

    // ---- PHASE 8: THE MESSAGE COMES FROM THE TEMPLATES, PREVIEWED ---------
    // The row's WhatsApp button opens the template modal, and the preview is
    // the rendered message: this patient, the PATIENT-FACING clinic name, the
    // clinic-clock time — no fragment concatenation anywhere.
    await row.getByRole('button', { name: /open whatsapp with a reminder/i }).click();
    // getByRole('dialog'), not the testid: antd mounts the testid on a
    // zero-size wrapper Playwright reports as hidden.
    const messageModal = page.getByRole('dialog').filter({ hasText: 'Message' });
    await expect(messageModal).toBeVisible();
    const preview = messageModal.getByTestId('message-preview');
    await expect(preview).toHaveValue(new RegExp(patientName.split(' ')[0]));
    // Fully rendered: the clinic-clock time is in, and no {placeholder}
    // survives. (WHICH name is spoken — patient-facing, never the internal
    // label — is pinned at unit level against a synthetic fixture; the CI
    // world and the staging world name their clinics differently.)
    await expect(preview).toHaveValue(new RegExp(chosenTime.slice(0, 5)));
    await expect(preview).not.toHaveValue(/\{[a-z_]+\}/);
    // Bahasa Malaysia is one tap away, from the same template store.
    await messageModal.locator('.ant-segmented').getByText('Bahasa Malaysia').click();
    await expect(preview).toHaveValue(/temujanji/);
    await messageModal.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByTestId('message-preview')).toHaveCount(0);

    // ---- REGISTER / CHECK IN, AND THE QUEUE TICKET THAT RESULTS ------------
    // The composition this whole module exists for: an appointment that
    // arrives becomes a VISIT and joins the type-A queue, with both ids
    // recorded on it. Phase 4 put a REGISTRATION REVIEW in front of that act:
    // the click opens the drawer (patient, doctor, payer, remarks — nothing
    // created yet), and only CONFIRM & ADD TO QUEUE commits.
    await row.getByRole('button', { name: /register \/ check in/i }).click();
    const registration = page.getByTestId('checkin-registration-drawer');
    await expect(registration).toBeVisible();
    // The review really is a review: the patient's on-file identity is in
    // front of the desk on opening, and the payer choice is one tab away.
    // The approved mockup splits the drawer into Patient Details | Visit
    // Info; the SPLIT is presentational — Confirm still commits both halves,
    // and an unanswered payer still refuses the button — so the walk now
    // reads both tabs, exactly as the counter does.
    // (.first(): the name appears twice by design — the identity header and
    // the record's own Name row.)
    await expect(registration.getByText(patientName).first()).toBeVisible();
    await registration.getByRole('tab', { name: 'Visit Info' }).click();
    await expect(registration.getByText('Payer')).toBeVisible();
    await page.getByTestId('confirm-add-to-queue').click();
    await expect(registration).toBeHidden({ timeout: 20_000 });
    await expect(row.getByRole('button', { name: /register \/ check in/i })).toBeHidden({
      timeout: 20_000,
    });

    await page.goto('/queue');
    await expect(
      page.getByText(patientName).first(),
      'the checked-in appointment did not reach the queue',
    ).toBeVisible({ timeout: 20_000 });

    // ---- AND THE DRAWER CAN SAY WHERE THEY ARE -----------------------------
    // Opened from the CALENDAR, which is the surface a receptionist is
    // actually on. It also exercises the path the List cannot: an event card
    // on the grid → the detail drawer.
    //
    // The Arrived TAB is deliberately not used here: it defaults to today,
    // which is right for "who is in the building" and wrong for a booking this
    // spec deliberately made two days out.
    await page.goto('/appointments/calendar');
    // TYPED IN THE PICKER'S OWN FORMAT. antd parses what you type using the
    // component's `format`, so an ISO date into a `D MMM YYYY` picker is
    // simply not a date and the field silently keeps today.
    await page.getByPlaceholder(/select date/i).fill(when.format('D MMM YYYY'));
    await page.keyboard.press('Enter');
    await expect(page.getByText(when.format('dddd D MMMM YYYY'))).toBeVisible();
    await page.locator('.kw-calendar-event').filter({ hasText: patientName }).first().click();

    const drawer = page.getByTestId('appointment-drawer');
    await expect(drawer).toBeVisible();
    // The ticket number, read through the visit the check-in created. This is
    // the assertion the whole path exists for: appointment → visit → queue,
    // all three linked, all three readable from the booking.
    await expect(drawer.getByText(/^A\d+/)).toBeVisible();
    // And it cannot be checked in twice: the premium drawer removes the dead
    // primary outright and offers the NEXT step instead. Scoped to the PAGE,
    // not the drawer body: antd renders a Drawer's footer outside the
    // content element the test id is on.
    await expect(page.getByRole('button', { name: /open visit/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /register \/ check in/i })).toHaveCount(0);
  });
});

test.describe('the patient can manage their own booking', () => {
  test('the token link shows one appointment and cancels it', async ({ page, context }) => {
    const { booking } = densityFixtures();
    const patientName = uniquePatientName('Manage');

    await context.clearCookies();
    await page.goto(`/book/${booking.publicPageSlug}/${booking.publicServiceSlug}`);
    await page.evaluate(() => window.localStorage.clear());
    await page.reload();

    // The service-specific link PRESELECTS the service; with a single
    // qualified provider the doctor step then answers itself too, so the flow
    // opens straight on the date rather than making the patient confirm two
    // things they already said.
    await expect(page.getByTestId('availability-calendar')).toBeVisible();
    await expect(page.getByTestId('public-progress')).toContainText(/date/i);

    const when = dayjs().add(3, 'day');
    await pickAvailabilityDate(page, when);
    await page.locator('.kw-public-slots button').first().click();
    await page.getByTestId('continue-to-details').click();

    await page.getByLabel(/your full name/i).fill(patientName);
    await page.getByLabel(/mobile number/i).fill(`0198${Date.now().toString().slice(-6)}`);
    await page.getByRole('button', { name: /review booking/i }).click();
    await page.getByRole('button', { name: /confirm appointment/i }).click();

    const manageHref = await page
      .getByRole('link', { name: /manage my appointment/i })
      .getAttribute('href');
    await page.goto(manageHref!);

    await expect(page.getByTestId('manage-booking')).toBeVisible();
    // Their OWN name and nothing about anybody else. This link travels by SMS
    // and gets forwarded.
    await expect(page.getByText(patientName)).toBeVisible();

    await page.getByRole('button', { name: /^cancel$/i }).click();
    await page.getByRole('button', { name: /cancel appointment/i }).click();
    await expect(page.getByText(/cancelled/i).first()).toBeVisible({ timeout: 20_000 });
  });
});

test.describe('the clinic writes its own messages', () => {
  test('templates render a live preview in both languages, and the reminder rules live beside them', async ({
    page,
  }) => {
    await login(page, ACCOUNTS.owner);
    await page.goto('/settings/scheduling/communication');
    await expect(page.getByTestId('communication-settings')).toBeVisible();

    // The editor holds the default wording — placeholders visible, because
    // the template IS the contract.
    const body = page.getByTestId('template-body');
    await expect(body).toHaveValue(/\{patient_name\}/);

    // The preview is the ONE renderer working on this clinic's real
    // identity: sample patient, patient-facing clinic name, filled dates.
    const preview = page.getByTestId('template-preview');
    await expect(preview).toContainText('Aisyah binti Rahman');
    // Substituted, whichever world: no token survives into the preview.
    await expect(preview).not.toContainText('{patient_name}');
    await expect(preview).not.toContainText('{clinic_name}');

    // One tap to Bahasa Malaysia, same store, same renderer.
    await page
      .getByTestId('message-templates-card')
      .locator('.ant-segmented')
      .getByText('Bahasa Malaysia')
      .click();
    await expect(preview).toContainText(/temujanji/);

    // The reminder rules — the honest automation — live one click away in the
    // console's own sub-navigation (approved mockup 6), on the same screen and
    // against the same store; the screen says out loud, from every section,
    // that no gateway is connected.
    await page.locator('.kw-comms-nav-item', { hasText: 'Reminders' }).first().click();
    await expect(page.getByTestId('reminder-rules-card')).toBeVisible();
    await expect(page.getByText('WhatsApp automation is not connected')).toBeVisible();
  });
});
