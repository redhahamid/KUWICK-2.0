import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { DoctorScheduleService } from './doctor-schedule.service';
import { CreateDoctorScheduleDto } from './dto/create-doctor-schedule.dto';
import { UpdateDoctorScheduleDto } from './dto/update-doctor-schedule.dto';

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

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDoctorScheduleDto) {
    return this.doctorSchedules.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.doctorSchedules.remove(id);
  }
}
