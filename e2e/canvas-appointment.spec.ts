import { expect, test } from '@playwright/test';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

// The seeded clinic's zone. Every clinical time in the web app renders in it.
const CLINIC_ZONE = 'Asia/Kuala_Lumpur';
import { densityFixtures, openDensityVisit } from './support/density';
import { ACCOUNTS, login } from './support/app';

/**
 * b4 PIECE C — A FOLLOW-UP BOOKED IN THE CANVAS IS AN APPOINTMENT.
 *
 * The composition failure no component test can see, and the one that would
 * make this feature worthless: a canvas card that recorded follow-ups
 * somewhere of its own. The assertion that closes it is the last one here —
 * the booking is opened from the consultation and then FOUND IN THE
 * APPOINTMENTS MODULE, by patient and by the time that was picked, with the
 * module's own actions (Arrived, Reschedule, Cancel) offered on it. One store.
 *
 * The two settings the picker has to honour are asserted on the way through:
 *
 *   DOCTOR-SERVICE MAPPING — the fixture maps ONE service to this doctor and
 *     leaves a second one in the catalogue unmapped. The picker must offer the
 *     first and not the second. An empty list would satisfy "does not offer
 *     the unmapped one" by accident, so both halves are asserted.
 *
 *   SLOT CAPACITY — the slots offered are the availability engine's, so they
 *     must be the configured slot length apart and must not exceed the daily
 *     capacity. The engine's own unit spec proves the arithmetic; what this
 *     proves is that the canvas asks IT rather than inventing times.
 */

const FOLLOW_UP_DAYS_AHEAD = 3;

test.describe('booking a follow-up from the consultation', () => {
  test('the card, the mapping, the capacity, and the appointment that results', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 768 });
    await openDensityVisit(page, 'typical');
    const { booking } = densityFixtures();

    // ---- THE MONTH AT REST -------------------------------------------------
    const calendar = page.getByTestId('canvas-appointment-calendar');
    await expect(calendar, 'the appointment month is not on the canvas').toBeVisible();
    // BOTTOM LEFT: in the visits column, below the visits panel. Its layout
    // contract — it must not push that panel or scroll the page — is measured
    // in canvas-viewport.spec.ts.
    await expect(page.locator('[data-testid="canvas-visits"] .kw2-appt-dock')).toHaveCount(1);
    // The two facts a doctor reads before deciding to book at all.
    await expect(calendar.getByTestId('appointment-previous')).toBeVisible();
    await expect(calendar.getByTestId('appointment-next')).toBeVisible();
    await calendar.screenshot({ path: 'test-results/canvas-appointment-month-at-rest.png' });

    // ---- THE PICKER, OPENED BY TAPPING THE DAY -----------------------------
    // The day the follow-up is for. Tapping it IS the booking gesture: the
    // picker opens on that date rather than asking for it again.
    const when = dayjs().add(FOLLOW_UP_DAYS_AHEAD, 'day');
    const day = calendar.locator(`[data-date="${when.format('YYYY-MM-DD')}"]`);
    await expect(day, 'the month does not carry the day that was asked for').toBeVisible();
    await day.click();
    await expect(page.getByText('Book a follow-up')).toBeVisible();
    await expect(page.getByLabel('Follow-up date')).toHaveValue(when.format('YYYY-MM-DD'));

    // DOCTOR-SERVICE MAPPING. Both halves: the mapped service is offered and
    // the unmapped one — which exists in the same catalogue — is not.
    const serviceBox = page.getByLabel('Follow-up service');
    await serviceBox.click();
    const dropdown = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
    await expect(
      dropdown.getByTitle(booking.followUpService),
      'the service this doctor IS mapped to was not offered',
    ).toBeVisible();
    await expect(
      dropdown.getByTitle(booking.unmappedService),
      'a service this doctor is NOT mapped to was offered — the booking would be refused',
    ).toHaveCount(0);
    await dropdown.getByTitle(booking.followUpService).click();

    // ---- THE ENGINE'S OWN SLOTS -------------------------------------------
    const slots = page.getByTestId('follow-up-slots');
    await expect(slots, 'the availability engine returned no slots for a rostered day').toBeVisible();
    const slotButtons = slots.locator('button[data-slot]');
    await expect(slotButtons.first()).toBeVisible();

    const offered = await slotButtons.count();
    // The rostered day produces slots at all. Daily capacity is deliberately
    // NOT asserted here any more: it used to `slice()` the offered list, so a
    // cap of 5 with nothing booked let the patient pick only the earliest
    // slot. It is now a GATE — refuse the day when it is full, otherwise offer
    // every free slot — and the capacity behaviour is pinned server-side in
    // `slot-availability.service.spec.ts` where it can be tested against a
    // full day without booking one.
    expect(offered, 'the rostered day produced no bookable slot').toBeGreaterThan(0);

    // And the SLOT LENGTH is the configured one, read off the two the doctor
    // is actually shown rather than from the config.
    if (offered >= 2) {
      const first = await slotButtons.nth(0).getAttribute('data-slot');
      const second = await slotButtons.nth(1).getAttribute('data-slot');
      const gapMinutes = dayjs(second!).diff(dayjs(first!), 'minute');
      expect(
        gapMinutes,
        `consecutive slots are ${gapMinutes} minutes apart, not the configured ${booking.slotLengthMinutes}`,
      ).toBe(booking.slotLengthMinutes);
    }

    // Evidence for the unit's report: the picker as the doctor sees it, with
    // the mapped service chosen and the engine's slots on screen.
    await page.locator('[role="dialog"]').first().screenshot({
      path: 'test-results/canvas-follow-up-picker.png',
    });

    // ---- BOOK IT -----------------------------------------------------------
    // The FIRST open slot, whatever it is. A hardcoded time would fail on the
    // second run against a re-used database for a reason that has nothing to
    // do with the feature: the slot it named would already be taken.
    const chosenIso = (await slotButtons.first().getAttribute('data-slot'))!;
    const chosenLabel = (await slotButtons.first().innerText()).trim();
    await slotButtons.first().click();
    await page.getByTestId('confirm-follow-up').click();

    // ---- THE MONTH NOW CARRIES IT -----------------------------------------
    await expect(page.getByText('Book a follow-up')).toHaveCount(0);
    const next = calendar.getByTestId('appointment-next');
    await expect(next, 'the month did not pick up the booking it just made').toContainText(
      booking.followUpService,
    );
    await expect(next).toContainText(chosenLabel);
    // And the day itself is marked, so the diary reads at a glance.
    await expect(day).toHaveAttribute('data-appointments', /[1-9]/);

    await page.screenshot({ path: 'test-results/canvas-appointment-month.png', fullPage: false });

    // ---- THE APPOINTMENTS MODULE IS THE STORE ------------------------------
    // Not "an appointment exists somewhere": the row is found in the module's
    // own list, for this patient, at the time that was picked in the canvas,
    // carrying the lifecycle actions that module owns. A canvas-side store
    // would fail here and nowhere else.
    await page.goto('/appointments');
    // The dashboard opens on Upcoming over the next 30 days, which covers a
    // follow-up three days out. Searching by name as well, because a busy
    // seeded clinic can put the row on a second page.
    await page.getByPlaceholder(/patient name or phone/i).fill(booking.patientName);

    // The list renders in the CLINIC's zone (`clinicTime.ts`), not the
    // runner's, and date and time are separate columns. Matching with a bare
    // `dayjs()` passed only because CI is UTC, and would have hidden an
    // eight-hour error on a Malaysian machine.
    // `bookedAt`, not `when` — that name is already the follow-up DATE this
    // test picked in the canvas, forty lines up.
    // The FULL range, not the start time alone. The Time column renders
    // "08:00–08:30", so filtering on "08:30" matches the 08:00 row as well as
    // the 08:30 one — and this spec deliberately books the next free slot each
    // run, so on any re-used database both rows exist.
    const bookedAt = dayjs(chosenIso).tz(CLINIC_ZONE);
    const bookedUntil = bookedAt.add(booking.slotLengthMinutes, 'minute');
    const row = page
      .getByRole('row')
      .filter({ hasText: booking.patientName })
      .filter({ hasText: bookedAt.format('D MMM YYYY') })
      .filter({ hasText: `${bookedAt.format('HH:mm')}–${bookedUntil.format('HH:mm')}` });
    await expect(
      row,
      'the follow-up booked in the canvas is not in the Appointments module',
    ).toHaveCount(1);
    // The status chip reads as words, not as an enum.
    await expect(row).toContainText(/confirmed/i);
    // The module's own actions are on it — it is an ordinary appointment, not
    // a read-only echo of something the canvas keeps elsewhere.
    await expect(row.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Arrived' })).toBeVisible();

    await page.screenshot({ path: 'test-results/canvas-appointment-in-module.png', fullPage: false });
  });
});

// ===========================================================================
// THE ROUND TRIP, THE OTHER WAY.
//
// The test above proves canvas → module: a follow-up booked in the
// consultation is found in the Appointments module. This proves module →
// canvas, which is the direction that actually breaks when a second store
// creeps in: the module writes somewhere the canvas does not read, and a
// doctor opening the record sees a diary that is missing an appointment the
// front desk made ten minutes ago.
//
// Booked through the CALENDAR's own modal, so the piece 3 booking path is what
// is under test rather than an API call standing in for it.
// ===========================================================================
test.describe('an appointment booked in the module reaches the canvas', () => {
  test('the module books it, the consultation month shows it', async ({ page }) => {
    const { booking } = densityFixtures();
    await page.setViewportSize({ width: 1440, height: 900 });

    // ---- BOOK IT IN THE MODULE --------------------------------------------
    // Through the module's own drawer, which drives the same availability
    // engine and the same create endpoint the calendar's slot modal uses. What
    // is under test here is that the two SURFACES read one store — not the
    // mechanics of a particular grid widget.
    await login(page, ACCOUNTS.frontDesk);
    await page.goto('/appointments');
    await page.getByRole('button', { name: 'Book appointment' }).click();

    const drawer = page.getByRole('dialog').filter({ hasText: 'Book Appointment' });
    await expect(drawer).toBeVisible();

    // Each control is a label above an antd Select in the same wrapper. The
    // option list renders in a portal outside the drawer, so the click on it
    // is scoped to the page rather than to `drawer`.
    const pick = async (label: string, option: string) => {
      await drawer.getByText(label, { exact: true }).locator('..').locator('.ant-select').click();
      await page.getByTitle(option, { exact: true }).first().click();
    };

    await pick('Patient', booking.patientName);
    await pick('Doctor', booking.doctorName);
    await pick('Service', booking.followUpService);

    // The date the fixture doctor is rostered on — every day, by design.
    const when = dayjs().add(FOLLOW_UP_DAYS_AHEAD, 'day');
    await drawer.getByPlaceholder('Select date').fill(when.format('YYYY-MM-DD'));
    await page.keyboard.press('Enter');

    const slot = drawer.locator('button').filter({ hasText: /^\d{2}:\d{2}$/ }).first();
    await expect(slot, 'the engine offered no slots for a rostered day').toBeVisible();
    await slot.click();
    await drawer.getByRole('button', { name: 'Book Appointment' }).click();
    await expect(drawer).toBeHidden();

    // ---- AND THE CANVAS HAS IT --------------------------------------------
    await openDensityVisit(page, 'typical');
    const calendar = page.getByTestId('canvas-appointment-calendar');
    await expect(
      calendar.getByTestId('appointment-next'),
      'the canvas month does not show an appointment the module just booked',
    ).toContainText(booking.followUpService);
  });
});
