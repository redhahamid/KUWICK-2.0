import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { StaffService } from './staff.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

jest.mock('bcryptjs');

function createService() {
  const prisma = {
    staff: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      create: jest.fn(),
    },
    staffProfessionalAudit: {
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
    // Final-UAT — assertMayManageUsers reads the actor's capability roles.
    staffRoleAssignment: { findMany: jest.fn().mockResolvedValue([]) },
  } as unknown as TenantScopedPrismaClient;
  return { service: new StaffService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

function asStaff<T>(staffId: string, fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId }, fn);
}

describe('StaffService', () => {
  it('create with no login fields creates a bare Staff record', async () => {
    const { service, prisma } = createService();
    (prisma.staff.create as jest.Mock).mockResolvedValue({ id: 'staff-1' });
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff-owner', role: Role.OWNER_ADMIN, active: true });

    await asStaff('staff-owner', () => service.create({ role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Nurse Amy' }));

    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.staff.create).toHaveBeenCalledWith({
      data: { role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Nurse Amy', tenantId: 'test-tenant' },
    });
  });

  it('create with login fields hashes the password and links the new User to the Staff record', async () => {
    const { service, prisma } = createService();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (prisma.user.create as jest.Mock).mockResolvedValue({ id: 'user-1' });
    (prisma.staff.create as jest.Mock).mockResolvedValue({ id: 'staff-1', userId: 'user-1' });
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff-owner', role: Role.OWNER_ADMIN, active: true });

    await asStaff('staff-owner', () =>
      service.create({
        role: Role.DOCTOR_RESIDENT,
        fullName: 'Dr. Amira Rahman',
        loginEmail: 'amira@clinic.test',
        loginPassword: 'S3curePass!',
      }),
    );

    expect(bcrypt.hash).toHaveBeenCalledWith('S3curePass!', 10);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { tenantId: 'test-tenant', email: 'amira@clinic.test', passwordHash: 'hashed-password' },
    });
    expect(prisma.staff.create).toHaveBeenCalledWith({
      data: { role: Role.DOCTOR_RESIDENT, fullName: 'Dr. Amira Rahman', userId: 'user-1', tenantId: 'test-tenant' },
    });
  });

  it('create throws ConflictException when the login email is already used in this tenant', async () => {
    const { service, prisma } = createService();
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
    (prisma.user.create as jest.Mock).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff-owner', role: Role.OWNER_ADMIN, active: true });

    await expect(
      asStaff('staff-owner', () =>
        service.create({
          role: Role.FRONT_DESK_CLINICAL_STAFF,
          fullName: 'Nurse Amy',
          loginEmail: 'dupe@clinic.test',
          loginPassword: 'S3curePass!',
        }),
      ),
    ).rejects.toThrow(ConflictException);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it('FINAL-UAT: a non-owner cannot create staff accounts any more — the ungated hole is closed', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ id: 'staff-fd', role: Role.FRONT_DESK_CLINICAL_STAFF, active: true });
    await expect(
      asStaff('staff-fd', () => service.create({ role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Self Made' })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.staff.create).not.toHaveBeenCalled();
  });

  it('findById throws NotFoundException when the staff record does not exist', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });

  it('isActiveDoctor is true for an active resident doctor', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      active: true,
      role: Role.DOCTOR_RESIDENT,
    });
    await expect(service.isActiveDoctor('1')).resolves.toBe(true);
  });

  it('isActiveDoctor is false for an inactive doctor', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      active: false,
      role: Role.DOCTOR_LOCUM,
    });
    await expect(service.isActiveDoctor('1')).resolves.toBe(false);
  });

  it('isActiveDoctor is false for a non-doctor role', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({
      id: '1',
      active: true,
      role: Role.FRONT_DESK_CLINICAL_STAFF,
    });
    await expect(service.isActiveDoctor('1')).resolves.toBe(false);
  });

  it('assertActiveDoctor throws when the staff id does not resolve to an active doctor', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(service.assertActiveDoctor('missing')).rejects.toThrow(NotFoundException);
  });
});

// C0 closure (D-051) — professional identity and clinical-signing permission
// decide who may electronically sign a clinical note, so changing them is
// both permission-gated and audited. `updatedAt` alone cannot answer "who
// granted this doctor the right to sign, and when".
describe('StaffService — professional identity permission + audit (C0 closure)', () => {
  const OWNER = { id: 'staff-owner', role: Role.OWNER_ADMIN, active: true, fullName: 'Encik Pemilik' };
  const DOCTOR = { id: 'staff-doctor', role: Role.DOCTOR_RESIDENT, active: true, fullName: 'Dr Faizal' };

  const subjectBefore = {
    id: 'staff-doctor',
    clinicId: 'clinic-1',
    professionalType: 'NON_CLINICAL',
    medicalRegistrationNo: null,
    professionalActive: false,
    canSignClinicalNotes: false,
    professionalVerifiedAt: null,
    professionalVerifiedByStaffId: null,
    clinicalSigningEnabledAt: null,
    clinicalSigningEnabledByStaffId: null,
  };

  it('refuses a non-owner trying to grant themselves signing permission', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(where.id === 'staff-doctor' ? { ...subjectBefore, ...DOCTOR } : null),
    );

    await expect(
      asStaff('staff-doctor', () => service.update('staff-doctor', { canSignClinicalNotes: true })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated session', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockResolvedValue({ ...subjectBefore, ...DOCTOR });

    await expect(
      withTenant(() => service.update('staff-doctor', { professionalActive: true })),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.staff.update).not.toHaveBeenCalled();
  });

  it('lets an owner enable signing, stamping verification server-side and auditing every field', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(
        where.id === 'staff-owner' ? OWNER : { ...subjectBefore, ...DOCTOR },
      ),
    );
    (prisma.staff.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...subjectBefore, ...DOCTOR, ...data }),
    );

    await asStaff('staff-owner', () =>
      service.update('staff-doctor', {
        professionalType: 'MEDICAL_DOCTOR',
        medicalRegistrationNo: 'MMC 12345',
        professionalActive: true,
        canSignClinicalNotes: true,
        professionalChangeReason: 'Sighted original MMC certificate',
      }),
    );

    // The verification timestamp/actor are derived server-side, never taken
    // from the client.
    const written = (prisma.staff.update as jest.Mock).mock.calls[0][0].data;
    expect(written.professionalVerifiedByStaffId).toBe('staff-owner');
    expect(written.professionalVerifiedAt).toBeInstanceOf(Date);
    expect(written.clinicalSigningEnabledByStaffId).toBe('staff-owner');
    expect(written.medicalRegistrationNoNormalised).toBe('MMC12345');
    // The free-text reason is audit metadata, not a Staff column.
    expect(written.professionalChangeReason).toBeUndefined();

    const rows = (prisma.staffProfessionalAudit.createMany as jest.Mock).mock.calls[0][0].data;
    const byField = Object.fromEntries(rows.map((r: { field: string }) => [r.field, r]));
    expect(byField.PROFESSIONAL_TYPE).toMatchObject({ previousValue: 'NON_CLINICAL', newValue: 'MEDICAL_DOCTOR' });
    expect(byField.CAN_SIGN_CLINICAL_NOTES).toMatchObject({ previousValue: 'false', newValue: 'true' });
    expect(byField.MEDICAL_REGISTRATION_NO).toMatchObject({ previousValue: null, newValue: 'MMC 12345' });
    // Derived fields are audited too, so the verification trail is complete.
    expect(byField.PROFESSIONAL_VERIFIED_BY.newValue).toBe('staff-owner');
    expect(byField.CLINICAL_SIGNING_ENABLED_AT.newValue).toEqual(expect.any(String));
    // Every row carries actor, branch context and the reason.
    for (const row of rows) {
      expect(row.changedByStaffId).toBe('staff-owner');
      expect(row.changedByNameSnapshot).toBe('Encik Pemilik');
      expect(row.changedByRoleSnapshot).toBe(Role.OWNER_ADMIN);
      expect(row.clinicId).toBe('clinic-1');
      expect(row.tenantId).toBe('test-tenant');
      expect(row.reason).toBe('Sighted original MMC certificate');
    }
  });

  it('clears verification and signing timestamps when the flags are turned off, and audits that too', async () => {
    const { service, prisma } = createService();
    const enabled = {
      ...subjectBefore,
      ...DOCTOR,
      professionalType: 'MEDICAL_DOCTOR',
      medicalRegistrationNo: 'MMC12345',
      professionalActive: true,
      canSignClinicalNotes: true,
      professionalVerifiedAt: new Date('2026-01-01'),
      professionalVerifiedByStaffId: 'staff-owner',
      clinicalSigningEnabledAt: new Date('2026-01-01'),
      clinicalSigningEnabledByStaffId: 'staff-owner',
    };
    (prisma.staff.findUnique as jest.Mock).mockImplementation(({ where }) =>
      Promise.resolve(where.id === 'staff-owner' ? OWNER : enabled),
    );
    (prisma.staff.update as jest.Mock).mockImplementation(({ data }) => Promise.resolve({ ...enabled, ...data }));

    await asStaff('staff-owner', () =>
      service.update('staff-doctor', { canSignClinicalNotes: false, professionalChangeReason: 'Locum contract ended' }),
    );

    const written = (prisma.staff.update as jest.Mock).mock.calls[0][0].data;
    // No stale "signing enabled at" left behind a disabled flag.
    expect(written.clinicalSigningEnabledAt).toBeNull();
    expect(written.clinicalSigningEnabledByStaffId).toBeNull();

    const rows = (prisma.staffProfessionalAudit.createMany as jest.Mock).mock.calls[0][0].data;
    const byField = Object.fromEntries(rows.map((r: { field: string }) => [r.field, r]));
    expect(byField.CAN_SIGN_CLINICAL_NOTES).toMatchObject({ previousValue: 'true', newValue: 'false' });
    expect(byField.CLINICAL_SIGNING_ENABLED_AT.newValue).toBeNull();
  });

  it('writes no audit rows when a non-professional field changes', async () => {
    const { service, prisma } = createService();
    (prisma.staff.findUnique as jest.Mock).mockImplementation(({ where }: { where: { id: string } }) =>
      Promise.resolve(where.id === 'staff-owner' ? OWNER : { ...subjectBefore, ...DOCTOR }),
    );
    (prisma.staff.update as jest.Mock).mockImplementation(({ data }) =>
      Promise.resolve({ ...subjectBefore, ...DOCTOR, ...data }),
    );

    await asStaff('staff-owner', () => service.update('staff-doctor', { staffNumber: 'S-99' }));

    expect(prisma.staffProfessionalAudit.createMany).not.toHaveBeenCalled();
  });
});
