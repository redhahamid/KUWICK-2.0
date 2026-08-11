import { useEffect, useState } from 'react';
import { Alert, Descriptions, Modal, Typography, message } from 'antd';
import { ApiError } from '../../core/api-client';
import { QueueBoardRow, VisitCompletionBlocker } from '../types';
import { useCompleteVisit } from '../hooks/useQueueTickets';
import { money } from '../queuePresentation';
import { formatClinicDateTime } from '../clinicTime';
import { QueueBlockerPanel } from './QueueBlockerPanel';

const { Text } = Typography;

interface Props {
  row: QueueBoardRow | null;
  onClose: () => void;
  /** Restores focus to whatever opened the modal. */
  onAfterClose?: () => void;
}

/**
 * G4.5d3c-3b (D-095) — the Complete Visit confirmation.
 *
 * Closing a visit is the one operation that sets `checkOutAt`, so it is never
 * a bare button: staff see what they are asserting — doctor phase, procedures,
 * dispensing, billing and the patient balance — before they confirm.
 *
 * The summary states the PATIENT'S position only. A panel receivable is shown
 * as the panel's share, never as patient debt and never as something the
 * clinic has collected.
 *
 * The preview can go stale between render and submit (someone adds a charge
 * from another terminal), so a 400 carrying blockers is caught and displayed
 * rather than reported as a generic failure.
 */
export function CompleteVisitModal({ row, onClose, onAfterClose }: Props) {
  const complete = useCompleteVisit();
  const [lateBlockers, setLateBlockers] = useState<VisitCompletionBlocker[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (row) {
      setLateBlockers(null);
      setFailure(null);
    }
  }, [row]);

  if (!row) return null;

  const submit = async () => {
    try {
      const result = await complete.mutateAsync({ visitId: row.visitId });
      message.success(
        result.alreadyCompleted
          ? 'This visit was already completed.'
          : `Visit completed for ${row.patientName}.`,
      );
      onClose();
    } catch (error) {
      // The server re-evaluates inside its transaction; if it refuses, show
      // exactly what it found rather than a generic failure.
      const body = error instanceof ApiError ? (error.body as { blockers?: VisitCompletionBlocker[] }) : null;
      if (body?.blockers?.length) {
        setLateBlockers(body.blockers);
        return;
      }
      setFailure(error instanceof ApiError ? error.message : 'The visit could not be completed.');
    }
  };

  const blocked = (lateBlockers?.length ?? 0) > 0;
  const dispensingText =
    row.dispensing.onsiteTotal === 0
      ? 'Not required'
      : row.dispensing.remaining === 0
        ? `All ${row.dispensing.onsiteTotal} dispensed`
        : `${row.dispensing.remaining} still to dispense`;

  return (
    <Modal
      open
      title="Complete this Visit?"
      okText="Complete Visit"
      cancelText="Cancel"
      // The server is asked again on submit; the button is additionally
      // withheld the moment a refusal has been seen.
      okButtonProps={{ disabled: blocked }}
      confirmLoading={complete.isPending}
      onCancel={onClose}
      onOk={submit}
      afterClose={onAfterClose}
      destroyOnHidden
    >
      <Text>
        This will close the active queue visit and record the checkout time. Clinical and financial records remain
        available according to their existing lifecycle rules.
      </Text>

      <Descriptions size="small" column={1} colon={false} style={{ marginTop: 12 }}>
        <Descriptions.Item label="Patient">{row.patientName}</Descriptions.Item>
        <Descriptions.Item label="Visit">
          {row.displayNumber ?? '—'}
          {row.doctorName ? ` · ${row.doctorName}` : ''}
        </Descriptions.Item>
        <Descriptions.Item label="Checked in">{formatClinicDateTime(row.checkInAt)}</Descriptions.Item>
        <Descriptions.Item label="Doctor phase">
          {row.doctorCompletedAt ? 'Completed' : 'Not completed'}
        </Descriptions.Item>
        <Descriptions.Item label="Procedures">
          {row.blockers?.some((b) => b.code === 'PROCEDURE_PENDING') ? 'Outstanding' : 'Resolved'}
        </Descriptions.Item>
        <Descriptions.Item label="Medication dispensing">{dispensingText}</Descriptions.Item>
        <Descriptions.Item label="Billing">
          {row.billing.state === 'SETTLED'
            ? 'Resolved'
            : row.billing.state === 'NO_INVOICE'
              ? 'Nothing to bill'
              : 'Outstanding'}
        </Descriptions.Item>
        <Descriptions.Item label="Patient balance">
          {money(row.billing.remainingBalance ?? '0') ?? 'RM 0.00'}
        </Descriptions.Item>
        {row.billing.panelResponsibility !== null && Number(row.billing.panelResponsibility) > 0 && (
          <Descriptions.Item label="Panel responsibility">
            {/* The amount stacks ABOVE its note: side by side, a narrow value
                column broke "RM 60.00" onto one character per line. */}
            <div style={{ display: 'block' }}>
              <Text style={{ whiteSpace: 'nowrap' }}>{money(row.billing.panelResponsibility)}</Text>
              <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                Claimed from the panel by Finance. It is not owed by the patient and does not hold this visit open.
              </Text>
            </div>
          </Descriptions.Item>
        )}
      </Descriptions>

      {blocked && (
        <Alert
          type="error"
          showIcon
          role="alert"
          style={{ marginTop: 12 }}
          message="This visit can no longer be completed"
          description={
            <QueueBlockerPanel compact row={{ ...row, blockers: lateBlockers ?? [] }} />
          }
        />
      )}

      {failure && (
        <Alert type="error" showIcon role="alert" style={{ marginTop: 12 }} message={failure} />
      )}
    </Modal>
  );
}
