import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  NO_BRANCH_REFUSAL,
  SCOPE_REFUSAL,
  ScopeActor,
  ScopeSource,
  branchClause,
  resolveBranchScope,
} from './branch-scope';

const A = 'clinic-a';
const B = 'clinic-b';
const C = 'clinic-c';

const actor = (over: Partial<ScopeActor> = {}): ScopeActor => ({
  id: 'staff-1',
  active: true,
  clinicId: null,
  userId: 'user-1',
  assignedRoles: [],
  directGrants: [],
  ...over,
});

const source = (tenant: string[], granted: string[] = []): ScopeSource => ({
  clinicIds: async () => tenant,
  grantedClinicIds: async () => granted,
});

/** Nobody holds anything unless a test says so. */
const holdsNothing = () => false;
const isAccountHolder = (permission: string) => permission === 'settings.manage';

describe('an account holder administers every branch', () => {
  it('resolves tenant-wide and filters nothing', async () => {
    const scope = await resolveBranchScope(actor(), source([A, B, C]), isAccountHolder as never);
    expect(scope.everyBranch).toBe(true);
    expect(scope.clinicIds).toEqual([A, B, C]);
    // Tenant-wide filters to {} — RLS already bounds the query to the tenant,
    // and an `in` of every branch would go stale the day one is added.
    expect(scope.filter).toEqual({});
    expect(scope.assert(B)).toBe(B);
  });
});

/*
 * THE HOLE THIS MODULE CLOSES.
 *
 * A staff member scoped to branch A could append ?clinicId=<branch B> and the
 * admin services passed it straight into Prisma. `requirePermission`
 * authorised the ACTION; nothing authorised the BRANCH.
 */
describe('a branch-scoped account cannot reach another branch', () => {
  it('REFUSES a branch it was not given, rather than filtering it away silently', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(scope.everyBranch).toBe(false);
    expect(scope.clinicIds).toEqual([A]);
    expect(() => scope.assert(B)).toThrow(ForbiddenException);
    expect(() => scope.assert(B)).toThrow(SCOPE_REFUSAL);
  });

  it('allows its own branch', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(scope.assert(A)).toBe(A);
  });

  it('filters reads to its own branches when no branch is named', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(scope.assert(undefined)).toBeNull();
    expect(scope.filter).toEqual({ clinicId: { in: [A] } });
  });
});

/*
 * A NULL HOME BRANCH USED TO MEAN TWO OPPOSITE THINGS — "the whole tenant" in
 * about fifteen admin files, "nothing at all" in six clinical ones. It now
 * means neither: tenant-wide access comes from a permission somebody was
 * granted, and everything else is an explicit grant.
 */
describe('a null home branch grants nothing by itself', () => {
  it('resolves to an empty scope in a multi-branch tenant', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A, B]), holdsNothing);
    expect(scope.clinicIds).toEqual([]);
    expect(scope.everyBranch).toBe(false);
  });

  it('matches NO rows rather than every row', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A, B]), holdsNothing);
    // The dangerous shape would be `{}`, which reads as "no filter" and hands
    // back the whole tenant. An empty scope must return nothing.
    expect(scope.filter).toEqual({ clinicId: { in: [] } });
    expect(scope.staffFilter).toEqual({ staff: { clinicId: { in: [] } } });
  });

  it('refuses any branch it is asked for', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A, B]), holdsNothing);
    expect(() => scope.assert(A)).toThrow(ForbiddenException);
  });
});

describe('explicit per-branch grants', () => {
  it('reads UserClinicAccess, which no admin service used to consult', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B, C], [C]), holdsNothing);
    expect(scope.clinicIds.sort()).toEqual([A, C]);
    expect(scope.assert(C)).toBe(C);
    // The point of the whole exercise: A and C, not B.
    expect(() => scope.assert(B)).toThrow(ForbiddenException);
  });

  it('ignores a grant for a branch that no longer exists', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B], ['deleted-branch']), holdsNothing);
    expect(scope.clinicIds).toEqual([A]);
  });

  it('cannot be widened by an account with no user record', async () => {
    const scope = await resolveBranchScope(
      actor({ clinicId: null, userId: null }),
      source([A, B], [A, B]),
      holdsNothing,
    );
    expect(scope.clinicIds).toEqual([]);
  });
});

describe('a single-branch tenant has nothing to disambiguate', () => {
  it('admits an account with no home branch, because there is no second branch to keep it out of', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A]), holdsNothing);
    expect(scope.everyBranch).toBe(true);
    expect(scope.assert(A)).toBe(A);
  });
});

describe('an inactive account administers nothing', () => {
  it('is denied even holding settings.manage', async () => {
    const scope = await resolveBranchScope(
      actor({ active: false, clinicId: A }),
      source([A, B]),
      isAccountHolder as never,
    );
    expect(scope.clinicIds).toEqual([]);
    expect(scope.everyBranch).toBe(false);
    expect(() => scope.assert(A)).toThrow(ForbiddenException);
  });
});

describe('require() — an operation that must name one branch', () => {
  it('settles it when the actor has exactly one', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(scope.require(undefined)).toBe(A);
  });

  it('refuses to guess when the actor has several', async () => {
    const scope = await resolveBranchScope(actor(), source([A, B, C]), isAccountHolder as never);
    // Picking "the first clinic in the tenant" would post one branch's cash
    // into another's drawer.
    expect(() => scope.require(undefined)).toThrow(NotFoundException);
  });

  it('says so plainly when the actor has none', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A, B]), holdsNothing);
    expect(() => scope.require(undefined)).toThrow(NO_BRANCH_REFUSAL);
  });

  it('still refuses a branch outside the scope', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(() => scope.require(B)).toThrow(ForbiddenException);
  });
});

/*
 * THE RAW-SQL HALF OF THE SAME RULE.
 *
 * `branchClause` used to live beside one caller in Stock. It is here now
 * because a second copy of "which branches may this read see" is how two
 * screens end up disagreeing about whose money they are showing — and Finance
 * needed it the day its unclosed-days list stopped demanding a single branch.
 */
describe('branchClause() — the same scope, in a raw query', () => {
  it('adds nothing for a genuinely tenant-wide account; RLS already bounds it', async () => {
    const scope = await resolveBranchScope(actor(), source([A, B, C]), isAccountHolder as never);
    expect(branchClause(scope, undefined, 'p')).toBe(Prisma.empty);
  });

  it('narrows to the branches the account holds when none is named', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(branchClause(scope, undefined, 'p').values).toEqual([[A]]);
  });

  it('narrows to the ONE branch that was named', async () => {
    const scope = await resolveBranchScope(actor(), source([A, B, C]), isAccountHolder as never);
    expect(branchClause(scope, B, 'p').values).toEqual([[B]]);
  });

  it('REFUSES a branch outside the scope rather than filtering it away', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: A }), source([A, B]), holdsNothing);
    expect(() => branchClause(scope, B, 'p')).toThrow(SCOPE_REFUSAL);
  });

  it('matches nothing for an account holding no branch, so a caller must refuse first', async () => {
    const scope = await resolveBranchScope(actor({ clinicId: null }), source([A, B]), holdsNothing);
    // An empty ANY() is a query that returns nothing — which reads as "no
    // open days" rather than "you are not authorised". `DayEndService`
    // refuses on `clinicIds.length === 0` before it ever gets here.
    expect(branchClause(scope, undefined, 'p').values).toEqual([[]]);
  });
});
