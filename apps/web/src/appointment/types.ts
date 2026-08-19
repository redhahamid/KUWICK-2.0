import type { AppointmentStatus } from '@kuwick/shared';

// Service/CreateServiceDto moved to ../clinical/types.ts — ServiceCatalog is
// owned by Clinical Operations (docs/DECISIONS.md, Clinical 1a Phase 1),
// this module only references it by id.

export interface DoctorSchedule {
  id: string;
  tenantId: string;
  clinicId: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo: string | null;
}

export interface CreateDoctorScheduleDto {
  clinicId: string;
  staffId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  effectiveFrom: string;
  effectiveTo?: string;
}

export interface ScheduleException {
  id: string;
  tenantId: string;
  clinicId: string;
  staffId: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  reason: string | null;
}

export interface CreateScheduleExceptionDto {
  clinicId: string;
  staffId: string;
  date: string;
  startTime?: string;
  endTime?: string;
  reason?: string;
}

export interface DoctorServiceQualification {
  id: string;
  tenantId: string;
  staffId: string;
  serviceId: string;
}

export interface CreateDoctorServiceQualificationDto {
  staffId: string;
  serviceId: string;
}

export interface SlotCapacityConfig {
  id: string;
  tenantId: string;
  clinicId: string;
  staffId: string;
  serviceId: string;
  slotLengthMinutes: number;
  dailyCapacity: number | null;
}

export interface CreateSlotCapacityConfigDto {
  clinicId: string;
  staffId: string;
  serviceId: string;
  slotLengthMinutes: number;
  dailyCapacity?: number;
}

export type AppointmentSource = 'ONLINE_PORTAL' | 'FRONT_DESK';

export interface Appointment {
  id: string;
  tenantId: string;
  clinicId: string;
  patientId: string;
  staffId: string;
  serviceId: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  scheduledStart: string;
  scheduledEnd: string;
  notes: string | null;
  cancelReason: string | null;
  arrivedAt: string | null;
  rescheduledFromId: string | null;

  /**
   * The visit this appointment BECAME when the patient arrived. Null until
   * then, and null forever for one that never arrived — which is why "Open
   * record" is only offered when it is set.
   */
  visitId?: string | null;
  cancelledByStaffId?: string | null;
  cancelledAt?: string | null;
  reminderSentAt?: string | null;
}

export interface CreateAppointmentDto {
  clinicId: string;
  patientId: string;
  staffId: string;
  serviceId: string;
  source: AppointmentSource;
  scheduledStart: string;
  scheduledEnd: string;
  notes?: string;
}

export interface RescheduleAppointmentDto {
  scheduledStart: string;
  scheduledEnd: string;
}

export interface AvailableSlot {
  start: string;
  end: string;
}
