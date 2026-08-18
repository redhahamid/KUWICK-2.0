import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { DoctorScheduleService } from './doctor-schedule.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';
import { SetWeeklyAvailabilityDto } from './dto/set-weekly-availability.dto';

@Controller('doctor-schedules')
export class DoctorScheduleController {
  constructor(private readonly doctorSchedules: DoctorScheduleService) {}

  @Post()
  create(@Body() dto: CreateDoctorScheduleDto) {
    return this.doctorSchedules.create(dto);
  }

  @Get()
  findAll(@Query('staffId') staffId?: string, @Query('clinicId') clinicId?: string) {
    return this.doctorSchedules.findAll({ staffId, clinicId });
  }

  // Before `:id` — otherwise Nest reads "weekly" as an id.
  @Get('weekly')
  weekly(@Query('staffId') staffId: string, @Query('clinicId') clinicId: string) {
    return this.doctorSchedules.weekly(staffId, clinicId);
  }

  @Put('weekly')
  setWeekly(@Body() dto: SetWeeklyAvailabilityDto) {
    return this.doctorSchedules.setWeekly(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDoctorScheduleDto) {
    return this.doctorSchedules.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doctorSchedules.remove(id);
  }
}
