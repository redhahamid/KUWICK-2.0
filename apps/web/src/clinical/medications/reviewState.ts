import { Prescription } from '../types';

/**
 * KW2-C2 — how a carried-over medication describes its own review state.
 *
 * Three separate facts, deliberately not collapsed into one badge:
 *
 *   1. This row was COPIED from an earlier visit (`sourceVisitId`). Permanent
 *      provenance — it stays true after the review, because where a
 *      prescription came from is part of the record.
 *   2. Nobody has re-read it on THIS visit (`reviewFlag`). Temporary, and the
 *      only one of the three that asks for anything.
 *   3. Somebody has, and who (`reviewedByStaffId` / `reviewedAt`).
 *
 * Collapsing 1 into 2 is the tempting shortcut and it is wrong: it would erase
 * the provenance the moment the box is ticked, and provenance is exactly what
 * a later reader needs to understand why a dose from three months ago is on
 * today's visit.
 *
 * Nothing here is a safety check. The flag says whether a human looked, not
 * whether the medicine is right, and no wording in this file may imply
 * otherwise.
 */

export const CARRIED_OVER_LABEL = 'Carried over';
export const NEEDS_REVIEW_LABEL = 'Not reviewed';
export const REVIEW_ACTION_LABEL = 'Reviewed ✓';
export const REVIEW_ACTION_HINT =
  'Records that you have re-read this carried-over medication on this visit.';

/** Copied forward from an earlier visit. Permanent. */
export function isCarriedOver(prescription: Prescription): boolean {
  return Boolean(prescription.sourceVisitId);
}

/**
 * Still awaiting a re-read.
 *
 * A CANCELLED row is excluded: it is not going to the patient, so asking a
 * doctor to confirm they have re-read it is noise. This mirrors the server's
 * own `unreviewedCopiedNames`, which excludes CANCELLED for the same reason —
 * the two must agree, or the footer would warn about a medicine the list shows
 * no way to clear.
 */
export function needsReview(prescription: Prescription): boolean {
  return prescription.reviewFlag === true && prescription.status !== 'CANCELLED';
}

/**
 * The attribution line, once somebody has re-read it.
 *
 * `at` arrives already formatted — this module owns the words, not the clock,
 * and the clinic's timezone rules live in one place (clinicTime).
 */
export function reviewedLine(params: { name: string | null; at: string | null }): string | null {
  if (!params.at) return null;
  return params.name ? `Re-read by ${params.name} · ${params.at}` : `Re-read · ${params.at}`;
}
