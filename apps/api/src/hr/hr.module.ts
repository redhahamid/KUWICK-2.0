import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { LeaveRequestService } from './leave-request.service';
import { LeaveRequestController } from './leave-request.controller';
import { PublicHolidayService } from './public-holiday.service';
import { PublicHolidayController } from './public-holiday.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

@Module({
  imports: [CoreModule],
  controllers: [StaffController, LeaveRequestController, PublicHolidayController, AttendanceController],
  providers: [StaffService, LeaveRequestService, PublicHolidayService, AttendanceService],
  exports: [StaffService],
})
export class HrModule {}
