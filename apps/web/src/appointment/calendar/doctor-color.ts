import {
  PROVIDER_COLORS,
  ProviderColor,
  providerColorByAccent,
} from '@kuwick/shared';

/**
 * PROVIDER IDENTITY COLOUR — resolved, not invented.
 *
 * The approved system (design decision 2/3) has one authority: the provider's
 * OWN stored `Staff.calendarColor`. That column already exists and is already
 * populated; this module's job is to prefer it, and to degrade honestly when
 * it is null on an older record.
 *
 * The fallback is a hash into the same curated palette. It is deliberately
 * NOT an index into a sorted provider list: a list index re-colours everybody
 * the day a new doctor is hired, and a provider's identity colour must be the
 * one thing about the diary that does not move. A hash is stable per staff id
 * forever — its only weakness is collisions between providers, which is why
 * new and edited providers are given a PERSISTED colour instead and the hash
 * survives only for rows written before the column was filled in.
 *
 * Provider colour is identity. It is never a status, and (decision 2) it is
 * never a full-card fill: accent = edge/ring/dot, pastel = gutter band and
 * month chip ground.
 */
const PALETTE = PROVIDER_COLORS.map((color) => color.accent);

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * The DETERMINISTIC FALLBACK — for a provider whose colour was never stored.
 * Stable for a given id across renders, reloads and new hires.
 */
export function getDoctorColor(staffId: string): string {
  return PALETTE[hashString(staffId) % PALETTE.length];
}

/**
 * The resolver every surface should use: stored colour first, curated
 * fallback second, always the full three-role triple so a caller can never
 * pair an accent with somebody else's pastel.
 */
export function providerColorFor(
  calendarColor: string | null | undefined,
  staffId: string | null | undefined,
): ProviderColor {
  const stored = providerColorByAccent(calendarColor);
  if (stored) return stored;
  const fallbackAccent = getDoctorColor(staffId ?? '');
  return providerColorByAccent(fallbackAccent) ?? PROVIDER_COLORS[0];
}

/** The neutral identity — an unassigned column, "any available doctor". */
export const NEUTRAL_PROVIDER_COLOR: ProviderColor =
  PROVIDER_COLORS.find((color) => color.name === 'SLATE') ?? PROVIDER_COLORS[0];

/**
 * A SOFT wash of an identity colour, for the few grounds that want the hue at
 * a strength the palette's own `pastel` does not cover (an avatar behind
 * initials, a week card's faint tint at 3–5%). One implementation so an
 * avatar and a card can never disagree about what "Dr Chong's colour,
 * softly" means.
 */
export function softTint(hex: string, alpha = 0.16): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
