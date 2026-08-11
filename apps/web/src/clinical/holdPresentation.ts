/**
 * KW2-C2 — how a HELD consultation describes itself.
 *
 * A held patient sits in the WAITING queue next to patients who have simply
 * not been seen yet. The two are indistinguishable by status and mean
 * completely different things to whoever works the queue: one is waiting to
 * be called, the other is waiting for a doctor who already has them and is
 * expecting them back. Everything in this file exists to keep them apart.
 */

/**
 * Who may PAUSE a consultation. Mirrors the server's HOLD_CONSULTATION
 * matrix, and mirrors it in the safe direction: this only ever hides a
 * control. The server refuses regardless of what the browser believes, so a
 * drift here costs a doctor a button, never an unauthorised write.
 *
 * Front desk is deliberately absent. Holding is a clinical judgement made in
 * a room the counter cannot see into; RESUMING is theirs too, which is why
 * that goes through the ordinary start-consultation permission.
 */
export const HOLD_ROLES = ['OWNER_ADMIN', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'];

export function mayHoldConsultation(role: string | null | undefined): boolean {
  return role != null && HOLD_ROLES.includes(role);
}

/** Is this queue row waiting because a doctor paused it? */
export function isOnHold(row: { heldAt?: string | null }): boolean {
  return Boolean(row.heldAt);
}

/**
 * "On hold · Dr Amira Rahman".
 *
 * Never "On hold" alone. An unattributed pause is the silent state change
 * this feature exists to prevent, and the counter's next question is always
 * who to ask. The database will not store one without the other, so a null
 * name here means the row was not held at all.
 */
export function holdLabel(row: { heldAt?: string | null; heldByName?: string | null }): string | null {
  if (!row.heldAt) return null;
  return row.heldByName ? `On hold · ${row.heldByName}` : 'On hold';
}
