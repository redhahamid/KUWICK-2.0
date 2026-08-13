import { Item, ItemAgeDosage, StockLevel } from '../../inventory/types';

/**
 * G4.5d6 — the prescribing rules, as pure functions.
 *
 * These were spread across two prescribing surfaces (the Canvas modal and the
 * Flow tab) with the dosage maths written out once and the item-master
 * defaults written out not at all. Anything that decides a DOSE belongs in
 * one tested place.
 */

export interface PrescriptionDefaults {
  amount?: number;
  unit?: string;
  frequency?: string;
  durationDays?: number;
  quantity?: number;
  indication?: string;
  remark?: string;
}

/**
 * What the medication master already knows, so the doctor does not retype it.
 *
 * NOTHING IS INVENTED. A field the item does not carry stays absent, and the
 * caller leaves whatever the doctor typed. An item with no default dose unit
 * yields no unit rather than guessing "tablet", because a wrong unit on a
 * prescription is a dosing error, not a cosmetic one. `doseDefault` and
 * `durationDefault` are free text on the master ("2", "5 days"), so they are
 * only used when they parse cleanly to a number.
 */
export function defaultsFromItem(item: Item): PrescriptionDefaults {
  const defaults: PrescriptionDefaults = {};

  const dose = numeric(item.doseDefault);
  if (dose !== undefined) defaults.amount = dose;
  if (item.doseUnitDefault) defaults.unit = item.doseUnitDefault;
  if (item.frequencyDefault?.trim()) defaults.frequency = item.frequencyDefault.trim();

  const duration = numeric(item.durationDefault);
  if (duration !== undefined && duration > 0) defaults.durationDays = duration;

  if (typeof item.defaultDispenseQuantity === 'number' && item.defaultDispenseQuantity > 0) {
    defaults.quantity = item.defaultDispenseQuantity;
  }
  if (item.indication?.trim()) defaults.indication = item.indication.trim();
  // The master's `instruction` is guidance for the patient; `remark` is a note
  // about the medicine. Instruction is the one that belongs on a prescription.
  if (item.instruction?.trim()) defaults.remark = item.instruction.trim();

  return defaults;
}

/** "5 days" -> 5, "2" -> 2, "as directed" -> undefined. */
function numeric(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /-?\d+(\.\d+)?/.exec(value);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export interface WeightBasedResult {
  targetDoseMg: number;
  volumeMl: number;
}

/**
 * Dose x concentration volume / strength — the syrup calculation.
 *
 * Returns null rather than a number whenever any input is missing. A
 * calculator that guesses at a missing concentration is more dangerous than
 * no calculator, which is the whole reason this one exists (D-028).
 */
export function weightBasedDose(
  item: Pick<Item, 'concVolMl' | 'strengthMg'> | undefined,
  weightKg: number | undefined,
  doseRateMgPerKg: number | undefined,
): WeightBasedResult | null {
  const concVolMl = Number(item?.concVolMl ?? NaN);
  const strengthMg = Number(item?.strengthMg ?? NaN);
  if (!Number.isFinite(concVolMl) || !Number.isFinite(strengthMg) || strengthMg <= 0) return null;
  if (!weightKg || !doseRateMgPerKg || weightKg <= 0 || doseRateMgPerKg <= 0) return null;

  const targetDoseMg = weightKg * doseRateMgPerKg;
  const volumeMl = (targetDoseMg * concVolMl) / strengthMg;
  return { targetDoseMg, volumeMl: Math.round(volumeMl * 100) / 100 };
}

/** True when this medicine can be dosed by weight at all. */
export function supportsWeightBasedDosing(item: Pick<Item, 'concVolMl' | 'strengthMg'> | undefined): boolean {
  return Boolean(item?.concVolMl && item?.strengthMg);
}

/** The age bracket covering this patient, or null when none does. */
export function bracketForAgeMonths(
  brackets: ItemAgeDosage[] | undefined,
  ageMonths: number | null | undefined,
): ItemAgeDosage | null {
  if (!brackets?.length || ageMonths === null || ageMonths === undefined) return null;
  return (
    brackets.find(
      (b) => ageMonths >= Number(b.ageFromMonths ?? 0) && ageMonths <= Number(b.ageToMonths ?? 0),
    ) ?? null
  );
}

export type StockPosition = 'UNKNOWN' | 'SUFFICIENT' | 'LOW' | 'INSUFFICIENT' | 'NONE';

export interface StockAdvice {
  position: StockPosition;
  onHand: number | null;
  message: string | null;
}

/**
 * What the doctor is told about stock WHILE prescribing, not after.
 *
 * Deliberately advisory. Stock never blocks a prescription: a doctor may
 * legitimately prescribe something the clinic is out of, for the patient to
 * buy elsewhere, and a system that refuses is a system that gets worked
 * around. It says what is true and lets the doctor decide.
 *
 * "Unknown" is a real answer and is stated as one. Silence would read as
 * "in stock", which is the one thing it must never imply.
 */
export function stockAdvice(
  itemId: string | undefined,
  quantity: number | undefined,
  levels: StockLevel[] | undefined,
): StockAdvice {
  if (!itemId || !levels) return { position: 'UNKNOWN', onHand: null, message: null };

  const matching = levels.filter((level) => level.itemId === itemId);
  if (matching.length === 0) {
    return {
      position: 'UNKNOWN',
      onHand: null,
      message: 'No stock record for this medicine — quantity on hand is unknown.',
    };
  }

  const onHand = matching.reduce((total, level) => total + Number(level.quantityOnHand ?? 0), 0);
  const wanted = quantity ?? 0;

  if (onHand <= 0) {
    return { position: 'NONE', onHand, message: 'Out of stock. The patient will need to be supplied elsewhere.' };
  }
  if (wanted > onHand) {
    return {
      position: 'INSUFFICIENT',
      onHand,
      message: `Only ${onHand} in stock — ${wanted} prescribed.`,
    };
  }
  // A threshold the clinic set beats an arbitrary one.
  const threshold = matching.reduce((lowest, level) => {
    const min = Number(level.minThreshold ?? 0);
    return min > lowest ? min : lowest;
  }, 0);
  if (threshold > 0 && onHand - wanted < threshold) {
    return {
      position: 'LOW',
      onHand,
      message: `${onHand} in stock — this prescription takes it below the clinic's minimum of ${threshold}.`,
    };
  }
  return { position: 'SUFFICIENT', onHand, message: `${onHand} in stock.` };
}

// ---------------------------------------------------------------------------
// b1 — WHAT THE MEDICINE SEARCH ROW SAYS
// ---------------------------------------------------------------------------

/**
 * The quantity on hand for this medicine, from the stock levels that travel
 * with the item.
 *
 * `null`, not 0, when there is no stock record: "we have none" and "nobody has
 * ever counted these" are different facts, and rendering the second as the
 * first is how a doctor is told a medicine is out when it may be on the shelf.
 */
export function itemOnHand(item: Pick<Item, 'stockLevels'>): number | null {
  const levels = item.stockLevels;
  if (!levels || levels.length === 0) return null;
  return levels.reduce((total, level) => total + Number(level.quantityOnHand ?? 0), 0);
}

/**
 * The second line of a medicine search row: group · price · stock · CASH ONLY.
 *
 * All four are what the clinic actually needs at the moment of choosing, and
 * three of them were invisible until now — the row said the strength and
 * nothing else, so "which of these is in stock, and what does it cost" was a
 * question the doctor could not answer without leaving the consultation.
 *
 * CASH ONLY is stated, never applied: the flag is a fact about how the clinic
 * sells the medicine, and turning it into behaviour (refusing to prescribe it
 * on a panel visit, say) is a billing decision this list does not get to make.
 */
export function medicineSearchDetail(item: Item): string {
  const parts: string[] = [];
  if (item.groupTag?.trim()) parts.push(item.groupTag.trim());
  if (item.strengthMg) parts.push(`${item.strengthMg}mg`);
  parts.push(`RM ${Number(item.sellPrice ?? 0).toFixed(2)}`);

  const onHand = itemOnHand(item);
  // The clinic's own words for the shelf, and "unknown" said out loud rather
  // than left as silence that reads as "in stock".
  parts.push(onHand === null ? 'stock unknown' : onHand <= 0 ? 'out of stock' : `${onHand} in stock`);

  if (item.cashOnly) parts.push('CASH ONLY');
  return parts.join(' · ');
}
