import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { AppointmentService } from './appointment.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { CancelAppointmentDto } from './dto/cancel-appointment.dto';

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

  @Patch(':id/arrived')
  arrived(@Param('id') id: string) {
    return this.appointments.arrived(id);
  }
}
