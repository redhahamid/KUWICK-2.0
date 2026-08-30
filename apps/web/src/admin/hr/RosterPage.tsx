import { Alert } from 'antd';
import { AdminShell } from '../components/AdminShell';
import { RosterPage as CanonicalRosterPage } from '../../appointment/roster/RosterPage';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';

/**
 * THE ROSTER, seen from HR — and it is the SAME roster.
 *
 * There is exactly one shift table in this product and exactly one component
 * that edits it. Two screens once wrote it with opposite models and saving one
 * destroyed the other's rows; that is why `RosterPage` is imported here rather
 * than re-implemented, and why this file contains no query, no mutation and no
 * shift model of its own.
 *
 * What this wrapper adds is the two things the canonical page cannot know: the
 * branch the Admin hub is currently filtered to, and an Admin header so that
 * arriving here from HR ▸ Roster does not feel like leaving Admin.
 */
export function AdminRosterPage() {
  const { clinicId } = useClinicFilter();

  return (
    <AdminShell
      title="Roster"
      subtitle="Who is scheduled, by branch and month. The same roster the Appointments module uses — edited here, read everywhere."
    >
      <Alert
        type="info"
        showIcon
        message="One roster"
        description="Shifts saved here are the shifts the calendar books against and the shifts HR ▸ Today reads. There is no separate HR schedule."
      />
      <CanonicalRosterPage clinicId={clinicId} />
    </AdminShell>
  );
}
