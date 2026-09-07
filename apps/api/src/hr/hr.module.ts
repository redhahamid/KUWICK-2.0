import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';
import { LeaveRequestService } from './leave-request.service';
import { LeaveRequestController } from './leave-request.controller';
import { PublicHolidayService } from './public-holiday.service';
import { PublicHolidayController } from './public-holiday.controller';
import { RoleAccessService } from './role-access.service';
import { RoleAccessController } from './role-access.controller';

@Module({
  imports: [CoreModule],
  controllers: [StaffController, LeaveRequestController, PublicHolidayController, RoleAccessController],
  providers: [StaffService, LeaveRequestService, PublicHolidayService, RoleAccessService],
  exports: [StaffService],
})
export class HrModule {}
