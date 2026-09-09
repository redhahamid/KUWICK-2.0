import { Alert, Button, Space, Spin } from 'antd';
import { AdminNotice, AdminShell } from '../components/AdminShell';
import { RosterPage as CanonicalRosterPage } from '../../appointment/roster/RosterPage';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { WorkAreaTabs } from '../components/WorkAreaTabs';

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
const SCHEDULE_VIEWS = [
  { path: '/admin/hr/schedule', label: 'Schedule' },
  { path: '/admin/hr/attendance', label: 'Attendance' },
];

export function AdminRosterPage() {
  const { clinicId, setClinicId, clinics } = useClinicFilter();

  // A ROSTER IS ONE BRANCH'S, and the Admin hub opens on "All branches".
  //
  // So the default arrival at HR ▸ Roster was a blank page reading "Choose a
  // branch to see its roster" — an instruction whose control is in the hub
  // header, above the tabs, where somebody looking at an empty board is not
  // looking. The matrix genuinely cannot be drawn for two branches at once
  // (providers down, dates across, one clinic's shifts in the cells), so the
  // answer is not to render something: it is to put the choice where the
  // person is already looking.
  //
  // The branch list arrives asynchronously, so this covers the whole of
  // "no branch yet" rather than only the settled case — otherwise the screen
  // flashes the canonical board's own bare empty state on the way here, which
  // is the very thing being replaced.
  if (!clinicId) {
    return (
      <AdminShell
        title="Schedule"
        subtitle="Who is working, by branch and month."
      >
        <WorkAreaTabs views={SCHEDULE_VIEWS} />
        <AdminNotice tone="info">
          <strong>A roster belongs to one branch.</strong> Shifts are people against dates at a place, so this
          board shows one branch at a time rather than averaging two. Pick the one you are rostering:
          <div style={{ marginTop: 12 }}>
            {clinics ? (
              <Space wrap>
                {clinics.map((clinic) => (
                  <Button key={clinic.id} onClick={() => setClinicId(clinic.id)}>
                    {clinic.name}
                  </Button>
                ))}
              </Space>
            ) : (
              <Spin size="small" />
            )}
          </div>
        </AdminNotice>
      </AdminShell>
    );
  }

  return (
    <AdminShell
      title="Schedule"
      subtitle="Who is working, by branch and month."
    >
      <WorkAreaTabs views={SCHEDULE_VIEWS} />
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
