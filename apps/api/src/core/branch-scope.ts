import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, SystemRole } from '@prisma/client';
import { Permission, can } from './permissions';
import { currentTenantId } from './tenant-context';

/**
 * WHICH BRANCHES MAY THIS ACCOUNT ACT IN.
 *
 * ONE CONTRACT, replacing two that meant opposite things by the same column.
 *
 * Kuwick grew two branch-scope systems. The admin half read
 * `Staff.clinicId = null` as "works across the whole tenant" and let a request
 * name any branch it liked; the clinical half read the same null as
 * "authorised for nothing" and denied. The guard that looked canonical,
 * `assertBranchScope`, had no callers at all, failed open on both of its
 * clauses, and could only ever compare against a single branch id — so it
 * could not express "manages branches A and C but not B", which is the
 * sentence the product needs.
 *
 * This module is the single answer. Everything that scopes by branch resolves
 * a `BranchScope` and uses it; nothing writes its own `where` fragment and
 * nothing compares `actor.clinicId` by hand.
 *
 * ACCOUNT ACCESS IS NOT PROVIDER IDENTITY.
 *
 * The two were conflated, and that is why a null home branch had to mean two
 * things. `Staff.clinicId` is a PROVIDER fact — where this person practises,
 * which is what a clinical record and a roster care about. It is not a
 * statement about what their account may administer. An owner who is also a
 * GP practises at one branch and administers all of them; under the old
 * reading those two facts fought over one column.
 *
 * So authorisation reads the scope below, and the scope is built from three
 * sources, in this order:
 *
 *   1. `settings.manage` — an account holder administers every branch in the
 *      tenant. This is the ONLY route to tenant-wide access, and it is a
 *      permission somebody was granted, never the absence of a value.
 *   2. `UserClinicAccess` — explicit per-branch grants. The table existed and
 *      no admin service read it.
 *   3. `Staff.clinicId` — the home branch, which an account may always
 *      administer.
 *
 * FAIL CLOSED. An account with none of the three gets an empty scope and can
 * administer nothing, rather than everything. The one exception is a tenant
 * with a single branch, where there is nothing to disambiguate and denying
 * would only produce a support call.
 *
 * "ALL BRANCHES" MEANS ALL BRANCHES THIS ACTOR MAY MANAGE — never all
 * branches that exist. That is the whole point of the change.
 */
export interface BranchScope {
  /** Branch ids this actor may act in. Empty means none. */
  clinicIds: string[];
  /**
   * True when the actor administers the whole tenant, so the list above is
   * "every branch that exists today" and a branch added tomorrow is included
   * without re-resolving.
   */
  everyBranch: boolean;
  /**
   * A Prisma `where` fragment for a model with a `clinicId` column.
   *
   * Tenant-wide resolves to `{}` — RLS already bounds the query to the tenant,
   * so adding a redundant `in` of every branch would only go stale. A scoped
   * actor gets `{ clinicId: { in: [...] } }`, and an actor with no branches
   * gets `{ clinicId: { in: [] } }`, which matches nothing. Never `{}` by
   * accident: an empty scope must return no rows, not every row.
   */
  filter: { clinicId?: { in: string[] } };
  /**
   * The same fragment for a model that reaches its branch through `staff`,
   * such as a payroll line or an attendance record.
   */
  staffFilter: { staff?: { clinicId: { in: string[] } } };
  /**
   * Resolve the branch a request is about, refusing one outside the scope.
   *
   * Refuses rather than filtering silently, because silently returning
   * another branch's empty result set looks like "no data" and is
   * indistinguishable from a bug. Passing nothing returns null, meaning
   * "every branch I may manage" — which the caller applies with `filter`.
   */
  assert(requested: string | null | undefined): string | null;
  /**
   * The branch a single-branch operation must happen in. Throws when the
   * request named none and the actor's scope does not settle it, because a
   * stock movement or a day-end closing without a branch is not a record of
   * anything.
   */
  require(requested: string | null | undefined): string;
  /**
   * The `where` fragment for a read that MAY name one branch.
   *
   * The old shape was `clinicId ? { clinicId } : {}` — "no branch named means
   * every branch", which is what let a scoped account read the whole tenant by
   * leaving the parameter off. This validates a named branch and falls back to
   * the actor's own scope rather than to no filter at all.
   */
  where(requested: string | null | undefined): { clinicId?: string | { in: string[] } };
  /**
   * The branch ids a RAW SQL query must restrict to, or null when the actor is
   * tenant-wide and RLS alone is enough. Raw SQL cannot use `filter`, and a
   * hand-written query that forgets the clause is the same hole in a different
   * language.
   */
  sqlClinicIds(requested: string | null | undefined): string[] | null;
}

/** Just enough of the actor to decide. Keeps this module free of Prisma types. */
export interface ScopeActor {
  id: string;
  active: boolean;
  clinicId: string | null;
  userId: string | null;
  assignedRoles: SystemRole[];
  directGrants: Permission[];
}

/** The reads this module needs, named so a test can supply them directly. */
export interface ScopeSource {
  /** Every branch in the tenant. */
  clinicIds(): Promise<string[]>;
  /** Explicit per-branch grants for this account. */
  grantedClinicIds(userId: string): Promise<string[]>;
}

export const SCOPE_REFUSAL =
  'Your account is not authorised for that branch. Ask an account holder to give you access to it.';
export const NO_BRANCH_REFUSAL =
  'Your account is not authorised for any branch yet. Ask an account holder to give you access to one.';

/**
 * Build the scope. `actorCan` is passed in rather than imported so this module
 * has one job and a test can drive the permission side without a database.
 */
export async function resolveBranchScope(
  actor: ScopeActor,
  source: ScopeSource,
  actorCan: (permission: Permission) => boolean = (permission) =>
    can(actor as never, permission, actor.assignedRoles, actor.directGrants),
): Promise<BranchScope> {
  const tenantClinicIds = await source.clinicIds();

  // AN INACTIVE ACCOUNT ADMINISTERS NOTHING, whatever it used to hold.
  if (!actor.active) return buildScope([], false);

  // TENANT-WIDE, from a permission somebody was granted.
  if (actorCan('settings.manage')) return buildScope(tenantClinicIds, true);

  // A SINGLE-BRANCH TENANT has nothing to disambiguate. Denying here would
  // produce a support call and protect nobody: there is no second branch to
  // keep this account out of.
  if (tenantClinicIds.length <= 1) return buildScope(tenantClinicIds, true);

  const granted = actor.userId ? await source.grantedClinicIds(actor.userId) : [];
  const scoped = new Set(granted);
  if (actor.clinicId) scoped.add(actor.clinicId);

  // Only branches that still exist. A grant left behind by a deleted branch
  // must not widen a filter into matching nothing-in-particular.
  const live = tenantClinicIds.filter((id) => scoped.has(id));
  return buildScope(live, false);
}

function buildScope(clinicIds: string[], everyBranch: boolean): BranchScope {
  const set = new Set(clinicIds);
  return {
    clinicIds,
    everyBranch,
    filter: everyBranch ? {} : { clinicId: { in: clinicIds } },
    staffFilter: everyBranch ? {} : { staff: { clinicId: { in: clinicIds } } },
    assert(requested) {
      if (requested === null || requested === undefined || requested === '') return null;
      if (everyBranch || set.has(requested)) return requested;
      throw new ForbiddenException(SCOPE_REFUSAL);
    },
    where(requested) {
      const resolved = this.assert(requested);
      if (resolved) return { clinicId: resolved };
      return everyBranch ? {} : { clinicId: { in: clinicIds } };
    },
    sqlClinicIds(requested) {
      const resolved = this.assert(requested);
      if (resolved) return [resolved];
      return everyBranch ? null : clinicIds;
    },
    require(requested) {
      const resolved = this.assert(requested);
      if (resolved) return resolved;
      // Nothing requested. One branch in scope settles it; more than one is a
      // genuine ambiguity the caller has to resolve, and guessing "the first
      // clinic in the tenant" would post one branch's cash into another's.
      if (clinicIds.length === 1) return clinicIds[0];
      if (clinicIds.length === 0) throw new ForbiddenException(NO_BRANCH_REFUSAL);
      throw new NotFoundException('No branch selected for this request.');
    },
  };
}

/**
 * THE BRANCH CLAUSE FOR A RAW QUERY.
 *
 * `AND "<alias>"."clinic_id" = ANY(...)`, or nothing at all when the account
 * is genuinely tenant-wide. Lives here rather than beside any one caller
 * because "which branches may this read see" has to have exactly one answer:
 * a second copy of this fragment is how two screens end up disagreeing about
 * whose money they are showing.
 */
export function branchClause(scope: BranchScope, requested: string | null | undefined, alias: string): Prisma.Sql {
  const ids = scope.sqlClinicIds(requested);
  if (ids === null) return Prisma.empty;
  return Prisma.sql`AND ${Prisma.raw(`"${alias}"`)}."clinic_id" = ANY(${ids})`;
}

/**
 * The database-backed source. `tx` is any Prisma client already inside the
 * tenant context, so RLS bounds both reads.
 */
export function prismaScopeSource(tx: Prisma.TransactionClient): ScopeSource {
  return {
    async clinicIds() {
      const rows = await tx.clinic.findMany({
        where: { tenantId: currentTenantId() },
        select: { id: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((row) => row.id);
    },
    async grantedClinicIds(userId: string) {
      const rows = await tx.userClinicAccess.findMany({ where: { userId }, select: { clinicId: true } });
      return rows.map((row) => row.clinicId);
    },
  };
}
