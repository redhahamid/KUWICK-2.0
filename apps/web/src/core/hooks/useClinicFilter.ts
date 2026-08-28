import { create } from 'zustand';
import { useAuthStore } from '../auth-store';
import { useClinics } from './useClinics';

/**
 * THE BRANCH A GROUP-LEVEL PERSON IS LOOKING AT — one value, app-wide.
 *
 * This was `useState` inside the hook, which meant every component calling
 * `useClinicFilter` got its OWN copy. The picker in the hub header updated
 * the header's copy and nothing else: the pages below kept asking the server
 * with no branch at all, got "No branch selected for this request", and drew
 * the resulting nothing as zeros. A selection that only the selector can see
 * is not a selection.
 *
 * It survives a reload, in sessionStorage. Without that, opening Finance,
 * choosing Contoh Central, and following a link to Outstanding produced two
 * screens with the same label and different totals — RM653.90 for the branch
 * against RM823.50 for the group — because the second one had quietly lost
 * the branch and gone back to asking about both. Two screens disagreeing about
 * one number is the failure this module exists to prevent.
 *
 * sessionStorage and not localStorage: which branch you are reviewing belongs
 * to the sitting you are in. A branch silently restored a week later is how
 * somebody closes the wrong day.
 */
const BRANCH_KEY = 'kuwick.selectedBranch';

function storedBranch(): string | undefined {
  try {
    return window.sessionStorage.getItem(BRANCH_KEY) ?? undefined;
  } catch {
    // Private mode, blocked storage — the picker still works, it just forgets.
    return undefined;
  }
}

const useSelectedBranch = create<{ clinicId?: string; select: (clinicId?: string) => void }>((set) => ({
  clinicId: storedBranch(),
  select: (clinicId) => {
    try {
      if (clinicId) window.sessionStorage.setItem(BRANCH_KEY, clinicId);
      else window.sessionStorage.removeItem(BRANCH_KEY);
    } catch {
      // Ignored for the same reason as above.
    }
    set({ clinicId });
  },
}));

// D-045 — "once log in supposed to under that clinic": a clinic picker on
// every screen was pure friction for the common case (a single-location
// clinic, or a staff member who only ever works one branch). This resolves
// the clinic automatically wherever possible and only asks when it
// genuinely can't be known — a multi-branch tenant where this staff member
// (owner/finance/HR-type roles) isn't tied to one specific branch.
function useResolvedClinicId() {
  const staffClinicId = useAuthStore((state) => state.staff?.clinicId ?? undefined);
  const { data: clinics } = useClinics();
  const resolvedId = staffClinicId ?? (clinics?.length === 1 ? clinics[0].id : undefined);
  return { resolvedId, clinics };
}

// For read/filter screens (Queue, Reports, Stock lists, ...): a clinicId
// plus a setter, and whether the picker should even be shown. Falls back
// to manual selection only when there's real ambiguity to resolve.
export function useClinicFilter() {
  const { resolvedId, clinics } = useResolvedClinicId();
  const manualClinicId = useSelectedBranch((state) => state.clinicId);
  const setClinicId = useSelectedBranch((state) => state.select);

  const clinicId = resolvedId ?? manualClinicId;
  const showSelector = !resolvedId && (clinics?.length ?? 0) > 1;

  return { clinicId, setClinicId, clinics, showSelector };
}

// For create/edit forms with a required Clinic field (Add to Queue, New
// Visit, Stock In, ...): just the best-guess id to pre-fill via the Form's
// `initialValues`, so a single-clinic tenant or a branch-locked staff
// member never has to touch it. Every such form in this app uses
// `destroyOnHidden`, so a fresh `initialValues` is exactly what's needed
// each time the form (re)mounts — no effect/sync required.
export function useDefaultClinicId(): string | undefined {
  const { resolvedId } = useResolvedClinicId();
  return resolvedId;
}
