import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Platform-admin session (D-034) — a wholly separate identity from a clinic
// staff login (useAuthStore): no tenantId, manages tenants themselves.
export interface AuthenticatedPlatformAdmin {
  id: string;
  email: string;
  fullName: string;
}

interface PlatformAuthState {
  accessToken: string | null;
  admin: AuthenticatedPlatformAdmin | null;
  setSession: (session: { accessToken: string; admin: AuthenticatedPlatformAdmin }) => void;
  clearAuth: () => void;
}

export const usePlatformAuthStore = create<PlatformAuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      admin: null,
      setSession: ({ accessToken, admin }) => set({ accessToken, admin }),
      clearAuth: () => set({ accessToken: null, admin: null }),
    }),
    { name: 'kuwick-platform-auth' },
  ),
);
