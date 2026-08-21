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
import { ProviderScheduleModeService } from './provider-schedule-mode.service';
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
import { StaffNotificationService } from './staff-notification.service';
import { StaffNotificationController } from './staff-notification.controller';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { AppointmentChangeRequestService } from './appointment-change-request.service';
import { AppointmentChangeRequestController } from './appointment-change-request.controller';
import { ProviderShiftController } from './provider-shift.controller';
import { ProviderShiftService } from './provider-shift.service';
import { ServiceBookingConfigController } from './service-booking-config.controller';
import { ServiceBookingConfigService } from './service-booking-config.service';
import { BookingPageService } from './booking-page.service';
import { WaitlistService } from './waitlist.service';
import { AppointmentSeriesService } from './appointment-series.service';
import { AppointmentCommunicationService } from './appointment-communication.service';
import { PublicBookingController } from './public-booking.controller';
import { PublicBookingService } from './public-booking.service';
import {
  AppointmentCommunicationController,
  AppointmentSeriesController,
  BookingPageController,
  WaitlistController,
} from './appointment-extras.controller';

@Module({
  imports: [CoreModule, HrModule, ClinicalModule],
  controllers: [
    DoctorScheduleController,
    ProviderShiftController,
    ServiceBookingConfigController,
    BookingPageController,
    WaitlistController,
    AppointmentSeriesController,
    AppointmentCommunicationController,
    PublicBookingController,
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
    StaffNotificationController,
    MediaController,
    AppointmentChangeRequestController,
    AppointmentReminderController,
    AppointmentController,
    ClinicBookingSettingsController,
  ],
  providers: [
    DoctorScheduleService,
    ProviderShiftService,
    ServiceBookingConfigService,
    BookingPageService,
    WaitlistService,
    AppointmentSeriesService,
    AppointmentCommunicationService,
    PublicBookingService,
    ScheduleExceptionService,
    SlotCapacityConfigService,
    DoctorServiceQualificationService,
    ProviderScheduleModeService,
    SlotAvailabilityService,
    AppointmentBookingValidator,
    AppointmentService,
    ClinicBookingSettingsService,
    AppointmentDashboardService,
    StaffNotificationService,
    MediaService,
    AppointmentChangeRequestService,
  ],
})
export class AppointmentModule {}
