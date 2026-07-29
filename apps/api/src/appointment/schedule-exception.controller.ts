import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ScheduleExceptionService } from './schedule-exception.service';
import { CreateScheduleExceptionDto } from './dto/create-schedule-exception.dto';

@Controller('schedule-exceptions')
export class ScheduleExceptionController {
  constructor(private readonly scheduleExceptions: ScheduleExceptionService) {}

  @Post()
  create(@Body() dto: CreateScheduleExceptionDto) {
    return this.scheduleExceptions.create(dto);
  }

  @Get()
  findAll(
    @Query('staffId') staffId?: string,
    @Query('clinicId') clinicId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.scheduleExceptions.findAll({ staffId, clinicId, from, to });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.scheduleExceptions.remove(id);
  }
}
