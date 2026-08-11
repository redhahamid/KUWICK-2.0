import { VITAL_FIELDS, VitalField, VitalsFormValues, isVitalsFormEmpty, liveBmi } from './vitalsEntry';

/**
 * KW2-C3 — the six vitals the Canvas puts INLINE in the clinical notes card
 * (spec p.2), and the rules for editing them there.
 *
 * The strip they replace was read-only: it showed what had been recorded and
 * offered a "Record vitals" link that opened a separate panel. That is one
 * screen change, one form, one save and one dismissal to type a blood
 * pressure — for the single most frequently entered thing in a consultation.
 * The mockup puts the inputs where the numbers are read, and so does this.
 *
 * SIX, not eleven. The observation record holds more (respiratory rate, pain
 * score, head circumference, glucose), and those keep their home in the full
 * Vitals & Observations panel. A row of eleven inputs across a 738px column
 * is a form, not a strip, and the four extra fields are recorded on a small
 * minority of visits — putting them inline would cost every consultation
 * width to serve a few.
 */

export interface InlineVital {
  field: VitalField;
  /** What the doctor reads. Short — this is a strip, not a form. */
  label: string;
  /** Rendered after the input, never inside it. */
  unit?: string;
  /** Two fields share one BP cell. */
  pairedWith?: VitalField;
  step?: number;
}

export const INLINE_VITALS: InlineVital[] = [
  { field: 'bpSystolic', label: 'BP', pairedWith: 'bpDiastolic' },
  { field: 'pulse', label: 'PR', unit: 'bpm' },
  { field: 'temperature', label: 'Temp', unit: '°C', step: 0.1 },
  { field: 'spo2', label: 'SpO₂', unit: '%' },
  { field: 'weight', label: 'Wt', unit: 'kg', step: 0.1 },
  { field: 'height', label: 'Ht', unit: 'cm', step: 0.1 },
];

/** The fields the inline strip owns, including the paired diastolic. */
export const INLINE_VITAL_FIELDS: VitalField[] = INLINE_VITALS.flatMap((vital) =>
  vital.pairedWith ? [vital.field, vital.pairedWith] : [vital.field],
);

/**
 * What the BMI badge shows.
 *
 * A muted em-dash until BOTH weight and height are present, and it says which
 * one is missing rather than sitting blank. An empty badge beside "BMI" reads
 * as a value nobody could compute; "enter height" reads as an instruction.
 *
 * Never a category. "Overweight" against a 4-year-old is wrong, against a
 * pregnant patient is wrong, and against an amputee is wrong — and none of
 * those are things this strip knows. The number is the honest output.
 */
export interface BmiBadge {
  value: string;
  hint: string | null;
  /** True once there is a real number. */
  computed: boolean;
}

export function bmiBadge(values: VitalsFormValues | undefined): BmiBadge {
  const weight = values?.weight;
  const height = values?.height;
  const has = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '' && Number(v) > 0;

  if (!has(weight) && !has(height)) {
    return { value: '—', hint: 'BMI fills when Wt + Ht are entered', computed: false };
  }
  if (!has(height)) return { value: '—', hint: 'enter height', computed: false };
  if (!has(weight)) return { value: '—', hint: 'enter weight', computed: false };

  const bmi = liveBmi(values);
  if (bmi === null) {
    // Both present but the arithmetic refused them — a height of 0, a
    // negative weight. Says so rather than printing NaN or a wrong number.
    return { value: '—', hint: 'check the values', computed: false };
  }
  return { value: bmi.toFixed(1), hint: null, computed: true };
}

/**
 * Whether an inline edit is worth sending.
 *
 * The strip autosaves, so this runs on every debounce. Two guards:
 * an empty strip is never saved (the server refuses a set with no values, and
 * a doctor should not learn that by way of a failed request), and a set
 * identical to what is already recorded is not re-sent — a re-save would
 * create a second observation row, attributed and timestamped, describing a
 * reading nobody took.
 */
export function shouldSaveVitals(
  values: VitalsFormValues | undefined,
  lastSavedKey: string | null,
): boolean {
  if (isVitalsFormEmpty(values)) return false;
  return vitalsKey(values) !== lastSavedKey;
}

/**
 * A stable comparable rendering, over the INLINE fields only.
 *
 * Deliberately not the full `vitalsSetKey` from vitalsEntry: this strip does
 * not own respiratory rate, pain score, head circumference or glucose, and
 * including them would make the strip think something had changed every time
 * the observations panel recorded one.
 */
export function vitalsKey(values: VitalsFormValues | undefined): string {
  return INLINE_VITAL_FIELDS.map((field) => {
    const raw = values?.[field];
    if (raw === null || raw === undefined || String(raw).trim() === '') return '';
    return String(Number(raw));
  }).join('|');
}

/** Seeds the strip from the visit's latest recorded observation. */
export function seedFromObservation(
  latest: Partial<Record<VitalField, unknown>> | null | undefined,
): VitalsFormValues {
  if (!latest) return {};
  const seeded: VitalsFormValues = {};
  for (const field of INLINE_VITAL_FIELDS) {
    const value = latest[field];
    if (value !== null && value !== undefined && String(value).trim() !== '') {
      seeded[field] = Number(value);
    }
  }
  return seeded;
}

/**
 * The fields to submit: the inline ones the doctor has filled in.
 *
 * Fields the strip does not own are omitted entirely rather than sent as
 * null, so an inline save can never blank a respiratory rate somebody
 * recorded in the full panel.
 */
export function inlineVitalsPayload(values: VitalsFormValues): Record<string, number> {
  const payload: Record<string, number> = {};
  for (const field of INLINE_VITAL_FIELDS) {
    const raw = values[field];
    if (raw !== null && raw !== undefined && String(raw).trim() !== '') {
      payload[field] = Number(raw);
    }
  }
  return payload;
}

/** Guards against a stray field creeping into the inline list. */
export const ALL_VITAL_FIELDS = VITAL_FIELDS;
