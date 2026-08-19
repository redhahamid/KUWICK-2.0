import { AppointmentModule } from './appointment.module';
import { AppointmentController } from './appointment.controller';
import {
  AppointmentDashboardController,
  AppointmentReminderController,
} from './appointment-dashboard.controller';

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
});
