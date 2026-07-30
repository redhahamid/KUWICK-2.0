import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { Service, CreateServiceDto } from '../types';

export const { useList: useServices, useCreate: useCreateService } = createResourceHooks<
  Service,
  CreateServiceDto
>('/services', 'services');
