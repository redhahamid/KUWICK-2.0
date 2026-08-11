import { ClinicalNoteStatus, ClinicalNoteType } from '@prisma/client';
import { ClinicalTx } from './clinical-actor';

/**
 * G4.5d3c-3c — the DOCUMENTATION PENDING state, defined once.
 *
 * Three callers need to agree on what "the note is not written yet" means:
 * the doctor-phase status read (which reports it as an amber warning), the
 * doctor-phase write (which records it against the actor and the moment), and
 * visit completion (which refuses to close the visit while it is true). Two
 * implementations of that question would eventually disagree, and the failure
 * would look like a screen offering a button the server refuses.
 *
 * It lives in its own module rather than on either service so neither has to
 * import the other.
 *
 * A DOCTOR_NARRATIVE carrying a signature is what counts:
 *
 *   - a STAFF_REMARK is not the doctor's narrative (C0/D-051 split them
 *     precisely so a front-desk entry cannot stand in for a clinician's);
 *   - a DRAFT is not documentation however long it is, because signing is the
 *     act that makes a note attributable and locks it against silent edits.
 *
 * Neither of those is loosened here. What changed in 3c is only WHERE the
 * requirement is enforced.
 */
export async function isDocumentationPending(tx: ClinicalTx, visitId: string): Promise<boolean> {
  const signedNotes = await tx.clinicalNote.count({
    where: {
      visitId,
      noteType: ClinicalNoteType.DOCTOR_NARRATIVE,
      status: ClinicalNoteStatus.SIGNED,
      signedAt: { not: null },
    },
  });
  return signedNotes === 0;
}

/**
 * Read the documentation state recorded on a workflow event's metadata.
 *
 * Returns NULL — not false — when the key is absent. A phase completed before
 * this was recorded genuinely does not say, and answering "documentation was
 * complete" for it would be inventing a fact about a clinical record.
 */
export function readDocumentationPending(metadata: unknown): boolean | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const value = (metadata as Record<string, unknown>).documentationPending;
  return typeof value === 'boolean' ? value : null;
}
