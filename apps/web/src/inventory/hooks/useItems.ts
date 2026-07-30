import { createResourceHooks } from '../../core/hooks/use-crud-resource';
import { Item, CreateItemDto } from '../types';

export const { useList: useItems, useCreate: useCreateItem } = createResourceHooks<Item, CreateItemDto>(
  '/items',
  'items',
);
