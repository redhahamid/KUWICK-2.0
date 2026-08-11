import { PrescriptionSupplyMode } from '@prisma/client';

/**
 * G4.5d3c-3c — the supply intent a COPIED prescription is created with.
 *
 * Copy Previous re-prescribes a past visit's medication onto today's visit.
 * Until now it wrote no supply mode at all, so every copied line arrived NULL
 * — unresolved — and the doctor had to answer the same question once per line
 * before the consultation could be routed anywhere. Copying five repeat
 * medications produced five blockers.
 *
 * The rule below is the owner's explicit, safe rule. Two clauses:
 *
 *   1. A copy CARRIES OVER the source's recorded supply mode when the source
 *      actually recorded one. If last month's amoxicillin was an external
 *      prescription, this month's copy is an external prescription: that is
 *      the decision the clinic made about this drug for this patient, and
 *      silently converting it to clinic dispensing would assert that the
 *      clinic is supplying medicine it is not.
 *
 *   2. Where the source recorded NOTHING — a legacy NULL — or recorded
 *      DEFERRED, the copy takes the clinic's default for a new prescription
 *      (clinic dispensing), exactly as if it had been typed fresh today.
 *
 * Clause 2 is the one worth justifying. Copying is a NEW prescribing decision
 * made today by the doctor doing the copying — the service already re-authors
 * it to them for precisely that reason — so the new row gets the same visible
 * default any new row gets, and the doctor can change it before or after
 * saving. Propagating the NULL instead would be worse in both directions: it
 * would recreate the friction this checkpoint exists to remove, and it would
 * write a fresh "nobody has said" onto a row where somebody just did.
 *
 * DEFERRED is treated as unrecorded on purpose. It means "decide later" about
 * a PAST visit, and that deferral was resolved, abandoned or forgotten when
 * that visit ended; carrying it forward would manufacture a new blocker out of
 * an old hesitation.
 *
 * What this rule never does: rewrite the SOURCE row. A legacy NULL on a past
 * visit stays NULL, stays unresolved and keeps saying so. Nothing here reaches
 * backwards into a record that has already been made.
 */
export const DEFAULT_SUPPLY_MODE: PrescriptionSupplyMode = PrescriptionSupplyMode.ONSITE_DISPENSE;

export type CopiedSupplyOrigin = 'CARRIED_OVER' | 'DEFAULTED';

export interface CopiedSupplyDecision {
  supplyMode: PrescriptionSupplyMode;
  origin: CopiedSupplyOrigin;
}

export function supplyModeForCopy(
  sourceSupplyMode: PrescriptionSupplyMode | null | undefined,
): CopiedSupplyDecision {
  if (sourceSupplyMode && sourceSupplyMode !== PrescriptionSupplyMode.DEFERRED) {
    return { supplyMode: sourceSupplyMode, origin: 'CARRIED_OVER' };
  }
  return { supplyMode: DEFAULT_SUPPLY_MODE, origin: 'DEFAULTED' };
}

/**
 * What the clinic is told after a copy, so the rule is visible rather than
 * something the doctor has to infer from the rows that appeared.
 */
export function describeCopyOutcome(decisions: CopiedSupplyDecision[]): string {
  const total = decisions.length;
  if (total === 0) return 'Nothing was copied.';
  const defaulted = decisions.filter((decision) => decision.origin === 'DEFAULTED').length;
  const carried = total - defaulted;

  const lines = total === 1 ? '1 medication copied' : `${total} medications copied`;
  if (defaulted === 0) {
    return `${lines}. Supply mode carried over from the previous visit.`;
  }
  if (carried === 0) {
    return `${lines}, set to dispense from clinic. Change the supply mode on any line that is supplied elsewhere.`;
  }
  return `${lines}. ${carried} kept the previous supply mode; ${defaulted} had none recorded and were set to dispense from clinic.`;
}
