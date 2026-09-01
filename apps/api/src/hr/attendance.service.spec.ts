import { AttendanceService } from './attendance.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

/*
 * These tests are about the derivation, and the derivation is what they should
 * test. Every method now authorises through a scope helper that needs a real
 * actor and tenant context; stubbing it to a tenant-wide scope keeps these
 * unit tests on their own subject. Authorisation is proved where it can be —
 * in `authorization-scope.e2e-spec.ts`, against a real database and a real
 * signed token.
 */
function grantEveryBranch(service: object) {
  const tenantWide = (id?: string) => ({
    clinicIds: [],
    everyBranch: true,
    filter: {},
    staffFilter: {},
    assert: () => id ?? null,
    where: () => (id ? { clinicId: id } : {}),
    sqlClinicIds: () => null,
    require: (requested?: string | null) => requested ?? 'clinic-1',
  });
  const patched = service as { readScope?: unknown; writeScope?: unknown };
  patched.readScope = async () => tenantWide();
  patched.writeScope = async () => tenantWide();
  return service;
}


function createService() {
  const prisma = { visit: { findMany: jest.fn() } } as unknown as TenantScopedPrismaClient;
  return { service: grantEveryBranch(new AttendanceService(prisma, {} as never)) as AttendanceService, prisma };
}

describe('AttendanceService', () => {
  it('groups visits by staff and day, taking the earliest check-in and latest check-out', async () => {
    const { service, prisma } = createService();
    (prisma.visit.findMany as jest.Mock).mockResolvedValue([
      {
        staffId: 'staff-1',
        staff: { fullName: 'Dr. Amira Rahman' },
        checkInAt: new Date('2026-07-31T09:00:00Z'),
        checkOutAt: new Date('2026-07-31T09:30:00Z'),
      },
      {
        staffId: 'staff-1',
        staff: { fullName: 'Dr. Amira Rahman' },
        checkInAt: new Date('2026-07-31T08:00:00Z'),
        checkOutAt: new Date('2026-07-31T08:30:00Z'),
      },
      {
        staffId: 'staff-1',
        staff: { fullName: 'Dr. Amira Rahman' },
        checkInAt: new Date('2026-07-31T14:00:00Z'),
        checkOutAt: null,
      },
    ]);

    const result = await service.getAttendance({});

    expect(result).toEqual([
      {
        staffId: 'staff-1',
        staffName: 'Dr. Amira Rahman',
        date: '2026-07-31',
        firstCheckIn: new Date('2026-07-31T08:00:00Z'),
        lastCheckOut: new Date('2026-07-31T09:30:00Z'),
        visitCount: 3,
      },
    ]);
  });

  it('keeps different staff and different days as separate buckets', async () => {
    const { service, prisma } = createService();
    (prisma.visit.findMany as jest.Mock).mockResolvedValue([
      {
        staffId: 'staff-1',
        staff: { fullName: 'Dr. Amira Rahman' },
        checkInAt: new Date('2026-07-31T09:00:00Z'),
        checkOutAt: new Date('2026-07-31T09:30:00Z'),
      },
      {
        staffId: 'staff-2',
        staff: { fullName: 'Dr. Faizal Hakim' },
        checkInAt: new Date('2026-07-31T10:00:00Z'),
        checkOutAt: null,
      },
      {
        staffId: 'staff-1',
        staff: { fullName: 'Dr. Amira Rahman' },
        checkInAt: new Date('2026-08-01T09:00:00Z'),
        checkOutAt: null,
      },
    ]);

    const result = await service.getAttendance({});

    expect(result).toHaveLength(3);
  });
});
