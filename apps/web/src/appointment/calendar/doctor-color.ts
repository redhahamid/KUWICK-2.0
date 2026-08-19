// Deterministic per-doctor color assignment for the Calendar view — client-derived
// only, since nothing in the spec requires a persisted/configurable color. The
// same staffId always maps to the same color across renders and reloads
// without needing a schema field on Staff.
// V2 identity palette (§6): saturated enough to tell apart at a 3px accent,
// calm enough never to be mistaken for a status. Identity only — the accent
// edge, the avatar ring, the header chip. Never a card fill.
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
