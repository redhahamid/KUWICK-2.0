import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { PrismaService } from '../core/prisma.service';
import {
  CUSTOM_ROLE_GRANTABLE,
  INDIVIDUALLY_GRANTABLE,
  Permission,
  assertCan,
  canHoldDoctorRole,
  isCustomRoleGrantable,
  isIndividuallyGrantable,
  permissionPayload,
  wouldRemoveLastOwner,
} from '../core/permissions';
import { requireActor, withTenantTx } from '../clinical/clinical-actor';

const SYSTEM_ROLES: SystemRole[] = ['DOCTOR', 'CLINICAL_STAFF', 'ADMINISTRATOR', 'OWNER'];

/**
 * FINAL-UAT — ROLE MANAGEMENT, at last with a write path.
 *
 * The audit's headline: multi-role per person and per-person grants already
 * existed end-to-end in the data model and the policy engine — what was
 * missing was any endpoint to manage them (the only writer was a seed
 * script). This service is that write path, gated on `users.manage`, and it
 * enforces the three standing rules the policy module already defined but
 * nothing called:
 *
 * - a tenant is never left without an OWNER (wouldRemoveLastOwner);
 * - DOCTOR is never assigned to somebody with no professional identity
 *   (canHoldDoctorRole);
 * - custom roles carry only CUSTOM_ROLE_GRANTABLE permissions — nothing
 *   clinical, nothing owner-tier.
 *
 * RLS is untouched by all of this: no policy reads role, and the one new
 * table carries the standard tenant-isolation triple.
 */
@Injectable()
export class RoleAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** Everything the access drawer shows for one staff member. */
  accessOf(staffId: string) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);

      const staff = await tx.staff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff member not found');

      const assignments = await tx.staffRoleAssignment.findMany({
        where: { staffId },
        select: {
          role: true,
          customRole: { select: { id: true, name: true, permissions: true } },
          assignedAt: true,
          assignedBy: { select: { fullName: true } },
        },
      });
      const grants = await tx.staffPermissionGrant.findMany({
        where: { staffId },
        select: {
          permission: true,
          reason: true,
          grantedAt: true,
          grantedBy: { select: { fullName: true } },
        },
      });

      const roles = assignments
        .map((row) => row.role)
        .filter((role): role is SystemRole => role !== null);
      const customRoles = assignments
        .map((row) => row.customRole)
        .filter((role): role is NonNullable<typeof role> => Boolean(role));
      const extra: Permission[] = [
        ...grants.map((row) => row.permission).filter(isIndividuallyGrantable),
        ...customRoles.flatMap((role) => role.permissions).filter(isCustomRoleGrantable),
      ];

      return {
        staffId,
        fullName: staff.fullName,
        legacyRole: staff.role,
        canHoldDoctorRole: canHoldDoctorRole(staff),
        roles,
        customRoles: customRoles.map((role) => ({ id: role.id, name: role.name })),
        grants,
        effectivePermissions: permissionPayload(staff, roles, extra),
        individuallyGrantable: INDIVIDUALLY_GRANTABLE,
      };
    });
  }

  /**
   * Replace this person's role set — built-in and custom together, so the
   * drawer's Save is one atomic statement of "what this person holds now".
   */
  setRoles(staffId: string, input: { roles: SystemRole[]; customRoleIds: string[] }) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      const roles = [...new Set(input.roles)];
      const customRoleIds = [...new Set(input.customRoleIds)];
      for (const role of roles) {
        if (!SYSTEM_ROLES.includes(role)) {
          throw new BadRequestException(`Unknown role: ${role}`);
        }
      }

      const staff = await tx.staff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff member not found');

      if (roles.includes('DOCTOR') && !canHoldDoctorRole(staff)) {
        throw new BadRequestException(
          'DOCTOR needs a professional identity: record a medical registration number on the staff profile first.',
        );
      }

      // The owner floor. Owners = everyone explicitly assigned OWNER, plus
      // legacy OWNER_ADMINs still on the fallback (no explicit assignments):
      // removing the only person in that set locks the whole tenant out of
      // the screen that would put an owner back.
      const explicitOwners = await tx.staffRoleAssignment.findMany({
        where: { role: 'OWNER', staff: { active: true } },
        select: { staffId: true },
      });
      const explicitlyAssigned = await tx.staffRoleAssignment.groupBy({
        by: ['staffId'],
        _count: true,
      });
      const assignedIds = new Set(explicitlyAssigned.map((row) => row.staffId));
      const fallbackOwners = await tx.staff.findMany({
        where: { role: 'OWNER_ADMIN', active: true },
        select: { id: true },
      });
      const ownerIds = new Set(explicitOwners.map((row) => row.staffId));
      for (const row of fallbackOwners) {
        if (!assignedIds.has(row.id)) ownerIds.add(row.id);
      }
      if (
        wouldRemoveLastOwner({
          currentOwnerStaffIds: [...ownerIds],
          staffId,
          rolesAfter: roles,
        })
      ) {
        throw new ConflictException(
          'This is the last owner account. Assign OWNER to somebody else before removing it here.',
        );
      }

      const wanted = await tx.clinicCustomRole.findMany({
        where: { id: { in: customRoleIds } },
        select: { id: true },
      });
      if (wanted.length !== customRoleIds.length) {
        throw new NotFoundException('One of those custom roles no longer exists.');
      }

      // Replace, atomically: the row set after this transaction IS the answer
      // to "what does this person hold".
      await tx.staffRoleAssignment.deleteMany({ where: { staffId } });
      if (roles.length > 0 || customRoleIds.length > 0) {
        await tx.staffRoleAssignment.createMany({
          data: [
            ...roles.map((role) => ({
              tenantId: actor.tenantId,
              staffId,
              role,
              assignedByStaffId: actor.id,
            })),
            ...customRoleIds.map((customRoleId) => ({
              tenantId: actor.tenantId,
              staffId,
              customRoleId,
              assignedByStaffId: actor.id,
            })),
          ],
        });
      }
      return { staffId, roles, customRoleIds };
    });
  }

  /** Additive-only, closed-list, with a reason — the Task 1 contract. */
  grant(staffId: string, input: { permission: string; reason: string }) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      if (!isIndividuallyGrantable(input.permission)) {
        throw new BadRequestException(
          'That permission cannot be granted to one person. Use a role instead.',
        );
      }
      if (!input.reason || input.reason.trim().length < 3) {
        throw new BadRequestException('Say why this person specifically — the audit reads it.');
      }
      const staff = await tx.staff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundException('Staff member not found');
      return tx.staffPermissionGrant.upsert({
        where: { staffId_permission: { staffId, permission: input.permission } },
        create: {
          tenantId: actor.tenantId,
          staffId,
          permission: input.permission,
          reason: input.reason.trim(),
          grantedByStaffId: actor.id,
        },
        update: { reason: input.reason.trim() },
      });
    });
  }

  // ---- custom roles -------------------------------------------------------

  listCustomRoles() {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      return tx.clinicCustomRole.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { assignments: true } } },
      });
    });
  }

  private validateCustomPermissions(permissions: string[]): Permission[] {
    const cleaned = [...new Set(permissions)];
    for (const permission of cleaned) {
      if (!isCustomRoleGrantable(permission)) {
        throw new BadRequestException(
          `A custom role cannot carry "${permission}". Clinical authority comes only from the Doctor and Clinical staff roles, and owner powers stay with Owner.`,
        );
      }
    }
    return cleaned as Permission[];
  }

  createCustomRole(input: { name: string; description?: string; permissions: string[] }) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      const name = input.name?.trim();
      if (!name) throw new BadRequestException('Give the role a name.');
      const permissions = this.validateCustomPermissions(input.permissions ?? []);
      const clash = await tx.clinicCustomRole.findFirst({ where: { name } });
      if (clash) throw new ConflictException(`A role named "${name}" already exists.`);
      return tx.clinicCustomRole.create({
        data: {
          tenantId: actor.tenantId,
          name,
          description: input.description?.trim() || null,
          permissions,
          createdByStaffId: actor.id,
        },
      });
    });
  }

  updateCustomRole(
    id: string,
    input: { name?: string; description?: string; permissions?: string[] },
  ) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      const permissions =
        input.permissions !== undefined
          ? this.validateCustomPermissions(input.permissions)
          : undefined;
      const existing = await tx.clinicCustomRole.findUnique({ where: { id } });
      if (!existing) throw new NotFoundException('Custom role not found');
      return tx.clinicCustomRole.update({
        where: { id },
        data: {
          name: input.name?.trim() || undefined,
          description: input.description !== undefined ? input.description.trim() || null : undefined,
          permissions,
        },
      });
    });
  }

  deleteCustomRole(id: string) {
    return withTenantTx(this.prisma, async (tx) => {
      const actor = await requireActor(tx);
      assertCan(actor, 'users.manage', actor.assignedRoles, actor.directGrants);
      const existing = await tx.clinicCustomRole.findUnique({
        where: { id },
        include: { _count: { select: { assignments: true } } },
      });
      if (!existing) throw new NotFoundException('Custom role not found');
      // The FK cascades assignment rows away with the role — said out loud
      // rather than silently: deleting a role IS un-assigning it everywhere.
      await tx.clinicCustomRole.delete({ where: { id } });
      return { deleted: true, unassignedFrom: existing._count.assignments };
    });
  }

  /** The catalogue the role editor renders — served, never hardcoded twice. */
  customRolePermissionCatalogue() {
    return { permissions: CUSTOM_ROLE_GRANTABLE };
  }
}
