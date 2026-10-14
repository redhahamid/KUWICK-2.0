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
  // STOCK. Creating a catalogue entry is how a duplicate medicine gets in, and
  // a duplicate means two stock levels and a count that never reconciles.
  | 'stock.newItemApproved'
  | 'stock.newItemRejected'
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
  /**
   * A file of historical claims was imported (G-12). The audit row carries the
   * totals as they stood, which is what makes the import checkable against the
   * workbook it came from months later.
   */
  | 'panel.claimsImported'
  // HR
  | 'employee.changed'
  | 'jobTitle.created'
  | 'jobTitle.updated'
  | 'attendance.corrected'
  | 'attendancePolicy.saved'
  | 'shiftTemplate.saved'
  | 'staff.groupChanged'
  | 'staff.clinicalAccessChanged'
  | 'employee.doctorRatesChanged'
  | 'attendance.pinFailed'
  | 'shiftTemplate.retired'
  | 'shiftTemplate.deleted'
  | 'staffFile.uploaded'
  | 'selfieConsent.given'
  | 'claimPolicy.saved'
  | 'benefit.policySaved'
  | 'benefit.yearSetUp'
  | 'benefit.usageRecorded'
  | 'publicHoliday.created'
  | 'publicHoliday.updated'
  | 'publicHoliday.deleted'
  | 'employee.created'
  | 'employee.intake'
  /// A record removed outright: a wrong entry, a duplicate, a hire who never
  /// turned up. Refused for anybody an approved run ever paid.
  | 'employee.deleted'
  | 'attendanceCorrection.requested'
  | 'attendanceCorrection.decided'
  | 'leaveRequest.submitted'
  | 'leave.decided'
  | 'leave.openingBalancesImported'
  | 'leaveType.created'
  | 'leaveType.updated'
  | 'payroll.calculated'
  | 'payroll.approved'
  | 'payroll.adjusted'
  // Malaysia payroll Stage 1 + 2. The audit trail is not a feature of a
  // payroll system; it is most of what makes one trustworthy. The audited
  // competitor ships an `AuditLogs.View` permission and no log behind it.
  | 'legalEmployer.created'
  | 'legalEmployer.updated'
  | 'employee.employerAssigned'
  | 'employeeSalary.recorded'
  | 'employeeSalary.corrected'
  | 'employeeSalary.deleted'
  /** A monthly allowance or deduction on one employee, dated. */
  | 'employeeRecurringItem.created'
  | 'employeeRecurringItem.updated'
  | 'employeeRecurringItem.ended'
  /** The employer selected which wages EPF is contributed on — a dated preference. */
  | 'employeeContributionBasis.recorded'
  | 'employeeContributionBasis.branchRecorded'
  | 'employeeStatutoryClassification.recorded'
  /// The standing already on a date restated, rather than a second version
  /// opened on the same day. The first standing an employee ever gets is
  /// written from their join date by the Add employee form and carries only
  /// what that form asked for; the rest of it has to land on that same row.
  | 'employeeStatutoryClassification.corrected'
  /// A version recorded in error removed; the one before it runs on to
  /// where it ran to. Refused where an approved month was worked out from it.
  | 'employeeStatutoryClassification.deleted'
  | 'legalEmployerStatutory.recorded'
  | 'payComponent.seeded'
  | 'payComponent.created'
  | 'payComponent.updated'
  /// A version corrected before it took effect — not a new version, because
  /// nothing was ever paid under the one it replaces.
  | 'payComponent.versionCorrected'
  | 'payComponent.startCorrected'
  /** A person's display name changed, by themselves or the owner. */
  | 'staff.renamed'
  /// An unstarted version withdrawn outright, leaving the treatment in force
  /// unchanged. The mistake lives here rather than in the catalogue.
  | 'payComponent.versionWithdrawn'
  /// When an item is paid, set on every version of it. Payment, not treatment.
  | 'payComponent.payDateSet'
  // A named person here looked at the statutory registry. Not verification.
  | 'statutory.checked'
  | 'payrollPolicy.created'
  | 'payrollPolicy.updated'
  | 'payrollPolicy.deleted'
  | 'payrollInput.created'
  | 'payrollInput.imported'
  | 'payrollInput.updated'
  | 'payrollInput.deleted'
  | 'payrollInput.materialised'
  | 'payrollInput.carried'
  | 'payrollException.overridden'
  | 'payrollWarning.acknowledged'
  | 'payrollSnapshot.created'
  /** Opening year-to-date typed in for a clinic migrating mid-year. */
  | 'payroll.ytdImported'
  | 'payrollApproval.recorded'
  | 'payrollApprovalPolicy.changed'
  | 'payroll.reopened'
  /// An unapproved run thrown away. Nothing was paid or filed from it, so
  /// the row goes; this entry is what remains of it.
  | 'payroll.discarded'
  /** A payslip PDF left the system — who took whose slip, for which version. */
  | 'payrollPayslip.downloaded'
  /** The JSON payslip read — same figures as the PDF, so the same trail. */
  | 'payrollPayslip.viewed'
  /** A full-pay report was served — the register and its twelve siblings. */
  | 'payrollReport.served'
  /** The frozen snapshot payload was read — every employee's figures at once. */
  | 'payrollSnapshot.read'
  /** The statutory outputs view — per-employee figures per scheme. */
  | 'payrollStatutory.outputsViewed'
  // Payment preparation. Three separate events, because "a document exists",
  // "somebody took it" and "money moved" are three different claims.
  | 'payrollPayment.batchPrepared'
  | 'payrollPayment.listingDownloaded'
  | 'payrollPayment.recordedPaid'
  /// The owner moved a pay date for one run, before its listing was prepared.
  | 'payrollPayment.payDateChosen'
  // Statutory outputs: a listing leaving, and a human recording that a filing
  // was actually made at the authority's portal — the only "submitted" there is.
  | 'payrollStatutory.listingDownloaded'
  | 'payrollStatutory.submissionRecorded'
  | 'payrollStatutory.filingViewed'
  | 'payrollStatutory.filingRecorded'
  // TP1/TP3 — the two LHDN forms that change a month's tax. Recording and
  // deleting are both acts on somebody's cumulative tax position.
  | 'payrollTax.tp1Recorded'
  | 'payrollTax.tp1Deleted'
  | 'payrollTax.tp3Recorded'
  | 'payrollTax.tp3Deleted'
  | 'incentiveRule.changed'
  // Stage 2.5 — cross-module payroll integration. Every state change on a
  // claim or a locum session is auditable, because these are the two records
  // that decide whether somebody is paid twice or not at all.
  | 'staffClaim.created'
  | 'staffClaim.submitted'
  | 'staffClaim.decided'
  | 'staffClaim.cancelled'
  | 'staffClaim.routedToPayroll'
  | 'staffClaim.settledByFinance'
  | 'locumSession.recorded'
  | 'locumSession.updated'
  | 'locumSession.approved'
  | 'locumSession.settled'
  | 'employee.engagementChanged'
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
