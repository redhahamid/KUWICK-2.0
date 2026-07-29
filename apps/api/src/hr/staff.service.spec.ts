import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';
import { StaffService } from './staff.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

function createService() {
  const prisma = {
    staff: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  } as unknown as TenantScopedPrismaClient;
  return { service: new StaffService(prisma), prisma };
}

describe('StaffService', () => {
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
