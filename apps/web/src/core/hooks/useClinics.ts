import { createResourceHooks } from './use-crud-resource';
import { Clinic, CreateClinicDto } from '../types';

export const { useList: useClinics, useCreate: useCreateClinic } = createResourceHooks<
  Clinic,
  CreateClinicDto
>('/clinics', 'clinics');
