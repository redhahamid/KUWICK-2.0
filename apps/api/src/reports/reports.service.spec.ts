import { AppointmentStatus, InvoiceStatus } from '@prisma/client';
import { ReportsService } from './reports.service';
import { ClaimBatchService } from '../clinical/claim-batch.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

function createService() {
  const prisma = {
    invoice: { findMany: jest.fn() },
    appointment: { findMany: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  const claimBatches = { listOutstanding: jest.fn() } as unknown as ClaimBatchService;
  return { service: new ReportsService(prisma, claimBatches), prisma, claimBatches };
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
});
