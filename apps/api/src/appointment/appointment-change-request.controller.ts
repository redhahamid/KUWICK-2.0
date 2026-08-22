import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { AppointmentChangeRequestService } from './appointment-change-request.service';

/**
 * PHASE 7 — staff review of patient change requests. Permissions are asserted
 * in the service per request TYPE (reschedule vs cancel), mirroring what an
 * approval would actually do to the diary.
 */
@Controller()
export class AppointmentChangeRequestController {
  constructor(private readonly requests: AppointmentChangeRequestService) {}

  @Get('appointments/:id/change-requests')
  list(@Param('id') id: string) {
    return this.requests.listFor(id);
  }

  @Post('appointment-change-requests/:id/approve')
  approve(@Param('id') id: string) {
    return this.requests.approve(id);
  }

  @Post('appointment-change-requests/:id/decline')
  decline(@Param('id') id: string, @Body('note') note?: string) {
    return this.requests.decline(id, note);
  }
}
