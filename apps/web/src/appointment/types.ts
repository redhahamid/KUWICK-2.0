import type { AppointmentStatus } from '@kuwick/shared';

export interface Service {
  id: string;
  tenantId: string;
  name: string;
  durationMinutesDefault: number;
  active: boolean;
}

export interface CreateServiceDto {
  name: string;
  durationMinutesDefault: number;
}

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
