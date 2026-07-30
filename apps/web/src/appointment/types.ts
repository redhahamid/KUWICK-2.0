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
