import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InvoiceStatus } from '@prisma/client';
import { InvoiceService } from './invoice.service';
import { VisitService } from './visit.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';

// G3c closure (D-066) — billing authority depends on the ROLE, so the actor
// is now a parameter. The pay/cancel business-rule tests below run as a
// billing role; the authorisation tests pick the role deliberately.
function createService(role = 'FINANCE_STAFF') {
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
        fullName: 'Aminah Counter',
        role,
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

// =============================================================================
// G3c closure (D-066) — the billing authorisation matrix, on the routes that
// move money. Before this, ANY authenticated user of the tenant could create,
// line, pay or cancel an invoice by calling the API directly.
// =============================================================================
describe('billing authorisation', () => {
  const UNPAID_INVOICE = { id: 'inv-1', visitId: 'visit-1', status: InvoiceStatus.UNPAID, lines: [] };

  const arrange = (role: string) => {
    const ctx = createService(role);
    (ctx.prisma.invoice.findUnique as jest.Mock).mockResolvedValue(UNPAID_INVOICE);
    (ctx.visits.findById as jest.Mock).mockResolvedValue({ id: 'visit-1', staffId: 'staff-9' });
    (ctx.prisma.invoice.count as jest.Mock).mockResolvedValue(0);
    (ctx.prisma.invoice.create as jest.Mock).mockResolvedValue({ id: 'inv-1' });
    (ctx.prisma.invoiceLine.create as jest.Mock).mockResolvedValue({ id: 'l1' });
    (ctx.prisma.invoiceLine.findMany as jest.Mock).mockResolvedValue([{ amount: 10 }]);
    (ctx.prisma.invoice.update as jest.Mock).mockResolvedValue({ id: 'inv-1' });
    return ctx;
  };

  const ACTIONS = {
    create: (s: InvoiceService) => s.create({ visitId: 'visit-1', createdByStaffId: 'staff-1' }),
    addLine: (s: InvoiceService) => s.addLine('inv-1', { description: 'X', unitPrice: 10 }),
    pay: (s: InvoiceService) => s.pay('inv-1', { paymentMethod: 'CASH' }),
    cancel: (s: InvoiceService) => s.cancel('inv-1', { cancelReason: 'x' }),
  };

  // The approved matrix, asserted as data so the table and the guard cannot
  // drift apart silently.
  const MATRIX: [string, (keyof typeof ACTIONS)[]][] = [
    ['OWNER_ADMIN', ['create', 'addLine', 'pay', 'cancel']],
    ['FINANCE_STAFF', ['create', 'addLine', 'pay', 'cancel']],
    ['FRONT_DESK_CLINICAL_STAFF', ['create', 'addLine', 'pay']],
    ['DOCTOR_RESIDENT', ['create', 'addLine']],
    ['DOCTOR_LOCUM', ['create', 'addLine']],
    ['HR_STAFF', []],
    ['STOCK_STAFF', []],
    ['PANEL_STAFF', []],
    ['PATIENT_PORTAL', []],
  ];

  for (const [role, allowed] of MATRIX) {
    for (const action of Object.keys(ACTIONS) as (keyof typeof ACTIONS)[]) {
      const permitted = allowed.includes(action);
      it(`${role} ${permitted ? 'may' : 'may NOT'} ${action}`, async () => {
        const { service } = arrange(role);
        const run = () => withTenant(() => ACTIONS[action](service));
        if (permitted) {
          await expect(run()).resolves.toBeDefined();
        } else {
          await expect(run()).rejects.toThrow(ForbiddenException);
        }
      });
    }
  }

  it('an inactive staff member may do nothing, whatever their role', async () => {
    const { service, tx } = arrange('FINANCE_STAFF');
    tx.staff.findUnique.mockResolvedValue({
      id: 'staff-1',
      fullName: 'Former Finance',
      role: 'FINANCE_STAFF',
      active: false,
      clinicId: 'clinic-1',
      userId: 'user-1',
    });

    await expect(withTenant(() => ACTIONS.pay(service))).rejects.toThrow();
  });

  // The browser never chooses which visit a mutation lands on: pay/cancel/
  // line resolve the invoice's OWN visit before the branch check.
  it('a mutation resolves the branch from the invoice’s stored visit', async () => {
    const { service, prisma, tx } = arrange('FINANCE_STAFF');
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      ...UNPAID_INVOICE,
      visitId: 'visit-OWNED-BY-ANOTHER-BRANCH',
    });
    tx.clinic.count.mockResolvedValue(2);
    tx.visit.findUnique.mockResolvedValue({ clinicId: 'clinic-OTHER' });

    await expect(withTenant(() => ACTIONS.pay(service))).rejects.toThrow(ForbiddenException);
    expect(tx.visit.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'visit-OWNED-BY-ANOTHER-BRANCH' } }),
    );
  });

  it('a mutation against an unknown invoice fails closed', async () => {
    const { service, prisma } = arrange('FINANCE_STAFF');
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(withTenant(() => ACTIONS.pay(service))).rejects.toThrow(NotFoundException);
  });
});

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

    await expect(withTenant(() => service.addLine('inv-1', { description: 'X', unitPrice: 10 }))).rejects.toThrow(BadRequestException);
  });

  it('removeLine throws NotFoundException for a line not on this invoice', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({
      id: 'inv-1',
      status: InvoiceStatus.UNPAID,
      lines: [{ id: 'other-line' }],
    });

    await expect(withTenant(() => service.removeLine('inv-1', 'missing-line'))).rejects.toThrow(NotFoundException);
  });

  it('cancel rejects an invoice that is already PAID', async () => {
    const { service, prisma } = createService();
    (prisma.invoice.findUnique as jest.Mock).mockResolvedValue({ id: 'inv-1', status: InvoiceStatus.PAID, lines: [] });

    await expect(withTenant(() => service.cancel('inv-1', {}))).rejects.toThrow(BadRequestException);
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

    await withTenant(() => service.pay('inv-1', { paymentMethod: 'CASH' }));

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

    await withTenant(() => service.pay('inv-1', { paymentMethod: 'CASH' }));

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

    await expect(withTenant(() => service.pay('inv-1', { paymentMethod: 'PANEL' }))).rejects.toThrow(BadRequestException);
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

    await withTenant(() => service.pay('inv-1', { paymentMethod: 'PANEL' }));

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

    await expect(withTenant(() => service.pay('inv-1', { paymentMethod: 'CASH' }))).rejects.toThrow(BadRequestException);
  });
});
