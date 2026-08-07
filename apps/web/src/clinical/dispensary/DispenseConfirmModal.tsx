import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Typography } from 'antd';
import { KuwickModal, KuwickModalActionBar, KuwickStatusTag } from '../../design-system/kuwick';
import type { DispensaryMedication } from '../hooks/useDispensary';
import { needsStockAcknowledgement, stockPresentation } from './dispensaryPresentation';

const { Text } = Typography;

/**
 * G4.5d5b-3 — the last screen before medicine leaves the clinic.
 *
 * Dispensing cannot be reversed in this product — there is no un-dispense,
 * and returns are out of scope by decision — so this modal exists to make the
 * hand-over deliberate rather than one click away from a list. It states what
 * is about to move, in what quantity, and what the shelf will hold afterwards.
 *
 * The quantity is not editable. It is the prescribed quantity, shown so the
 * dispenser can count against it; the request carries only prescription ids
 * and the server reads the quantity from the record.
 *
 * A shortage is not a blocker but it is not silent either. Where the branch
 * cannot cover the prescription, the confirm button stays disabled until the
 * dispenser ticks an acknowledgement — because dispensing anyway is sometimes
 * the right call (a partly-counted shelf, a stock record behind reality) and
 * the record should say that somebody knew.
 */

export interface DispenseConfirmModalProps {
  open: boolean;
  patientName: string;
  medications: DispensaryMedication[];
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (acknowledgeStockWarning: boolean) => void;
}

export function DispenseConfirmModal({
  open,
  patientName,
  medications,
  loading = false,
  error = null,
  onCancel,
  onConfirm,
}: DispenseConfirmModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Every open starts unacknowledged. A tick that survived from the previous
  // patient would be an acknowledgement nobody made.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  const shortages = medications.filter((medication) =>
    needsStockAcknowledgement(medication.stock.state),
  );
  const blocked = shortages.length > 0 && !acknowledged;

  return (
    <KuwickModal
      open={open}
      size="medium"
      title={medications.length === 1 ? 'Dispense this medication' : `Dispense ${medications.length} medications`}
      subtitle={`${patientName} · this cannot be undone`}
      loading={loading}
      error={error}
      onClose={onCancel}
      dataTestId="dispense-confirm-modal"
      footer={
        <KuwickModalActionBar
          cancel={
            <Button onClick={onCancel} disabled={loading}>
              Cancel
            </Button>
          }
          primary={
            <Button
              type="primary"
              loading={loading}
              disabled={blocked || medications.length === 0}
              onClick={() => onConfirm(shortages.length > 0)}
            >
              {medications.length === 1 ? 'Dispense' : `Dispense ${medications.length} medications`}
            </Button>
          }
        />
      }
    >
      <ul className="kw-dispense-list">
        {medications.map((medication) => {
          const stock = stockPresentation({
            state: medication.stock.state,
            onHand: medication.stock.onHand,
            required: medication.quantity,
          });
          // Only shown where the numbers are genuinely comparable — see
          // stockPresentation for why UNIT_UNKNOWN exists.
          const after =
            medication.stock.onHand !== null && medication.stock.state !== 'UNIT_UNKNOWN'
              ? medication.stock.onHand - medication.quantity
              : null;
          return (
            <li key={medication.prescriptionId} className="kw-dispense-list-item">
              <div className="kw-dispense-list-identity">
                <Text strong>
                  {medication.name}
                  {medication.strength ? ` ${medication.strength}` : ''}
                </Text>
                <Text type="secondary">
                  Quantity {medication.quantity}
                  {medication.stock.prescriptionUnit ? ` ${medication.stock.prescriptionUnit}` : ''}
                </Text>
              </div>
              <div className="kw-dispense-list-stock">
                <KuwickStatusTag tone={stock.tone} label={stock.label} detail={stock.detail} />
                {after !== null && (
                  <Text type="secondary" className="kw-dispense-after">
                    {medication.stock.onHand} → {after} after dispensing
                  </Text>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {shortages.length > 0 && (
        <>
          <Alert
            type="error"
            showIcon
            className="kw-dispense-shortage"
            message={
              shortages.length === 1
                ? 'The branch does not hold enough of one medication'
                : `The branch does not hold enough of ${shortages.length} medications`
            }
            description="Dispensing will still record the full prescribed quantity and will take the branch stock negative. Correct the stock record in Inventory if the shelf disagrees."
          />
          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="kw-dispense-acknowledge"
          >
            I have checked the shelf and am dispensing despite the shortage
          </Checkbox>
        </>
      )}
    </KuwickModal>
  );
}
