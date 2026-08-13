import { DurationUnit } from '@prisma/client';

/**
 * b1 PHASE A — turning the doctor's choices into what the record keeps.
 *
 * Two jobs, both of which the SERVER has to do:
 *
 *   THE LABEL TEXT IS RESOLVED HERE, NOT SENT. The browser posts catalogue
 *   IDs; this looks up what those rows say and copies it onto the
 *   prescription. A client that could post `frequencyBm: "Sekali sehari"`
 *   alongside `frequency: "TDS"` could print a label that contradicts the
 *   prescription, and nothing downstream would catch it — the label renderer
 *   trusts the record precisely because the record is composed here.
 *
 *   THE COURSE IS CONVERTED HERE. "2 WEEK" becomes 14 days once, in one place.
 *   `durationDays` is what every existing reader uses (dispensing, invoices,
 *   the label), and a second opinion about how long a month is would show up
 *   as two different courses for one prescription.
 *
 * Pure functions over plain data: the service does the reading, this decides
 * what the row says.
 */

/** How many days each unit is worth. A month is 30 — stated, not implied. */
export const DAYS_PER_DURATION_UNIT: Record<DurationUnit, number> = {
  DAY: 1,
  WEEK: 7,
  MONTH: 30,
};

export function durationInDays(value: number, unit: DurationUnit): number {
  return value * DAYS_PER_DURATION_UNIT[unit];
}

/** The catalogue rows this needs, narrowed to the fields it reads. */
export interface FrequencyRow {
  code: string;
  patientLabelBm: string;
  timesPerDay: number | null;
}
export interface DosageUnitRow {
  systemNameEn: string;
  patientLabelBm: string;
}
export interface ConsumptionMethodRow {
  methodBilingual: string;
  patientInstructionBm: string;
}
export interface IndicationRow {
  labelEn: string;
  labelBm: string;
}

/** Everything the prescription copies from the catalogues, and nothing else. */
export interface PrescriptionSnapshot {
  unit?: string;
  doseUnitBm?: string;
  frequency?: string;
  frequencyBm?: string;
  consumptionMethod?: string;
  consumptionInstructionBm?: string;
  indication?: string;
  indicationBm?: string;
}

/**
 * Compose the snapshot from whichever catalogue rows were resolved.
 *
 * A row that was not chosen contributes NOTHING — not an empty string. The
 * columns are nullable because "the doctor did not pick a route" is a real
 * state, and `''` would print as a blank line on a label that is 40mm tall.
 */
export function composeSnapshot(rows: {
  frequency?: FrequencyRow | null;
  doseUnit?: DosageUnitRow | null;
  consumptionMethod?: ConsumptionMethodRow | null;
  indication?: IndicationRow | null;
}): PrescriptionSnapshot {
  const snapshot: PrescriptionSnapshot = {};
  if (rows.frequency) {
    snapshot.frequency = rows.frequency.code;
    snapshot.frequencyBm = rows.frequency.patientLabelBm;
  }
  if (rows.doseUnit) {
    snapshot.unit = rows.doseUnit.systemNameEn;
    snapshot.doseUnitBm = rows.doseUnit.patientLabelBm;
  }
  if (rows.consumptionMethod) {
    snapshot.consumptionMethod = rows.consumptionMethod.methodBilingual;
    snapshot.consumptionInstructionBm = rows.consumptionMethod.patientInstructionBm;
  }
  if (rows.indication) {
    snapshot.indication = rows.indication.labelEn;
    snapshot.indicationBm = rows.indication.labelBm;
  }
  return snapshot;
}

/**
 * The quantity to dispense, or `null` for "cannot be computed".
 *
 * `null` is a real answer and must not collapse into 1. PRN and STAT carry no
 * doses-per-day because there is no such number for them — multiplying a
 * when-required painkiller out over five days produces a quantity nobody
 * decided, and a dispensary would hand it over.
 *
 * Rounds UP: a half-tablet dose still leaves the shelf as whole tablets, and
 * rounding down gives the patient four days of a five-day course.
 */
export function computeQuantity(input: {
  doseAmount?: number | null;
  timesPerDay?: number | null;
  durationDays?: number | null;
}): number | null {
  const { doseAmount, timesPerDay, durationDays } = input;
  if (!doseAmount || !timesPerDay || !durationDays) return null;
  return Math.ceil(doseAmount * timesPerDay * durationDays);
}

/**
 * The directions line, bilingual, exactly as the label prints it.
 *
 * Composed from the SNAPSHOT, never from the catalogues — see the module note.
 * Each half is omitted when the record does not carry it, because a label that
 * says "Take 2 () " is worse than one that says "Take 2".
 *
 *   2 Tablet (BIJI) — TDS (Tiga kali sehari) — Ambil melalui mulut — 5 days
 */
export function labelDirections(record: {
  amount: number | string;
  unit?: string | null;
  doseUnitBm?: string | null;
  frequency?: string | null;
  frequencyBm?: string | null;
  consumptionInstructionBm?: string | null;
  durationDays?: number | null;
}): string {
  const parts: string[] = [];

  const unit = record.unit
    ? record.doseUnitBm
      ? `${record.unit} (${record.doseUnitBm})`
      : record.unit
    : null;
  parts.push(unit ? `${record.amount} ${unit}` : String(record.amount));

  if (record.frequency) {
    // "OD (Sekali sehari)" — the code because that is what the clinic says to
    // each other, the Malay because that is what the patient reads.
    parts.push(record.frequencyBm ? `${record.frequency} (${record.frequencyBm})` : record.frequency);
  }
  if (record.consumptionInstructionBm) {
    parts.push(record.consumptionInstructionBm);
  }
  if (record.durationDays && record.durationDays > 0) {
    parts.push(`${record.durationDays} ${record.durationDays === 1 ? 'day' : 'days'}`);
  }
  return parts.join(' — ');
}
