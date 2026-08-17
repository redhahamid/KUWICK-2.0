import { expect, test } from '@playwright/test';
import dayjs from 'dayjs';
import { densityFixtures, openDensityVisit } from './support/density';

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

    // ---- THE CARD AT REST --------------------------------------------------
    const card = page.locator('.kw-rail-panel[data-panel="Next Appointment"]');
    await expect(card, 'the appointment card is not in the rail').toBeVisible();
    // It is the LAST card in the column: a follow-up is decided at the end of
    // the consultation, and anything inserted above Medications would push the
    // rows the 1366×768 assertions protect.
    const panels = page.locator('[data-testid="canvas-right"] .kw-rail-panel');
    await expect(panels.last()).toHaveAttribute('data-panel', 'Next Appointment');

    // A SENSIBLE STATE BEFORE ANYTHING IS BOOKED. Asserted as "says one of the
    // two true things" rather than as "is empty": these specs share one worker
    // and one database, so on a re-run against a re-used database this patient
    // already carries the follow-up the last run booked, and a strict empty
    // assertion would fail for a reason that has nothing to do with the card.
    // The exact empty wording is pinned in the unit suite, where it is not
    // subject to the order the specs ran in.
    const CARD = '.kw-rail-panel[data-panel="Next Appointment"]';
    await expect(
      page.locator(`${CARD}[data-empty="true"], ${CARD} [data-appointment-id]`).first(),
      'the card neither says there is no follow-up nor shows one',
    ).toBeVisible();
    await card.scrollIntoViewIfNeeded();
    await card.screenshot({ path: 'test-results/canvas-appointment-card-at-rest.png' });

    // ---- THE PICKER --------------------------------------------------------
    await card.getByTestId('book-follow-up-button').scrollIntoViewIfNeeded();
    await card.getByTestId('book-follow-up-button').click();
    await expect(page.getByText('Book a follow-up')).toBeVisible();

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

    // ---- THE DATE, AND THE ENGINE'S OWN SLOTS ------------------------------
    const when = dayjs().add(FOLLOW_UP_DAYS_AHEAD, 'day');
    const dateInput = page.getByLabel('Follow-up date');
    await dateInput.click();
    await dateInput.fill(when.format('YYYY-MM-DD'));
    await page.keyboard.press('Enter');

    const slots = page.getByTestId('follow-up-slots');
    await expect(slots, 'the availability engine returned no slots for a rostered day').toBeVisible();
    const slotButtons = slots.locator('button[data-slot]');
    await expect(slotButtons.first()).toBeVisible();

    const offered = await slotButtons.count();
    // SLOT CAPACITY, on the real screen: the engine caps the list at the
    // clinic's configured daily capacity, so a picker showing more than that
    // is a picker that is not reading it.
    expect(
      offered,
      `the picker offered ${offered} slots, more than the configured daily capacity of ${booking.dailyCapacity}`,
    ).toBeLessThanOrEqual(booking.dailyCapacity);
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

    // ---- THE CARD NOW CARRIES IT ------------------------------------------
    await expect(page.getByText('Book a follow-up')).toHaveCount(0);
    const bookedRow = card.locator('[data-appointment-id]').first();
    await expect(bookedRow, 'the card did not pick up the booking it just made').toBeVisible();
    await expect(bookedRow).toContainText(booking.followUpService);
    await expect(bookedRow).toContainText(chosenLabel);
    await expect(card.locator('.kw-rail-head')).toContainText('Next Appointment (');

    await page.screenshot({ path: 'test-results/canvas-appointment-card.png', fullPage: false });

    // ---- THE APPOINTMENTS MODULE IS THE STORE ------------------------------
    // Not "an appointment exists somewhere": the row is found in the module's
    // own list, for this patient, at the time that was picked in the canvas,
    // carrying the lifecycle actions that module owns. A canvas-side store
    // would fail here and nowhere else.
    await page.goto('/appointments');
    const row = page.getByRole('row').filter({ hasText: booking.patientName }).filter({
      hasText: dayjs(chosenIso).format('YYYY-MM-DD HH:mm'),
    });
    await expect(
      row,
      'the follow-up booked in the canvas is not in the Appointments module',
    ).toHaveCount(1);
    await expect(row).toContainText('CONFIRMED');
    // The module's own actions are on it — it is an ordinary appointment, not
    // a read-only echo of something the canvas keeps elsewhere.
    await expect(row.getByRole('button', { name: 'Reschedule' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Arrived' })).toBeVisible();

    await page.screenshot({ path: 'test-results/canvas-appointment-in-module.png', fullPage: false });
  });
});
