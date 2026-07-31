import { NotFoundException } from '@nestjs/common';
import { DocumentType } from '@prisma/client';
import { DocumentService } from './document.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    document: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), delete: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;
  return { service: new DocumentService(prisma, visits), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('DocumentService', () => {
  it('create defaults issuedByStaffId to the visit doctor when not given', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', type: DocumentType.MC, content: '3 days rest' }));

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        type: DocumentType.MC,
        content: '3 days rest',
        issuedByStaffId: 'staff-1',
        issuedDate: undefined,
        startDate: undefined,
        endDate: undefined,
        diagnosisText: undefined,
        referredTo: undefined,
      },
    });
  });

  it('create uses an explicitly chosen issuedByStaffId (locum coverage) over the visit doctor', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-1' });
    (prisma.document.create as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await withTenant(() =>
      service.create({
        visitId: 'visit-1',
        type: DocumentType.MC,
        content: 'template text',
        issuedByStaffId: 'locum-staff-2',
        issuedDate: '2026-07-31',
        startDate: '2026-07-31',
        endDate: '2026-08-01',
        diagnosisText: 'Upper respiratory tract infection',
      }),
    );

    expect(prisma.document.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuedByStaffId: 'locum-staff-2',
        issuedDate: new Date('2026-07-31'),
        startDate: new Date('2026-07-31'),
        endDate: new Date('2026-08-01'),
        diagnosisText: 'Upper respiratory tract infection',
      }),
    });
  });

  it('findByVisitId orders by createdAt descending', async () => {
    const { service, prisma } = createService();
    (prisma.document.findMany as jest.Mock).mockResolvedValue([]);

    await service.findByVisitId('visit-1');

    expect(prisma.document.findMany).toHaveBeenCalledWith({
      where: { visitId: 'visit-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('remove throws NotFoundException for an unknown document', async () => {
    const { service, prisma } = createService();
    (prisma.document.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.remove('missing')).rejects.toThrow(NotFoundException);
  });

  it('remove deletes an existing document', async () => {
    const { service, prisma } = createService();
    (prisma.document.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await service.remove('doc-1');

    expect(prisma.document.delete).toHaveBeenCalledWith({ where: { id: 'doc-1' } });
  });

  it('sign throws NotFoundException for an unknown document', async () => {
    const { service, prisma } = createService();
    (prisma.document.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.sign('missing', { staffId: 'staff-1' })).rejects.toThrow(NotFoundException);
  });

  it('sign records signedAt/signedByStaffId', async () => {
    const { service, prisma } = createService();
    (prisma.document.findUnique as jest.Mock).mockResolvedValue({ id: 'doc-1' });
    (prisma.document.update as jest.Mock).mockResolvedValue({ id: 'doc-1' });

    await service.sign('doc-1', { staffId: 'dispensary-staff' });

    expect(prisma.document.update).toHaveBeenCalledWith({
      where: { id: 'doc-1' },
      data: { signedAt: expect.any(Date), signedByStaffId: 'dispensary-staff' },
    });
  });
});
