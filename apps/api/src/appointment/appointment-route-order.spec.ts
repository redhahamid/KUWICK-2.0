import { AppointmentModule } from './appointment.module';
import { AppointmentController } from './appointment.controller';
import {
  AppointmentDashboardController,
  AppointmentReminderController,
} from './appointment-dashboard.controller';
import { PublicBookingController } from './public-booking.controller';

/**
 * THE ORDERING IN `appointment.module.ts` IS LOAD-BEARING.
 *
 * `AppointmentController` is `@Controller('appointments')` with a
 * `@Get(':id')`. Nest matches routes in registration order, so registered
 * first it swallows `/appointments/dashboard` and reads it as an appointment
 * whose id is "dashboard".
 *
 * The failure is SILENT: no 404 the browser reports, no error in the log —
 * the dashboard just renders "No appointments booked in this period" for a
 * clinic with a full diary. It cost an e2e run to find, and a comment alone
 * would not stop the next person sorting the list alphabetically.
 *
 * The same trap `@Get('bookable')` and `@Get('weekly')` avoid WITHIN a single
 * controller, which is exactly why it was easy to miss ACROSS two.
 */
describe('route registration order', () => {
  const controllers = Reflect.getMetadata('controllers', AppointmentModule) as unknown[];

  it('1. every controller with a literal appointments/ path is registered before the :id one', () => {
    const literalFirst = [AppointmentDashboardController, AppointmentReminderController];
    const catchAll = controllers.indexOf(AppointmentController);

    expect(catchAll).toBeGreaterThan(-1);
    for (const controller of literalFirst) {
      const index = controllers.indexOf(controller);
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(catchAll);
    }
  });

  it('2. the public booking page registers its literal manage/ routes before :slug', () => {
    // Same trap, one level down. `@Get(':slug')` registered first reads
    // /public/booking/manage/<token> as a clinic whose slug is "manage" — and
    // the failure mode is a 404 on a link the clinic has already sent to a
    // patient by SMS.
    const prototype = PublicBookingController.prototype as unknown as Record<string, unknown>;
    const paths = Reflect.ownKeys(prototype)
      .filter((key) => key !== 'constructor')
      .map((key) => Reflect.getMetadata('path', prototype[key as string] as object));

    const manage = paths.findIndex((path) => String(path).startsWith('manage'));
    const slug = paths.findIndex((path) => String(path).startsWith(':slug'));

    expect(manage).toBeGreaterThan(-1);
    expect(slug).toBeGreaterThan(-1);
    expect(manage).toBeLessThan(slug);
  });
});
