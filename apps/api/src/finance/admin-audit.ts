import { AdminTx } from './admin-actor';
import { ActingStaff } from '../clinical/clinical-actor';
import { currentTenantId } from '../core/tenant-context';

/**
 * HIGH-RISK MUTATIONS LEAVE A RECORD. Owner brief §8.
 *
 * One writer over the EXISTING `AuditLog` table rather than a second audit
 * table per module — the brief's own rule about not creating parallel sources
 * of truth applies to audit trails as much as to invoices. `AuditLog` already
 * carries actor, action, entity, before, after and a timestamp; what it lacked
 * was a REASON and a consistent action vocabulary, and both are supplied here
 * inside the `after` payload rather than by widening the table.
 *
 * Written inside the caller's transaction, always. An audit row committed
 * separately from the change it describes is an audit row that can exist
 * without the change, or the change without the row.
 */

/** The acts this system considers high-risk. Named for the ACT, as permissions are. */
export type AuditAction =
  // Finance
  | 'payment.recorded'
  | 'payment.reversed'
  | 'refund.recorded'
  | 'creditNote.created'
  | 'creditNote.approved'
  | 'creditNote.voided'
  | 'dayEnd.counted'
  | 'dayEnd.closed'
  | 'dayEnd.reopened'
  | 'taxCode.changed'
  // Stock
  | 'stock.adjusted'
  | 'stock.transfer.sent'
  | 'stock.transfer.received'
  | 'stock.transfer.cancelled'
  | 'stockTake.approved'
  | 'stockTake.posted'
  | 'item.price.changed'
  | 'item.cost.changed'
  // Panel
  | 'panel.claim.statusChanged'
  | 'panel.claim.financialEdit'
  | 'panel.receipt.recorded'
  | 'panel.writeOff'
  /**
   * A rejected claim handed to the patient instead. Its own action because it
   * moves money between two people's responsibility on a real invoice, and the
   * patient who rings up asking why they owe RM128 deserves an answer with a
   * name and a date on it.
   */
  | 'panel.chargedToPatient'
  // ACCOUNTS PAYABLE. What a supplier billed, what the clinic paid, and the
  // terms both are judged against — all three recorded, because a supplier
  // arguing about an invoice a year later is the case this table is for.
  | 'supplierInvoice.recorded'
  | 'supplierInvoice.updated'
  | 'supplierPayment.recorded'
  | 'supplier.termsUpdated'
  | 'panel.configured'
  /**
   * The fee treatment changed and unsent claims were re-stamped with it. Kept
   * as its own action because it silently changes the arithmetic on claims
   * nobody edited, and "who changed our receivable and when" is exactly the
   * question this table exists to answer.
   */
  | 'panel.feeTreatmentRestamped'
  /** A new effective-dated fee term was recorded against a panel. */
  | 'panel.feeTermRecorded'
  // HR
  | 'employee.changed'
  | 'attendance.corrected'
  | 'leave.decided'
  | 'payroll.calculated'
  | 'payroll.approved'
  | 'payroll.adjusted'
  | 'incentiveRule.changed'
  // Access
  | 'role.changed';

export interface AuditEntry {
  action: AuditAction;
  entityType: string;
  entityId: string;
  /** The state before the change, projected to the fields that changed. */
  before?: unknown;
  after?: unknown;
  /**
   * WHY. Mandatory for every act that corrects, reverses or overrides
   * something — the callers that can omit it are the ones where the act itself
   * is the reason (recording an ordinary payment, say).
   */
  reason?: string | null;
  /** Where the act came from: a screen name, a batch id, an import. */
  source?: string;
}

export async function recordAudit(tx: AdminTx, actor: ActingStaff, entry: AuditEntry): Promise<void> {
  await tx.auditLog.create({
    data: {
      tenantId: currentTenantId(),
      // `AuditLog.actorUserId` is the USER, and a staff member may have none
      // (a profile created before an account was issued). The staff id is kept
      // in the payload either way, so "who" is answerable from one place
      // whichever of the two identities the row has.
      actorUserId: actor.userId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: (entry.before ?? null) as never,
      after: {
        ...(typeof entry.after === 'object' && entry.after !== null ? entry.after : { value: entry.after ?? null }),
        _actor: { staffId: actor.id, name: actor.fullName, role: actor.role },
        ...(entry.reason ? { _reason: entry.reason } : {}),
        ...(entry.source ? { _source: entry.source } : {}),
      } as never,
    },
  });
}

/**
 * A projection of only what changed, for the `before`/`after` pair.
 *
 * Storing the whole row on both sides makes an audit log that nobody reads,
 * because the diff is buried. Storing only the changed keys makes the question
 * "what did this person actually alter" answerable at a glance.
 */
export function diffOf<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
): { before: Partial<T>; after: Partial<T> } {
  const changedBefore: Partial<T> = {};
  const changedAfter: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    const nextValue = after[key];
    if (nextValue === undefined) continue;
    if (String(before[key] ?? '') === String(nextValue ?? '')) continue;
    changedBefore[key] = before[key];
    changedAfter[key] = nextValue;
  }
  return { before: changedBefore, after: changedAfter };
}
