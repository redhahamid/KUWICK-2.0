import { KuwickModal, KuwickModalActionBar } from '../design-system/kuwick';
import { Button } from 'antd';
import { Patient } from '../core/types';
import { usePatientAlerts } from './hooks/usePatientAlerts';
import { AlertsPanel } from './PatientAlertsPanel';

/**
 * b1.5 FIX 1 — the alerts, and ONLY the alerts.
 *
 * Clicking the alert chip used to open the whole patient profile: demographics,
 * contact, payer, an editable name field. A doctor mid-consult checking why a
 * patient is flagged landed in a form for changing their address. Two intents,
 * two controls — "what is flagged on this person?" and "let me correct their
 * phone number" are not the same question, and answering the first with the
 * second is how a consultation gets interrupted by a demographics edit nobody
 * asked for.
 *
 * So: view active alerts, add one, resolve one. Nothing else. The full profile
 * has its own clearly labelled control in the header beside it.
 *
 * Same `AlertsPanel` the profile renders, so the rules that matter — nothing is
 * deleted, resolving stamps a second author, a resolved row stays visible —
 * are one implementation rather than two that drift.
 */
export interface PatientAlertsModalProps {
  open: boolean;
  patient: Patient;
  onClose: () => void;
  canEdit?: boolean;
  canRecordMedical?: boolean;
}

export function PatientAlertsModal({
  open,
  patient,
  onClose,
  canEdit = true,
  canRecordMedical = true,
}: PatientAlertsModalProps) {
  const { data: alerts, isLoading } = usePatientAlerts(patient.id);

  return (
    <KuwickModal
      open={open}
      title="Patient alerts"
      // The patient is named, because an alerts list with no name on it is one
      // a doctor has to trust they opened from the right row.
      subtitle={patient.name}
      size="medium"
      // Nothing here is a half-typed form the doctor would lose: the add form
      // holds its own state and the panel's own Cancel clears it.
      onClose={onClose}
      dataTestId="patient-alerts-modal"
      footer={
        // Close is the PRIMARY here, because there is no save: adding and
        // resolving each commit on their own button inside the panel. A
        // greyed-out "Save" on a list would be a control that never works.
        <KuwickModalActionBar
          primary={
            <Button type="primary" onClick={onClose}>
              Close
            </Button>
          }
        />
      }
    >
      <AlertsPanel
        patient={patient}
        alerts={alerts}
        loading={isLoading}
        canEdit={canEdit}
        canRecordMedical={canRecordMedical}
      />
    </KuwickModal>
  );
}
