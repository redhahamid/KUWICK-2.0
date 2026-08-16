/**
 * Who the profile OFFERS the IC and date-of-birth fields to.
 *
 * Mirrors the server's `patient.identity.write`, and only ever disables a
 * control — the API refuses regardless of what the browser believes, so a
 * drift here costs somebody an editable field, never an unauthorised write.
 *
 * The fields are OFFERED DISABLED rather than hidden. A counter clerk who
 * cannot see an IC field at all has no way to know the value is wrong and
 * correctable; one who sees it greyed out with the reason knows to ask. That
 * distinction is the whole point of this change: the failure being fixed is
 * somebody deciding the only way forward is a second patient record.
 */

const PERMISSION = 'patient.identity.write';

/**
 * The pre-permissions fallback, for a session minted before the server
 * published a permission list. Deliberately the NARROW reading — owner and
 * front counter, matching OWNER and ADMINISTRATOR on the server — because a
 * stale session should never be shown a control the server would refuse.
 */
const LEGACY_ROLES = ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF'];

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

/** What the disabled field says, so it is honest rather than merely inert. */
export const IDENTITY_LOCKED_REASON =
  'Only the front counter or the clinic owner can correct an IC or date of birth. Ask them rather than registering the patient again.';

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
