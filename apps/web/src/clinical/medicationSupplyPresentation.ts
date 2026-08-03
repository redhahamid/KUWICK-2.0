import { Prescription, PrescriptionSupplyMode } from './types';

/**
 * G4.5d3c-3a1 (D-091) — how the supply intent describes itself to the clinic.
 *
 * The owner's approved wording, in one place. No raw enum value reaches a
 * screen through this module, and NULL is a real state with its own words —
 * "Supply mode not confirmed" — never displayed as, or defaulted to,
 * "Dispense from clinic".
 */
export const SUPPLY_MODE_LABEL: Record<PrescriptionSupplyMode, string> = {
  ONSITE_DISPENSE: 'Dispense from clinic',
  EXTERNAL_PRESCRIPTION: 'External prescription',
  PATIENT_OWN_SUPPLY: 'Patient already has medication',
  DEFERRED: 'Deferred supply',
  NO_SUPPLY_REQUIRED: 'No supply required',
};

export const SUPPLY_MODE_UNRESOLVED_LABEL = 'Supply mode not confirmed';

/** Select options in the order a GP reads them: commonest first. */
export const SUPPLY_MODE_OPTIONS: Array<{ value: PrescriptionSupplyMode; label: string }> = [
  { value: 'ONSITE_DISPENSE', label: SUPPLY_MODE_LABEL.ONSITE_DISPENSE },
  { value: 'EXTERNAL_PRESCRIPTION', label: SUPPLY_MODE_LABEL.EXTERNAL_PRESCRIPTION },
  { value: 'PATIENT_OWN_SUPPLY', label: SUPPLY_MODE_LABEL.PATIENT_OWN_SUPPLY },
  { value: 'DEFERRED', label: SUPPLY_MODE_LABEL.DEFERRED },
  { value: 'NO_SUPPLY_REQUIRED', label: SUPPLY_MODE_LABEL.NO_SUPPLY_REQUIRED },
];

/** The label for a stored value, or the unresolved wording for NULL. */
export function supplyModeLabel(mode: PrescriptionSupplyMode | null | undefined): string {
  return mode ? SUPPLY_MODE_LABEL[mode] : SUPPLY_MODE_UNRESOLVED_LABEL;
}

type SupplyCountable = Pick<Prescription, 'status' | 'supplyMode'>;

/**
 * The rail's two counts, computed the way the server routes (D-086):
 *
 * "To dispense" is ONSITE_DISPENSE and still ORDERED — nothing else. An
 * external prescription, the patient's own supply, deferred, no-supply,
 * NULL, DISPENSED and CANCELLED all stay out of it; the old count treated
 * every ORDERED row as clinic dispensing work, which told the dispensary to
 * expect medicine that was never coming to the counter.
 *
 * "Unresolved" is ORDERED with a NULL mode — a question the doctor still has
 * to answer, reported SEPARATELY, never folded into the dispensing number.
 */
export function supplyCounts(prescriptions: SupplyCountable[] | undefined): {
  toDispense: number;
  unresolved: number;
} {
  const list = prescriptions ?? [];
  return {
    toDispense: list.filter((p) => p.status === 'ORDERED' && p.supplyMode === 'ONSITE_DISPENSE').length,
    unresolved: list.filter((p) => p.status === 'ORDERED' && p.supplyMode == null).length,
  };
}

export function toDispenseText(count: number): string {
  return `${count} to dispense`;
}

export function unresolvedText(count: number): string {
  return count === 1 ? '1 supply mode unresolved' : `${count} supply modes unresolved`;
}

/**
 * Whether the Canvas may offer Dispense for this row.
 *
 * Only clinic dispensing, and only while ORDERED. Every other mode either
 * has no clinic hand-over (external, own supply, none) or has not decided
 * (NULL, deferred) — offering a stock-moving action on any of those would
 * let one click contradict the recorded intent. Role permissions are the
 * server's and are not widened or narrowed here.
 */
export function canOfferDispense(prescription: SupplyCountable): boolean {
  return prescription.status === 'ORDERED' && prescription.supplyMode === 'ONSITE_DISPENSE';
}

/** ORDERED rows whose supply intent nobody has recorded yet. */
export function isUnresolvedSupply(prescription: SupplyCountable): boolean {
  return prescription.status === 'ORDERED' && prescription.supplyMode == null;
}
