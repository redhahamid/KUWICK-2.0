import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PublicBookingService } from './public-booking.service';
import { PublicBookDto, PublicCancelDto, PublicRescheduleDto } from './dto/public-booking.dto';

/**
 * UNAUTHENTICATED, BY DESIGN — the `public/(.*)` prefix is excluded from the
 * tenant-context middleware in `app.module.ts`, which is why every route here
 * begins with it and why nothing else in the appointment module does.
 *
 * The service resolves the tenant from the page slug and then runs everything
 * under normal row-level security. Unauthenticated is not unscoped.
 */
@Controller('public/booking')
export class PublicBookingController {
  constructor(private readonly booking: PublicBookingService) {}

  /** The manage-booking routes come FIRST: `:slug` would swallow "manage". */
  @Get('manage/:token')
  manage(@Param('token') token: string) {
    return this.booking.manage(token);
  }

  @Get('manage/:token/availability')
  availabilityForToken(@Param('token') token: string, @Query('date') date: string) {
    return this.booking.availabilityForToken(token, date);
  }

  @Patch('manage/:token/reschedule')
  rescheduleByToken(@Param('token') token: string, @Body() dto: PublicRescheduleDto) {
    return this.booking.rescheduleByToken(token, dto);
  }

  @Patch('manage/:token/cancel')
  cancelByToken(@Param('token') token: string, @Body() dto: PublicCancelDto) {
    return this.booking.cancelByToken(token, dto);
  }

  @Get(':slug')
  page(@Param('slug') slug: string, @Query('service') serviceSlug?: string) {
    return this.booking.page(slug, serviceSlug);
  }

  @Get(':slug/providers')
  providers(@Param('slug') slug: string, @Query('serviceId') serviceId: string) {
    return this.booking.providers(slug, serviceId);
  }

  @Get(':slug/availability')
  availability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.booking.availabilityFor(slug, { serviceId, date, staffId });
  }

  @Get(':slug/form-fields')
  formFields(@Param('slug') slug: string, @Query('serviceId') serviceId: string) {
    return this.booking.formFields(slug, serviceId);
  }

  @Post(':slug/book')
  book(@Param('slug') slug: string, @Body() dto: PublicBookDto) {
    return this.booking.book(slug, dto);
  }
}
