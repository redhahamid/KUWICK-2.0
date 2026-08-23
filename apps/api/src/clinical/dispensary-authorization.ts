import { ForbiddenException } from '@nestjs/common';
import { Role, Staff } from '@prisma/client';
import { ROLE_PERMISSIONS, attachedGrants, attachedRoles } from '../core/permissions';

/**
 * G4.5d5b-2 — who may do what at the dispensary counter.
 *
 * The owner's decision for v1 is explicit: NO new DISPENSARY_STAFF role. A
 * role is a migration, a seeding story and a permission surface everywhere
 * else in the product, and a small Malaysian clinic does not have a dedicated
 * dispenser — the same people do the counter, the front desk and sometimes
 * the consultation. So existing roles are used, with the actions written down.
 *
 * Writing them down is the point. Before this file, `dispense()` called
 * `requireActor` and nothing else: ANY authenticated staff member of ANY role,
 * from ANY branch, could move clinic stock. The audit found it and this closes
 * it. Authentication is not permission, and a doctor being able to dispense in
 * a small clinic is a decision somebody made, not a side effect of there being
 * no check.
 *
 * STOCK_STAFF is read-only here deliberately. They may look at the dispensary
 * to see what is about to move and resolve a stock problem in Inventory, but
 * handing medicine to a patient is a clinical hand-over with a named
 * dispenser on the record.
 */
export type DispensaryAction =
  | 'VIEW_DISPENSARY'
  | 'PRINT_LABEL'
  | 'DISPENSE_MEDICATION'
  | 'RESOLVE_STOCK_ISSUE';

const DISPENSARY_MATRIX: Record<DispensaryAction, Role[]> = {
  // Reading the board. Stock staff are included so they can see the demand
  // they are about to be asked to fill.
  VIEW_DISPENSARY: [
    'OWNER_ADMIN',
    'FRONT_DESK_CLINICAL_STAFF',
    'DOCTOR_RESIDENT',
    'DOCTOR_LOCUM',
    'STOCK_STAFF',
  ],
  // Printing a label moves nothing and is part of preparing the medicine.
  // Stock staff are excluded: a label is a clinical instruction to a patient.
  PRINT_LABEL: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],
  // The hand-over itself. Stock staff are excluded for the same reason.
  DISPENSE_MEDICATION: ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM'],
  // Correcting the stock record is inventory work, not counter work.
  RESOLVE_STOCK_ISSUE: ['OWNER_ADMIN', 'STOCK_STAFF'],
};

const ACTION_WORDS: Record<DispensaryAction, string> = {
  VIEW_DISPENSARY: 'view the dispensary',
  PRINT_LABEL: 'print a medication label',
  DISPENSE_MEDICATION: 'dispense medication',
  RESOLVE_STOCK_ISSUE: 'resolve a stock issue',
};

export function canPerformDispensary(staff: Staff, action: DispensaryAction): boolean {
  if (!staff.active) return false;
  if (DISPENSARY_MATRIX[action].includes(staff.role)) return true;
  // FINAL-UAT — the audit's holdout closed: this matrix ignored the
  // `dispense.perform` capability entirely, so an Inventory custom role or
  // an individual grant was refused at the very door it exists to open.
  //
  // EXPLICIT holdings only, deliberately. The legacy fallback also hands
  // STOCK_STAFF `dispense.perform`, but this matrix REFUSES stock staff the
  // hand-over by design (a label is a clinical instruction) — so the widening
  // honours only what an owner explicitly composed: an individual grant, a
  // custom role, or an assigned capability role. An explicit
  // `dispense.perform` opens all four actions; that is the owner's call.
  const explicit = new Set<string>(attachedGrants(staff) ?? []);
  for (const role of attachedRoles(staff) ?? []) {
    for (const permission of ROLE_PERMISSIONS[role]) explicit.add(permission);
  }
  return explicit.has('dispense.perform');
}

/**
 * The refusal names the ACTION in clinic language, never the role that would
 * have been required — telling a user which role to obtain is an invitation.
 */
export function assertCanPerformDispensary(staff: Staff, action: DispensaryAction): void {
  if (!canPerformDispensary(staff, action)) {
    throw new ForbiddenException(`This account may not ${ACTION_WORDS[action]}.`);
  }
}

/** Exposed so the browser can hide what the server would refuse. */
export function dispensaryPermissionsFor(staff: Staff): Record<DispensaryAction, boolean> {
  return {
    VIEW_DISPENSARY: canPerformDispensary(staff, 'VIEW_DISPENSARY'),
    PRINT_LABEL: canPerformDispensary(staff, 'PRINT_LABEL'),
    DISPENSE_MEDICATION: canPerformDispensary(staff, 'DISPENSE_MEDICATION'),
    RESOLVE_STOCK_ISSUE: canPerformDispensary(staff, 'RESOLVE_STOCK_ISSUE'),
  };
}
