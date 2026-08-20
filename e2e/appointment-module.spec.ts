import { expect, test } from '@playwright/test';
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

        await events.first().click();
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

    // Any available doctor — the path that has to persist a REAL provider.
    await page.getByRole('radio', { name: /any available doctor/i }).click();
    await page.getByRole('button', { name: /continue/i }).click();

    // Two days out: inside the fixture roster, past any minimum notice.
    const when = dayjs().add(2, 'day');
    await page.getByPlaceholder(/select date/i).fill(when.format('YYYY-MM-DD'));
    await page.keyboard.press('Enter');

    const slot = page.locator('.kw-public-slots button').first();
    await expect(slot, 'the public page offered no times for a rostered day').toBeVisible();
    const chosenTime = (await slot.textContent())?.trim() ?? '';
    await slot.click();

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

    // ---- CHECK IN, AND THE QUEUE TICKET THAT RESULTS -----------------------
    // The composition this whole module exists for: an appointment that
    // arrives becomes a VISIT and joins the type-A queue, with both ids
    // recorded on it. A status change with no ticket behind it would satisfy
    // a unit test and leave the patient invisible to the doctor.
    await row.getByRole('button', { name: /check in/i }).click();
    await expect(row.getByRole('button', { name: /check in/i })).toBeHidden({ timeout: 20_000 });

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
    await expect(page.getByRole('button', { name: /^check in$/i })).toHaveCount(0);
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

    // The service-specific link PRESELECTS the service, so the flow opens on
    // the doctor step rather than making the patient pick what they already
    // clicked.
    await expect(page.getByRole('radio', { name: /any available doctor/i })).toBeVisible();
    await page.getByRole('button', { name: /continue/i }).click();

    const when = dayjs().add(3, 'day');
    await page.getByPlaceholder(/select date/i).fill(when.format('YYYY-MM-DD'));
    await page.keyboard.press('Enter');
    await page.locator('.kw-public-slots button').first().click();

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
