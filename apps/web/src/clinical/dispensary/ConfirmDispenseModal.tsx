import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Typography } from 'antd';
import { KuwickModal, KuwickModalActionBar, KuwickStatusTag } from '../../design-system/kuwick';
import type { DispensaryMedication } from '../hooks/useDispensary';
import { stockPresentation } from './dispensaryPresentation';
import { DispenseException, dispenseExceptions } from './counterPresentation';

const { Text } = Typography;

/**
 * G4.5d5c — ONE confirmation for the whole hand-over.
 *
 * Replaces per-row confirmations. The counter hands a bag to the patient once,
 * so it confirms once: this lists every clinic-supplied medicine still to go
 * out and, on confirm, runs the SAME server-authoritative dispense the
 * per-row action ran — atomic claim per prescription, stock movement, named
 * dispenser, audit, routing. Nothing is marked in the UI alone.
 *
 * NORMAL CASES ARE NOT INTERRUPTED. Where every medicine is in stock this is a
 * plain "yes, handed over" — no acknowledgement, no ticking, no warning to
 * read past. An acknowledgement appears only where an exception genuinely
 * exists, which is what keeps it meaningful when it does.
 */

export interface ConfirmDispenseModalProps {
  open: boolean;
  patientName: string;
  medications: DispensaryMedication[];
  loading?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (acknowledgeStockWarning: boolean) => void;
}

export function ConfirmDispenseModal({
  open,
  patientName,
  medications,
  loading = false,
  error = null,
  onCancel,
  onConfirm,
}: ConfirmDispenseModalProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  // Every open starts unacknowledged; a tick carried over from the previous
  // patient would be an acknowledgement nobody made.
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open]);

  const exceptions: DispenseException[] = dispenseExceptions(
    medications.map((m) => ({
      prescriptionId: m.prescriptionId,
      name: m.name,
      status: m.status,
      quantity: m.quantity,
      stock: { state: m.stock.state, onHand: m.stock.onHand },
    })),
  );
  const blocked = exceptions.length > 0 && !acknowledged;
  const count = medications.length;

  return (
    <KuwickModal
      open={open}
      size="medium"
      title={count === 1 ? 'Confirm medication handed over' : `Confirm ${count} medications handed over`}
      subtitle={`${patientName} · this cannot be undone`}
      loading={loading}
      error={error}
      onClose={onCancel}
      dataTestId="confirm-dispense-modal"
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
              disabled={blocked || count === 0}
              onClick={() => onConfirm(exceptions.length > 0)}
            >
              Confirm Medications Dispensed
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

      {exceptions.length > 0 && (
        <>
          <Alert
            type="error"
            showIcon
            className="kw-dispense-shortage"
            message={
              exceptions.length === 1
                ? 'Stock discrepancy on 1 medication'
                : `Stock discrepancy on ${exceptions.length} medications`
            }
            description={
              <ul className="kw-dispense-exceptions">
                {exceptions.map((e) => (
                  <li key={e.prescriptionId}>
                    <Text strong>{e.name}</Text> — {e.detail}
                  </li>
                ))}
              </ul>
            }
          />
          <Checkbox
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="kw-dispense-acknowledge"
          >
            I have checked the shelf and am handing these over despite the discrepancy
          </Checkbox>
        </>
      )}
    </KuwickModal>
  );
}
