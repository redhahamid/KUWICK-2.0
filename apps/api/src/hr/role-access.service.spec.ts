import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { RoleAccessService } from './role-access.service';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import { CUSTOM_ROLE_GRANTABLE } from '../core/permissions';

// ===========================================================================
// FINAL-UAT — ROLE MANAGEMENT AT LAST HAS A WRITE PATH, AND IT KEEPS THE
// THREE STANDING RULES: only an owner manages access, a tenant is never left
// ownerless, and DOCTOR needs a doctor. Custom roles get the fourth rule:
// nothing clinical, nothing owner-tier — a named bundle must never mint a
// doctor or an owner.
// ===========================================================================

type Actor = {
  id: string;
  tenantId: string;
  role: string;
  fullName: string;
  active: boolean;
  assigned: string[];
  medicalRegistrationNo?: string | null;
};

const owner: Actor = {
  id: 'staff-ow',
  tenantId: 't1',
  role: 'OWNER_ADMIN',
  fullName: 'Dr Redha',
  active: true,
  assigned: ['OWNER'],
};
const frontdesk: Actor = {
  id: 'staff-fd',
  tenantId: 't1',
  role: 'FRONT_DESK_CLINICAL_STAFF',
  fullName: 'Nurul',
  active: true,
  assigned: ['ADMINISTRATOR'],
};

function build(
  actor: Actor,
  world: {
    target?: Partial<Actor> & { id: string };
    explicitOwners?: string[];
    fallbackOwners?: string[];
    assignedStaffIds?: string[];
    customRoles?: { id: string }[];
    nameClash?: boolean;
  } = {},
) {
  const target = world.target ?? { id: 'staff-target', medicalRegistrationNo: null };
  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === actor.id ? actor : { active: true, fullName: 'Target', role: 'FRONT_DESK_CLINICAL_STAFF', ...target },
      ),
      findMany: jest.fn(async () => (world.fallbackOwners ?? []).map((id) => ({ id }))),
    },
    staffRoleAssignment: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.staffId === actor.id) return actor.assigned.map((role) => ({ role }));
        if (where.role === 'OWNER') return (world.explicitOwners ?? []).map((staffId) => ({ staffId }));
        return [];
      }),
      groupBy: jest.fn(async () => (world.assignedStaffIds ?? []).map((staffId) => ({ staffId }))),
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    staffPermissionGrant: {
      findMany: jest.fn(async ({ where }: { where: { staffId: string } }) =>
        where.staffId === actor.id ? [] : [],
      ),
      upsert: jest.fn(async ({ create }: { create: unknown }) => create),
    },
    clinicCustomRole: {
      findMany: jest.fn(async () => world.customRoles ?? []),
      findFirst: jest.fn(async () => (world.nameClash ? { id: 'existing' } : null)),
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: unknown }) => ({ id: 'role-new', ...(data as object) })),
    },
  };
  const prisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;
  return { service: new RoleAccessService(prisma), tx };
}

function asActor<T>(actor: Actor, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 't1', staffId: actor.id }, fn);
}

describe('only an owner manages access', () => {
  it('1. an administrator is refused with the owner sentence', async () => {
    const { service, tx } = build(frontdesk);
    await expect(
      asActor(frontdesk, () => service.setRoles('staff-target', { roles: ['ADMINISTRATOR'], customRoleIds: [] })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tx.staffRoleAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('2. the owner replaces the role set atomically, with attribution', async () => {
    const { service, tx } = build(owner, { explicitOwners: [owner.id] });
    await asActor(owner, () =>
      service.setRoles('staff-target', { roles: ['ADMINISTRATOR', 'CLINICAL_STAFF'], customRoleIds: [] }),
    );
    expect(tx.staffRoleAssignment.deleteMany).toHaveBeenCalledWith({ where: { staffId: 'staff-target' } });
    const created = tx.staffRoleAssignment.createMany.mock.calls[0][0].data;
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ assignedByStaffId: owner.id, tenantId: 't1' });
  });
});

describe('the standing rules hold', () => {
  it('3. DOCTOR is refused for somebody with no medical registration', async () => {
    const { service } = build(owner, {
      explicitOwners: [owner.id],
      target: { id: 'staff-target', medicalRegistrationNo: null },
    });
    await expect(
      asActor(owner, () => service.setRoles('staff-target', { roles: ['DOCTOR'], customRoleIds: [] })),
    ).rejects.toThrow(/professional identity/i);
  });

  it('4. removing the LAST owner is refused — the tenant must never be ownerless', async () => {
    const { service, tx } = build(owner, {
      explicitOwners: [owner.id],
      target: { id: owner.id },
    });
    await expect(
      asActor(owner, () => service.setRoles(owner.id, { roles: ['ADMINISTRATOR'], customRoleIds: [] })),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.staffRoleAssignment.deleteMany).not.toHaveBeenCalled();
  });

  it('5. an individual grant outside the closed list is refused; a real one lands with its reason', async () => {
    const { service, tx } = build(owner);
    await expect(
      asActor(owner, () => service.grant('staff-target', { permission: 'note.sign', reason: 'because' })),
    ).rejects.toBeInstanceOf(BadRequestException);
    await asActor(owner, () =>
      service.grant('staff-target', { permission: 'appointment.override', reason: 'Practice manager squeezes urgent cases in' }),
    );
    expect(tx.staffPermissionGrant.upsert).toHaveBeenCalled();
  });
});

describe('a custom role can never mint a doctor or an owner', () => {
  it('6. clinical and owner-tier permissions are refused BY NAME', async () => {
    const { service } = build(owner);
    for (const permission of ['note.write', 'prescription.write', 'users.manage', 'settings.manage']) {
      await expect(
        asActor(owner, () =>
          service.createCustomRole({ name: 'Sneaky', permissions: [permission] }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('7. an administrative bundle is accepted — the Branch Manager use-case', async () => {
    const { service, tx } = build(owner);
    await asActor(owner, () =>
      service.createCustomRole({
        name: 'Branch Manager',
        permissions: ['appointment.view', 'appointment.configure', 'appointment.manage_roster', 'billing.counter'],
      }),
    );
    expect(tx.clinicCustomRole.create).toHaveBeenCalled();
  });

  it('8. the closed list itself carries nothing clinical and nothing owner-tier', () => {
    for (const forbidden of [
      'note.write',
      'note.sign',
      'diagnosis.write',
      'prescription.write',
      'clinical.void',
      'consultation.complete',
      'patient.alert.medical.write',
      'users.manage',
      'settings.manage',
      'discount.approve',
    ]) {
      expect(CUSTOM_ROLE_GRANTABLE as string[]).not.toContain(forbidden);
    }
  });

  it('9. a duplicate role name is a sentence, not a 500', async () => {
    const { service } = build(owner, { nameClash: true });
    await expect(
      asActor(owner, () => service.createCustomRole({ name: 'Branch Manager', permissions: [] })),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
