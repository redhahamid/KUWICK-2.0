import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Real auth (D-034) — replaces the interim tenant-store.ts (D-017). Tokens
// persist across reloads the same way the old tenant-ID input did, but are
// now issued by POST /auth/login rather than typed in by hand.
export interface AuthenticatedStaff {
  id: string;
  fullName: string;
  role: string;
}

export interface AuthenticatedTenant {
  id: string;
  name: string;
  slug: string | null;
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  staff: AuthenticatedStaff | null;
  tenant: AuthenticatedTenant | null;
  setSession: (session: {
    accessToken: string;
    refreshToken: string;
    staff: AuthenticatedStaff;
    tenant: AuthenticatedTenant;
  }) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      staff: null,
      tenant: null,
      setSession: ({ accessToken, refreshToken, staff, tenant }) => set({ accessToken, refreshToken, staff, tenant }),
      setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
      clearAuth: () => set({ accessToken: null, refreshToken: null, staff: null, tenant: null }),
    }),
    { name: 'kuwick-auth' },
  ),
);
