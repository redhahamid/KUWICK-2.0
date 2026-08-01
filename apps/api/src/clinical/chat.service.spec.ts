import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ChatService } from './chat.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    chatMessage: { findMany: jest.fn(), create: jest.fn() },
    orderService: { findUnique: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ChatService(prisma), prisma };
}

function withTenant<T>(fn: () => T, staffId?: string): T {
  return tenantContextStorage.run({ tenantId: 'test-tenant', staffId }, fn);
}

describe('ChatService', () => {
  describe('listClinicWide', () => {
    it('lists only clinic-wide messages (orderServiceId null) for the clinic, oldest first', async () => {
      const { service, prisma } = createService();
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValue([]);

      await service.listClinicWide('clinic-1');

      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { clinicId: 'clinic-1', orderServiceId: null },
        include: { staff: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createClinicWide', () => {
    it('creates a clinic-wide message from the authenticated staff member', async () => {
      const { service, prisma } = createService();
      (prisma.chatMessage.create as jest.Mock).mockResolvedValue({ id: 'msg-1' });

      await withTenant(() => service.createClinicWide('clinic-1', '  Need more gauze  '), 'staff-1');

      expect(prisma.chatMessage.create).toHaveBeenCalledWith({
        data: { tenantId: 'test-tenant', clinicId: 'clinic-1', staffId: 'staff-1', message: 'Need more gauze' },
        include: { staff: { select: { id: true, fullName: true } } },
      });
    });

    it('rejects a blank message', async () => {
      const { service } = createService();

      await expect(withTenant(() => service.createClinicWide('clinic-1', '   '), 'staff-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when there is no authenticated staff member', async () => {
      const { service } = createService();

      await expect(withTenant(() => service.createClinicWide('clinic-1', 'hello'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('listForOrder', () => {
    it('lists messages scoped to the order service', async () => {
      const { service, prisma } = createService();
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValue([]);

      await service.listForOrder('order-1');

      expect(prisma.chatMessage.findMany).toHaveBeenCalledWith({
        where: { orderServiceId: 'order-1' },
        include: { staff: { select: { id: true, fullName: true } } },
        orderBy: { createdAt: 'asc' },
      });
    });
  });

  describe('createForOrder', () => {
    it('derives clinicId from the order rather than trusting client input', async () => {
      const { service, prisma } = createService();
      (prisma.orderService.findUnique as jest.Mock).mockResolvedValue({ clinicId: 'clinic-9' });
      (prisma.chatMessage.create as jest.Mock).mockResolvedValue({ id: 'msg-1' });

      await withTenant(() => service.createForOrder('order-1', 'X-ray came back unclear'), 'staff-2');

      expect(prisma.chatMessage.create).toHaveBeenCalledWith({
        data: {
          tenantId: 'test-tenant',
          clinicId: 'clinic-9',
          orderServiceId: 'order-1',
          staffId: 'staff-2',
          message: 'X-ray came back unclear',
        },
        include: { staff: { select: { id: true, fullName: true } } },
      });
    });

    it('throws when the order does not exist', async () => {
      const { service, prisma } = createService();
      (prisma.orderService.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(withTenant(() => service.createForOrder('missing', 'hi'), 'staff-1')).rejects.toThrow(NotFoundException);
    });
  });
});
