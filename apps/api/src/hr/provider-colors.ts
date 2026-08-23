/**
 * THE CURATED PROVIDER PALETTE, SERVER SIDE.
 *
 * These eight values are character-for-character the ones in
 * `packages/shared` (PROVIDER_COLORS). They are DUPLICATED rather than
 * imported for the same reason `vitals-bmi.ts` duplicates the browser's BMI
 * table: apps/api does not depend on @kuwick/shared — there is no dependency,
 * no tsconfig path and no jest module mapper — and the Nest build emits an
 * import of it verbatim, so a runtime import of that package takes the API
 * down on boot with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Wiring the package
 * into the Nest build for one list of hexes would be a build-system change
 * out of proportion to the problem.
 *
 * The duplication is therefore deliberate and load-bearing, and it is PINNED:
 * `provider-colors.spec.ts` imports the shared module (specs run under
 * ts-jest, which can resolve it, and never reach dist) and asserts the two
 * lists are identical. If either side gains, loses or edits a colour, that
 * test fails — which is the property that matters, because the server is what
 * decides whether a colour may be stored at all.
 */
export const PROVIDER_COLOR_VALUES: string[] = [
  '#0F6B78', // Teal
  '#2F8B57', // Emerald
  '#2E7BC4', // Sky — the only blue in the palette
  '#4A57C4', // Indigo
  '#7A4FBF', // Violet
  '#B4506B', // Rose
  '#A96A12', // Amber
  '#55627A', // Slate — the neutral slot (locum, unassigned)
];

/** Slate means "no particular provider", so it is spent last. */
const NEUTRAL = '#55627A';

/**
 * The colour a NEW provider is given when nobody picked one: the first
 * curated colour not already spoken for in this tenant. A clinic's first
 * seven providers are therefore guaranteed visually distinct, which is the
 * whole point of the identity system and exactly what a hash cannot promise —
 * six random ids into six slots land all-distinct about 1.5% of the time.
 */
export function nextProviderColor(taken: (string | null | undefined)[]): string {
  const used = new Set(
    taken.filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase()),
  );
  const preferred = PROVIDER_COLOR_VALUES.filter((value) => value !== NEUTRAL);
  const free = preferred.find((value) => !used.has(value));
  if (free) return free;
  if (!used.has(NEUTRAL)) return NEUTRAL;
  return preferred[used.size % preferred.length];
}
