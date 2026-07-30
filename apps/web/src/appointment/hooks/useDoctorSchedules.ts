import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { DoctorSchedule, CreateDoctorScheduleDto } from '../types';

export const { useList: useDoctorSchedules, useCreate: useCreateDoctorSchedule } = createResourceHooks<
  DoctorSchedule,
  CreateDoctorScheduleDto
>('/doctor-schedules', 'doctor-schedules');
