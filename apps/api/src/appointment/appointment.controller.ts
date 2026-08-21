import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';
import { CheckInAppointmentDto } from './dto/check-in-appointment.dto';

@Controller('appointments')
export class AppointmentController {
  constructor(private readonly appointments: AppointmentService) {}

  @Post()
  create(@Body() dto: CreateAppointmentDto) {
    return this.appointments.create(dto);
  }

  @Get()
  findAll(
    @Query('clinicId') clinicId?: string,
    @Query('staffId') staffId?: string,
    @Query('patientId') patientId?: string,
    @Query('status') status?: AppointmentStatus,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.appointments.findAll({
      clinicId,
      staffId,
      patientId,
      status,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.appointments.findById(id);
  }

  @Patch(':id/confirm')
  confirm(@Param('id') id: string) {
    return this.appointments.confirm(id);
  }

  @Patch(':id/reschedule')
  reschedule(@Param('id') id: string, @Body() dto: RescheduleAppointmentDto) {
    return this.appointments.reschedule(id, dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id') id: string, @Body() dto: CancelAppointmentDto) {
    return this.appointments.cancel(id, dto);
  }

  @Patch(':id/no-show')
  noShow(@Param('id') id: string) {
    return this.appointments.noShow(id);
  }

  /**
   * Kept as `arrived` because the front desk, the calendar and the canvas all
   * call it, and renaming a live route to say the same thing differently is
   * churn. What it DOES is the full check-in: mark arrived, create the visit
   * and the type-A queue ticket, link both, and move to CHECKED_IN.
   */
  @Patch(':id/arrived')
  arrived(@Param('id') id: string, @Body() dto: CheckInAppointmentDto) {
    return this.appointments.checkIn(id, dto);
  }

  /** "They're here" without committing to a visit yet. */
  @Patch(':id/mark-arrived')
  markArrived(@Param('id') id: string) {
    return this.appointments.markArrived(id);
  }

  /** §30 — the clinic declining a request that needed approval. */
  @Patch(':id/reject')
  reject(@Param('id') id: string, @Body('reason') reason?: string) {
    return this.appointments.reject(id, reason);
  }

  /** Everything the detail drawer shows, including the appointment's history. */
  @Get(':id/detail')
  detail(@Param('id') id: string) {
    return this.appointments.findDetail(id);
  }
}
