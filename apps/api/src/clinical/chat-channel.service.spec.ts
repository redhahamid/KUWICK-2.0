import { BadRequestException } from '@nestjs/common';
import { ChatChannelService } from './chat-channel.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    chatChannel: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn() },
    chatMessage: { findMany: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ChatChannelService(prisma), prisma };
}

function withTenant<T>(fn: () => T): T {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('ChatChannelService', () => {
  describe('listByClinic', () => {
    it('returns existing channels without creating anything', async () => {
      const { service, prisma } = createService();
      const existing = [{ id: 'ch-1', name: 'General', isGeneral: true }];
      (prisma.chatChannel.findMany as jest.Mock).mockResolvedValue(existing);

      const result = await service.listByClinic('clinic-1');

      expect(result).toBe(existing);
      expect(prisma.chatChannel.create).not.toHaveBeenCalled();
    });

    it('lazily creates a General channel for a clinic with none yet', async () => {
      const { service, prisma } = createService();
      (prisma.chatChannel.findMany as jest.Mock)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: 'ch-new', name: 'General', isGeneral: true }]);

      const result = await withTenant(() => service.listByClinic('clinic-1'));

      expect(prisma.chatChannel.create).toHaveBeenCalledWith({
        data: { tenantId: 'test-tenant', clinicId: 'clinic-1', name: 'General', isGeneral: true },
      });
      expect(result).toEqual([{ id: 'ch-new', name: 'General', isGeneral: true }]);
    });
  });

  describe('listByClinicWithLatestMessage', () => {
    it('attaches each channel\'s latest message timestamp and author', async () => {
      const { service, prisma } = createService();
      (prisma.chatChannel.findMany as jest.Mock).mockResolvedValue([
        { id: 'ch-1', name: 'General' },
        { id: 'ch-2', name: 'Doctors' },
      ]);
      (prisma.chatMessage.findMany as jest.Mock).mockResolvedValue([
        { channelId: 'ch-1', createdAt: new Date('2026-08-01T10:00:00Z'), staffId: 'staff-1' },
      ]);

      const result = await service.listByClinicWithLatestMessage('clinic-1');

      expect(result).toEqual([
        { id: 'ch-1', name: 'General', latestMessageAt: new Date('2026-08-01T10:00:00Z'), latestMessageStaffId: 'staff-1' },
        { id: 'ch-2', name: 'Doctors', latestMessageAt: null, latestMessageStaffId: null },
      ]);
    });
  });

  describe('create', () => {
    it('creates a named channel', async () => {
      const { service, prisma } = createService();
      (prisma.chatChannel.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.chatChannel.create as jest.Mock).mockResolvedValue({ id: 'ch-2', name: 'Doctors' });

      await withTenant(() => service.create('clinic-1', '  Doctors  '));

      expect(prisma.chatChannel.create).toHaveBeenCalledWith({
        data: { tenantId: 'test-tenant', clinicId: 'clinic-1', name: 'Doctors', isGeneral: false },
      });
    });

    it('rejects a blank name', async () => {
      const { service } = createService();

      await expect(withTenant(() => service.create('clinic-1', '   '))).rejects.toThrow(BadRequestException);
    });

    it('rejects a duplicate channel name for the same clinic', async () => {
      const { service, prisma } = createService();
      (prisma.chatChannel.findFirst as jest.Mock).mockResolvedValue({ id: 'ch-1', name: 'Doctors' });

      await expect(withTenant(() => service.create('clinic-1', 'Doctors'))).rejects.toThrow(BadRequestException);
    });
  });
});
