// Deterministic per-doctor color assignment for the Calendar view — client-derived
// only, since nothing in the spec requires a persisted/configurable color. The
// same staffId always maps to the same color across renders and reloads
// without needing a schema field on Staff.
const PALETTE = [
  '#1677ff', // blue
  '#722ed1', // purple
  '#13a8a8', // teal
  '#d4b106', // gold
  '#eb2f96', // magenta
  '#52c41a', // green
  '#fa541c', // volcano
  '#2f54eb', // geekblue
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
