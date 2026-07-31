import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoiceService } from './invoice.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    invoice: { count: jest.fn(), create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
    invoiceLine: { create: jest.fn(), findMany: jest.fn(), delete: jest.fn() },
    visit: { findUnique: jest.fn().mockResolvedValue({ panelClinicId: null }) },
    prescription: { findUnique: jest.fn() },
    orderService: { findUnique: jest.fn() },
    panelExclusion: { findFirst: jest.fn() },
    panelClinic: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const visits = { findById: jest.fn() } as unknown as VisitService;
  return { service: new InvoiceService(prisma, visits), prisma, visits };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('InvoiceService', () => {
  it('create uses the caller-supplied createdByStaffId, not the visit doctor (locum coverage)', async () => {
    const { service, prisma, visits } = createService();
    (visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'attending-staff' });
    (prisma.invoice.count as jest.Mock).mockResolvedValue(4);
    (prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });

    await withTenant(() => service.create({ visitId: 'visit-1', createdByStaffId: 'locum-staff' }));

    expect(prisma.invoice.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        visitId: 'visit-1',
        createdByStaffId: 'locum-staff',
        invoiceNumber: 'INV-000005',
      },
    });
  });

  it('addLine computes amount from quantity * unitPrice and recalculates the invoice total', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.UNPAID,
      lines: [],
    });
    (prisma.invoiceLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
    (prisma.invoiceLine.findMany as jest.Mock).mockResolvedValue([{ amount: 150 }]);
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', totalAmount: 150 });

    await withTenant(() => service.addLine('inv-1', { description: 'Consultation', quantity: 3, unitPrice: 50 }));

    expect(prisma.invoiceLine.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        invoiceId: 'inv-1',
        description: 'Consultation',
        quantity: 3,
        unitPrice: 50,
        amount: 150,
        sourceOrderServiceId: undefined,
        sourcePrescriptionId: undefined,
        excludedFromPanel: false,
      },
    });
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv-1' }, data: { totalAmount: 150 } });
  });

  it('addLine stamps excludedFromPanel when the source service is on the visit panel\'s exclusion list', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      lines: [],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: 'panel-1' });
    (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({ serviceCatalogId: 'svc-1' });
    (prisma.panelExclusion.findFirst as jest.Mock).mockResolvedValue({ id: 'excl-1' });
    (prisma.invoiceLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
    (prisma.invoiceLine.findMany as jest.Mock).mockResolvedValue([{ amount: 80 }]);
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', totalAmount: 80 });

    await withTenant(() =>
      service.addLine('inv-1', { description: 'X-Ray', unitPrice: 80, sourceOrderServiceId: 'os-1' }),
    );

    expect(prisma.panelExclusion.findFirst).toHaveBeenCalledWith({
      where: { panelClinicId: 'panel-1', serviceCatalogId: 'svc-1' },
    });
    expect(prisma.invoiceLine.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ excludedFromPanel: true, sourceOrderServiceId: 'os-1' }) }),
    );
  });

  it('addLine does not check exclusions for a self-pay (non-panel) visit', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      lines: [],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: null });
    (prisma.invoiceLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
    (prisma.invoiceLine.findMany as jest.Mock).mockResolvedValue([{ amount: 80 }]);
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', totalAmount: 80 });

    await withTenant(() =>
      service.addLine('inv-1', { description: 'X-Ray', unitPrice: 80, sourceOrderServiceId: 'os-1' }),
    );

    expect(prisma.orderService.findUnique).not.toHaveBeenCalled();
    expect(prisma.panelExclusion.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoiceLine.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ excludedFromPanel: false }) }),
    );
  });

  it('addLine rejects adding to a non-UNPAID invoice', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.CANCELLED,
      lines: [],
    });

    await expect(service.addLine('inv-1', { description: 'X', unitPrice: 10 })).rejects.toThrow(BadRequestException);
  });

  it('removeLine throws NotFoundException for a line not on this invoice', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.UNPAID,
      lines: [{ id: 'other-line' }],
    });

    await expect(service.removeLine('inv-1', 'missing-line')).rejects.toThrow(NotFoundException);
  });

  it('cancel rejects an invoice that is already PAID', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID, lines: [] });

    await expect(service.cancel('inv-1', {})).rejects.toThrow(BadRequestException);
  });

  it('pay marks an UNPAID invoice as PAID, recording the full total as patient-paid for a self-pay visit', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      totalAmount: 100,
      lines: [],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: null });
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID });

    await service.pay('inv-1', { paymentMethod: 'CASH' });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: expect.any(Date),
        paymentMethod: 'CASH',
        panelCoveredAmount: 0,
        patientPaidAmount: 100,
      },
    });
  });

  it('pay snapshots the panel-covered/patient-copay split for a panel visit', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      totalAmount: 150,
      lines: [{ amount: 150, excludedFromPanel: false }],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: 'panel-1' });
    (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({ limitAmount: 100 });
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID });

    await service.pay('inv-1', { paymentMethod: 'CASH' });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: expect.any(Date),
        paymentMethod: 'CASH',
        panelCoveredAmount: 100,
        patientPaidAmount: 50,
      },
    });
  });

  it('pay rejects "Mark Fully Covered by Panel" when a real copay is still due', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      totalAmount: 150,
      lines: [{ amount: 150, excludedFromPanel: false }],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: 'panel-1' });
    (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({ limitAmount: 100 });

    await expect(service.pay('inv-1', { paymentMethod: 'PANEL' })).rejects.toThrow(BadRequestException);
  });

  it('pay allows "Mark Fully Covered by Panel" when the computed copay is zero', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      visitId: 'visit-1',
      status: InvoiceStatus.UNPAID,
      totalAmount: 50,
      lines: [{ amount: 50, excludedFromPanel: false }],
    });
    (prisma.visit.findUnique as jest.Mock).mockResolvedValue({ panelClinicId: 'panel-1' });
    (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({ limitAmount: 100 });
    (prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID });

    await service.pay('inv-1', { paymentMethod: 'PANEL' });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
      data: {
        status: InvoiceStatus.PAID,
        paidAt: expect.any(Date),
        paymentMethod: 'PANEL',
        panelCoveredAmount: 50,
        patientPaidAmount: 0,
      },
    });
  });

  it('pay rejects an invoice that is already CANCELLED', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.CANCELLED,
      lines: [],
    });

    await expect(service.pay('inv-1', { paymentMethod: 'CASH' })).rejects.toThrow(BadRequestException);
  });
});
