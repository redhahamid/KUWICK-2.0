import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { DoctorServiceQualification, CreateDoctorServiceQualificationDto } from '../types';

export const {
  useList: useDoctorServiceQualifications,
  useCreate: useCreateDoctorServiceQualification,
} = createResourceHooks<DoctorServiceQualification, CreateDoctorServiceQualificationDto>(
  '/doctor-service-qualifications',
  'doctor-service-qualifications',
);
