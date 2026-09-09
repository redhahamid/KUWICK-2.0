import { NotFoundException } from '@nestjs/common';
import { LeaveType } from '@prisma/client';
import { LeaveRequestService } from './leave-request.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

/**
 * APPROVE AND REJECT ARE NOT UNIT-TESTED HERE ANY MORE, deliberately.
 *
 * They used to be, and what they asserted was that the approver id ARRIVING IN
 * THE REQUEST BODY got written down — the bug, pinned in place by a test. Both
 * now run through `withAdminTx`: a real transaction, the session's actor, a
 * permission assert and an audit row, none of which a mocked Prisma client can
 * demonstrate. They are covered end to end in
 * `test/leave-decision-authority.e2e-spec.ts`, against the real guard.
 *
 * What stays here is what still goes through the scoped client directly.
 */
function createService() {
  const prisma = {
    leaveRequest: { create: jest.fn(), findMany: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
  } as unknown as TenantScopedPrismaClient;
  // The raw client is only reached by the audited decision path, which this
  // file no longer exercises.
  const raw = {} as never;
  return { service: new LeaveRequestService(prisma, raw), prisma };
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





  it('findById throws NotFoundException for a missing request', async () => {
    const { service, prisma } = createService();
    (prisma.leaveRequest.findUnique as jest.Mock).mockResolvedValue(null);

    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
  });
});
