/**
 * G4.5d5b-3 — who is OFFERED the dispensary.
 *
 * A mirror of the server's VIEW_DISPENSARY row, used for one purpose only:
 * deciding whether the top-level navigation shows a Dispensary link. The
 * server remains authoritative — `/dispensary/board` authorises the actor and
 * the branch on every request, and every action route does it again — so this
 * list being wrong would cost a user a 403, not access.
 *
 * It exists because offering a link that always refuses is its own kind of
 * defect: staff learn to ignore refusals, and a refusal that means "not you"
 * becomes indistinguishable from one that means "something is broken".
 *
 * Deliberately NOT a general client-side permission engine. There is exactly
 * one action here, and the board's own `permissions` object — which the
 * server computed — drives everything inside the workspace.
 */
const VIEW_DISPENSARY_ROLES = new Set([
  'OWNER_ADMIN',
  'FRONT_DESK_CLINICAL_STAFF',
  'DOCTOR_RESIDENT',
  'DOCTOR_LOCUM',
  'STOCK_STAFF',
]);

export function canViewDispensary(role: string | null | undefined): boolean {
  return Boolean(role) && VIEW_DISPENSARY_ROLES.has(role as string);
}
