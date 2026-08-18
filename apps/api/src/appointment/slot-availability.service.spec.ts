import { SlotAvailabilityService, UnavailableReason } from './slot-availability.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { parseTimeToDate } from './time.util';

const STAFF_ID = 'staff-1';
const CLINIC_ID = 'clinic-1';
const SERVICE_ID = 'service-1';
// A Wednesday. Chosen so the weekday the roster matches on is unambiguous.
const DATE = new Date('2026-08-05T00:00:00.000Z');

// ===========================================================================
// THE CLINIC'S CLOCK
//
// Every instant below is Kuala Lumpur, UTC+8. A 09:00 clinic slot is
// 01:00Z, and the fact that these assertions used to read 09:00Z is the bug
// this file now pins closed: the engine built appointment instants with
// `Date.UTC(y, m, d, 9, 0)`, which is 5pm in Malaysia. On a UTC test runner
// the wrong instant rendered back as the right wall clock and nothing looked
// amiss. See the block comment in `time.util.ts`.
// ===========================================================================
const kl = (time: string) => `2026-08-05T${time}:00.000Z`;

interface World {
  timezone?: string;
  closedDate?: boolean;
  service?: {
    bookable?: boolean;
    active?: boolean;
    durationMinutesDefault?: number;
    slotIntervalMinutes?: number | null;
    concurrentLimit?: number | null;
  } | null;
  qualified?: boolean;
  config?: { slotLengthMinutes: number; dailyCapacity: number | null } | null;
  settings?: {
    firstSessionTime: Date;
    lastSessionTime: Date;
    minimumNoticeMinutes: number;
  } | null;
  exception?: { startTime: Date | null; endTime: Date | null } | null;
  schedules?: { startTime: Date; endTime: Date }[];
  /** The doctor's day, whatever the service. */
  occupied?: { scheduledStart: Date; scheduledEnd: Date }[];
  /** The service's day across every doctor — the room or the machine. */
  serviceOccupied?: { scheduledStart: Date; scheduledEnd: Date }[];
  bookedForService?: number;
  now?: Date;
}

function createService(world: World = {}) {
  const appointmentFindMany = jest.fn(async ({ where }: never) => {
    // The engine asks twice: once for the doctor, once for the service. The
    // service query is the one that carries a serviceId.
    const query = where as { serviceId?: string };
    return query?.serviceId ? (world.serviceOccupied ?? []) : (world.occupied ?? []);
  });

  const prisma = {
    clinic: {
      findUnique: jest.fn().mockResolvedValue({ timezone: world.timezone ?? 'Asia/Kuala_Lumpur' }),
    },
    clinicClosedDate: {
      findFirst: jest.fn().mockResolvedValue(world.closedDate ? { id: 'closed-1' } : null),
    },
    serviceCatalog: {
      findUnique: jest.fn().mockResolvedValue(
        world.service === null
          ? null
          : {
              bookable: world.service?.bookable ?? true,
              active: world.service?.active ?? true,
              durationMinutesDefault: world.service?.durationMinutesDefault ?? 30,
              slotIntervalMinutes:
                world.service?.slotIntervalMinutes === undefined
                  ? null
                  : world.service.slotIntervalMinutes,
              concurrentLimit:
                world.service?.concurrentLimit === undefined ? null : world.service.concurrentLimit,
            },
      ),
    },
    doctorServiceQualification: {
      findFirst: jest.fn().mockResolvedValue(world.qualified === false ? null : { id: 'q-1' }),
    },
    slotCapacityConfig: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          world.config === undefined ? { slotLengthMinutes: 30, dailyCapacity: null } : world.config,
        ),
    },
    clinicBookingSettings: {
      findFirst: jest.fn().mockResolvedValue(world.settings ?? null),
    },
    scheduleException: {
      findFirst: jest.fn().mockResolvedValue(world.exception ?? null),
    },
    doctorSchedule: {
      findMany: jest.fn().mockResolvedValue(world.schedules ?? []),
    },
    appointment: {
      findMany: appointmentFindMany,
      count: jest.fn().mockResolvedValue(world.bookedForService ?? 0),
    },
  } as unknown as TenantScopedPrismaClient;

  const service = new SlotAvailabilityService(prisma);
  const ask = () =>
    service.findAvailability({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
      // Far in the past by default, so minimum notice never fires unless a
      // test is about minimum notice.
      now: world.now ?? new Date('2026-01-01T00:00:00.000Z'),
    });

  return { service, prisma, ask };
}

const NINE_TO_TEN = [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') }];

describe('the clinic clock — an instant is not a wall clock', () => {
  it('1. a 09:00 Kuala Lumpur slot is 01:00Z, not 09:00Z', async () => {
    // The whole point. Stored as a real instant, so a browser anywhere can
    // render it and a tariff engine can compare it.
    const { ask } = createService({ schedules: NINE_TO_TEN });

    const { slots } = await ask();

    expect(slots).toHaveLength(2);
    expect(slots[0].start.toISOString()).toBe(kl('01:00'));
    expect(slots[0].end.toISOString()).toBe(kl('01:30'));
    expect(slots[1].start.toISOString()).toBe(kl('01:30'));
  });

  it('2. a clinic in another zone gets that zone, not the server default', async () => {
    const { ask } = createService({ timezone: 'Asia/Kolkata', schedules: NINE_TO_TEN });

    const { slots } = await ask();

    // UTC+5:30 — and the half-hour offset is the case a naive integer would
    // have got wrong.
    expect(slots[0].start.toISOString()).toBe(kl('03:30'));
  });

  it('3. the doctor-busy window is compared as an instant, not a wall clock', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      occupied: [{ scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) }],
    });

    const { slots } = await ask();

    expect(slots).toHaveLength(1);
    expect(slots[0].start.toISOString()).toBe(kl('01:30'));
  });
});

describe('the six constraints, each on its own', () => {
  const cases: [string, World, UnavailableReason][] = [
    ['the clinic is shut that day', { closedDate: true, schedules: NINE_TO_TEN }, 'CLINIC_CLOSED'],
    ['the service is not bookable', { service: { bookable: false }, schedules: NINE_TO_TEN }, 'SERVICE_NOT_BOOKABLE'],
    ['the service is retired', { service: { active: false }, schedules: NINE_TO_TEN }, 'SERVICE_NOT_BOOKABLE'],
    ['the service does not exist', { service: null, schedules: NINE_TO_TEN }, 'SERVICE_NOT_BOOKABLE'],
    ['the doctor is not mapped to it', { qualified: false, schedules: NINE_TO_TEN }, 'NOT_QUALIFIED'],
    ['the doctor is not rostered', { schedules: [] }, 'NOT_ROSTERED'],
    ['the doctor took the day off', { exception: { startTime: null, endTime: null } }, 'NOT_ROSTERED'],
  ];

  it.each(cases)('4. %s → no slots, and it says why', async (_label, world, reason) => {
    const { ask } = createService(world);

    const result = await ask();

    expect(result.slots).toEqual([]);
    // The reason is the point. "No slots" with no explanation is what makes a
    // front desk phone the developer.
    expect(result.reason).toBe(reason);
  });

  it('5. a date that offers slots carries no reason', async () => {
    const { ask } = createService({ schedules: NINE_TO_TEN });

    const result = await ask();

    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.reason).toBeNull();
  });
});

describe('the per-date override beats the weekly pattern', () => {
  it('6. an override with hours replaces the roster for that date', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      exception: { startTime: parseTimeToDate('14:00'), endTime: parseTimeToDate('15:00') },
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([kl('06:00'), kl('06:30')]);
  });
});

describe("the clinic's booking window narrows the roster, never widens it", () => {
  const window = (first: string, last: string, notice = 0) => ({
    firstSessionTime: parseTimeToDate(first),
    lastSessionTime: parseTimeToDate(last),
    minimumNoticeMinutes: notice,
  });

  it('7. a doctor rostered 08:00-20:00 at a 09:00-11:00 clinic is offered 09:00-11:00', async () => {
    const { ask } = createService({
      schedules: [{ startTime: parseTimeToDate('08:00'), endTime: parseTimeToDate('20:00') }],
      settings: window('09:00', '11:00'),
    });

    const { slots } = await ask();

    expect(slots).toHaveLength(4);
    expect(slots[0].start.toISOString()).toBe(kl('01:00'));
    expect(slots[3].end.toISOString()).toBe(kl('03:00'));
  });

  it('8. a doctor rostered INSIDE the clinic window keeps their own shorter hours', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      settings: window('08:00', '18:00'),
    });

    const { slots } = await ask();

    expect(slots).toHaveLength(2);
  });

  it('9. a roster entirely outside the window offers nothing, and says which', async () => {
    const { ask } = createService({
      schedules: [{ startTime: parseTimeToDate('19:00'), endTime: parseTimeToDate('21:00') }],
      settings: window('09:00', '17:00'),
    });

    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('OUTSIDE_BOOKING_WINDOW');
  });
});

describe('minimum notice — a slot the front desk cannot honour is not a slot', () => {
  it('10. 60 minutes notice drops the next hour and keeps the rest', async () => {
    const { ask } = createService({
      schedules: [{ startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('11:00') }],
      settings: {
        firstSessionTime: parseTimeToDate('00:00'),
        lastSessionTime: parseTimeToDate('23:30'),
        minimumNoticeMinutes: 60,
      },
      // 09:15 Kuala Lumpur. With an hour's notice the first bookable start is
      // 10:15, so 10:30 is the first slot on a 30-minute grid.
      now: new Date(kl('01:15')),
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([kl('02:30')]);
  });

  it('11. notice that swallows the whole day says TOO_LATE_TO_BOOK, not FULLY_BOOKED', async () => {
    // Different words because they are different problems: one is fixed by
    // phoning, the other by picking another day.
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      settings: {
        firstSessionTime: parseTimeToDate('00:00'),
        lastSessionTime: parseTimeToDate('23:30'),
        minimumNoticeMinutes: 24 * 60,
      },
      now: new Date(kl('00:30')),
    });

    const result = await ask();

    expect(result.reason).toBe('TOO_LATE_TO_BOOK');
  });

  it('12. zero notice books the very next slot', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      settings: {
        firstSessionTime: parseTimeToDate('00:00'),
        lastSessionTime: parseTimeToDate('23:30'),
        minimumNoticeMinutes: 0,
      },
      now: new Date(kl('00:59')),
    });

    const { slots } = await ask();

    expect(slots[0].start.toISOString()).toBe(kl('01:00'));
  });
});

describe('capacity — the doctor, the room, and the day', () => {
  it('13. a 30-minute service on a 15-minute interval starts every 15 minutes', async () => {
    // The stride and the duration are different numbers. 09:00, 09:15 and
    // 09:30 all fit inside a 09:00-10:00 window when each runs 30 minutes.
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      config: null,
      service: { durationMinutesDefault: 30, slotIntervalMinutes: 15 },
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([
      kl('01:00'),
      kl('01:15'),
      kl('01:30'),
    ]);
    expect(slots[0].end.toISOString()).toBe(kl('01:30'));
  });

  it('14. a bookable service needs no per-doctor capacity row to be offered', async () => {
    // The old engine returned [] with no SlotCapacityConfig, which made the
    // public page impossible: a clinic would have had to write one row per
    // doctor per service before a patient could see anything.
    const { ask } = createService({ schedules: NINE_TO_TEN, config: null });

    const { slots } = await ask();

    expect(slots).toHaveLength(2);
  });

  it('15. the per-doctor slot length overrides the service duration', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      config: { slotLengthMinutes: 20, dailyCapacity: null },
    });

    const { slots } = await ask();

    expect(slots).toHaveLength(3);
    expect(slots[0].end.toISOString()).toBe(kl('01:20'));
  });

  it('16. the concurrent limit counts the ROOM, across every doctor', async () => {
    // One ultrasound machine. Another doctor already has it at 09:00, so this
    // doctor cannot be offered 09:00 even though their own diary is clear.
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      service: { concurrentLimit: 1 },
      serviceOccupied: [
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
      ],
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([kl('01:30')]);
  });

  it('17. two rooms allow two at once and refuse the third', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      service: { concurrentLimit: 2 },
      serviceOccupied: [
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
      ],
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([kl('01:30')]);
  });

  it('18. no concurrent limit means the room never blocks', async () => {
    const { ask } = createService({
      schedules: NINE_TO_TEN,
      service: { concurrentLimit: null },
      serviceOccupied: [
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
      ],
    });

    const { slots } = await ask();

    expect(slots).toHaveLength(2);
  });

  it('19. remaining capacity GATES the day, it does not truncate the list', async () => {
    // With a cap of 1 and nothing booked, exactly one more booking may be
    // made — and the patient may pick EITHER free slot for it. Slicing to the
    // first entry, which this used to do, let them pick only the earliest and
    // made "is this slot bookable" unanswerable from the offered list.
    const { ask } = createService({
      config: { slotLengthMinutes: 30, dailyCapacity: 1 },
      schedules: NINE_TO_TEN,
    });

    const { slots } = await ask();

    expect(slots.map((slot) => slot.start.toISOString())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('21. the appointment being rescheduled does not block its own move', async () => {
    // The 09:00 booking is the one being moved. Without the exclusion it is
    // the thing refusing the move.
    const { service, prisma } = createService({
      schedules: NINE_TO_TEN,
      config: { slotLengthMinutes: 30, dailyCapacity: 1 },
      service: { concurrentLimit: 1 },
    });

    await service.findAvailability({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
      now: new Date('2026-01-01T00:00:00.000Z'),
      excludeAppointmentId: 'appt-being-moved',
    });

    // The exclusion has to reach EVERY count of "what is already there" — the
    // doctor's diary, the room, and the daily cap. Missing one is the bug
    // where an appointment blocks its own reschedule.
    const exclusion = { id: { not: 'appt-being-moved' } };
    const findMany = prisma.appointment.findMany as jest.Mock;
    expect(findMany).toHaveBeenCalledTimes(2);
    for (const call of findMany.mock.calls) {
      expect(call[0].where).toMatchObject(exclusion);
    }
    expect(prisma.appointment.count as jest.Mock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining(exclusion) }),
    );
  });

  it('20. a day already at capacity says FULLY_BOOKED', async () => {
    const { ask } = createService({
      config: { slotLengthMinutes: 30, dailyCapacity: 2 },
      schedules: NINE_TO_TEN,
      bookedForService: 2,
    });

    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('FULLY_BOOKED');
  });
});
