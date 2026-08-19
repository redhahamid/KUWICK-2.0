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
import { ClinicBookingSettingsController } from './clinic-booking-settings.controller';
import { ClinicBookingSettingsService } from './clinic-booking-settings.service';
import {
  AppointmentDashboardController,
  AppointmentReminderController,
} from './appointment-dashboard.controller';
import { AppointmentDashboardService } from './appointment-dashboard.service';
import { ProviderShiftController } from './provider-shift.controller';
import { ProviderShiftService } from './provider-shift.service';

@Module({
  imports: [CoreModule, HrModule, ClinicalModule],
  controllers: [
    DoctorScheduleController,
    ProviderShiftController,
    ScheduleExceptionController,
    SlotCapacityConfigController,
    DoctorServiceQualificationController,
    AvailabilityController,
    // BEFORE `AppointmentController`, and this ordering is load-bearing.
    // That controller is `@Controller('appointments')` with a `@Get(':id')`,
    // and Nest matches in registration order — registered first, it reads
    // `/appointments/dashboard` as an appointment whose id is "dashboard" and
    // the dashboard silently returns nothing. The same trap `@Get('bookable')`
    // and `@Get('weekly')` avoid within a single controller, which is exactly
    // why it was easy to miss across two.
    // Pinned by `appointment-route-order.spec.ts` — reordering this list
    // breaks the dashboard silently.
    AppointmentDashboardController,
    AppointmentReminderController,
    AppointmentController,
    ClinicBookingSettingsController,
  ],
  providers: [
    DoctorScheduleService,
    ProviderShiftService,
    ScheduleExceptionService,
    SlotCapacityConfigService,
    DoctorServiceQualificationService,
    SlotAvailabilityService,
    AppointmentBookingValidator,
    AppointmentService,
    ClinicBookingSettingsService,
    AppointmentDashboardService,
  ],
})
export class AppointmentModule {}
