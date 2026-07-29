import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { StaffService } from './staff.service';
import { StaffController } from './staff.controller';

@Module({
  imports: [CoreModule],
  controllers: [StaffController],
  providers: [StaffService],
  exports: [StaffService],
})
export class HrModule {}
