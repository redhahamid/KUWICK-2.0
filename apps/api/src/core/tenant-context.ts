import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();
