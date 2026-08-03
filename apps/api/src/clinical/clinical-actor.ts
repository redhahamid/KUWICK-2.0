import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Staff } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { assertBranchAccess, type BranchAccessContext } from './clinical-authorization';

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

/**
 * S3c (D-082) — who to attribute a piece of visit work to.
 *
 * Documents, orders and prescriptions each have a REQUIRED author, and each
 * used to default it to `Visit.staffId`. That field is nullable now, so an
 * unassigned walk-in would break the insert.
 *
 * The visit's attending clinician stays the first choice, so existing
 * behaviour is unchanged wherever one is assigned. The fallback is the
 * authenticated actor — which is not a compromise but the more accurate
 * answer: if nobody is formally attending, the person who wrote the thing is
 * the one who wrote it. Nothing is ever attributed to a request-supplied id.
 */
export function authorForVisitWork(visitStaffId: string | null | undefined): string {
  const staffId = visitStaffId ?? currentStaffId();
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
