import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Real auth (D-034) — replaces the interim tenant-store.ts (D-017). Tokens
// persist across reloads the same way the old tenant-ID input did, but are
// now issued by POST /auth/login rather than typed in by hand.
export interface AuthenticatedStaff {
  id: string;
  fullName: string;
  role: string;
  // D-045 — this staff member's home branch, if the tenant has more than
  // one clinic and they're assigned to a specific one. Null/undefined =
  // works across every clinic (owner/finance/HR-type roles).
  clinicId?: string | null;
  clinicName?: string | null;
  /**
   * D1 — whether THIS person may author a doctor's clinical narrative,
   * decided by the server using the same function its write path uses.
   *
   * The Canvas used to work this out from the role alone, and got a
   * different answer: a credentialed OWNER_ADMIN — the owner who is also the
   * GP, which describes most single-doctor clinics here — could author on the
   * server and was handed a read-only editor by the browser.
   *
   * Optional because a session minted before this field existed does not
   * carry it. Absent is treated as "fall back to the role", never as "no".
   */
  canAuthorNarrative?: boolean;
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
      // C1 (D-052) — losing the session must also drop every in-memory
      // clinical draft. Otherwise unsaved patient text could still be sitting
      // in the store when the next person signs in on a shared clinic
      // machine. Imported lazily to keep core free of a clinical dependency.
      clearAuth: () => {
        void import('../clinical/clinical-draft-store').then(({ useClinicalDraftStore }) =>
          useClinicalDraftStore.getState().clearAll(),
        );
        set({ accessToken: null, refreshToken: null, staff: null, tenant: null });
      },
    }),
    { name: 'kuwick-auth' },
  ),
);
