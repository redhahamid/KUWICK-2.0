import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TenantSubscriptionService } from './tenant-subscription.service';
import { PrismaService } from '../core/prisma.service';

function createService() {
  const prisma = {
    tenantSubscription: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
    subscriptionPlan: { findUnique: jest.fn() },
    tenant: { findUnique: jest.fn() },
    $executeRaw: jest.fn(),
  } as unknown as PrismaService;
  (prisma as unknown as { $transaction: jest.Mock }).$transaction = jest.fn((fn: (tx: PrismaService) => unknown) =>
    fn(prisma),
  );
  return { service: new TenantSubscriptionService(prisma), prisma };
}

describe('TenantSubscriptionService', () => {
  describe('activate', () => {
    it('rejects an unknown plan', async () => {
      const { service, prisma } = createService();
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.activate({ tenantId: 't1', planId: 'missing' })).rejects.toThrow(NotFoundException);
    });

    it('defaults the subscription length to the plan durationDays', async () => {
      const { service, prisma } = createService();
      (prisma.subscriptionPlan.findUnique as jest.Mock).mockResolvedValue({ id: 'plan-1', durationDays: 30 });
      (prisma.tenant.findUnique as jest.Mock).mockResolvedValue({ id: 't1' });
      (prisma.tenantSubscription.create as jest.Mock).mockResolvedValue({ id: 'sub-1' });

      await service.activate({ tenantId: 't1', planId: 'plan-1' });

      const endsAt = (prisma.tenantSubscription.create as jest.Mock).mock.calls[0][0].data.endsAt as Date;
      const days = Math.round((endsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
      expect(days).toBe(30);
      expect((prisma.tenantSubscription.create as jest.Mock).mock.calls[0][0].data.status).toBe('ACTIVE');
    });
  });

  describe('extend', () => {
    it('adds extraDays onto the current endsAt', async () => {
      const { service, prisma } = createService();
      const currentEnd = new Date('2026-08-20T00:00:00Z');
      (prisma.tenantSubscription.findUnique as jest.Mock).mockResolvedValue({ id: 'sub-1', status: 'ACTIVE', endsAt: currentEnd });
      (prisma.tenantSubscription.update as jest.Mock).mockResolvedValue({ id: 'sub-1' });

      await service.extend('sub-1', { extraDays: 10 });

      const newEnd = (prisma.tenantSubscription.update as jest.Mock).mock.calls[0][0].data.endsAt as Date;
      expect(newEnd.toISOString()).toBe('2026-08-30T00:00:00.000Z');
    });

    it('re-activates a cancelled subscription on extend', async () => {
      const { service, prisma } = createService();
      (prisma.tenantSubscription.findUnique as jest.Mock).mockResolvedValue({
        id: 'sub-1',
        status: 'CANCELLED',
        endsAt: new Date(),
      });
      (prisma.tenantSubscription.update as jest.Mock).mockResolvedValue({ id: 'sub-1' });

      await service.extend('sub-1', { extraDays: 30 });

      expect((prisma.tenantSubscription.update as jest.Mock).mock.calls[0][0].data.status).toBe('ACTIVE');
    });
  });

  describe('cancel', () => {
    it('rejects double cancellation', async () => {
      const { service, prisma } = createService();
      (prisma.tenantSubscription.findUnique as jest.Mock).mockResolvedValue({ id: 'sub-1', status: 'CANCELLED' });

      await expect(service.cancel('sub-1')).rejects.toThrow(BadRequestException);
    });

    it('marks an active subscription cancelled with a timestamp', async () => {
      const { service, prisma } = createService();
      (prisma.tenantSubscription.findUnique as jest.Mock).mockResolvedValue({ id: 'sub-1', status: 'ACTIVE' });
      (prisma.tenantSubscription.update as jest.Mock).mockResolvedValue({ id: 'sub-1' });

      await service.cancel('sub-1');

      expect(prisma.tenantSubscription.update).toHaveBeenCalledWith({
        where: { id: 'sub-1' },
        data: { status: 'CANCELLED', cancelledAt: expect.any(Date) },
        include: { tenant: true, plan: true },
      });
    });
  });
});
