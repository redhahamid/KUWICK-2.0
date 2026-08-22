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

  it('2. the public booking page registers its literal sub-paths before the bare :slug', () => {
    // Same trap, one level down. `@Get(':slug')` registered first would read
    // /public/booking/uat-clinic/providers as a clinic whose slug is
    // "uat-clinic/providers" — or, worse, match the one-segment route and
    // return the page for a request that asked for something else.
    const prototype = PublicBookingController.prototype as unknown as Record<string, unknown>;
    const paths = Reflect.ownKeys(prototype)
      .filter((key) => key !== 'constructor')
      .map((key) => String(Reflect.getMetadata('path', prototype[key as string] as object)));

    const bareSlug = paths.indexOf(':slug');
    expect(bareSlug).toBeGreaterThan(-1);
    for (const literal of [':slug/providers', ':slug/availability', ':slug/month-availability', ':slug/form-fields']) {
      // Jest's `expect` takes no message argument — the assertion has to say
      // which path it is about through the loop variable in the failure output.
      const index = paths.indexOf(literal);
      expect({ literal, index }).toMatchObject({ literal });
      expect(index).toBeGreaterThan(-1);
      expect(index).toBeLessThan(bareSlug);
    }
  });

  it('3. every manage-booking route carries the clinic slug', () => {
    // Not decoration: appointments are behind row-level security, so a token
    // lookup with no tenant context returns nothing. The slug is what resolves
    // the tenant, through the one table readable without one. A route added
    // later as `manage/:token` would 404 every link the clinic has sent.
    const prototype = PublicBookingController.prototype as unknown as Record<string, unknown>;
    const managePaths = Reflect.ownKeys(prototype)
      .filter((key) => key !== 'constructor')
      .map((key) => String(Reflect.getMetadata('path', prototype[key as string] as object)))
      .filter((path) => path.includes('manage'));

    expect(managePaths.length).toBeGreaterThan(0);
    for (const path of managePaths) {
      expect(path).toMatch(/^:slug\/manage\//);
    }
  });
});
