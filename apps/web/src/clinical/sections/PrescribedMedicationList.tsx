import { Alert, Button, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd';
import { ExclamationCircleFilled, PrinterOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { printDrugLabel } from '../printTextDocument';
import {
  useCancelPrescription,
  useDispensePrescription,
  useRemovePrescription,
} from '../hooks/usePrescriptions';
import { useStockLevels } from '../../inventory/hooks/useStock';
import { Prescription, PrescriptionStatus } from '../types';
import { Clinic, Patient } from '../../core/types';
import { ApiError } from '../../core/api-client';

const { Text } = Typography;

const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  ORDERED: 'To dispense',
  DISPENSED: 'Dispensed',
  CANCELLED: 'Cancelled',
};

const STATUS_COLOR: Record<PrescriptionStatus, string> = {
  ORDERED: 'gold',
  DISPENSED: 'green',
  CANCELLED: 'default',
};

interface PrescribedMedicationListProps {
  visitId: string;
  prescriptions: Prescription[] | undefined;
  isLoading?: boolean;
  patient?: Patient;
  clinic?: Clinic;
  latestWeightKg?: string | null;
}

// G2b (D-060) — the prescribed-medication list.
//
// Replaces a 6-column antd Table that needed horizontal scrolling on anything
// narrower than a laptop and hid the clinical detail (indication, remark,
// prescriber) behind a cramped cell. Each medication is now a row that wraps,
// so dose, frequency, duration, quantity and instructions stay readable at
// 375px without zooming.
//
// Strength is read from the prescribed Item and LABELLED as the item's
// strength — it is a property of the product, not a per-prescription field,
// and pretending otherwise would misrepresent the record. Route is not shown
// at all because it is not modelled.
export function PrescribedMedicationList({
  visitId,
  prescriptions,
  isLoading,
  patient,
  clinic,
  latestWeightKg,
}: PrescribedMedicationListProps) {
  const dispense = useDispensePrescription(visitId);
  const cancel = useCancelPrescription(visitId);
  const remove = useRemovePrescription(visitId);
  const { data: stockLevels } = useStockLevels();

  const report = (error: unknown, fallback: string) =>
    message.error(error instanceof ApiError ? error.message : fallback);

  const allergies = patient?.allergies ?? [];
  const list = prescriptions ?? [];

  const stockFor = (itemId: string): number | undefined =>
    stockLevels
      ?.filter((level) => level.itemId === itemId)
      .reduce((total, level) => total + Number(level.quantityOnHand ?? 0), 0);

  return (
    <div>
      {/* Allergy context beside prescribing. Icon + words, never colour alone.
          Kuwick does NOT cross-check a drug against these — saying so plainly
          is safer than a banner that implies a check nobody implemented. */}
      {allergies.length > 0 ? (
        <Alert
          type="error"
          showIcon
          icon={<ExclamationCircleFilled />}
          style={{ marginBottom: 12 }}
          message={`Recorded allergies: ${allergies.join(', ')}`}
          description="Kuwick does not automatically check prescriptions against these. Please review before prescribing."
        />
      ) : (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="No allergies recorded for this patient"
        />
      )}

      {latestWeightKg && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          Latest recorded weight: {latestWeightKg} kg — used to seed the dosage calculator.
        </Text>
      )}

      {list.length === 0 && !isLoading ? (
        <Text type="secondary" italic>
          No medications prescribed for this visit.
        </Text>
      ) : (
        <div className="kw-dx-list">
          {list.map((prescription) => {
            const item = prescription.item;
            const stock = item ? stockFor(item.id) : undefined;
            const lowStock = stock !== undefined && stock <= 0;

            return (
              <div key={prescription.id} className="kw-dx-row">
                <div className="kw-dx-main">
                  <Space wrap size={6}>
                    <Text strong>{item?.name ?? 'Unknown medicine'}</Text>
                    {/* Labelled as the ITEM's strength — see the note above. */}
                    {item?.strengthMg && <Tag color="geekblue">Item strength {item.strengthMg} mg</Tag>}
                    <Tag color={STATUS_COLOR[prescription.status]}>{STATUS_LABEL[prescription.status]}</Tag>
                    {prescription.calcMethod && (
                      <Tooltip
                        title={
                          prescription.calcMethod === 'WEIGHT_BASED'
                            ? `Weight-based: ${prescription.calcWeightKg ?? '—'} kg at ${prescription.calcDoseRateMgKg ?? '—'} mg/kg`
                            : 'Dose taken from an age bracket'
                        }
                      >
                        <Tag>
                          {prescription.calcMethod === 'WEIGHT_BASED' ? 'Weight-based dose' : 'Age-based dose'}
                        </Tag>
                      </Tooltip>
                    )}
                    {lowStock && (
                      <Tag color="red" icon={<WarningFilled />}>
                        No stock on hand
                      </Tag>
                    )}
                  </Space>

                  <div>
                    <Text>
                      {prescription.amount}
                      {prescription.unit ?? ''} · {prescription.frequency} · {prescription.durationDays} days ·
                      Qty {prescription.quantity}
                    </Text>
                  </div>

                  {prescription.indication && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Indication: {prescription.indication}
                      </Text>
                    </div>
                  )}
                  {prescription.remark && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        Instructions: {prescription.remark}
                      </Text>
                    </div>
                  )}

                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      Prescribed by {prescription.prescribedBy?.fullName ?? 'not recorded'} ·{' '}
                      {dayjs(prescription.prescribedAt).format('D MMM YYYY, HH:mm')}
                      {prescription.dispensedAt &&
                        ` · Dispensed ${dayjs(prescription.dispensedAt).format('D MMM, HH:mm')}`}
                      {stock !== undefined && ` · Stock on hand: ${stock}`}
                    </Text>
                  </div>
                </div>

                <Space size={4} className="kw-dx-actions">
                  <Tooltip title="Print drug label">
                    <Button
                      size="small"
                      icon={<PrinterOutlined />}
                      aria-label="Print drug label"
                      onClick={() =>
                        printDrugLabel({
                          clinicName: clinic?.name ?? '',
                          clinicAddress: clinic?.address,
                          clinicPhone: clinic?.phone,
                          clinicEmail: clinic?.email,
                          patientName: patient?.name ?? '',
                          drugName: item?.name ?? '',
                          dose: `${prescription.amount}${prescription.unit ?? ''}`,
                          frequency: prescription.frequency,
                          durationDays: prescription.durationDays,
                          indication: prescription.indication,
                          quantity: prescription.quantity,
                        })
                      }
                    />
                  </Tooltip>

                  {/* Only what this status permits. Stock decrements at
                      DISPENSED only — that rule is the server's, unchanged. */}
                  {prescription.status === 'ORDERED' && (
                    <>
                      <Button
                        size="small"
                        type="primary"
                        loading={dispense.isPending}
                        onClick={() =>
                          dispense
                            .mutateAsync({ id: prescription.id })
                            .catch((e) => report(e, 'Failed to dispense'))
                        }
                      >
                        Dispense
                      </Button>
                      <Popconfirm
                        title="Cancel this prescription?"
                        okText="Cancel"
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          cancel.mutateAsync({ id: prescription.id }).catch((e) => report(e, 'Failed to cancel'))
                        }
                      >
                        <Button size="small" danger>
                          Cancel
                        </Button>
                      </Popconfirm>
                      <Popconfirm
                        title="Delete this prescription?"
                        description="It is removed from the visit entirely."
                        okText="Delete"
                        okButtonProps={{ danger: true }}
                        onConfirm={() =>
                          remove.mutateAsync(prescription.id).catch((e) => report(e, 'Failed to delete'))
                        }
                      >
                        <Button size="small" type="text" danger>
                          Delete
                        </Button>
                      </Popconfirm>
                    </>
                  )}
                </Space>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
