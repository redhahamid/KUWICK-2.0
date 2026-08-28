import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { ActingStaff, requireActor, withTenantTx } from '../clinical/clinical-actor';
import { Permission, assertCan, can } from '../core/permissions';

export type AdminTx = Prisma.TransactionClient;

/**
 * THE ADMIN MODULES' ONE AUTHORISATION GATE.
 *
 * Exactly the shape `InvoiceService.authoriseBilling` already uses for
 * clinical billing, generalised over a `Permission` so that Finance, Stock,
 * Panel and HR do not each grow a private copy. Four copies of an
 * authorisation rule is how one of them quietly stops matching the other
 * three — the lesson D1 taught this codebase, and the reason `permissions.ts`
 * exists at all.
 *
 * Every mutating method in the admin programme starts with a call to this.
 * None of them checks a role directly.
 */
export async function withAdminTx<T>(
  prisma: PrismaService,
  permission: Permission,
  fn: (tx: AdminTx, actor: ActingStaff) => Promise<T>,
): Promise<T> {
  return withTenantTx(prisma, async (tx) => {
    const actor = await requireActor(tx);
    assertCan(actor, permission, actor.assignedRoles, actor.directGrants);
    return fn(tx, actor);
  });
}

/** Read-side equivalent: authorise, then read. No transaction semantics needed. */
export async function requirePermission(prisma: PrismaService, permission: Permission): Promise<ActingStaff> {
  return withTenantTx(prisma, async (tx) => {
    const actor = await requireActor(tx);
    assertCan(actor, permission, actor.assignedRoles, actor.directGrants);
    return actor;
  });
}

/**
 * Does this actor hold a permission?
 *
 * ALWAYS through this, never by inspecting `assignedRoles` directly. A staff
 * member with no explicit role assignment resolves through the LEGACY FALLBACK
 * (`permissions.rolesOf`), so `assignedRoles.includes('OWNER')` is false for a
 * legacy OWNER_ADMIN who is, in every sense that matters, the owner. Reading
 * the array is the second implementation of a rule that already has one — the
 * exact divergence `permissions.ts` exists to prevent.
 */
export function actorCan(actor: ActingStaff, permission: Permission): boolean {
  return can(actor, permission, actor.assignedRoles, actor.directGrants);
}

/**
 * BRANCH SCOPE.
 *
 * `Staff.clinicId` set means the person works at one branch and every
 * clinic-scoped screen resolves to it (D-045). Null means they work across the
 * tenant. A request naming a different branch than a home-branch staff member
 * holds is refused here rather than filtered silently, because silently
 * returning another branch's empty result set looks like "no data" and is
 * indistinguishable from a bug.
 */
export function assertBranchScope(actor: ActingStaff, clinicId: string | null | undefined): void {
  if (!clinicId) return;
  if (!actor.clinicId) return;
  if (actor.clinicId !== clinicId) {
    throw new ForbiddenException('Your account is scoped to a different branch.');
  }
}

/**
 * The branch a request is about.
 *
 * What the request asked for, else the actor's home branch. Throws rather than
 * guessing when neither answers, because a stock movement or a day-end closing
 * without a branch is not a record of anything — and picking "the first clinic
 * in the tenant" would post one branch's cash into another's drawer.
 */
export function resolveClinicId(actor: ActingStaff, requested?: string | null): string {
  const resolved = requested ?? actor.clinicId;
  if (!resolved) {
    throw new NotFoundException('No branch selected for this request.');
  }
  assertBranchScope(actor, resolved);
  return resolved;
}

export { currentTenantId };
