import { Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { StaffNotificationService } from './staff-notification.service';

/**
 * PHASE 5 — the signed-in staff member's own inbox. No permission gate
 * beyond authentication ON PURPOSE: every row was addressed to the caller at
 * write time, and reading "a new booking exists" is not authority to act on
 * it — the actions behind each notification keep their own server-side
 * checks (§5D).
 */
@Controller('staff-notifications')
export class StaffNotificationController {
  constructor(private readonly notifications: StaffNotificationService) {}

  @Get()
  list(@Query('unreadOnly') unreadOnly?: string, @Query('take') take?: string) {
    return this.notifications.listMine({
      unreadOnly: unreadOnly === 'true',
      take: take ? Number(take) : undefined,
    });
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.notifications.markRead(id);
  }

  @Post('read-all')
  markAllRead() {
    return this.notifications.markAllRead();
  }
}
