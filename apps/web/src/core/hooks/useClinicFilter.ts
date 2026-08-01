import { useState } from 'react';
import { useAuthStore } from '../auth-store';
import { useClinics } from './useClinics';

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
  const [manualClinicId, setManualClinicId] = useState<string>();

  const clinicId = resolvedId ?? manualClinicId;
  const showSelector = !resolvedId && (clinics?.length ?? 0) > 1;

  return { clinicId, setClinicId: setManualClinicId, clinics, showSelector };
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
