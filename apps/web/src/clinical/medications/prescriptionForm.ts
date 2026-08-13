import { Item, DurationUnit } from '../../inventory/types';
import {
  ConsumptionMethodRow,
  DosageUnitRow,
  IndicationRow,
  PrescriptionFrequencyRow,
} from '../hooks/useReferenceCatalogs';

/**
 * b1 PHASE A — the prescribing form's rules, as pure functions.
 *
 * Everything here decides what a doctor sees before they press Add, so it is
 * tested away from the modal. The modal renders; this decides.
 */

/** Days per unit. Must agree with the server's `DAYS_PER_DURATION_UNIT`. */
export const DAYS_PER_DURATION_UNIT: Record<DurationUnit, number> = { DAY: 1, WEEK: 7, MONTH: 30 };

export function durationInDays(value: number, unit: DurationUnit): number {
  return value * DAYS_PER_DURATION_UNIT[unit];
}

/**
 * The quantity to dispense, or `null` for "cannot be computed".
 *
 * `null` is a real answer and the caller must LEAVE THE BOX ALONE on it —
 * never fall back to 1. PRN and STAT carry no doses-per-day because there is
 * no such number for them, and multiplying a when-required painkiller out over
 * five days produces a quantity nobody decided that a dispensary would hand
 * over. Rounds UP: a half-tablet dose leaves the shelf as whole tablets, and
 * rounding down is four days of a five-day course.
 */
export function computeQuantity(input: {
  amount?: number | null;
  timesPerDay?: number | null;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
}): number | null {
  const { amount, timesPerDay, durationValue, durationUnit } = input;
  if (!amount || !timesPerDay || !durationValue || !durationUnit) return null;
  return Math.ceil(amount * timesPerDay * durationInDays(durationValue, durationUnit));
}

/** What the modal opens with for a medicine, read from its 1F defaults. */
export interface StandardPrescriptionPrefill {
  amount?: number;
  doseUnitId?: string;
  unit?: string;
  frequencyId?: string;
  frequency?: string;
  durationValue?: number;
  durationUnit?: DurationUnit;
  quantity?: number;
  consumptionMethodId?: string;
}

/**
 * Prefill from the medicine's own standard prescription.
 *
 * NOTHING IS INVENTED, and this is the rule the whole 1F seed was built
 * around: a medicine with no default dose opens with the dose EMPTY. 226 of
 * the clinic's 236 medicines carry defaults; ten carry none because they are
 * arm slings and soaps, and the paediatric syrups deliberately carry a unit
 * and a route but no dose amount, because that belongs to the calculator.
 *
 * The free-text mirrors (`unit`, `frequency`) are filled alongside the ids so
 * the form still reads correctly for anything that only looks at the text —
 * the server prefers the id and overwrites both from the catalogue.
 */
export function prefillFromStandard(
  item: Item,
  catalogues: {
    units?: DosageUnitRow[];
    frequencies?: PrescriptionFrequencyRow[];
  },
): StandardPrescriptionPrefill {
  const prefill: StandardPrescriptionPrefill = {};

  if (item.defaultDoseAmount != null) {
    const amount = Number(item.defaultDoseAmount);
    if (Number.isFinite(amount) && amount > 0) prefill.amount = amount;
  }
  if (item.defaultDoseUnitId) {
    prefill.doseUnitId = item.defaultDoseUnitId;
    prefill.unit = catalogues.units?.find((row) => row.id === item.defaultDoseUnitId)?.systemNameEn;
  }
  if (item.defaultFrequencyId) {
    prefill.frequencyId = item.defaultFrequencyId;
    prefill.frequency = catalogues.frequencies?.find((row) => row.id === item.defaultFrequencyId)?.code;
  }
  if (item.defaultDurationValue && item.defaultDurationUnit) {
    prefill.durationValue = item.defaultDurationValue;
    prefill.durationUnit = item.defaultDurationUnit;
  }
  if (item.defaultQuantity && item.defaultQuantity > 0) prefill.quantity = item.defaultQuantity;
  if (item.defaultConsumptionMethodId) prefill.consumptionMethodId = item.defaultConsumptionMethodId;

  return prefill;
}

/** Did this medicine actually carry anything? Drives the visible prefill notice. */
export function hasStandardPrescription(prefill: StandardPrescriptionPrefill): boolean {
  return Object.keys(prefill).length > 0;
}

/**
 * Match free text the dosage calculator produced back to a catalogue entry.
 *
 * An EXACT name match only, case- and space-insensitive. That is a lookup, not
 * an inference: "ml" matching a unit named "ml" is the same unit. Anything
 * looser would be this function deciding that a doctor's "tab" means the
 * catalogue's "Tablet", which is exactly the kind of guess the seed refused to
 * make. No match returns undefined and the free text stands on its own — the
 * prescription then carries no Malay label for it, which is true.
 */
export function matchCatalogueByText<T extends { id: string }>(
  text: string | undefined,
  rows: T[] | undefined,
  readName: (row: T) => string,
): string | undefined {
  const needle = text?.trim().toLowerCase();
  if (!needle || !rows) return undefined;
  return rows.find((row) => readName(row).trim().toLowerCase() === needle)?.id;
}

/**
 * An indication matches on EITHER language.
 *
 * A Malaysian clinic types "demam" as readily as "fever", and a picker that
 * only searched English would send half the staff to the free-text box for
 * entries that are already on the list.
 */
export function indicationMatches(row: IndicationRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return row.labelEn.toLowerCase().includes(needle) || row.labelBm.toLowerCase().includes(needle);
}

/** "Fever / Demam" — both, because either is what somebody will look for. */
export function indicationLabel(row: IndicationRow): string {
  return `${row.labelEn} / ${row.labelBm}`;
}

/** "ORAL (MAKAN/MINUM)" reads as itself; nothing to compose. */
export function consumptionLabel(row: ConsumptionMethodRow): string {
  return row.methodBilingual;
}

/** "TDS — Three times a day". The code first, because that is what is typed. */
export function frequencyLabel(row: PrescriptionFrequencyRow): string {
  return `${row.code} — ${row.doctorDisplay}`;
}
