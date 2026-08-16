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

/**
 * G4.5d3c-3c — the clinic's default supply intent for a NEW prescription.
 *
 * The overwhelming majority of what a Malaysian GP prescribes is handed over
 * at the clinic's own counter, so requiring the doctor to state that on every
 * line was a decision they were making hundreds of times a day and almost
 * never changing. It is the pre-selected value now — VISIBLY pre-selected,
 * in a control that is on screen and readable before saving, never a hidden
 * database default.
 *
 * The distinction matters and is the reason `supplyMode` still has no default
 * in the schema (D-084): a column default would make a row nobody looked at
 * indistinguishable from a row a prescriber deliberately set to clinic
 * dispensing. A pre-selected control cannot do that — the doctor sees the
 * answer, and what they see is what is sent.
 *
 * Existing NULLs are NOT touched by this. A legacy row stays unresolved and
 * keeps saying so, because nobody ever answered the question for it.
 */
export const DEFAULT_SUPPLY_MODE: PrescriptionSupplyMode = 'ONSITE_DISPENSE';

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

/**
 * b4 PIECE 1 — the rail's row order: rows nobody has decided come FIRST.
 *
 * D-091 refused to move the unresolved-supply chip to hover, on the grounds
 * that a warning behind an interaction is a warning that gets missed. The
 * density measurement then found the same information behind a different
 * interaction: the rail discloses five rows and collapses the remainder, so on
 * a ten-medication visit an unresolved row in sixth place sat inside "+5 more"
 * — visible only after a click, which is what hover was rejected for. The
 * panel header still counts it, but a count is not the row, and the row is
 * where the decision is made.
 *
 * So the outstanding decision is what orders the list. This is a CLINICAL
 * order, which is the only kind `RailPanel` accepts: what still needs an
 * answer is read before what has one. The relative order of everything else —
 * the server's, newest first — is untouched, and the completion checkpoint's
 * jump to the first `[data-unresolved-supply]` row (D-091) lands on the first
 * row rather than scrolling into a collapsed remainder.
 */
export function unresolvedSupplyFirst<T extends SupplyCountable>(prescriptions: T[]): T[] {
  const unresolved = prescriptions.filter(isUnresolvedSupply);
  // Not a sort: Array.prototype.sort's stability is guaranteed, but a
  // comparator says less about intent here than the partition does.
  return unresolved.length === 0
    ? prescriptions
    : [...unresolved, ...prescriptions.filter((p) => !isUnresolvedSupply(p))];
}
