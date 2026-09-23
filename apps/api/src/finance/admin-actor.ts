import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentTenantId } from '../core/tenant-context';
import { ActingStaff, requireActor, TenantTxOptions, withTenantTx } from '../clinical/clinical-actor';
import { Permission, assertCan, can } from '../core/permissions';
import { BranchScope, prismaScopeSource, resolveBranchScope } from '../core/branch-scope';

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
  options: TenantTxOptions = {},
): Promise<T> {
  return withTenantTx(
    prisma,
    async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, permission, actor.assignedRoles, actor.directGrants);
      return fn(tx, actor);
    },
    options,
  );
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
 * WHICH BRANCHES MAY THIS ACCOUNT ACT IN.
 *
 * One resolver, in `core/branch-scope.ts`, replacing the two contradictory
 * systems the Stage 2.5 audit found. Read that module for the reasoning; this
 * is the admin modules' way in.
 *
 * Every admin read that filters by branch, and every admin write that names
 * one, goes through here. Nothing writes its own `where` fragment, and nothing
 * compares `actor.clinicId` by hand.
 */
export async function branchScopeOf(tx: AdminTx, actor: ActingStaff): Promise<BranchScope> {
  return resolveBranchScope(
    {
      id: actor.id,
      active: actor.active,
      clinicId: actor.clinicId,
      userId: actor.userId,
      assignedRoles: actor.assignedRoles,
      directGrants: actor.directGrants,
    },
    prismaScopeSource(tx),
    (permission) => actorCan(actor, permission),
  );
}

/**
 * Authorise an action AND resolve the branch scope in one step.
 *
 * The two were separate, and that is exactly how sixteen call sites came to
 * authorise the action while nothing authorised the branch. Handing both to
 * the callback together makes the scoped version the easy one to write.
 */
export async function withScopedAdminTx<T>(
  prisma: PrismaService,
  permission: Permission,
  fn: (tx: AdminTx, actor: ActingStaff, scope: BranchScope) => Promise<T>,
  options: TenantTxOptions = {},
): Promise<T> {
  return withAdminTx(prisma, permission, async (tx, actor) => fn(tx, actor, await branchScopeOf(tx, actor)), options);
}

/** The read-side equivalent. */
export async function requireScope(
  prisma: PrismaService,
  permission: Permission,
): Promise<{ actor: ActingStaff; scope: BranchScope }> {
  return withTenantTx(prisma, async (tx) => {
    const actor = await requireActor(tx);
    assertCan(actor, permission, actor.assignedRoles, actor.directGrants);
    return { actor, scope: await branchScopeOf(tx, actor) };
  });
}

/**
 * The branch a single-branch operation is about.
 *
 * Was: "what the request asked for, else the actor's home branch", with a
 * guard that returned early when the actor had no home branch — so an account
 * with none could name any branch in the tenant. It now goes through the
 * scope, which refuses a branch the account was not given.
 */
export function resolveClinicId(scope: BranchScope, requested?: string | null): string {
  return scope.require(requested);
}

export { currentTenantId };
