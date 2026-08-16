import { Button, Popconfirm, Select, Space, Tag, Tooltip, Typography, message } from 'antd';
import { PrinterOutlined, WarningFilled } from '@ant-design/icons';
import dayjs from 'dayjs';
import { printDrugLabel } from '../printTextDocument';
import {
  useCancelPrescription,
  useDispensePrescription,
  useMarkPrescriptionReviewed,
  useRemovePrescription,
  useSetSupplyMode,
} from '../hooks/usePrescriptions';
import {
  CARRIED_OVER_LABEL,
  NEEDS_REVIEW_LABEL,
  REVIEW_ACTION_HINT,
  REVIEW_ACTION_LABEL,
  isCarriedOver,
  needsReview,
  reviewedLine,
} from '../medications/reviewState';
import { useStaff } from '../../hr/hooks/useStaff';
import { PatientAllergyStrip } from '../medications/AllergyStrip';
import {
  SUPPLY_MODE_OPTIONS,
  SUPPLY_MODE_UNRESOLVED_LABEL,
  canOfferDispense,
  isUnresolvedSupply,
  supplyModeLabel,
} from '../medicationSupplyPresentation';
import { useStockLevels } from '../../inventory/hooks/useStock';
import { Prescription, PrescriptionStatus } from '../types';
import { Clinic, Patient } from '../../core/types';
import { ApiError } from '../../core/api-client';

const { Text } = Typography;

// D-091 — ORDERED is no longer described as "To dispense": whether clinic
// dispensing is required is the SUPPLY MODE's fact, shown beside it, and an
// external prescription labelled "to dispense" told the dispensary to expect
// medicine that was never coming to the counter.
const STATUS_LABEL: Record<PrescriptionStatus, string> = {
  ORDERED: 'Ordered',
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
  const setSupply = useSetSupplyMode(visitId);
  const markReviewed = useMarkPrescriptionReviewed(visitId);
  const { data: stockLevels } = useStockLevels();
  // Only to put a NAME on an id the row already carries. No clinical fact is
  // read from here, and a staff list that fails to load costs the attribution
  // its name, never the row its state.
  const { data: staff } = useStaff();

  const report = (error: unknown, fallback: string) =>
    message.error(error instanceof ApiError ? error.message : fallback);

  const list = prescriptions ?? [];

  const stockFor = (itemId: string): number | undefined =>
    stockLevels
      ?.filter((level) => level.itemId === itemId)
      .reduce((total, level) => total + Number(level.quantityOnHand ?? 0), 0);

  return (
    <div>
      {/* KW2-C2 — the persistent strip, pinned to the top of the list.
          It replaces a RED alert and a separate blue "no allergies recorded"
          banner. Both were wrong: red said stop where nothing had decided
          anything was wrong, and the blue one reported "none recorded" for a
          patient nobody had asked in exactly the same words as for one who
          had answered no. Three states, one of which is deliberately silent. */}
      <PatientAllergyStrip allergies={patient ? (patient.allergies ?? null) : undefined} patientId={patient?.id} />

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
            const carriedOver = isCarriedOver(prescription);
            const awaitingReview = needsReview(prescription);
            const reviewer = prescription.reviewedByStaffId
              ? (staff?.find((s) => s.id === prescription.reviewedByStaffId)?.fullName ?? null)
              : null;
            const reviewed = reviewedLine({
              name: reviewer,
              at: prescription.reviewedAt
                ? dayjs(prescription.reviewedAt).format('D MMM YYYY, HH:mm')
                : null,
            });

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
                    {/* KW2-C2 — provenance, then state. Two tags rather than
                        one because they answer different questions and the
                        first one never goes away: "carried over" stays true
                        after the review, "not reviewed" does not. */}
                    {carriedOver && <Tag>{CARRIED_OVER_LABEL}</Tag>}
                    {awaitingReview && (
                      // Amber. Not red — nobody has said this is wrong, only
                      // that nobody has looked, and red here would be the
                      // interaction warning Kuwick does not perform.
                      <Tag color="gold">{NEEDS_REVIEW_LABEL}</Tag>
                    )}
                  </Space>

                  <div>
                    <Text>
                      {prescription.amount}
                      {prescription.unit ?? ''} · {prescription.frequency} · {prescription.durationDays} days ·
                      Qty {prescription.quantity}
                    </Text>
                  </div>

                  {/* D-091 — the supply intent. Editable HERE, on the
                      prescribing surface, while the row is still ORDERED: a
                      labelled select for the doctor, and plain words for a
                      row that can no longer change. NULL shows as a
                      placeholder the doctor must resolve, never as a
                      preselected clinic dispensing. */}
                  {prescription.status === 'ORDERED' ? (
                    <div className="kw-supply-edit">
                      <Text type="secondary" style={{ fontSize: 12 }} id={`supply-label-${prescription.id}`}>
                        Supply mode
                      </Text>
                      <Select
                        size="small"
                        style={{ width: 230 }}
                        aria-labelledby={`supply-label-${prescription.id}`}
                        value={prescription.supplyMode ?? undefined}
                        placeholder={SUPPLY_MODE_UNRESOLVED_LABEL}
                        status={isUnresolvedSupply(prescription) ? 'warning' : undefined}
                        options={SUPPLY_MODE_OPTIONS}
                        loading={setSupply.isPending}
                        onChange={(value) =>
                          setSupply
                            .mutateAsync({ id: prescription.id, dto: { supplyMode: value } })
                            .catch((e) => report(e, 'Failed to update the supply mode'))
                        }
                      />
                      {isUnresolvedSupply(prescription) && (
                        <Text type="warning" style={{ fontSize: 12 }}>
                          {SUPPLY_MODE_UNRESOLVED_LABEL}
                        </Text>
                      )}
                    </div>
                  ) : prescription.status === 'DISPENSED' ? (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {supplyModeLabel(prescription.supplyMode)}
                      </Text>
                    </div>
                  ) : null}

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

                  {/* Who re-read it. A clinical acknowledgement without a name
                      and a time is not an acknowledgement — it is a tick box
                      that nobody owns (owner decision 4). */}
                  {reviewed && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }} data-reviewed-line="true">
                        {reviewed}
                      </Text>
                    </div>
                  )}
                </div>

                <Space size={4} className="kw-dx-actions">
                  {/* KW2-C2 — the explicit re-read. Offered ONLY while the
                      flag is up, so it disappears once it has been used and
                      cannot be pressed twice; editing any field of the row
                      clears the same flag on the server, which is why this is
                      an affordance and not the only way out of the state. */}
                  {awaitingReview && (
                    <Tooltip title={REVIEW_ACTION_HINT}>
                      <Button
                        size="small"
                        loading={markReviewed.isPending}
                        onClick={() =>
                          markReviewed
                            .mutateAsync(prescription.id)
                            .catch((e) => report(e, 'Failed to record the review'))
                        }
                      >
                        {REVIEW_ACTION_LABEL}
                      </Button>
                    </Tooltip>
                  )}

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
                      {/* D-091 — only where clinic dispensing is the RECORDED
                          intent (see medicationSupplyPresentation). */}
                      {canOfferDispense(prescription) && (
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
                      )}
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
