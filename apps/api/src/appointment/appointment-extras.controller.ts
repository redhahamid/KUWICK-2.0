import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { BookingPageService } from './booking-page.service';
import { WaitlistService } from './waitlist.service';
import { AppointmentSeriesService, SeriesScope } from './appointment-series.service';
import { AppointmentCommunicationService } from './appointment-communication.service';
import {
  CreateSeriesDto,
  CreateWaitlistEntryDto,
  LogCommunicationDto,
  UpdateWaitlistEntryDto,
  UpsertBookingPageDto,
  UpsertReminderRulesDto,
} from './dto/appointment-extras.dto';

@Controller('booking-page')
export class BookingPageController {
  constructor(private readonly pages: BookingPageService) {}

  @Get()
  get(@Query('clinicId') clinicId: string) {
    return this.pages.get(clinicId);
  }

  @Put()
  upsert(@Body() dto: UpsertBookingPageDto) {
    return this.pages.upsert(dto);
  }

  @Put('reminder-rules')
  setReminderRules(@Body() dto: UpsertReminderRulesDto) {
    return this.pages.setReminderRules(dto);
  }
}

@Controller('waitlist')
export class WaitlistController {
  constructor(private readonly waitlist: WaitlistService) {}

  // Literal before `:id`.
  @Get('matches')
  matches(
    @Query('clinicId') clinicId: string,
    @Query('serviceId') serviceId: string,
    @Query('staffId') staffId: string,
    @Query('start') start: string,
  ) {
    return this.waitlist.matchesFor({ clinicId, serviceId, staffId, start: new Date(start) });
  }

  @Post()
  create(@Body() dto: CreateWaitlistEntryDto) {
    return this.waitlist.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWaitlistEntryDto) {
    return this.waitlist.update(id, dto);
  }

  @Patch(':id/booked')
  markBooked(@Param('id') id: string, @Body('appointmentId') appointmentId: string) {
    return this.waitlist.markBooked(id, appointmentId);
  }
}

@Controller('appointment-series')
export class AppointmentSeriesController {
  constructor(private readonly series: AppointmentSeriesService) {}

  @Post()
  create(@Body() dto: CreateSeriesDto) {
    return this.series.create(dto);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.series.detail(id);
  }

  @Patch(':id/cancel')
  cancelScope(
    @Param('id') id: string,
    @Body() body: { fromAppointmentId: string; scope: SeriesScope; reason?: string },
  ) {
    return this.series.cancelScope({
      seriesId: id,
      fromAppointmentId: body.fromAppointmentId,
      scope: body.scope,
      reason: body.reason,
    });
  }
}

@Controller('appointment-communications')
export class AppointmentCommunicationController {
  constructor(private readonly communications: AppointmentCommunicationService) {}

  @Get('due')
  due(@Query('clinicId') clinicId: string) {
    return this.communications.due(clinicId);
  }

  /** Final-UAT Reminder Centre — literals stay ABOVE :appointmentId. */
  @Get('upcoming')
  upcoming(@Query('clinicId') clinicId: string) {
    return this.communications.upcoming(clinicId);
  }

  @Get('sent')
  sent(@Query('clinicId') clinicId: string) {
    return this.communications.sentHistory(clinicId);
  }

  @Get(':appointmentId')
  list(@Param('appointmentId') appointmentId: string) {
    return this.communications.list(appointmentId);
  }

  @Post(':appointmentId')
  logManualSend(@Param('appointmentId') appointmentId: string, @Body() dto: LogCommunicationDto) {
    return this.communications.logManualSend(appointmentId, dto);
  }
}
