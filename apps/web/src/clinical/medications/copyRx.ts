/**
 * KW2-C2 — what the Copy Rx modal is allowed to say about allergies.
 *
 * THIS IS NOT AN INTERACTION CHECK, AND MUST NEVER READ AS ONE.
 *
 * An ALLERGY alert's label is free text somebody typed. There is no drug
 * dictionary behind it, no ingredient mapping, no cross-reactivity table.
 * What can honestly be done is compare strings and say so — which is worth
 * doing, because "Penicillin" against "Tab Penicillin V 250mg" is a match a
 * tired doctor at 7pm can miss and a substring cannot.
 *
 * What it must not do is imply more than it is. Red means stop; amber means
 * look. A red banner reading "interaction detected" over a string comparison
 * would be a lie that gets believed, and the first time it missed something
 * the doctor would have trusted it instead of their own reading.
 */

export type AllergyRecordState = 'NONE_RECORDED' | 'NONE_KNOWN' | 'PRESENT';

/**
 * Three states, not two.
 *
 * "Never asked" and "asked, none known" are different clinical facts and the
 * modal says so. The second one takes a recorded answer to claim — no alert at
 * all is a question nobody put, not a negative answer.
 */
export function allergyRecordState(
  allergies: string[] | null | undefined,
  askedAndNoneKnown = false,
): AllergyRecordState {
  const real = (allergies ?? []).filter((entry) => entry?.trim());
  if (real.length > 0) return 'PRESENT';
  // NONE_KNOWN is now a POSITIVE record — a NO_KNOWN_ALLERGY alert — rather
  // than an empty array. An absent list can no longer be read as a negative
  // answer, because absence is exactly what "nobody asked" looks like.
  return askedAndNoneKnown ? 'NONE_KNOWN' : 'NONE_RECORDED';
}

/** The heading above the patient's own words. Never paraphrased. */
export const ALLERGY_HEADING = 'Recorded allergies — check yourself:';

/** Shown when there is nothing recorded. Absence of data is itself a warning. */
export const NO_ALLERGY_RECORD_WARNING = '⚠ No allergy record for this patient';

/** The row-level wording. Deliberately "possible" and "verify". */
export const POSSIBLE_MATCH_LABEL = 'possible allergy match — verify';

/**
 * Does this medication's name contain any recorded allergy term?
 *
 * Case-insensitive substring, both directions, on words of 3+ characters.
 * Short fragments are excluded deliberately: "K" or "PC" would match half the
 * formulary and train people to ignore the flag, which is worse than not
 * flagging at all.
 *
 * Returns the terms that matched, not a boolean, so the UI can name them —
 * "possible allergy match" is unactionable; "matches: Penicillin" is not.
 */
export function matchingAllergyTerms(
  medicationName: string | null | undefined,
  allergies: string[] | null | undefined,
): string[] {
  if (!medicationName || !allergies?.length) return [];
  const haystack = medicationName.toLowerCase();
  return allergies
    .map((entry) => entry?.trim())
    .filter((entry): entry is string => Boolean(entry) && entry.trim().length >= 3)
    .filter((entry) => haystack.includes(entry.toLowerCase()));
}

export interface CopyCandidate {
  id: string;
  name: string;
  /** "4.5ml QID ×5d · 1 bottle" — what would be carried over. */
  detail: string;
}

/** A row as the modal renders it: the medication plus what we can say about it. */
export interface CopyCandidateView extends CopyCandidate {
  matchedAllergies: string[];
  /** Amber, never red, and never blocking. */
  flagged: boolean;
}

export function decorateCandidates(
  candidates: CopyCandidate[],
  allergies: string[] | null | undefined,
): CopyCandidateView[] {
  return candidates.map((candidate) => {
    const matchedAllergies = matchingAllergyTerms(candidate.name, allergies);
    return { ...candidate, matchedAllergies, flagged: matchedAllergies.length > 0 };
  });
}

/** "Add 2 selected", or the disabled state's wording. */
export function copyButtonLabel(selectedCount: number): string {
  return selectedCount === 0 ? 'Select medications to copy' : `Add ${selectedCount} selected`;
}
