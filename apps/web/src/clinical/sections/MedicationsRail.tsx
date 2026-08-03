import { useState } from 'react';
import { Button, Drawer, Space, Tag, Tooltip, Typography, message } from 'antd';
import { ExperimentOutlined } from '@ant-design/icons';
import {
  useCancelPrescription,
  useDispensePrescription,
  usePrescriptions,
} from '../hooks/usePrescriptions';
import { MedicationsTab } from '../MedicationsTab';
import { Prescription } from '../types';
import { ApiError } from '../../core/api-client';
import { RailPanel } from './RailPanel';

const { Text } = Typography;

interface MedicationsRailProps {
  visitId: string;
}

const STATUS_COLOR: Record<string, string> = {
  ORDERED: 'gold',
  DISPENSED: 'green',
  CANCELLED: 'default',
};

/**
 * G4.5b (D-071) — Medications, always open in the rail.
 *
 * The prescription is readable without a click: name, strength where the item
 * carries one, dose, frequency, duration, quantity, dispensing status, and
 * the weight the calculation actually used. Reviewing what a patient is on
 * was previously a reveal click away, which is the one thing a doctor does
 * most often and least deliberately.
 *
 * Prescribing itself is NOT reduced to one click. The full workflow —
 * item search, weight- and age-based calculators, copy-previous, dispense,
 * label printing, and every existing validation — is the unchanged
 * `MedicationsTab`, opened in a Drawer. Dose, frequency, duration and
 * quantity remain deliberate clinical decisions; what was removed is the
 * reveal-only click in front of them.
 *
 * At 1366 the Drawer may cover the rail. It must never resize the note: the
 * note's height is declared in CSS and nothing here touches it.
 */
export function MedicationsRail({ visitId }: MedicationsRailProps) {
  const [prescribing, setPrescribing] = useState(false);
  const { data: prescriptions, isLoading, error } = usePrescriptions(visitId);
  const dispense = useDispensePrescription(visitId);
  const cancel = useCancelPrescription(visitId);

  const list = prescriptions ?? [];
  const awaitingDispense = list.filter((p) => p.status === 'ORDERED').length;

  const report = (err: unknown, fallback: string) =>
    message.error(err instanceof ApiError ? err.message : fallback);

  // Only what the item genuinely stores. `Item` has strengthMg and concVolMl
  // and no dosage-form field, so a tablet's strength cannot be rendered as
  // reliably as a syrup's — nothing is fabricated to fill the gap.
  const strengthOf = (prescription: Prescription): string | null => {
    const mg = prescription.item?.strengthMg;
    return mg ? `${mg}mg` : null;
  };

  const calculationNote = (prescription: Prescription): string | null => {
    if (prescription.calcMethod === 'WEIGHT_BASED' && prescription.calcWeightKg) {
      return `Calculated using ${prescription.calcWeightKg} kg`;
    }
    if (prescription.calcMethod === 'AGE_BASED') {
      return 'Age-band recommendation';
    }
    if (prescription.calcMethod === 'MANUAL') {
      return 'Manual dose entered';
    }
    return null;
  };

  return (
    <>
      <RailPanel
        title="Medications"
        anchorId="kw-anchor-medications"
        count={list.length}
        status={awaitingDispense > 0 ? <Tag color="gold">{awaitingDispense} to dispense</Tag> : undefined}
        isLoading={isLoading}
        error={error ?? undefined}
        emptyText="No medications prescribed for this visit"
        previewLimit={5}
        addControl={
          <Space size={6} wrap>
            <Button type="primary" icon={<ExperimentOutlined />} onClick={() => setPrescribing(true)}>
              Add Medication
            </Button>
            {/* Copy Previous stays deliberate and re-runs the current
                allergy and prescribing checks — it lives inside the same
                prescribing surface rather than being a one-click shortcut. */}
            <Button onClick={() => setPrescribing(true)}>Copy Previous</Button>
          </Space>
        }
        items={list.map((prescription) => {
          const strength = strengthOf(prescription);
          const calculated = calculationNote(prescription);
          return (
            <div key={prescription.id} className="kw-rail-row">
              <div className="kw-rail-row-main">
                <Space size={4} wrap>
                  <Text strong style={{ fontSize: 14 }}>
                    {prescription.item?.name ?? 'Medication'}
                  </Text>
                  {strength && <Text type="secondary" style={{ fontSize: 12 }}>{strength}</Text>}
                  <Tag color={STATUS_COLOR[prescription.status]}>{prescription.status}</Tag>
                </Space>
                <Text style={{ fontSize: 12 }}>
                  {prescription.amount}
                  {prescription.unit ? ` ${prescription.unit}` : ''} · {prescription.frequency} ·{' '}
                  {prescription.durationDays} day{prescription.durationDays === 1 ? '' : 's'} · qty{' '}
                  {prescription.quantity}
                  {(prescription.remark || prescription.indication) && (
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {' · '}
                      {prescription.remark ?? prescription.indication}
                    </Text>
                  )}
                </Text>

                {calculated && (
                  <Tooltip title="The calculation recorded at prescribing time, kept with the prescription.">
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      ⚖ {calculated}
                    </Text>
                  </Tooltip>
                )}
              </div>
              <Space size={4} className="kw-rail-row-actions">
                {prescription.status === 'ORDERED' && (
                  <>
                    <Button
                      size="small"
                      type="primary"
                      loading={dispense.isPending}
                      onClick={() =>
                        dispense.mutateAsync({ id: prescription.id }).catch((e) => report(e, 'Failed to dispense'))
                      }
                    >
                      Dispense
                    </Button>
                    <Button
                      size="small"
                      danger
                      onClick={() =>
                        cancel
                          .mutateAsync({ id: prescription.id, input: { cancelReason: 'Cancelled by prescriber' } })
                          .catch((e) => report(e, 'Failed to cancel'))
                      }
                    >
                      Cancel
                    </Button>
                  </>
                )}
              </Space>
            </div>
          );
        })}
      />

      {/* The unchanged prescribing workspace: calculators, copy-previous,
          dispensing, labels and every existing validation. */}
      <Drawer
        title="Prescribe medication"
        placement="right"
        width={720}
        open={prescribing}
        onClose={() => setPrescribing(false)}
        destroyOnHidden
      >
        <MedicationsTab visitId={visitId} />
      </Drawer>
    </>
  );
}
