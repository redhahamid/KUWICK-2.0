import { AppointmentStatus, InvoiceStatus } from '@prisma/client';
import { ReportsService, classifyMovement } from './reports.service';
import { ClaimBatchService } from '../clinical/claim-batch.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

function createService() {
  const prisma = {
    invoice: { findMany: jest.fn() },
    appointment: { findMany: jest.fn() },
    invoiceLine: { findMany: jest.fn() },
    item: { findMany: jest.fn() },
    visit: { findMany: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const claimBatches = { listOutstanding: jest.fn() } as unknown as ClaimBatchService;
  const service = new ReportsService(prisma, {} as never, claimBatches);

  /*
   * These are arithmetic tests, and the arithmetic is what they should test.
   *
   * Every method now authorises through `scopeFor` before it reads, which
   * needs a real actor and a real tenant context. Stubbing it to a tenant-wide
   * scope keeps these tests about revenue bucketing rather than about
   * authorisation — which is covered where it can actually be proved, in
   * `authorization-scope.e2e-spec.ts`, against a real database and a real
   * signed token.
   */
  (service as unknown as { scopeFor: (id?: string) => Promise<unknown> }).scopeFor = async (id?: string) => ({
    scope: null,
    // A tenant-wide actor: a named branch is honoured, and naming none reads
    // every branch. Exactly what the real scope does for an account holder.
    clinic: id ? { clinicId: id } : {},
    visit: { visit: id ? { clinicId: id } : {} },
  });

  return { service, prisma, claimBatches };
}

describe('ReportsService', () => {
  describe('getSalesSummary', () => {
    it('splits revenue into cash-collected and panel-owed, and buckets by day and payment method', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { totalAmount: 100, patientPaidAmount: 100, panelCoveredAmount: 0, paidAt: new Date('2026-07-01T10:00:00Z'), paymentMethod: 'CASH' },
        { totalAmount: 150, patientPaidAmount: 50, panelCoveredAmount: 100, paidAt: new Date('2026-07-01T12:00:00Z'), paymentMethod: 'CARD' },
        { totalAmount: 50, patientPaidAmount: 0, panelCoveredAmount: 50, paidAt: new Date('2026-07-02T09:00:00Z'), paymentMethod: 'PANEL' },
      ]);

      const result = await service.getSalesSummary({});

      expect(result.invoiceCount).toBe(3);
      expect(result.totalRevenue).toBe(300);
      expect(result.cashRevenue).toBe(150);
      expect(result.panelRevenue).toBe(150);
      expect(result.byDay).toEqual([
        { date: '2026-07-01', cash: 150, panel: 100 },
        { date: '2026-07-02', cash: 0, panel: 50 },
      ]);
      expect(result.byPaymentMethod).toEqual(
        expect.arrayContaining([
          { paymentMethod: 'CASH', amount: 100 },
          { paymentMethod: 'CARD', amount: 150 },
          { paymentMethod: 'PANEL', amount: 50 },
        ]),
      );
    });

    it('passes the date range and clinic filter through to the query', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);

      await service.getSalesSummary({ from: '2026-07-01', to: '2026-07-31', clinicId: 'clinic-1' });

      expect(prisma.invoice.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: InvoiceStatus.PAID,
            paidAt: { gte: new Date('2026-07-01'), lte: new Date(new Date('2026-07-31').setHours(23, 59, 59, 999)) },
            visit: { clinicId: 'clinic-1' },
          }),
        }),
      );
    });
  });

  describe('getAppointmentAnalytics', () => {
    it('computes no-show/completed/cancelled rates', async () => {
      const { service, prisma } = createService();
      (prisma.appointment.findMany as jest.Mock).mockResolvedValue([
        { status: AppointmentStatus.COMPLETED },
        { status: AppointmentStatus.COMPLETED },
        { status: AppointmentStatus.NO_SHOW },
        { status: AppointmentStatus.CANCELLED },
      ]);

      const result = await service.getAppointmentAnalytics({});

      expect(result.total).toBe(4);
      expect(result.countByStatus.COMPLETED).toBe(2);
      expect(result.countByStatus.NO_SHOW).toBe(1);
      expect(result.noShowRate).toBe(25);
      expect(result.completedRate).toBe(50);
      expect(result.cancelledRate).toBe(50);
    });

    it('returns all-zero rates when there are no appointments in range', async () => {
      const { service, prisma } = createService();
      (prisma.appointment.findMany as jest.Mock).mockResolvedValue([]);

      const result = await service.getAppointmentAnalytics({});

      expect(result.total).toBe(0);
      expect(result.noShowRate).toBe(0);
      expect(result.completedRate).toBe(0);
    });
  });

  describe('getDoctorPerformance', () => {
    it('groups PAID invoices by attending staff and computes revenue per visit', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        { totalAmount: 100, visit: { staffId: 'staff-1', staff: { fullName: 'Dr. Amira Rahman' } } },
        { totalAmount: 200, visit: { staffId: 'staff-1', staff: { fullName: 'Dr. Amira Rahman' } } },
        { totalAmount: 50, visit: { staffId: 'staff-2', staff: { fullName: 'Dr. Faizal Hakim' } } },
      ]);

      const result = await service.getDoctorPerformance({});

      expect(result).toEqual([
        { staffId: 'staff-1', staffName: 'Dr. Amira Rahman', visitCount: 2, revenue: 300, revenuePerVisit: 150 },
        { staffId: 'staff-2', staffName: 'Dr. Faizal Hakim', visitCount: 1, revenue: 50, revenuePerVisit: 50 },
      ]);
    });
  });

  describe('getPanelAging', () => {
    it('delegates to ClaimBatchService.listOutstanding', async () => {
      const { service, claimBatches } = createService();
      (claimBatches.listOutstanding as jest.Mock).mockResolvedValue([{ id: 'batch-1' }]);

      const result = await service.getPanelAging();

      expect(claimBatches.listOutstanding).toHaveBeenCalled();
      expect(result).toEqual([{ id: 'batch-1' }]);
    });
  });

  // ------ D-042: drug movement + wait times ------

  describe('classifyMovement', () => {
    it('splits sold items into FAST / MEDIUM / SLOW tertiles', () => {
      // 6 sold items: ranks 0-1 FAST, 2-3 MEDIUM, 4-5 SLOW.
      expect(classifyMovement(0, 6)).toBe('FAST');
      expect(classifyMovement(1, 6)).toBe('FAST');
      expect(classifyMovement(2, 6)).toBe('MEDIUM');
      expect(classifyMovement(3, 6)).toBe('MEDIUM');
      expect(classifyMovement(4, 6)).toBe('SLOW');
      expect(classifyMovement(5, 6)).toBe('SLOW');
      expect(classifyMovement(0, 0)).toBe('SLOW');
    });
  });

  describe('getDrugMovement', () => {
    it('aggregates quantity/revenue per item and lists never-sold items as SLOW', async () => {
      const { service, prisma } = createService();
      (prisma.invoiceLine.findMany as jest.Mock).mockResolvedValue([
        { quantity: 2, amount: 16, sourcePrescription: { itemId: 'item-1', item: { name: 'Paracetamol', category: 'Medication' } } },
        { quantity: 1, amount: 8, sourcePrescription: { itemId: 'item-1', item: { name: 'Paracetamol', category: 'Medication' } } },
        { quantity: 1, amount: 18, sourcePrescription: { itemId: 'item-2', item: { name: 'Amoxicillin', category: 'Medication' } } },
      ]);
      (prisma.item.findMany as jest.Mock).mockResolvedValue([
        { id: 'item-1', name: 'Paracetamol', category: 'Medication' },
        { id: 'item-2', name: 'Amoxicillin', category: 'Medication' },
        { id: 'item-3', name: 'Never Sold Syrup', category: 'Medication' },
      ]);

      const rows = await service.getDrugMovement({});

      const paracetamol = rows.find((r) => r.itemId === 'item-1');
      expect(paracetamol).toMatchObject({ quantity: 3, revenue: 24, prescriptions: 2 });
      const neverSold = rows.find((r) => r.itemId === 'item-3');
      expect(neverSold).toMatchObject({ quantity: 0, movement: 'SLOW' });
      // Sorted sold-first by quantity.
      expect(rows[0].itemId).toBe('item-1');
    });
  });

  describe('getWaitTimes', () => {
    it('computes averages and buckets from ticket/visit timestamps, ignoring insane outliers', async () => {
      const { service, prisma } = createService();
      const t0 = new Date('2026-07-01T09:00:00Z');
      const plus = (minutes: number) => new Date(t0.getTime() + minutes * 60000);
      (prisma.visit.findMany as jest.Mock).mockResolvedValue([
        // 10-minute wait, 30-minute service, 40 total.
        { checkInAt: t0, checkOutAt: plus(40), queueTicket: { createdAt: t0, calledAt: plus(10) } },
        // 45-minute wait, no checkout yet.
        { checkInAt: t0, checkOutAt: null, queueTicket: { createdAt: t0, calledAt: plus(45) } },
        // Forgotten checkout: 20h total — excluded from totals as insane.
        { checkInAt: t0, checkOutAt: plus(20 * 60), queueTicket: { createdAt: t0, calledAt: plus(5) } },
      ]);

      const result = await service.getWaitTimes({});

      expect(result.visitCount).toBe(3);
      expect(result.measuredWaits).toBe(3);
      expect(result.averageWaitMinutes).toBe(20); // (10 + 45 + 5) / 3
      expect(result.averageTotalVisitMinutes).toBe(40); // 20h visit excluded
      expect(result.waitBuckets).toEqual([
        { bucket: '0-15 min', count: 2 },
        { bucket: '15-30 min', count: 0 },
        { bucket: '30-60 min', count: 1 },
        { bucket: '60+ min', count: 0 },
      ]);
    });
  });
});
