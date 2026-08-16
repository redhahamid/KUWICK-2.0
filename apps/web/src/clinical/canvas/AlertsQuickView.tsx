import { ReactElement, useState } from 'react';
import { Popover, Typography } from 'antd';
import { Patient } from '../../core/types';
import { usePatientAlerts } from '../hooks/usePatientAlerts';
import { AlertsPanel } from '../PatientAlertsPanel';

const { Text } = Typography;

/**
 * The alerts, where the chip is — not in the middle of the screen.
 *
 * FIX 1 gave the alert chip its own view instead of the full patient profile,
 * but made it a centred modal: the canvas dimmed, the consultation went behind
 * a mask, and answering "what is this patient flagged for?" cost a full context
 * switch and a Close button. The allergy chip beside it had already settled the
 * right shape — click the chip, the answer opens under it, click away and it is
 * gone — and two adjacent chips in one band should not behave differently.
 *
 * So the same shape as `AllergyQuickRecord`: an anchored popover on a
 * deliberate click, dismissed by clicking away. Nothing is dimmed and nothing
 * is lost — there is no half-typed form to protect here, because adding and
 * resolving each commit on their own button, which is also why this does not
 * need the Phase B dismissal guard a modal would.
 *
 * The panel inside is the SAME `AlertsPanel` the profile renders, in its
 * compact layout. The rules that carry clinical weight — nothing is deleted,
 * resolving stamps a second author, a resolved row stays visible, MEDICAL and
 * ALLERGY stay honest-disabled without the permission — are one implementation,
 * not a lighter re-write that could quietly lose one.
 */
export function AlertsQuickView({
  patient,
  canEdit,
  canRecordMedical,
  children,
}: {
  patient: Patient;
  canEdit: boolean;
  canRecordMedical: boolean;
  /** The chip. It stays in the header, so its own rules stay with it. */
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const { data: alerts, isLoading } = usePatientAlerts(patient.id);

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomLeft"
      content={
        <div
          data-testid="patient-alerts-popover"
          style={{
            // Wide enough for a type select and a label field stacked, narrow
            // enough to stay a popover rather than a modal in disguise.
            width: 340,
            // A patient with a long history scrolls INSIDE the popover. Letting
            // it grow would push the resolved rows off the bottom of the
            // viewport, where the append-only history may as well not exist.
            maxHeight: '60vh',
            overflowY: 'auto',
          }}
        >
          <Text strong style={{ display: 'block' }}>
            Patient alerts
          </Text>
          {/* Named, because an alerts list with no name on it is one a doctor
              has to trust they opened from the right row. */}
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            {patient.name}
          </Text>
          <AlertsPanel
            patient={patient}
            alerts={alerts}
            loading={isLoading}
            canEdit={canEdit}
            canRecordMedical={canRecordMedical}
            compact
          />
        </div>
      }
    >
      {children}
    </Popover>
  );
}
