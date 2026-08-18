import { BadRequestException, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AppointmentDashboardService,
  DashboardTab,
  TAB_STATUSES,
} from './appointment-dashboard.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      serviceId,
      search,
    });
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
