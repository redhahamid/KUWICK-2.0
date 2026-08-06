/**
 * G4.5d3c-3c — BMI, computed once, in one place.
 *
 * Before this module the formula existed twice on the client: an inline
 * `bmiFrom` in `ClinicalVitalsStrip` that read the saved observation, and
 * nothing at all in the entry form — the doctor had to save a set of vitals
 * and wait for the server's answer to find out the BMI of the patient sitting
 * in front of them. Two implementations of a clinical number is one too many,
 * and a number that only exists after a round trip is not available when the
 * decision is being made.
 *
 * The rule the owner stated, unchanged:
 *
 *     BMI = weightKg / (heightMetres ^ 2),  heightMetres = heightCm / 100
 *
 * Everything else here exists to make that formula safe to render live, on
 * every keystroke, against fields a human is still halfway through typing:
 *
 *   - a height of 0 (or a blank that parses to 0) would divide by zero and
 *     produce Infinity. That is not a BMI and must never reach a screen.
 *   - a partially typed field is `undefined`/`null`/'' and means "not known
 *     yet", which is NOT the same as "no BMI" and is not the same as zero.
 *   - a non-numeric string yields NaN, which renders as the literal text
 *     "NaN" beside a patient's weight if it is not caught here.
 *
 * So the contract is: a finite positive number, or null. Never NaN, never
 * Infinity, never a negative, never a string the caller has to re-check.
 *
 * NO NETWORK. This is a pure function of two numbers. Nothing in this module
 * fetches, mutates, invalidates a query or touches a store — typing a weight
 * must not cost a request in a clinic seeing 200 patients a day.
 */

/** Decimal places the clinic reads BMI at. One, as approved. */
export const BMI_DECIMALS = 1;

/**
 * Anything a form field can hand over mid-typing: a number, the string the
 * user is still editing, or an absence.
 */
export type VitalInput = number | string | null | undefined;

/**
 * One numeric field, or null when it is not a usable positive measurement.
 *
 * Zero is deliberately rejected rather than passed through: a height of zero
 * is not a short patient, it is a field nobody has filled in, and treating it
 * as data is exactly how Infinity gets rendered.
 */
export function parseVital(value: VitalInput): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/**
 * BMI from weight in kilograms and height in CENTIMETRES.
 *
 * Height is taken in centimetres because that is what the clinic records and
 * what the observation form asks for; the conversion to metres happens here so
 * no caller can forget it. Returns null whenever the answer is not knowable.
 */
export function calculateBmi(weightKg: VitalInput, heightCm: VitalInput): number | null {
  const kg = parseVital(weightKg);
  const cm = parseVital(heightCm);
  if (kg === null || cm === null) return null;

  const metres = cm / 100;
  const bmi = kg / (metres * metres);

  // Belt and braces. `parseVital` has already excluded every input that could
  // get here non-finite, but this is a number a clinician may act on and the
  // cost of the check is nothing.
  if (!Number.isFinite(bmi)) return null;

  const rounded = Math.round(bmi * 10 ** BMI_DECIMALS) / 10 ** BMI_DECIMALS;
  return Number.isFinite(rounded) ? rounded : null;
}

/**
 * The same answer as a string for display, or null.
 *
 * Fixed to one decimal so "22" and "22.0" cannot appear on the same screen for
 * the same patient depending on which surface rendered them.
 */
export function formatBmi(weightKg: VitalInput, heightCm: VitalInput): string | null {
  const bmi = calculateBmi(weightKg, heightCm);
  return bmi === null ? null : bmi.toFixed(BMI_DECIMALS);
}

/**
 * Rendering a BMI the SERVER already computed, falling back to computing it
 * from the stored weight and height when it did not.
 *
 * Existing observation rows carry a server-side `bmi`; older rows and any row
 * whose height was never recorded carry null. This keeps the displayed number
 * the server's wherever the server has one, so a saved reading never disagrees
 * with the record, and only derives locally where there is nothing to disagree
 * with.
 */
export function displayBmi(params: {
  serverBmi: number | string | null | undefined;
  weight: VitalInput;
  height: VitalInput;
}): string | null {
  const fromServer = parseVital(params.serverBmi);
  if (fromServer !== null) return fromServer.toFixed(BMI_DECIMALS);
  return formatBmi(params.weight, params.height);
}

/**
 * The WHO adult classification, for the live hint beside the number.
 *
 * Adult only, and labelled as such by the caller: applying adult cut-offs to a
 * child is clinically wrong, and this module cannot see the patient's age. The
 * band is advisory text next to a calculation — it is not stored, not billed
 * on, and nothing branches on it.
 */
export type BmiBand = 'UNDERWEIGHT' | 'NORMAL' | 'OVERWEIGHT' | 'OBESE';

export const BMI_BAND_LABEL: Record<BmiBand, string> = {
  UNDERWEIGHT: 'Underweight',
  NORMAL: 'Normal range',
  OVERWEIGHT: 'Overweight',
  OBESE: 'Obese',
};

export function bmiBand(bmi: number | null): BmiBand | null {
  if (bmi === null || !Number.isFinite(bmi) || bmi <= 0) return null;
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}
