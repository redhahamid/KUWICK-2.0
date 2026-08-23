import { Select } from 'antd';
import { PageHeader } from '../../design-system/components/PageHeader';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { CommunicationCentre } from './CommunicationCentre';

/**
 * SETTINGS → APPOINTMENTS & SCHEDULING → COMMUNICATION & REMINDERS
 *
 * Final-UAT: the editor itself is the shared CommunicationCentre, which ALSO
 * renders inside Appointments → Booking Page → Communication so the module
 * needs no page switch. One component, two doors, one store — this page
 * survives for bookmarks and for owners who think in Clinic Settings terms.
 */
export function CommunicationSettingsPage() {
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();

  return (
    <div className="kw-settings-page" data-testid="communication-settings">
      <PageHeader
        title="Communication & reminders"
        subtitle="What Kuwick says to patients, in the clinic's own words — and when to nudge them."
      />

      {showSelector && (
        <Select
          className="kw-settings-clinic"
          placeholder="Choose a branch"
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((row) => ({ value: row.id, label: row.name }))}
        />
      )}

      <CommunicationCentre clinicId={clinicId} />
    </div>
  );
}
