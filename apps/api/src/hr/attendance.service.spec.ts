import { AttendanceService } from './attendance.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

function createService() {
  const prisma = { visit: { findMany: jest.fn() } } as unknown as TenantScopedPrismaClient;
  return { service: new AttendanceService(prisma), prisma };
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
