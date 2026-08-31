import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ClaimBatchStatus, ClaimLineStatus, InvoiceStatus } from '@prisma/client';
import { ClaimBatchService, panelClaimFee } from './claim-batch.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    invoice: { findMany: jest.fn() },
    claimBatch: { count: jest.fn(), create: jest.fn(), findUnique: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    claimBatchLine: { findMany: jest.fn(), create: jest.fn(), update: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
    panelClinic: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  // Default: a panel with no fee configured (the AIA case).
  (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({
    id: 'panel-1',
    claimFeeType: null,
    claimFeeValue: null,
    paymentTermDays: null,
  });
  return { service: new ClaimBatchService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('ClaimBatchService', () => {
  describe('createBatch', () => {
    it('creates a batch with one line per invoice, snapshotting panelCoveredAmount as claimedAmount', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claimBatch.count as jest.Mock).mockResolvedValue(0);
      (prisma.claimBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-1' });
      (prisma.claimBatchLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({ id: 'batch-1', lines: [] });

      await withTenant(() =>
        service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
      );

      expect(prisma.claimBatch.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'test-tenant',
          panelClinicId: 'panel-1',
          batchNumber: 'CLAIM-000001',
          createdByStaffId: 'staff-1',
        },
      });
      expect(prisma.claimBatchLine.create).toHaveBeenCalledWith({
        data: { tenantId: 'test-tenant', claimBatchId: 'batch-1', invoiceId: 'inv-1', claimedAmount: 100, feeAmount: 0 },
      });
    });

    it('rejects an invoice that is not PAID', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.UNPAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);

      await expect(
        withTenant(() =>
          service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invoice belonging to a different panel', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-2' },
        },
      ]);

      await expect(
        withTenant(() =>
          service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects an invoice that has already been claimed in another batch', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([{ id: 'existing-line', invoiceId: 'inv-1' }]);

      await expect(
        withTenant(() =>
          service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('submit', () => {
    it('moves a BATCHED batch to SUBMITTED and records the method', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.BATCHED,
        lines: [],
      });
      (prisma.claimBatch.update as jest.Mock).mockResolvedValue({ id: 'batch-1', status: ClaimBatchStatus.SUBMITTED });

      await service.submit('batch-1', { submissionMethod: 'PORTAL', submissionReference: 'REF-1' });

      expect(prisma.claimBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: {
          status: ClaimBatchStatus.SUBMITTED,
          submittedAt: expect.any(Date),
          submissionMethod: 'PORTAL',
          submissionReference: 'REF-1',
        },
        include: { lines: { include: { invoice: true } } },
      });
    });

    it('rejects submitting a batch that is already SUBMITTED', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.SUBMITTED,
        lines: [],
      });

      await expect(service.submit('batch-1', { submissionMethod: 'PORTAL' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('recordLinePayment', () => {
    it('rejects recording a payment on a batch that has not been submitted', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.BATCHED,
        lines: [{ id: 'line-1' }],
      });

      await expect(service.recordLinePayment('batch-1', 'line-1', { status: 'PAID' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects a lineId that does not belong to this batch', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.SUBMITTED,
        lines: [{ id: 'other-line' }],
      });

      await expect(service.recordLinePayment('batch-1', 'missing-line', { status: 'PAID' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('moves the batch to PARTIALLY_PAID when only some lines are paid', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'batch-1',
          status: ClaimBatchStatus.SUBMITTED,
          lines: [
            { id: 'line-1', status: ClaimLineStatus.PENDING },
            { id: 'line-2', status: ClaimLineStatus.PENDING },
          ],
        })
        .mockResolvedValueOnce({
          id: 'batch-1',
          status: ClaimBatchStatus.SUBMITTED,
          lines: [
            { id: 'line-1', status: ClaimLineStatus.PAID },
            { id: 'line-2', status: ClaimLineStatus.PENDING },
          ],
        });
      (prisma.claimBatchLine.update as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.update as jest.Mock).mockResolvedValue({ id: 'batch-1', status: ClaimBatchStatus.PARTIALLY_PAID });

      await service.recordLinePayment('batch-1', 'line-1', { status: 'PAID', paidAmount: 100 });

      expect(prisma.claimBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: ClaimBatchStatus.PARTIALLY_PAID },
        include: { lines: { include: { invoice: true } } },
      });
    });

    it('moves the batch to PAID once every line is PAID', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock)
        .mockResolvedValueOnce({
          id: 'batch-1',
          status: ClaimBatchStatus.SUBMITTED,
          lines: [{ id: 'line-1', status: ClaimLineStatus.PENDING }],
        })
        .mockResolvedValueOnce({
          id: 'batch-1',
          status: ClaimBatchStatus.SUBMITTED,
          lines: [{ id: 'line-1', status: ClaimLineStatus.PAID }],
        });
      (prisma.claimBatchLine.update as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.update as jest.Mock).mockResolvedValue({ id: 'batch-1', status: ClaimBatchStatus.PAID });

      await service.recordLinePayment('batch-1', 'line-1', { status: 'PAID', paidAmount: 100 });

      expect(prisma.claimBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: ClaimBatchStatus.PAID },
        include: { lines: { include: { invoice: true } } },
      });
    });
  });

  describe('reconcile', () => {
    it('rejects reconciling a batch that has not been submitted', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.BATCHED,
        lines: [],
      });

      await expect(service.reconcile('batch-1')).rejects.toThrow(BadRequestException);
    });

    it('marks a PAID batch as RECONCILED', async () => {
      const { service, prisma } = createService();
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({
        id: 'batch-1',
        status: ClaimBatchStatus.PAID,
        lines: [],
      });
      (prisma.claimBatch.update as jest.Mock).mockResolvedValue({ id: 'batch-1', status: ClaimBatchStatus.RECONCILED });

      await service.reconcile('batch-1');

      expect(prisma.claimBatch.update).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
        data: { status: ClaimBatchStatus.RECONCILED, reconciledAt: expect.any(Date) },
        include: { lines: { include: { invoice: true } } },
      });
    });
  });

  // ------ Panel workbook upgrade (D-041) ------

  describe('panelClaimFee', () => {
    it('computes % of claimed, flat RM, and zero when unconfigured (AIA)', () => {
      expect(panelClaimFee('PERCENT', 8, 100)).toBe(8);
      expect(panelClaimFee('PERCENT', 8, 33.52)).toBe(2.68);
      expect(panelClaimFee('AMOUNT', 5, 100)).toBe(5);
      expect(panelClaimFee(null, null, 100)).toBe(0);
      expect(panelClaimFee('PERCENT', null, 100)).toBe(0);
    });
  });

  describe('createBatch fee from panel configuration', () => {
    it("applies the panel's configured % fee per line (claim RM100 at 8% → fee RM8)", async () => {
      const { service, prisma } = createService();
      (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({
        id: 'panel-1',
        claimFeeType: 'PERCENT',
        claimFeeValue: 8,
      });
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claimBatch.count as jest.Mock).mockResolvedValue(0);
      (prisma.claimBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-1' });
      (prisma.claimBatchLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({ id: 'batch-1', lines: [] });

      await withTenant(() =>
        service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
      );

      expect(prisma.claimBatchLine.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ claimedAmount: 100, feeAmount: 8 }) }),
      );
    });

    it("applies the panel's flat RM fee per claim regardless of claimed amount", async () => {
      const { service, prisma } = createService();
      (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({
        id: 'panel-1',
        claimFeeType: 'AMOUNT',
        claimFeeValue: 5,
      });
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 250,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claimBatch.count as jest.Mock).mockResolvedValue(0);
      (prisma.claimBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-1' });
      (prisma.claimBatchLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({ id: 'batch-1', lines: [] });

      await withTenant(() =>
        service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
      );

      expect(prisma.claimBatchLine.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ claimedAmount: 250, feeAmount: 5 }) }),
      );
    });

    it('applies zero fee for a panel with no fee configured (AIA)', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claimBatch.count as jest.Mock).mockResolvedValue(0);
      (prisma.claimBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-1' });
      (prisma.claimBatchLine.create as jest.Mock).mockResolvedValue({ id: 'line-1' });
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({ id: 'batch-1', lines: [] });

      await withTenant(() =>
        service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
      );

      expect(prisma.claimBatchLine.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ feeAmount: 0 }) }),
      );
    });

    it('rejects only invoices with an ACTIVE prior claim — rejected lines do not block re-claiming', async () => {
      const { service, prisma } = createService();
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-1',
          invoiceNumber: 'INV-000001',
          status: InvoiceStatus.PAID,
          panelCoveredAmount: 100,
          visit: { panelClinicId: 'panel-1' },
        },
      ]);
      // The already-claimed guard queries only ACTIVE statuses — an empty
      // result here means the prior line was REJECTED/DEDUCTED.
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.claimBatch.count as jest.Mock).mockResolvedValue(1);
      (prisma.claimBatch.create as jest.Mock).mockResolvedValue({ id: 'batch-2' });
      (prisma.claimBatchLine.create as jest.Mock).mockResolvedValue({ id: 'line-2' });
      (prisma.claimBatch.findUnique as jest.Mock).mockResolvedValue({ id: 'batch-2', lines: [] });

      await withTenant(() =>
        service.createBatch({ panelClinicId: 'panel-1', invoiceIds: ['inv-1'], createdByStaffId: 'staff-1' }),
      );

      expect(prisma.claimBatchLine.findMany).toHaveBeenCalledWith({
        where: { invoiceId: { in: ['inv-1'] }, status: { in: [ClaimLineStatus.PENDING, ClaimLineStatus.ACCEPTED, ClaimLineStatus.PAID] } },
      });
    });
  });

  describe('listLines', () => {
    it('computes claim-to-receive/receivable, derives SUBMITTED for pending lines, and flags overdue against the panel payment term', async () => {
      const { service, prisma } = createService();
      (prisma.panelClinic.findUnique as jest.Mock).mockResolvedValue({
        id: 'panel-1',
        paymentTermDays: 30,
        claimFeeType: null,
        claimFeeValue: null,
      });
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([]);
      const submittedAt = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
      (prisma.claimBatchLine.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'line-1',
          claimBatchId: 'batch-1',
          status: ClaimLineStatus.PENDING,
          claimedAmount: 100,
          feeAmount: 8,
          feeDirection: 'ADDED',
          paidAmount: null,
          remarks: null,
          deductionReason: null,
          createdAt: submittedAt,
          claimBatch: {
            batchNumber: 'CLAIM-000001',
            status: ClaimBatchStatus.SUBMITTED,
            submittedAt,
            submissionReference: null,
          },
          invoice: {
            invoiceNumber: 'INV-000001',
            paidAt: submittedAt,
            createdAt: submittedAt,
            visit: { patient: { name: 'Test Patient' } },
          },
        },
      ]);

      const [row] = await service.listLines('panel-1');

      expect(row.claimToReceive).toBe(108);
      expect(row.receivable).toBe(108);
      expect(row.paymentTermDays).toBe(30);
      expect(row.overdue).toBe(true);
      // PENDING line in a SUBMITTED batch reads as SUBMITTED on the tracker.
      expect(row.status).toBe('SUBMITTED');

      // An unclaimed panel invoice appears automatically as UNCLAIMED.
      (prisma.invoice.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'inv-2',
          invoiceNumber: 'INV-000002',
          panelCoveredAmount: 80,
          paidAt: new Date(),
          createdAt: new Date(),
          visit: { patient: { name: 'Unclaimed Patient' } },
        },
      ]);
      const rows = await service.listLines('panel-1');
      const unclaimed = rows.find((r) => r.status === 'UNCLAIMED');
      expect(unclaimed).toBeDefined();
      expect(unclaimed?.invoiceNumber).toBe('INV-000002');
      expect(unclaimed?.receivable).toBe(80);
    });
  });
});
