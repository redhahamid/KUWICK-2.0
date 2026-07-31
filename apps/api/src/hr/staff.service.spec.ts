import { ConflictException, NotFoundException } from '@nestjs/common';
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
  } as unknown as TenantScopedPrismaClient;
  return { service: new StaffService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('StaffService', () => {
  it('create with no login fields creates a bare Staff record', async () => {
    const { service, prisma } = createService();
    (prisma.staff.create as jest.Mock).mockResolvedValue({ id: 'staff-1' });

    await withTenant(() => service.create({ role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Nurse Amy' }));

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

    await withTenant(() =>
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

    await expect(
      withTenant(() =>
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
