import { NotFoundException } from '@nestjs/common';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    visit: { count: jest.fn(), create: jest.fn() },
    panelClinic: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new VisitService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('VisitService', () => {
  describe('create', () => {
    it('derives billingType from the panel name when panelClinicId is given', async () => {
      const { service, prisma } = createService();
      (prisma.visit.count as jest.Mock).mockResolvedValue(0);
      (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({ id: 'panel-1', name: 'AIA' });
      (prisma.visit.create as jest.Mock).mockResolvedValue({ id: 'visit-1' });

      await withTenant(() =>
        service.create({
          clinicId: 'clinic-1',
          patientId: 'patient-1',
          staffId: 'staff-1',
          billingType: 'ignored client text',
          panelClinicId: 'panel-1',
        }),
      );

      expect(prisma.visit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ billingType: 'AIA', panelClinicId: 'panel-1' }),
      });
    });

    it('throws NotFoundException for an unknown panelClinicId', async () => {
      const { service, prisma } = createService();
      (prisma.visit.count as jest.Mock).mockResolvedValue(0);
      (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        withTenant(() =>
          service.create({
            clinicId: 'clinic-1',
            patientId: 'patient-1',
            staffId: 'staff-1',
            billingType: 'Self-pay',
            panelClinicId: 'missing',
          }),
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('uses the client-supplied billingType when no panelClinicId is given (cash visit)', async () => {
      const { service, prisma } = createService();
      (prisma.visit.count as jest.Mock).mockResolvedValue(0);
      (prisma.visit.create as jest.Mock).mockResolvedValue({ id: 'visit-1' });

      await withTenant(() =>
        service.create({
          clinicId: 'clinic-1',
          patientId: 'patient-1',
          staffId: 'staff-1',
          billingType: 'Self-pay',
        }),
      );

      expect(prisma.panelClinic.findUnique).not.toHaveBeenCalled();
      expect(prisma.visit.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ billingType: 'Self-pay', panelClinicId: undefined }),
      });
    });
  });
});
