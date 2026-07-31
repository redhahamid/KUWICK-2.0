import { Controller, Get, Query } from '@nestjs/common';
import { AttendanceService } from './attendance.service';

@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get()
  getAttendance(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('clinicId') clinicId?: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.attendance.getAttendance({ from, to, clinicId, staffId });
  }
}
