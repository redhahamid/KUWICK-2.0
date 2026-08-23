import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PublicBookingService } from './public-booking.service';
import { PublicBookDto, PublicCancelDto, PublicChangeRequestDto, PublicRescheduleDto } from './dto/public-booking.dto';

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

  /**
   * The manage-booking routes carry the SLUG as well as the token, and that is
   * a requirement rather than a nicety: appointments are behind row-level
   * security, so the token alone cannot be looked up without a tenant to scope
   * by. The slug resolves the clinic through the one table that is readable
   * without one. See the service.
   *
   * Three path segments, so these cannot collide with `:slug/:serviceSlug`.
   */
  @Get(':slug/manage/:token')
  manage(@Param('slug') slug: string, @Param('token') token: string) {
    return this.booking.manage(slug, token);
  }

  @Get(':slug/manage/:token/availability')
  availabilityForToken(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Query('date') date: string,
  ) {
    return this.booking.availabilityForToken(slug, token, date);
  }

  /**
   * Final-UAT — the reschedule calendar's month heat map, scoped by the
   * manage token. Cacheable for a minute: a heat map may be sixty seconds
   * stale; the slot grid and the write stay exact.
   */
  @Get(':slug/manage/:token/month-availability')
  async monthAvailabilityForToken(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Query('month') month: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.set('Cache-Control', 'public, max-age=60');
    return this.booking.monthAvailabilityForToken(slug, token, month);
  }

  @Patch(':slug/manage/:token/reschedule')
  rescheduleByToken(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body() dto: PublicRescheduleDto,
  ) {
    return this.booking.rescheduleByToken(slug, token, dto);
  }

  @Patch(':slug/manage/:token/cancel')
  cancelByToken(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body() dto: PublicCancelDto,
  ) {
    return this.booking.cancelByToken(slug, token, dto);
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

  /**
   * Final-UAT — one month of per-day availability for the colour-coded date
   * step, aggregated from the same engine the slot grid asks. See the
   * token variant above for the cache rationale.
   */
  @Get(':slug/month-availability')
  async monthAvailability(
    @Param('slug') slug: string,
    @Query('serviceId') serviceId: string,
    @Query('month') month: string,
    @Res({ passthrough: true }) res: Response,
    @Query('staffId') staffId?: string,
  ) {
    res.set('Cache-Control', 'public, max-age=60');
    return this.booking.monthAvailability(slug, { serviceId, month, staffId });
  }

  /**
   * Phase 6 — the public image bytes, tenant-resolved through the slug like
   * every other read on this controller. Cacheable hard: ids are immutable.
   */
  @Get(':slug/media/:id')
  async media(@Param('slug') slug: string, @Param('id') id: string, @Res() res: Response) {
    const row = await this.booking.mediaBySlug(slug, id);
    res.set({
      'Content-Type': row.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.send(Buffer.from(row.data));
  }

  /** Phase 7 — the patient's request; the appointment itself stays put. */
  @Post(':slug/manage/:token/request-change')
  requestChange(
    @Param('slug') slug: string,
    @Param('token') token: string,
    @Body() dto: PublicChangeRequestDto,
  ) {
    return this.booking.requestChangeByToken(slug, token, dto);
  }

  @Get(':slug/form-fields')
  formFields(@Param('slug') slug: string, @Query('serviceId') serviceId: string) {
    return this.booking.formFields(slug, serviceId);
  }

  @Get(':slug')
  page(@Param('slug') slug: string, @Query('service') serviceSlug?: string) {
    return this.booking.page(slug, serviceSlug);
  }

  @Post(':slug/book')
  book(@Param('slug') slug: string, @Body() dto: PublicBookDto) {
    return this.booking.book(slug, dto);
  }
}
