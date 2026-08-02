import { Role } from '@kuwick/shared';

/**
 * G3c closure (D-066) — the browser's copy of the billing matrix.
 *
 * This mirrors `clinical-authorization.ts` on the server and exists ONLY to
 * decide what to render. It is not the gate: every invoice mutation is
 * refused server-side regardless of what this returns, and the billing page
 * is written so that an unauthorised user never mounts the mutable component
 * in the first place. Hiding is presentation; the 403 is the rule.
 *
 * Kept as a small explicit table rather than a role list so the two sides can
 * be read against each other without interpretation.
 */
export type BillingAction = 'CREATE_INVOICE' | 'EDIT_LINES' | 'MARK_PAID' | 'CANCEL_INVOICE';

const BILLING_MATRIX: Record<BillingAction, Role[]> = {
  CREATE_INVOICE: [
    Role.OWNER_ADMIN,
    Role.FINANCE_STAFF,
    Role.FRONT_DESK_CLINICAL_STAFF,
    Role.DOCTOR_RESIDENT,
    Role.DOCTOR_LOCUM,
  ],
  EDIT_LINES: [
    Role.OWNER_ADMIN,
    Role.FINANCE_STAFF,
    Role.FRONT_DESK_CLINICAL_STAFF,
    Role.DOCTOR_RESIDENT,
    Role.DOCTOR_LOCUM,
  ],
  MARK_PAID: [Role.OWNER_ADMIN, Role.FINANCE_STAFF, Role.FRONT_DESK_CLINICAL_STAFF],
  CANCEL_INVOICE: [Role.OWNER_ADMIN, Role.FINANCE_STAFF],
};

export function canPerformBilling(role: string | undefined, action: BillingAction): boolean {
  if (!role) return false;
  return BILLING_MATRIX[action].includes(role as Role);
}

/** May this role reach the billing page at all? */
export function canAccessBilling(role: string | undefined): boolean {
  if (!role) return false;
  return (Object.keys(BILLING_MATRIX) as BillingAction[]).some((action) => canPerformBilling(role, action));
}
