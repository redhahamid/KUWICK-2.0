import { Button, Select, Space, Spin } from 'antd';
import { AdminNotice, AdminShell } from '../components/AdminShell';
import { RosterPage as CanonicalRosterPage } from '../../appointment/roster/RosterPage';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { FilterBar, Filter } from '../components/FilterBar';
import { TIME_VIEWS, WorkAreaTabs } from '../components/WorkAreaTabs';

/**
 * THE ROSTER, seen from HR — and it is the SAME roster.
 *
 * There is exactly one shift table in this product and exactly one component
 * that edits it. Two screens once wrote it with opposite models and saving one
 * destroyed the other's rows; that is why `RosterPage` is imported here rather
 * than re-implemented, and why this file contains no query, no mutation and no
 * shift model of its own.
 *
 * THE "ONE ROSTER" BANNER IS GONE. It was a blue alert on every visit
 * explaining that shifts saved here are the shifts the calendar books
 * against — true, and a note to a developer reading the codebase rather than
 * to somebody rostering a Tuesday. A permanent banner nobody can dismiss is
 * read once and then becomes 60px of noise above the work.
 *
 * What this wrapper adds is the branch — the one thing the canonical board
 * cannot know — and the Admin frame, so arriving from HR ▸ Time & Leave does
 * not feel like leaving HR.
 */
export function AdminRosterPage() {
  const { clinicId, setClinicId, clinics } = useClinicFilter();

  // A ROSTER IS ONE BRANCH'S, and the Admin hub opens on "All branches".
  //
  // So the default arrival was a blank page reading "Choose a branch to see
  // its roster" — an instruction whose control was in the hub header, above
  // the tabs, where somebody looking at an empty board is not looking. The
  // matrix genuinely cannot be drawn for two branches at once, so the answer
  // is not to render something: it is to put the choice where the person is.
  if (!clinicId) {
    return (
      <AdminShell title="Roster" subtitle="Who is working, by branch and month.">
        <WorkAreaTabs views={TIME_VIEWS} />
        <AdminNotice tone="info">
          <strong>A roster belongs to one branch.</strong> Shifts are people against dates at a place, so this
          board shows one branch at a time rather than averaging two.
          <div style={{ marginTop: 12 }}>
            {clinics ? (
              <Space wrap>
                {clinics.map((clinic) => (
                  <Button key={clinic.id} type="primary" ghost onClick={() => setClinicId(clinic.id)}>
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
    <AdminShell title="Roster" subtitle="Who is working, by branch and month.">
      <WorkAreaTabs views={TIME_VIEWS} />
      {(clinics?.length ?? 0) > 1 ? (
        <FilterBar>
          <Filter label="Branch">
            <Select
              size="small"
              style={{ width: 200 }}
              value={clinicId}
              onChange={(value) => setClinicId(value)}
              options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          </Filter>
        </FilterBar>
      ) : null}
      <CanonicalRosterPage clinicId={clinicId} />
    </AdminShell>
  );
}
