import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoiceService } from './invoice.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
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

  // G3c (D-065) — reading a visit's invoices now checks branch access, which
  // runs through an interactive transaction like every other clinical read.
  const tx = {
    $executeRaw: jest.fn(),
    staff: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'staff-1',
        fullName: 'Dr. Amira Rahman',
        role: 'DOCTOR_RESIDENT',
        active: true,
        clinicId: 'clinic-1',
        userId: 'user-1',
      }),
    },
    clinic: { count: jest.fn().mockResolvedValue(1) },
    userClinicAccess: { findMany: jest.fn().mockResolvedValue([]) },
    visit: { findUnique: jest.fn().mockResolvedValue({ clinicId: 'clinic-1' }) },
  };
  const rawPrisma = { $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)) } as unknown as PrismaService;

  return { service: new InvoiceService(prisma, rawPrisma, visits), prisma, visits, tx };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId: 'staff-1' }, fn);
}

describe('InvoiceService', () => {
  // G3c (D-065) — the read the Clinical Workspace exposes. Tenant isolation
  // came from RLS; the BRANCH was never checked, so a staff member authorised
  // only for Branch A could read Branch B's money for any visit id.
  it('reading a visit’s invoices enforces branch access', async () => {
    const { service, tx } = createService();
    tx.clinic.count.mockResolvedValue(2); // multi-branch tenant
    tx.visit.findUnique.mockResolvedValue({ clinicId: 'clinic-OTHER' });
    tx.staff.findUnique.mockResolvedValue({
      id: 'staff-1',
      fullName: 'Dr. Amira Rahman',
      role: 'DOCTOR_RESIDENT',
      active: true,
      clinicId: 'clinic-1',
      userId: 'user-1',
    });

    await expect(withTenant(() => service.findByVisitId('visit-elsewhere'))).rejects.toThrow(ForbiddenException);
  });

  it('an authorised branch can read its own visit’s invoices', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

    await withTenant(() => service.findByVisitId('visit-1'));

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { visitId: 'visit-1' } }),
    );
  });

  // The summary needs these to say who raised the invoice, which panel the
  // visit is on, and what each line came from — without a second round trip
  // or the frontend guessing from item names.
  it('the read resolves creator, panel, line sources and claim lines', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

    await withTenant(() => service.findByVisitId('visit-1'));

    const include = (prisma.invoice.findMany as jest.Mock).mock.calls[0][0].include;
    expect(include.createdBy).toBeDefined();
    expect(include.claimBatchLines).toBeDefined();
    expect(include.visit.select.panelClinic).toBeDefined();
    expect(include.lines.include.sourceOrderService).toBeDefined();
    expect(include.lines.include.sourcePrescription).toBeDefined();
  });

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
