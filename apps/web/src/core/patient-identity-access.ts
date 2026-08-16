/**
 * Who the profile OFFERS the IC and date-of-birth fields to.
 *
 * EVERY STAFF ROLE THAT SEES PATIENTS (owner's decision, 2026-08-16). It
 * shipped restricted to owner and front counter, and that was the wrong trade:
 * in a small clinic the person holding the IC card is whoever happens to be at
 * the counter, and sending them off to find an account with the permission is
 * how the second patient record gets created — the exact failure the editable
 * field exists to prevent. The restriction was never what made this safe. The
 * duplicate check, the confirmation and the append-only record are.
 *
 * Mirrors the server's `patient.identity.write`, and only ever disables a
 * control — the API refuses regardless of what the browser believes, so a
 * drift here costs somebody an editable field, never an unauthorised write.
 */

const PERMISSION = 'patient.identity.write';

/**
 * The pre-permissions fallback, for a session minted before the server
 * published a permission list. The four legacy roles that map to a system role
 * which now holds the permission — every account that sees patients.
 *
 * The back-office four (finance, HR, stock, panel) and the patient portal are
 * absent on purpose. They hold no system role at all, so the server would
 * refuse them, and a stale session must never be shown a control the server
 * would refuse.
 */
const LEGACY_ROLES = [
  'OWNER_ADMIN',
  'FRONT_DESK_CLINICAL_STAFF',
  'DOCTOR_RESIDENT',
  'DOCTOR_LOCUM',
];

export interface IdentitySubject {
  role?: string;
  /** The server's own answer. Absent only on a session minted before Task 1. */
  permissions?: string[];
}

export function mayCorrectPatientIdentity(staff: IdentitySubject | null | undefined): boolean {
  if (!staff) return false;
  if (staff.permissions) return staff.permissions.includes(PERMISSION);
  return LEGACY_ROLES.includes(staff.role ?? '');
}

/**
 * The sentence shown before an identity correction is saved.
 *
 * NAMES WHAT IS ATTACHED. "Are you sure?" about an unknown quantity is a
 * question nobody can answer well; "this patient has 14 visits, 6 invoices and
 * 2 issued documents" is the fact that decides whether this is a registration
 * typo or a records job.
 */
export function describeIdentityImpact(impact: {
  visits: number;
  invoices: number;
  documents: number;
}): string {
  const parts = [
    impact.visits ? `${impact.visits} visit${impact.visits === 1 ? '' : 's'}` : null,
    impact.invoices ? `${impact.invoices} invoice${impact.invoices === 1 ? '' : 's'}` : null,
    impact.documents
      ? `${impact.documents} issued document${impact.documents === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean) as string[];

  if (parts.length === 0) {
    return 'Nothing is attached to this patient yet, so this is a straightforward correction.';
  }
  const list =
    parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `This patient has ${list}. They all stay attached to this record and keep their own history — already-issued documents are not rewritten.`;
}
