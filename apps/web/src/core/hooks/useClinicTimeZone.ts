import { useEffect } from 'react';
import { useClinics } from './useClinics';
import { useAuthStore } from '../auth-store';
import { setClinicTimeZone } from '../../clinical/clinicTime';

/**
 * Point the clinical formatters at the clinic's own zone, once, at app boot.
 *
 * Every time on every clinical surface is rendered by `clinicTime.ts`, which
 * holds ONE zone for the whole session. This is where that zone comes from.
 *
 * Which clinic's? The staff member's own branch when they have one, otherwise
 * the tenant's first — a multi-branch tenant whose branches genuinely span
 * zones would need a per-surface answer, and nothing in Kuwick asks for one
 * yet. Malaysia is a single zone, so the honest scope of this is "the clinic
 * is not necessarily where the laptop is", which it fixes completely.
 */
export function useClinicTimeZoneSync(): void {
  const staffClinicId = useAuthStore((state) => state.staff?.clinicId ?? undefined);
  const { data: clinics } = useClinics();

  useEffect(() => {
    if (!clinics?.length) return;
    const mine = staffClinicId ? clinics.find((clinic) => clinic.id === staffClinicId) : undefined;
    setClinicTimeZone((mine ?? clinics[0]).timezone);
  }, [clinics, staffClinicId]);
}
