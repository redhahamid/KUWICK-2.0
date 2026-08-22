import { BadRequestException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AppointmentDashboardService,
  DashboardTab,
  TAB_STATUSES,
} from './appointment-dashboard.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** "a,b" → ['a','b']; empty/absent → undefined, meaning "no filter". */
function listOf(value?: string): string[] | undefined {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? items : undefined;
}

@Controller('appointments/dashboard')
export class AppointmentDashboardController {
  constructor(private readonly dashboard: AppointmentDashboardService) {}

  @Get()
  find(
    @Query('clinicId') clinicId: string,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('tab') tab?: string,
    @Query('staffId') staffId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('source') source?: string,
    @Query('search') search?: string,
  ) {
    if (!clinicId) throw new BadRequestException('clinicId is required');
    if (!DATE.test(from ?? '') || !DATE.test(to ?? '')) {
      throw new BadRequestException('from and to must be written as YYYY-MM-DD.');
    }
    if (to < from) throw new BadRequestException('The end of the period is before its start.');

    const resolved = (tab ?? 'UPCOMING').toUpperCase();
    if (!(resolved in TAB_STATUSES)) {
      throw new BadRequestException(`Unknown tab "${tab}".`);
    }

    return this.dashboard.dashboard({
      clinicId,
      from,
      to,
      tab: resolved as DashboardTab,
      staffId,
      // Comma-separated multi-select (Phase 3H): "Ear Suction, and only Ear
      // Suction" is one value; "these two related services" is two.
      serviceIds: listOf(serviceId),
      sources: listOf(source),
      search,
    });
  }

  /**
   * PHASE 8 — the setup checklist. Computed from what is actually configured,
   * so it can never disagree with the screens it links to.
   */
  @Get('setup-checklist')
  setupChecklist(@Query('clinicId') clinicId: string) {
    if (!clinicId) throw new BadRequestException('clinicId is required');
    return this.dashboard.setupChecklist(clinicId);
  }

  /**
   * The WAITLIST tab, which reads its own table. Not a `tab` value on the
   * query above, because a waitlist entry has no scheduled time and the date
   * range that bounds every other tab means nothing to it.
   */
  @Get('waitlist')
  waitlist(
    @Query('clinicId') clinicId: string,
    @Query('staffId') staffId?: string,
    @Query('serviceId') serviceId?: string,
    @Query('search') search?: string,
  ) {
    if (!clinicId) throw new BadRequestException('clinicId is required');
    return this.dashboard.waitlist({ clinicId, staffId, serviceIds: listOf(serviceId), search });
  }
}

@Controller('appointments')
export class AppointmentReminderController {
  constructor(private readonly dashboard: AppointmentDashboardService) {}

  /**
   * Records that a reminder was sent. The MESSAGE goes through WhatsApp on the
   * staff member's own phone via a wa.me link — Kuwick sends nothing and
   * therefore claims nothing about delivery. This records only that somebody
   * pressed the button, which is the only part the clinic can honestly assert.
   */
  @Post(':id/reminder-sent')
  markReminderSent(@Param('id') id: string) {
    return this.dashboard.markReminderSent(id);
  }
}
