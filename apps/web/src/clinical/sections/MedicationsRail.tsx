import { useRef, useState } from 'react';
import { Button, Drawer, Dropdown, Space, Tag, Tooltip, Typography, message } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import {
  useCancelPrescription,
  useDispensePrescription,
  usePrescriptions,
  useSetSupplyMode,
} from '../hooks/usePrescriptions';
import {
  SUPPLY_MODE_OPTIONS,
  canOfferDispense,
  isUnresolvedSupply,
  supplyCounts,
  supplyModeLabel,
  toDispenseText,
  unresolvedSupplyFirst,
  unresolvedText,
} from '../medicationSupplyPresentation';
import { MedicationsTab } from '../MedicationsTab';
import { PatientAllergyStrip } from '../medications/AllergyStrip';
import { useVisit } from '../hooks/useVisits';
import { AddMedicationModal } from '../medications/AddMedicationModal';
import { MedicineSearchBox } from '../medications/MedicineSearchBox';
import { Item } from '../../inventory/types';
import { Prescription } from '../types';
import { ApiError } from '../../core/api-client';
import { RailPanel } from './RailPanel';

const { Text } = Typography;

interface MedicationsRailProps {
  visitId: string;
}

// Token colour pairs, each rendered WITH its word (D-077 §4). D-091 adds the
// words themselves: the chip used to print the raw enum value.
const STATUS_CHIP: Record<string, { className: string; label: string }> = {
  ORDERED: { className: 'kw-chip-pending', label: 'Ordered' },
  DISPENSED: { className: 'kw-chip-success', label: 'Dispensed' },
  CANCELLED: { className: 'kw-chip-neutral', label: 'Cancelled' },
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
/**
 * b4 PIECE 1 — what moved off the row, kept as one hoverable string.
 *
 * How it was calculated, where it is dispensed from, and the prescriber's
 * remark. Each was a permanent line; together they were half the height of the
 * medications card and the reason eight medicines ran to thirty-two lines.
 */
export function secondaryDetail(
  prescription: Pick<Prescription, 'supplyMode' | 'status' | 'remark' | 'indication'>,
  calculated: string | null,
): string {
  return [
    calculated ? `⚖ ${calculated}` : null,
    prescription.status !== 'CANCELLED' ? supplyModeLabel(prescription.supplyMode) : null,
    prescription.remark ?? prescription.indication ?? null,
  ]
    .filter(Boolean)
    .join(' · ');
}

export function MedicationsRail({ visitId }: MedicationsRailProps) {
  // G4.5d5b-1 — two distinct surfaces now, where there was one drawer holding
  // everything. Adding a medication is a focused modal; Copy Previous still
  // needs the full prescribing workspace (calculators, source selection), so
  // it keeps the drawer rather than being crammed into a modal that is the
  // wrong shape for it.
  const [addingMedication, setAddingMedication] = useState(false);
  const [prescribing, setPrescribing] = useState(false);
  // The medicine chosen in the rail's search box, handed to the form whole so
  // it can lock the title and show price and stock without a second request.
  const [pickedMedicine, setPickedMedicine] = useState<Item | undefined>();
  // Bumped to put the cursor back in the search box after Add & Add Another.
  const [searchFocus, setSearchFocus] = useState(0);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const { data: prescriptions, isLoading, error } = usePrescriptions(visitId);
  // C1/D-091 — the visit query only. The allergy strip needs the patient, and
  // nothing here may reach the clinical note query that feeds the editor.
  const { data: visit } = useVisit(visitId);
  const dispense = useDispensePrescription(visitId);
  const cancel = useCancelPrescription(visitId);
  const setSupply = useSetSupplyMode(visitId);

  const list = prescriptions ?? [];
  // D-091 — counted the way the server routes, not "every ORDERED row". An
  // external prescription is not dispensary work, and a NULL mode is a
  // question, reported separately rather than folded into the number.
  const { toDispense, unresolved } = supplyCounts(list);

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
        status={
          toDispense > 0 || unresolved > 0 ? (
            <Space size={4} wrap>
              {toDispense > 0 && <Tag className="kw-chip-pending">{toDispenseText(toDispense)}</Tag>}
              {unresolved > 0 && <Tag className="kw-chip-danger">{unresolvedText(unresolved)}</Tag>}
            </Space>
          ) : undefined
        }
        isLoading={isLoading}
        error={error ?? undefined}
        // KW2-C2 — pinned above the Add button, so it is read before the form
        // opens rather than beside the list of what is already prescribed.
        // Undefined (not null) where the visit has not loaded: "we do not
        // know yet" must not render as "nobody asked".
        banner={
          <PatientAllergyStrip
            patientId={visit?.patient?.id}
          />
        }
        emptyText="No medications prescribed for this visit"
        previewLimit={5}
        addControl={
          /* b1 — SEARCH-FIRST. "Add Medication" was a button whose only job was
             to reveal a search box, so every prescription began with a click
             that decided nothing. The box is here now, always visible, and
             typing is the first act. Choosing a result opens the pre-filled
             form with the drug locked as its title. */
          <div className="kw-rail-add">
            <MedicineSearchBox
              onPick={(item) => {
                setPickedMedicine(item);
                setAddingMedication(true);
              }}
              focusSignal={searchFocus}
              disabled={Boolean(visit?.checkOutAt)}
            />
            {/* Copy Previous stays deliberate and re-runs the current
                allergy and prescribing checks — it lives inside the same
                prescribing surface rather than being a one-click shortcut. */}
            <Button ref={addButtonRef} onClick={() => setPrescribing(true)}>
              Copy Previous
            </Button>
          </div>
        }
        /* Rows nobody has decided the supply for come first, so the disclosure
           threshold below can never collapse one out of sight. The counts
           above are computed from the unordered list and are unaffected. */
        items={unresolvedSupplyFirst(list).map((prescription) => {
          const strength = strengthOf(prescription);
          const calculated = calculationNote(prescription);
          const unresolvedRow = isUnresolvedSupply(prescription);
          return (
            <div
              key={prescription.id}
              className="kw-rail-row"
              // The footer's "Review Medications" lands on the first of
              // these (D-091) — a DOM fact, so the navigation code can find
              // the row without re-deriving any clinical rule.
              {...(unresolvedRow ? { 'data-unresolved-supply': 'true', tabIndex: -1 } : {})}
            >
              <div className="kw-rail-row-main">
                {/* b4 PIECE 1 — ONE LINE, the way a paper prescription writes
                    one line per drug.
                    It spent four: name+status, the dose line, the calculation
                    note, and the supply source. Eight medicines was thirty-two
                    lines and the invoice had nowhere to go. The two that moved
                    are secondary — how it was calculated, and where it is
                    dispensed from — and they moved to HOVER, not to a click:
                    nothing is behind an interaction a doctor has to know to
                    make. */}
                {/*
                  HOVER, via a plain title attribute rather than a portal.
                  The detail stays in the DOM and in the accessibility tree —
                  a screen reader and a test can both still find "Dispense from
                  clinic". A tooltip that only exists while a pointer is over it
                  would have removed the information rather than relocated it,
                  which on a supply decision is not a layout choice.
                */}
                <Space size={4} wrap title={secondaryDetail(prescription, calculated)}>
                  <Text strong style={{ fontSize: 14 }}>
                    {prescription.item?.name ?? 'Medication'}
                  </Text>
                  {strength && <Text type="secondary" style={{ fontSize: 12 }}>{strength}</Text>}
                  <Tag className={STATUS_CHIP[prescription.status]?.className}>
                    {STATUS_CHIP[prescription.status]?.label ?? prescription.status}
                  </Tag>
                  <Text style={{ fontSize: 12 }}>
                    {prescription.amount}
                    {prescription.unit ? ` ${prescription.unit}` : ''} · {prescription.frequency} ·{' '}
                    {prescription.durationDays}d · qty {prescription.quantity}
                  </Text>
                  {/* THE ONE THING THAT DOES NOT MOVE TO HOVER.
                      D-091: a NULL supply mode is an unmade decision, and it is
                      the state the completion checkpoint stops on. Putting a
                      warning behind a hover is how a medication gets missed —
                      the failure this compaction must not cause. Resolved
                      supply hides; unresolved never does. */}
                  {unresolvedRow && (
                    <Tag className="kw-chip-pending kw-supply-label">
                      {supplyModeLabel(prescription.supplyMode)}
                    </Tag>
                  )}
                </Space>
              </div>
              {/* D-077 — ONE next action, plus More. Dispense is what the row
                  is usually for; cancelling is real but rare, and a red button
                  beside every prescription made the panel read as a list of
                  things to undo. The cancel call itself is unchanged. */}
              <Space size={4} className="kw-rail-row-actions">
                {prescription.status === 'ORDERED' && (
                  <>
                    {/* D-091 — Dispense only where clinic dispensing is the
                        RECORDED intent. An external prescription, the
                        patient's own supply, deferred and NULL all withhold
                        the button: a stock-moving action must not contradict
                        the stored decision, or stand in for one nobody made. */}
                    {canOfferDispense(prescription) && (
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
                    )}
                    <Dropdown
                      trigger={['click']}
                      menu={{
                        items: [
                          {
                            key: 'supply',
                            label: 'Supply mode',
                            children: SUPPLY_MODE_OPTIONS.map((option) => ({
                              key: option.value,
                              label: option.label,
                              disabled: prescription.supplyMode === option.value,
                              onClick: () =>
                                setSupply
                                  .mutateAsync({ id: prescription.id, dto: { supplyMode: option.value } })
                                  .catch((e) => report(e, 'Failed to update the supply mode')),
                            })),
                          },
                          {
                            key: 'cancel',
                            danger: true,
                            label: 'Cancel prescription',
                            onClick: () =>
                              cancel
                                .mutateAsync({
                                  id: prescription.id,
                                  input: { cancelReason: 'Cancelled by prescriber' },
                                })
                                .catch((e) => report(e, 'Failed to cancel')),
                          },
                        ],
                      }}
                    >
                      <Button
                        size="small"
                        icon={<MoreOutlined />}
                        aria-label={`More actions for ${prescription.item?.name ?? 'this medication'}`}
                      />
                    </Dropdown>
                  </>
                )}
              </Space>
            </div>
          );
        })}
      />

      {/* G4.5d5b-1 — one medication, centred, with the visit's list still
          visible behind it. Opening or closing this touches no clinical-note
          query, so an unsaved draft in the editor is untouched. */}
      <AddMedicationModal
        open={addingMedication}
        visitId={visitId}
        medicine={pickedMedicine}
        onClose={() => {
          setAddingMedication(false);
          setPickedMedicine(undefined);
        }}
        // b1 — Add & Add Another returns to the RAIL's box, because that is
        // where the next medication now starts. Bumping the signal remounts
        // the box focused, which is also how it clears itself.
        onAddAnother={() => {
          setAddingMedication(false);
          setPickedMedicine(undefined);
          setSearchFocus((n) => n + 1);
        }}
        restoreFocusTo={() => addButtonRef.current}
      />

      {/* Copy Previous keeps the full prescribing workspace: it needs the
          source-visit selector and the dosage calculators, which do not
          belong in a single-medication modal. */}
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
