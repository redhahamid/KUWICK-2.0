import { Role } from '@kuwick/shared';

/**
 * TASK 1 — the browser READS the server's answer; it no longer computes one.
 *
 * This file used to hold a copy of the server's BILLING_MATRIX, kept identical
 * by a test. That arrangement is exactly what produced D1: two implementations
 * of one question, correct until the day somebody changed one of them. The
 * session now publishes the permission list the server itself enforced with,
 * so the only thing left to do here is name which permission each action
 * needs — the same two names the server uses.
 *
 * This still decides only what RENDERS. Every invoice mutation is refused
 * server-side regardless of what this returns; hiding is presentation, the 403
 * is the rule.
 */
export type BillingAction =
  | 'CREATE_INVOICE'
  | 'EDIT_LINES'
  | 'MARK_PAID'
  | 'CANCEL_INVOICE'
  | 'APPLY_DISCOUNT'
  | 'CANCEL_LINE'
  | 'CLASSIFY_VISIT';

/** Mirrors BILLING_PERMISSION in the server's clinical-authorization.ts. */
const BILLING_PERMISSION: Record<BillingAction, string> = {
  CREATE_INVOICE: 'billing.counter',
  EDIT_LINES: 'billing.counter',
  MARK_PAID: 'billing.counter',
  CANCEL_LINE: 'billing.counter',
  CLASSIFY_VISIT: 'billing.counter',
  // Moving money the clinic has already earned. Owner by default, and
  // grantable to one trusted person without making them an owner.
  CANCEL_INVOICE: 'billing.corrections',
  APPLY_DISCOUNT: 'billing.corrections',
};

/**
 * The pre-permissions fallback, for a session minted before the server started
 * publishing a permission list. It is the OLD role table, deliberately left at
 * its old (narrower) values: a stale session should never be shown a control
 * the server would refuse, and being shown one fewer button until the next
 * login is a cosmetic cost. Re-authenticating replaces this entirely.
 */
const LEGACY_ROLE_ACTIONS: Record<string, BillingAction[]> = {
  [Role.OWNER_ADMIN]: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE', 'APPLY_DISCOUNT', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  [Role.FINANCE_STAFF]: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_INVOICE', 'APPLY_DISCOUNT', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  [Role.FRONT_DESK_CLINICAL_STAFF]: ['CREATE_INVOICE', 'EDIT_LINES', 'MARK_PAID', 'CANCEL_LINE', 'CLASSIFY_VISIT'],
  [Role.DOCTOR_RESIDENT]: ['CREATE_INVOICE', 'EDIT_LINES'],
  [Role.DOCTOR_LOCUM]: ['CREATE_INVOICE', 'EDIT_LINES'],
};

/** What the browser knows about the signed-in staff member. */
export interface BillingSubject {
  role?: string;
  /** The server's own answer. Absent only on a session minted before Task 1. */
  permissions?: string[];
}

export function canPerformBilling(staff: BillingSubject | null | undefined, action: BillingAction): boolean {
  if (!staff) return false;
  if (staff.permissions) {
    return staff.permissions.includes(BILLING_PERMISSION[action]);
  }
  return (LEGACY_ROLE_ACTIONS[staff.role ?? ''] ?? []).includes(action);
}

/** May this staff member reach the billing page at all? */
export function canAccessBilling(staff: BillingSubject | null | undefined): boolean {
  return (Object.keys(BILLING_PERMISSION) as BillingAction[]).some((action) => canPerformBilling(staff, action));
}
