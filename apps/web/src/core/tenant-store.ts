import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Interim, frontend-side counterpart to the backend's interim tenant
// header (docs/DECISIONS.md D-017): until real login exists, the operator
// enters a tenant UUID once (top bar) and it's persisted here so every
// API call can carry it. Swapped for a real session once auth ships.
interface TenantState {
  tenantId: string | null;
  setTenantId: (tenantId: string | null) => void;
}

export const useTenantStore = create<TenantState>()(
  persist(
    (set) => ({
      tenantId: null,
      setTenantId: (tenantId) => set({ tenantId }),
    }),
    { name: 'kuwick-tenant-id' },
  ),
);
