import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
}

export const tenantContextStorage = new AsyncLocalStorage<TenantContext>();

// tenantId is never accepted from request bodies (a client must never be able
// to write into a different tenant, even by accident) — every create() call
// derives it from here instead.
export function currentTenantId(): string {
  const store = tenantContextStorage.getStore();
  if (!store) {
    throw new Error('Tenant context not set — every tenant-scoped call must run behind TenantContextMiddleware');
  }
  return store.tenantId;
}
