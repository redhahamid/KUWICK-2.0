import { SlotAvailabilityService } from './slot-availability.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { parseTimeToDate } from './time.util';

const STAFF_ID = 'staff-1';
const CLINIC_ID = 'clinic-1';
const SERVICE_ID = 'service-1';
const DATE = new Date('2026-08-05T00:00:00.000Z');

function createService(overrides: {
  config?: { slotLengthMinutes: number; dailyCapacity: number | null } | null;
  exception?: { startTime: Date | null; endTime: Date | null } | null;
  schedules?: { startTime: Date; endTime: Date }[];
  occupied?: { scheduledStart: Date; scheduledEnd: Date }[];
  bookedForService?: number;
}) {
  const prisma = {
    slotCapacityConfig: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          overrides.config === undefined
            ? { slotLengthMinutes: 30, dailyCapacity: null }
            : overrides.config,
        ),
    },
    scheduleException: {
      findFirst: jest.fn().mockResolvedValue(overrides.exception ?? null),
    },
    doctorSchedule: {
      findMany: jest.fn().mockResolvedValue(overrides.schedules ?? []),
    },
    appointment: {
      findMany: jest.fn().mockResolvedValue(overrides.occupied ?? []),
      count: jest.fn().mockResolvedValue(overrides.bookedForService ?? 0),
    },
  } as unknown as TenantScopedPrismaClient;

  return { service: new SlotAvailabilityService(prisma), prisma };
}

describe('SlotAvailabilityService', () => {
  it('returns no slots when there is no SlotCapacityConfig for the doctor/service/clinic', async () => {
    const { service } = createService({ config: null });
    const slots = await service.findAvailableSlots({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });
    expect(slots).toEqual([]);
  });

  it('returns no slots on a date fully blocked by a null-window exception', async () => {
    const { service } = createService({ exception: { startTime: null, endTime: null } });
    const slots = await service.findAvailableSlots({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });
    expect(slots).toEqual([]);
  });

  it('slices a 9:00-10:00 window into 30-minute slots with no bookings', async () => {
    const { service } = createService({
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') }],
    });
    const slots = await service.findAvailableSlots({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });
    expect(slots).toHaveLength(2);
    expect(slots[0].start.toISOString()).toBe('2026-08-05T09:00:00.000Z');
    expect(slots[1].start.toISOString()).toBe('2026-08-05T09:30:00.000Z');
  });

  it('excludes a slot that overlaps an existing occupied appointment', async () => {
    const { service } = createService({
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') }],
      occupied: [
        {
          scheduledStart: new Date('2026-08-05T09:00:00.000Z'),
          scheduledEnd: new Date('2026-08-05T09:30:00.000Z'),
        },
      ],
    });
    const slots = await service.findAvailableSlots({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });
    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe('2026-08-05T09:30:00.000Z');
  });

  it('caps the returned slots at the remaining daily capacity', async () => {
    const { service } = createService({
      config: { slotLengthMinutes: 30, dailyCapacity: 1 },
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') }],
      bookedForService: 0,
    });
    const slots = await service.findAvailableSlots({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
    });
    expect(slots).toHaveLength(1);
  });
});
