import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  // Populated from the JWT's claims (D-034) — optional because every
  // existing unit test still runs services via
  // `tenantContextStorage.run({ tenantId }, fn)` alone, and none of that
  // pre-auth test code (or any pre-existing service) reads these fields.
  // New code may use them; nothing existing is required to.
  userId?: string;
  staffId?: string;
  role?: string;
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

// Available once real auth (D-034) sets it — the logged-in staff member
// making the current request, for new code that wants "who did this" from
// the session instead of a manual staff-picker DTO field. Existing
// endpoints keep their explicit staffId fields; migrating them off manual
// pickers is a follow-up, not part of this phase.
export function currentStaffId(): string | undefined {
  return tenantContextStorage.getStore()?.staffId;
}

export function currentRole(): string | undefined {
  return tenantContextStorage.getStore()?.role;
}
