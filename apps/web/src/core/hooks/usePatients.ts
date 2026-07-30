import { createResourceHooks } from './use-crud-resource';
import { Patient, CreatePatientDto } from '../types';

export const { useList: usePatients, useCreate: useCreatePatient } = createResourceHooks<
  Patient,
  CreatePatientDto
>('/patients', 'patients');
