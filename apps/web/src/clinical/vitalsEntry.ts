import { calculateBmi, VitalInput } from './vitalsBmi';

/**
 * G4.5d3c-3c — the pure rules behind the vitals entry surface.
 *
 * Kept out of the component so the two behaviours that actually matter can be
 * tested without a DOM: what counts as an empty form, and what counts as a
 * duplicate submission. Both were previously implicit in JSX and neither was
 * covered.
 */

/**
 * Every vital the observation record holds, in the order the form lays them
 * out. This list is the single definition used by "is the form empty",
 * "did anything change" and the duplicate check — three questions that must
 * agree on which fields exist, or a field added later gets silently ignored
 * by one of them.
 */
export const VITAL_FIELDS = [
  'bpSystolic',
  'bpDiastolic',
  'pulse',
  'temperature',
  'spo2',
  'respRate',
  'painScore',
  'weight',
  'height',
  'headCircumference',
  'glucose',
] as const;

export type VitalField = (typeof VITAL_FIELDS)[number];

export type VitalsFormValues = Partial<Record<VitalField, number | string | null | undefined>>;

/** A field the user has actually put a value in. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  return true;
}

/**
 * True when nothing has been entered.
 *
 * The server refuses a set with no values (`Record at least one observation
 * value`), so the form must not offer to save one — a doctor should not learn
 * that an empty form is empty by way of a failed request.
 */
export function isVitalsFormEmpty(values: VitalsFormValues | undefined): boolean {
  if (!values) return true;
  return VITAL_FIELDS.every((field) => !isPresent(values[field]));
}

/** The live BMI for whatever is currently in the weight and height fields. */
export function liveBmi(values: VitalsFormValues | undefined): number | null {
  if (!values) return null;
  return calculateBmi(values.weight as VitalInput, values.height as VitalInput);
}

/**
 * A stable, comparable rendering of one set of vitals.
 *
 * Numbers are normalised through `Number` so "37.0" and 37 are the same
 * reading — they are, and a form that round-trips a value through a text input
 * must not be able to manufacture a "different" set out of the same numbers.
 * Absent fields are the empty string rather than being omitted, so two sets
 * that differ only in WHICH field is blank still produce different keys.
 */
export function vitalsSignature(values: VitalsFormValues | undefined): string {
  return VITAL_FIELDS.map((field) => {
    const value = values?.[field];
    if (!isPresent(value)) return '';
    const parsed = Number(value);
    return Number.isFinite(parsed) ? String(parsed) : String(value);
  }).join('|');
}

/**
 * G4.5d3c-3c — the CLIENT half of the duplicate-vitals fix.
 *
 * The panel submits through an antd `Form` with `htmlType="submit"`. The Save
 * button carries `loading` while the request is in flight, which stops a
 * SECOND CLICK — but pressing Enter inside any numeric field submits the form
 * directly and never consults the button at all. That is the everyday path: a
 * nurse types the last figure, hits Enter, sees nothing happen for a moment on
 * a busy network, and hits Enter again. Two POSTs, two rows, one reading.
 *
 * This guard refuses a submission that is identical to one already in flight
 * or already accepted, and says so instead of silently dropping it — a save
 * that vanishes without a word is how people learn to press the button twice.
 *
 * It is deliberately NOT the whole fix. A guard living in a browser protects
 * this form and nothing else; the server carries its own, independent
 * protection (see `VisitObservationService.record`). Neither is sufficient
 * alone and both are cheap.
 */
export interface SubmitGuardState {
  /** Signature currently in flight, if any. */
  inFlight: string | null;
  /** Signature of the last submission the server accepted. */
  lastAccepted: string | null;
}

export type SubmitDecision =
  | { allow: true }
  | { allow: false; reason: 'IN_FLIGHT' | 'DUPLICATE'; message: string };

export const SUBMIT_REFUSAL_MESSAGE: Record<'IN_FLIGHT' | 'DUPLICATE', string> = {
  IN_FLIGHT: 'These observations are already being saved.',
  DUPLICATE:
    'These are the same values you just recorded. Change a value to record a repeat reading, or use Correct to fix the existing one.',
};

export function decideSubmit(state: SubmitGuardState, values: VitalsFormValues): SubmitDecision {
  const signature = vitalsSignature(values);
  if (state.inFlight !== null && state.inFlight === signature) {
    return { allow: false, reason: 'IN_FLIGHT', message: SUBMIT_REFUSAL_MESSAGE.IN_FLIGHT };
  }
  // Any submission at all while one is in flight is refused, even with
  // different values: the form is cleared on success, so a second set typed
  // over an unfinished save is far more likely to be a stuck keypress than a
  // deliberate second reading.
  if (state.inFlight !== null) {
    return { allow: false, reason: 'IN_FLIGHT', message: SUBMIT_REFUSAL_MESSAGE.IN_FLIGHT };
  }
  if (state.lastAccepted !== null && state.lastAccepted === signature) {
    return { allow: false, reason: 'DUPLICATE', message: SUBMIT_REFUSAL_MESSAGE.DUPLICATE };
  }
  return { allow: true };
}
