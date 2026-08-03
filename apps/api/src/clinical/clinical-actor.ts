import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { assertBranchAccess, canAuthorNarrative, type BranchAccessContext } from './clinical-authorization';

export type ClinicalTx = Prisma.TransactionClient;

// G3a (D-062) — the actor/branch plumbing that C0's note service and G2a's
// diagnosis service each grew independently. Extracted here rather than
// copied a third and fourth time into the document and attachment services:
// four private copies of an authorisation rule is how one of them quietly
// drifts.

/**
 * Open a transaction with app.tenant_id set inside it, so a multi-write
 * clinical correction is atomic and still tenant-scoped.
 */
export function withTenantTx<T>(prisma: PrismaService, fn: (tx: ClinicalTx) => Promise<T>): Promise<T> {
  const tenantId = currentTenantId();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    return fn(tx);
  });
}

/**
 * The acting staff member, from the verified JWT claim only — never from a
 * request body. Who performed a clinical correction must not be spoofable.
 */
export async function requireActor(tx: ClinicalTx): Promise<Staff> {
  const staffId = currentStaffId();
  if (!staffId) {
    throw new ForbiddenException('No authenticated staff member on this session');
  }
  const staff = await tx.staff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.active) {
    throw new ForbiddenException('Your staff account is inactive');
  }
  return staff;
}

/** Anything with a tenant-scoped `staff.findUnique` — a tx or the scoped client. */
type StaffReader = { staff: { findUnique(args: { where: { id: string } }): Promise<Staff | null> } };

/**
 * G4.5d3c-1c (D-085) — the CLINICAL AUTHOR of an action.
 *
 * This replaces S3c's `authorForVisitWork`, which preferred `Visit.staffId`
 * and fell back to the actor. That was wrong, and the owner caught it: it
 * meant a prescription written by anyone on a visit assigned to Dr A was
 * recorded as Dr A's. Silent "on behalf of" attribution is the one thing a
 * clinical record must never do — the author of a prescription is a
 * medico-legal fact about who exercised judgement, not a convenience default.
 *
 * The author is now ALWAYS the authenticated actor who performed the action,
 * and that actor must be entitled to author clinical work. `Visit.staffId`
 * says who is currently attending; it does not say who wrote this.
 *
 * An on-behalf workflow (a doctor dictating, a scribe entering) needs explicit
 * permission, visible identity and its own audit. It is deliberately NOT
 * built here — a silent version of it is exactly the defect being removed.
 */
export async function requireClinicalAuthor(db: StaffReader, action: string): Promise<Staff> {
  const staffId = currentStaffId();
  if (!staffId) {
    throw new ForbiddenException('No authenticated staff member on this session');
  }
  const staff = await db.staff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.active) {
    throw new ForbiddenException('Your staff account is inactive');
  }
  if (!canAuthorNarrative(staff)) {
    // Says what was refused, never who else could do it, and never suggests
    // that recording it under the attending doctor is an option.
    throw new ForbiddenException(
      `Your role is not permitted to ${action}. This must be recorded by the clinician who performed it.`,
    );
  }
  return staff;
}

/**
 * The authenticated actor as the CREATOR of an administrative record — a
 * document draft, for instance. Creator is not authorship: it carries no
 * clinical claim, so it is not gated on a clinical role. Whether the record
 * can then be *authorised* is a separate check that stays where it is.
 */
export function requireCreator(): string {
  const staffId = currentStaffId();
  if (!staffId) {
    throw new ForbiddenException('No authenticated staff member on this session');
  }
  return staffId;
}

// Fail-closed branch context: a null home branch grants nothing unless the
// tenant genuinely has a single branch or explicit access exists (C0).
export async function branchContext(tx: ClinicalTx, staff: Staff): Promise<BranchAccessContext> {
  const tenantBranchCount = await tx.clinic.count({ where: { tenantId: currentTenantId() } });
  const access = staff.userId
    ? await tx.userClinicAccess.findMany({ where: { userId: staff.userId }, select: { clinicId: true } })
    : [];
  return { tenantBranchCount, authorisedClinicIds: access.map((a) => a.clinicId) };
}

export async function assertMayTouchVisit(tx: ClinicalTx, visitId: string, staff: Staff): Promise<void> {
  const visit = await tx.visit.findUnique({ where: { id: visitId }, select: { clinicId: true } });
  if (!visit) {
    throw new NotFoundException('Visit not found');
  }
  assertBranchAccess(staff, visit.clinicId, await branchContext(tx, staff));
}

/**
 * Branch access for something hanging off an order rather than a visit
 * directly. The order carries its own clinicId.
 */
export async function assertMayTouchOrder(tx: ClinicalTx, orderServiceId: string, staff: Staff): Promise<void> {
  const order = await tx.orderService.findUnique({
    where: { id: orderServiceId },
    select: { clinicId: true },
  });
  if (!order) {
    throw new NotFoundException('Order/service not found');
  }
  assertBranchAccess(staff, order.clinicId, await branchContext(tx, staff));
}
