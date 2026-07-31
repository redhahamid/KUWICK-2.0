import { BadRequestException, NotFoundException } from '@nestjs/common';
import { LeaveStatus, LeaveType } from '@prisma/client';
import { LeaveRequestService } from './leave-request.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

function createService() {
  const prisma = {
    leaveRequest: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  return { service: new LeaveRequestService(prisma), prisma };
}

function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return tenantContextStorage.run({ tenantId: 'test-tenant' }, fn);
}

describe('LeaveRequestService', () => {
  it('create defaults to PENDING via the schema default (not set explicitly)', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.create as jest.Mock).mockResolvedValue({ id: 'leave-1' });

    await withTenant(() =>
      service.create({
        staffId: 'staff-1',
        leaveType: LeaveType.ANNUAL,
        startDate: '2026-08-01',
        endDate: '2026-08-03',
        reason: 'Family trip',
      }),
    );

    expect(prisma.leaveRequest.create).toHaveBeenCalledWith({
      data: {
        tenantId: 'test-tenant',
        staffId: 'staff-1',
        leaveType: LeaveType.ANNUAL,
        startDate: new Date('2026-08-01'),
        endDate: new Date('2026-08-03'),
        reason: 'Family trip',
      },
    });
  });

  it('approve rejects a request that is not PENDING', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.APPROVED });

    await expect(service.approve('leave-1', { approvedByStaffId: 'staff-2' })).rejects.toThrow(BadRequestException);
  });

  it('approve marks a PENDING request as APPROVED', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.PENDING });
    (prisma.leaveRequest.update as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.APPROVED });

    await service.approve('leave-1', { approvedByStaffId: 'staff-2' });

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: { status: LeaveStatus.APPROVED, approvedByStaffId: 'staff-2', approvedAt: expect.any(Date) },
    });
  });

  it('reject rejects a request that is not PENDING', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.REJECTED });

    await expect(service.reject('leave-1', { approvedByStaffId: 'staff-2' })).rejects.toThrow(BadRequestException);
  });

  it('reject marks a PENDING request as REJECTED with a reason', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.PENDING });
    (prisma.leaveRequest.update as jest.Mock).mockResolvedValue({ id: 'leave-1', status: LeaveStatus.REJECTED });

    await service.reject('leave-1', { approvedByStaffId: 'staff-2', rejectReason: 'Understaffed that week' });

    expect(prisma.leaveRequest.update).toHaveBeenCalledWith({
      where: { id: 'leave-1' },
      data: {
        status: LeaveStatus.REJECTED,
        approvedByStaffId: 'staff-2',
        approvedAt: expect.any(Date),
        rejectReason: 'Understaffed that week',
      },
    });
  });

  it('findById throws NotFoundException for a missing request', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });
});
