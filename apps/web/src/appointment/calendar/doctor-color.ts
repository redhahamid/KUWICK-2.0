// Deterministic per-doctor color assignment for the Calendar view — client-derived
// only, since nothing in the spec requires a persisted/configurable color. The
// same staffId always maps to the same color across renders and reloads
// without needing a schema field on Staff.
// V2 identity palette (§6): saturated enough to tell apart at a 3px accent,
// calm enough never to be mistaken for a status. Identity only — the accent
// edge, the avatar ring, the header chip, and (final visual pass, approved
// mockup) the ≤13% softTint wash grounding week/month cards. Never solid.
const PALETTE = [
  '#2e90fa', // blue
  '#15b79e', // teal-green
  '#7f56d9', // violet
  '#f79009', // amber
  '#6172f3', // indigo
  '#06aed4', // cyan
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function getDoctorColor(staffId: string): string {
  return PALETTE[hashString(staffId) % PALETTE.length];
}

/**
 * Final visual pass — a SOFT wash of an identity colour, for grounds the
 * approved mockup paints with the provider's pastel (week/month calendar
 * cards, avatars). One implementation so the avatar and the card can never
 * disagree about what "Dr Chong's colour, softly" means.
 */
export function softTint(hex: string, alpha = 0.16): string {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
