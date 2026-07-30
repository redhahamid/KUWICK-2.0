import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { Supplier, CreateSupplierDto } from '../types';

export const { useList: useSuppliers, useCreate: useCreateSupplier } = createResourceHooks<
  Supplier,
  CreateSupplierDto
>('/suppliers', 'suppliers');
