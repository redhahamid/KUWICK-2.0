/**
 * G4.5d3c-3c — the server's BMI, extracted so there is exactly one of it.
 *
 * It was an unexported helper inside `visit-observation.service.ts`, which
 * made it impossible to test directly and impossible to pin against the
 * client's live calculator. Both now exist as one function per process, over
 * the SAME formula and the SAME rounding, with the same fixture table asserted
 * on both sides (`vitals-bmi.spec.ts` here, `vitalsBmi.test.ts` on the web) so
 * they cannot drift apart unnoticed.
 *
 *     BMI = weightKg / (heightMetres ^ 2),  heightMetres = heightCm / 100
 *
 * Prisma hands Decimal columns over as `Decimal | string | null` depending on
 * the query, so the input type is deliberately wide and every non-measurement
 * — null, undefined, empty, non-numeric, zero, negative — collapses to null
 * rather than to NaN or Infinity. A stored BMI of Infinity would travel to
 * every screen, every document merge field and every export that reads it.
 */

export const BMI_DECIMALS = 1;

function toPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Weight in kilograms, height in CENTIMETRES. Null when not knowable. */
export function computeBmi(weight: unknown, height: unknown): number | null {
  const kg = toPositiveNumber(weight);
  const cm = toPositiveNumber(height);
  if (kg === null || cm === null) return null;

  const metres = cm / 100;
  const bmi = kg / (metres * metres);
  if (!Number.isFinite(bmi)) return null;

  const rounded = Math.round(bmi * 10 ** BMI_DECIMALS) / 10 ** BMI_DECIMALS;
  return Number.isFinite(rounded) ? rounded : null;
}
