import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { SlotCapacityConfig, CreateSlotCapacityConfigDto } from '../types';

export const {
  useList: useSlotCapacityConfigs,
  useCreate: useCreateSlotCapacityConfig,
} = createResourceHooks<SlotCapacityConfig, CreateSlotCapacityConfigDto>(
  '/slot-capacity-configs',
  'slot-capacity-configs',
);
