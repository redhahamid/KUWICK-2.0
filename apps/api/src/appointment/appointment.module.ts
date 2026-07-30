import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { HrModule } from '../hr/hr.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { DoctorScheduleController } from './doctor-schedule.controller';
import { DoctorScheduleService } from './doctor-schedule.service';
import { ScheduleExceptionController } from './schedule-exception.controller';
import { ScheduleExceptionService } from './schedule-exception.service';
import { SlotCapacityConfigController } from './slot-capacity-config.controller';
import { SlotCapacityConfigService } from './slot-capacity-config.service';
import { DoctorServiceQualificationController } from './doctor-service-qualification.controller';
import { DoctorServiceQualificationService } from './doctor-service-qualification.service';
import { AvailabilityController } from './availability.controller';
import { SlotAvailabilityService } from './slot-availability.service';
import { AppointmentController } from './appointment.controller';
import { AppointmentService } from './appointment.service';
import { AppointmentBookingValidator } from './appointment-booking-validator.service';

@Module({
  imports: [CoreModule, HrModule, ClinicalModule],
  controllers: [
    DoctorScheduleController,
    ScheduleExceptionController,
    SlotCapacityConfigController,
    DoctorServiceQualificationController,
    AvailabilityController,
    AppointmentController,
  ],
  providers: [
    DoctorScheduleService,
    ScheduleExceptionService,
    SlotCapacityConfigService,
    DoctorServiceQualificationService,
    SlotAvailabilityService,
    AppointmentBookingValidator,
    AppointmentService,
  ],
})
export class AppointmentModule {}
