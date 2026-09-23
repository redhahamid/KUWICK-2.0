import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Staff, SystemRole } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import { currentStaffId, currentTenantId } from '../core/tenant-context';
import { assertBranchAccess, canAuthorNarrative, type BranchAccessContext } from './clinical-authorization';
import { isCustomRoleGrantable, isIndividuallyGrantable, type Permission } from '../core/permissions';

export type ClinicalTx = Prisma.TransactionClient;

/**
 * TASK 1 — the acting staff member, WITH the capability roles they hold.
 *
 * The roles travel attached to the staff row rather than as a second argument
 * threaded through twenty call sites. Every authorisation predicate reads
 * them from here, so there is exactly one place that decides what somebody
 * may do and exactly one place that loads the input to that decision.
 *
 * `assignedRoles` empty means "none assigned yet", which the policy module
 * answers with the legacy role's mapping — so an account that predates the
 * roles table behaves precisely as it did before.
 */
export type ActingStaff = Staff & {
  assignedRoles: SystemRole[];
  /**
   * Permissions granted to THIS PERSON by name, outside any role.
   *
   * These were stored (`StaffPermissionGrant`, with a granter and a mandatory
   * reason) and read by nothing: `effectivePermissions` has always accepted a
   * `directGrants` argument and no caller passed one. So `INDIVIDUALLY_
   * GRANTABLE` — the list of capabilities an owner can hand to one named
   * person — was decorative, and a senior receptionist granted
   * `billing.corrections` still could not apply a discount.
   *
   * Loaded here for the same reason the roles are: one place decides what
   * somebody may do, and one place loads the input to that decision.
   */
  directGrants: Permission[];
};

/** Reads a staff member's capability roles. */
export async function loadAssignedRoles(
  db: { staffRoleAssignment?: { findMany(args: unknown): Promise<{ role: SystemRole | null }[]> } },
  staffId: string,
): Promise<SystemRole[]> {
  // Optional on purpose. A caller whose client cannot read the table — an
  // older code path, a narrow test double — gets an empty list, and empty
  // means "fall back to the legacy role's mapping", which is precisely the
  // behaviour that existed before capability roles. Failing open to the
  // PREVIOUS rules is safe; throwing here would take down every clinical
  // write for a lookup that is only ever an enrichment.
  if (!db.staffRoleAssignment) return [];
  const rows = await db.staffRoleAssignment.findMany({
    where: { staffId },
    select: { role: true },
  });
  // Null role = a custom-role assignment (final-UAT); its permissions ride
  // through loadCustomRolePermissions, not through the capability set.
  return rows.map((row) => row.role).filter((role): role is SystemRole => role !== null);
}

/**
 * FINAL-UAT — the permissions a staff member's CUSTOM roles carry.
 *
 * Filtered through `isCustomRoleGrantable` on the way out, exactly as direct
 * grants are filtered through their own closed list: the column is free
 * text, and a row naming a clinical or owner-tier permission must not become
 * one just because somebody wrote it into the table.
 */
export async function loadCustomRolePermissions(
  db: {
    staffRoleAssignment?: {
      findMany(args: unknown): Promise<{ customRole: { permissions: string[] } | null }[]>;
    };
  },
  staffId: string,
): Promise<Permission[]> {
  if (!db.staffRoleAssignment) return [];
  const rows = await db.staffRoleAssignment.findMany({
    where: { staffId, customRoleId: { not: null } },
    select: { customRole: { select: { permissions: true } } },
  });
  return rows
    .flatMap((row) => row.customRole?.permissions ?? [])
    .filter(isCustomRoleGrantable);
}

// G3a (D-062) — the actor/branch plumbing that C0's note service and G2a's
// diagnosis service each grew independently. Extracted here rather than
// copied a third and fourth time into the document and attachment services:
// four private copies of an authorisation rule is how one of them quietly
// drifts.

/**
 * Open a transaction with app.tenant_id set inside it, so a multi-write
 * clinical correction is atomic and still tenant-scoped.
 */
/**
 * How long a transaction may run. Prisma's default is five seconds, which
 * is plenty for a correction and not for working out a month of payroll:
 * that one crossed it on a cold API and a three-person branch, and the
 * month died with "Internal server error" and no way back. The heavy
 * callers say how long they need; everything else keeps the default.
 */
export type TenantTxOptions = { timeout?: number; maxWait?: number };

/**
 * The default budget for an ordinary write. Five seconds was Prisma's, and a
 * routine delete crossed it on a cold API in the test suite; a hosted
 * database in another region does not need a cold start to. Thirty seconds
 * still catches a transaction that has genuinely hung.
 */
const DEFAULT_TX: Required<TenantTxOptions> = { timeout: 30_000, maxWait: 10_000 };

export function withTenantTx<T>(
  prisma: PrismaService,
  fn: (tx: ClinicalTx) => Promise<T>,
  options: TenantTxOptions = {},
): Promise<T> {
  const tenantId = currentTenantId();
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return fn(tx);
    },
    { ...DEFAULT_TX, ...options },
  );
}

/**
 * G4.5d3c-2c (D-088) — a transaction that PostgreSQL will not let write.
 *
 * Status reads are supposed to be side-effect free, but "supposed to" is a
 * comment, and comments do not survive the next edit. `transaction_read_only`
 * is the same GUC `SET TRANSACTION READ ONLY` sets; with `is_local = true` it
 * lasts exactly as long as this transaction. Any INSERT, UPDATE or DELETE
 * issued inside the block — today's or one added in six months by someone
 * "just recording that the status was checked" — is refused by the server
 * with error 25006, so the freedom from side effects is enforced rather than
 * promised.
 *
 * Set through `set_config` rather than `SET`, matching the tenant line below:
 * a plain `SET` is a utility statement and does not survive being prepared,
 * which is how Prisma sends it.
 */
export function withReadOnlyTenantTx<T>(
  prisma: PrismaService,
  fn: (tx: ClinicalTx) => Promise<T>,
): Promise<T> {
  const tenantId = currentTenantId();
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
    await tx.$executeRaw`SELECT set_config('transaction_read_only', 'on', true)`;
    return fn(tx);
  });
}

/**
 * The acting staff member, from the verified JWT claim only — never from a
 * request body. Who performed a clinical correction must not be spoofable.
 */
export async function requireActor(tx: ClinicalTx): Promise<ActingStaff> {
  const staffId = currentStaffId();
  if (!staffId) {
    throw new ForbiddenException('No authenticated staff member on this session');
  }
  const staff = await tx.staff.findUnique({ where: { id: staffId } });
  if (!staff || !staff.active) {
    throw new ForbiddenException('Your staff account is inactive');
  }
  return {
    ...staff,
    assignedRoles: await loadAssignedRoles(tx as never, staff.id),
    // Direct grants and custom-role permissions travel the same channel:
    // both are person-specific additions the policy engine unions in, each
    // filtered through its own closed list at load.
    directGrants: [
      ...(await loadDirectGrants(tx as never, staff.id)),
      ...(await loadCustomRolePermissions(tx as never, staff.id)),
    ],
  };
}

/**
 * The permissions granted to this person by name.
 *
 * Filtered through `isIndividuallyGrantable` on the way out, deliberately: the
 * column is free text, and a row naming a permission an owner is not allowed
 * to hand out individually — `note.sign`, say — must not become one just
 * because somebody wrote it. The closed list is the policy; this table is only
 * a record of it being applied.
 */
export async function loadDirectGrants(
  db: { staffPermissionGrant?: { findMany(args: unknown): Promise<{ permission: string }[]> } },
  staffId: string,
): Promise<Permission[]> {
  // Same fail-to-previous-behaviour rule as `loadAssignedRoles`: a client that
  // cannot read the table yields none, and none is what every caller had
  // before this existed.
  if (!db.staffPermissionGrant) return [];
  const rows = await db.staffPermissionGrant.findMany({
    where: { staffId },
    select: { permission: true },
  });
  return rows.map((row) => row.permission).filter(isIndividuallyGrantable);
}

/** Anything with a tenant-scoped `staff.findUnique` — a tx or the scoped client. */
type StaffReader = {
  staff: { findUnique(args: { where: { id: string } }): Promise<Staff | null> };
  staffRoleAssignment: { findMany(args: unknown): Promise<{ role: SystemRole | null }[]> };
  staffPermissionGrant?: { findMany(args: unknown): Promise<{ permission: string }[]> };
};

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
export async function requireClinicalAuthor(db: StaffReader, action: string): Promise<ActingStaff> {
  const staffId = currentStaffId();
  if (!staffId) {
    throw new ForbiddenException('No authenticated staff member on this session');
  }
  const found = await db.staff.findUnique({ where: { id: staffId } });
  if (!found || !found.active) {
    throw new ForbiddenException('Your staff account is inactive');
  }
  const staff: ActingStaff = {
    ...found,
    assignedRoles: await loadAssignedRoles(db, found.id),
    directGrants: await loadDirectGrants(db, found.id),
  };
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
