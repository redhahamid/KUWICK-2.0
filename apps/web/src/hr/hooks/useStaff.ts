import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { Staff, CreateStaffDto } from '../types';

export const { useList: useStaff, useCreate: useCreateStaff } = createResourceHooks<
  Staff,
  CreateStaffDto
>('/staff', 'staff');
