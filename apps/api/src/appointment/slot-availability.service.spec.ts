import { SlotAvailabilityService, UnavailableReason } from './slot-availability.service';
import { ProviderScheduleModeService } from './provider-schedule-mode.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { parseTimeToDate } from './time.util';

const STAFF_ID = 'staff-1';
const CLINIC_ID = 'clinic-1';
const SERVICE_ID = 'service-1';
// A Wednesday. Chosen so the weekday the roster matches on is unambiguous.
const DATE = new Date('2026-08-05T00:00:00.000Z');
const THURSDAY = new Date('2026-08-06T00:00:00.000Z');

// ===========================================================================
// THE CLINIC'S CLOCK
//
// Every instant below is Kuala Lumpur, UTC+8. A 09:00 clinic slot is
// 01:00Z, and the fact that these assertions used to read 09:00Z is the bug
// this file pins closed: the engine built appointment instants with
// `Date.UTC(y, m, d, 9, 0)`, which is 5pm in Malaysia. On a UTC test runner
// the wrong instant rendered back as the right wall clock and nothing looked
// amiss. See the block comment in `time.util.ts`.
// ===========================================================================
const kl = (time: string) => `2026-08-05T${time}:00.000Z`;
const klThu = (time: string) => `2026-08-06T${time}:00.000Z`;

interface Busy {
  staffId?: string;
  serviceId?: string;
  scheduledStart: Date;
  scheduledEnd: Date;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}

interface Shift {
  shiftType?: 'WORKING' | 'OFF' | 'LEAVE' | 'BLOCKED' | 'LOCUM';
  startsAt: Date;
  endsAt: Date;
  bookableStartsAt?: Date | null;
  bookableEndsAt?: Date | null;
}

interface World {
  timezone?: string;
  closedDate?: boolean;
  publicHoliday?: boolean;
  onLeave?: boolean;
  /** ROSTER_LINKED reads `shifts`; FIXED_WEEKLY reads `schedules`. */
  scheduleMode?: 'ROSTER_LINKED' | 'FIXED_WEEKLY';
  /**
   * Effective-dated mode DECISIONS (§18b). When any exist, the latest one on
   * or before the queried date governs and `scheduleMode` above — the legacy
   * staff column — is not consulted at all.
   */
  modePeriods?: { mode: 'ROSTER_LINKED' | 'FIXED_WEEKLY'; effectiveFrom: Date }[];
  shifts?: Shift[];
  service?: {
    bookable?: boolean;
    active?: boolean;
    durationMinutesDefault?: number;
    slotIntervalMinutes?: number | null;
    concurrentLimit?: number | null;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    maxAdvanceDays?: number | null;
    minimumNoticeMinutes?: number | null;
  } | null;
  serviceHours?: { dayOfWeek: number; startTime: Date; endTime: Date }[];
  qualified?: boolean;
  config?: { slotLengthMinutes: number; dailyCapacity: number | null } | null;
  settings?: {
    firstSessionTime?: Date | null;
    lastSessionTime?: Date | null;
    minimumNoticeMinutes?: number;
    maxAdvanceDays?: number | null;
    observePublicHolidays?: boolean;
  } | null;
  exception?: { startTime: Date | null; endTime: Date | null } | null;
  schedules?: { dayOfWeek?: number; startTime: Date; endTime: Date }[];
  occupied?: Busy[];
  bookedForService?: number;
  now?: Date;
  date?: Date;
}

function createService(world: World = {}) {
  const prisma = {
    clinic: {
      findUnique: jest.fn().mockResolvedValue({ timezone: world.timezone ?? 'Asia/Kuala_Lumpur' }),
    },
    clinicClosedDate: {
      findFirst: jest.fn().mockResolvedValue(world.closedDate ? { id: 'closed-1' } : null),
    },
    publicHoliday: {
      findFirst: jest.fn().mockResolvedValue(world.publicHoliday ? { id: 'ph-1' } : null),
    },
    leaveRequest: {
      findFirst: jest.fn().mockResolvedValue(world.onLeave ? { id: 'leave-1' } : null),
    },
    staff: {
      findUnique: jest
        .fn()
        .mockResolvedValue({ appointmentScheduleMode: world.scheduleMode ?? 'FIXED_WEEKLY' }),
      findMany: jest.fn().mockResolvedValue([{ id: STAFF_ID }]),
    },
    providerScheduleModePeriod: {
      findFirst: jest.fn(async ({ where }: never) => {
        const cutoff = (where as { effectiveFrom: { lte: Date } }).effectiveFrom.lte;
        const governing = [...(world.modePeriods ?? [])]
          .filter((period) => period.effectiveFrom <= cutoff)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        return governing ? { mode: governing.mode } : null;
      }),
      findMany: jest.fn(async () => world.modePeriods ?? []),
    },
    providerShift: {
      findMany: jest.fn(async ({ where }: never) => {
        const bounds = (where as { startsAt: { lt: Date }; endsAt: { gt: Date } });
        return (world.shifts ?? [])
          .filter((s) => s.startsAt < bounds.startsAt.lt && s.endsAt > bounds.endsAt.gt)
          .map((s) => ({
            shiftType: s.shiftType ?? 'WORKING',
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            bookableStartsAt: s.bookableStartsAt ?? null,
            bookableEndsAt: s.bookableEndsAt ?? null,
          }));
      }),
    },
    serviceCatalog: {
      findUnique: jest.fn().mockResolvedValue(
        world.service === null
          ? null
          : {
              bookable: world.service?.bookable ?? true,
              active: world.service?.active ?? true,
              durationMinutesDefault: world.service?.durationMinutesDefault ?? 30,
              slotIntervalMinutes: world.service?.slotIntervalMinutes ?? null,
              concurrentLimit: world.service?.concurrentLimit ?? null,
              bufferBeforeMinutes: world.service?.bufferBeforeMinutes ?? 0,
              bufferAfterMinutes: world.service?.bufferAfterMinutes ?? 0,
              maxAdvanceDays: world.service?.maxAdvanceDays ?? null,
              minimumNoticeMinutes: world.service?.minimumNoticeMinutes ?? null,
            },
      ),
    },
    serviceBookableHour: {
      findMany: jest.fn(async ({ where }: never) => {
        const day = (where as { dayOfWeek: number }).dayOfWeek;
        return (world.serviceHours ?? []).filter((h) => h.dayOfWeek === day);
      }),
    },
    doctorServiceQualification: {
      findFirst: jest.fn().mockResolvedValue(world.qualified === false ? null : { id: 'q-1' }),
      findMany: jest.fn().mockResolvedValue([{ staffId: STAFF_ID }]),
    },
    slotCapacityConfig: {
      findFirst: jest
        .fn()
        .mockResolvedValue(
          world.config === undefined ? { slotLengthMinutes: 30, dailyCapacity: null } : world.config,
        ),
    },
    clinicBookingSettings: {
      findFirst: jest.fn().mockResolvedValue(
        world.settings === undefined || world.settings === null
          ? null
          : {
              firstSessionTime: world.settings.firstSessionTime ?? null,
              lastSessionTime: world.settings.lastSessionTime ?? null,
              minimumNoticeMinutes: world.settings.minimumNoticeMinutes ?? 0,
              maxAdvanceDays: world.settings.maxAdvanceDays ?? null,
              observePublicHolidays: world.settings.observePublicHolidays ?? false,
            },
      ),
    },
    scheduleException: {
      findFirst: jest.fn().mockResolvedValue(world.exception ?? null),
    },
    doctorSchedule: {
      findMany: jest.fn(async ({ where }: never) => {
        const days = (where as { dayOfWeek: { in: number[] } }).dayOfWeek.in;
        return (world.schedules ?? []).map((s) => ({ dayOfWeek: s.dayOfWeek ?? days[0], ...s }));
      }),
    },
    appointment: {
      findMany: jest.fn(async () =>
        (world.occupied ?? []).map((row) => ({
          staffId: row.staffId ?? STAFF_ID,
          serviceId: row.serviceId ?? SERVICE_ID,
          scheduledStart: row.scheduledStart,
          scheduledEnd: row.scheduledEnd,
          service: {
            bufferBeforeMinutes: row.bufferBeforeMinutes ?? 0,
            bufferAfterMinutes: row.bufferAfterMinutes ?? 0,
          },
        })),
      ),
      count: jest.fn().mockResolvedValue(world.bookedForService ?? 0),
    },
  } as unknown as TenantScopedPrismaClient;

  // The REAL resolver over the same mocked world — the point of §18b is that
  // the engine and the resolver are one path, so the tests walk that path.
  const service = new SlotAvailabilityService(prisma, new ProviderScheduleModeService(prisma));
  const ask = (overrides: { date?: Date; excludeAppointmentId?: string } = {}) =>
    service.findAvailability({
      staffId: STAFF_ID,
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: overrides.date ?? world.date ?? DATE,
      // Far in the past by default, so minimum notice never fires unless a
      // test is about minimum notice.
      now: world.now ?? new Date('2026-01-01T00:00:00.000Z'),
      excludeAppointmentId: overrides.excludeAppointmentId,
    });

  return { service, prisma, ask };
}

/** A weekly roster row, in the clinic's wall clock. */
const weekly = (start: string, end: string) => ({
  startTime: parseTimeToDate(start),
  endTime: parseTimeToDate(end),
});

const starts = (result: { slots: { start: Date }[] }) =>
  result.slots.map((slot) => slot.start.toISOString());

// ===========================================================================
describe('the clinic clock — an instant is not a wall clock', () => {
  it('1. a 09:00 Kuala Lumpur slot is 01:00Z, not 09:00Z', async () => {
    const { ask } = createService({ schedules: [weekly('09:00', '10:00')] });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('2. a clinic in another zone gets that zone, not the server default', async () => {
    const { ask } = createService({
      timezone: 'Asia/Tokyo',
      schedules: [weekly('09:00', '10:00')],
    });

    // Tokyo is UTC+9, so 09:00 there is 00:00Z.
    expect(starts(await ask())).toEqual(['2026-08-05T00:00:00.000Z', '2026-08-05T00:30:00.000Z']);
  });

  it('3. the doctor-busy window is compared as an instant, not a wall clock', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      occupied: [
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:30')]);
  });
});

// ===========================================================================
describe('the precedence — first refusal wins, in the order a person says them', () => {
  it.each<[string, World, UnavailableReason]>([
    ['the clinic is shut', { closedDate: true }, 'CLINIC_CLOSED'],
    [
      'a public holiday this branch observes',
      { publicHoliday: true, settings: { observePublicHolidays: true } },
      'PUBLIC_HOLIDAY',
    ],
    ['the service is not bookable', { service: { bookable: false } }, 'SERVICE_NOT_BOOKABLE'],
    ['the service is inactive', { service: { active: false } }, 'SERVICE_NOT_BOOKABLE'],
    ['the doctor is on approved leave', { onLeave: true }, 'ON_LEAVE'],
    ['the doctor is not rostered', { schedules: [] }, 'NOT_ROSTERED'],
    [
      'the doctor took the day off',
      { exception: { startTime: null, endTime: null }, schedules: [weekly('09:00', '17:00')] },
      'PROVIDER_BLOCKED',
    ],
    [
      'the doctor is not mapped to the service',
      { qualified: false, schedules: [weekly('09:00', '17:00')] },
      'NOT_QUALIFIED',
    ],
  ])('4. %s → no slots, and it says why', async (_label, world, reason) => {
    const { ask } = createService(world);
    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe(reason);
  });

  it('5. a date that offers slots carries no reason', async () => {
    const { ask } = createService({ schedules: [weekly('09:00', '10:00')] });

    expect((await ask()).reason).toBeNull();
  });

  it('6. a public holiday the branch does NOT observe is an ordinary working day', async () => {
    // Tenant-wide holidays are a payroll fact first. Plenty of clinics open on
    // one, and a migration must never shut a diary nobody asked to shut.
    const { ask } = createService({
      publicHoliday: true,
      settings: { observePublicHolidays: false },
      schedules: [weekly('09:00', '10:00')],
    });

    expect((await ask()).slots).toHaveLength(2);
  });

  it('7. approved leave beats the roster — the doctor is rostered and still unavailable', async () => {
    // THE DEFECT THIS CLOSES. `LeaveRequest` was live in HR and the engine had
    // never heard of it, so a doctor on approved annual leave was still
    // offered for booking unless somebody typed the absence a second time.
    const { ask, prisma } = createService({
      onLeave: true,
      schedules: [weekly('09:00', '17:00')],
    });
    const result = await ask();

    expect(result.reason).toBe('ON_LEAVE');
    expect(prisma.leaveRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'APPROVED' }) }),
    );
  });
});

// ===========================================================================
describe('overnight shifts — the case the old model could not express', () => {
  it('8. FIXED_WEEKLY: 23:00 → 09:00 offers the evening hour on the shift date', async () => {
    // `end <= start` used to yield a window the slot loop ran zero times over,
    // so a night doctor was silently unbookable — no error, no empty state.
    const { ask } = createService({
      schedules: [{ dayOfWeek: 3, ...weekly('23:00', '09:00') }],
    });

    // 23:00 and 23:30 KL on the Wednesday, which is 15:00Z and 15:30Z.
    expect(starts(await ask())).toEqual([kl('15:00'), kl('15:30')]);
  });

  it('9. FIXED_WEEKLY: the same shift offers the MORNING half on the following date', async () => {
    // Wednesday's 23:00 shift is still running at 02:00 on Thursday, and a
    // patient booking Thursday morning must be offered it.
    const { ask } = createService({
      schedules: [{ dayOfWeek: 3, ...weekly('23:00', '09:00') }],
      date: THURSDAY,
    });
    const result = await ask();

    // Thursday 00:00 KL is 16:00Z on Wednesday; the last 30-minute slot starts
    // at 08:30 KL = 00:30Z Thursday.
    expect(result.slots[0].start.toISOString()).toBe('2026-08-05T16:00:00.000Z');
    expect(result.slots[result.slots.length - 1].start.toISOString()).toBe(klThu('00:30'));
  });

  it('10. ROSTER_LINKED: one shift crossing midnight is one shift, not two', async () => {
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [{ startsAt: new Date(kl('15:00')), endsAt: new Date(klThu('01:00')) }],
      date: THURSDAY,
    });
    const result = await ask();

    // The Thursday half only: 00:00 KL (16:00Z Wed) through 09:00 KL.
    expect(result.slots[0].start.toISOString()).toBe('2026-08-05T16:00:00.000Z');
    expect(result.reason).toBeNull();
  });

  it('11. a 24-hour clinic with no session times offers the whole day', async () => {
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        {
          startsAt: new Date('2026-08-04T16:00:00.000Z'),
          endsAt: new Date('2026-08-05T16:00:00.000Z'),
        },
      ],
      settings: { firstSessionTime: null, lastSessionTime: null },
    });

    expect((await ask()).slots).toHaveLength(48);
  });
});

// ===========================================================================
describe('multiple shifts in one day — the other case the old model could not express', () => {
  it('12. 08:00-15:00 and 20:00-23:00 both offer slots, and the gap offers none', async () => {
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        { startsAt: new Date(kl('00:00')), endsAt: new Date(kl('01:00')) }, // 08:00-09:00 KL
        { startsAt: new Date(kl('12:00')), endsAt: new Date(kl('13:00')) }, // 20:00-21:00 KL
      ],
    });

    expect(starts(await ask())).toEqual([kl('00:00'), kl('00:30'), kl('12:00'), kl('12:30')]);
  });

  it('13. a BLOCKED shift carves a hole out of a working one', async () => {
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        { startsAt: new Date(kl('01:00')), endsAt: new Date(kl('03:00')) },
        { shiftType: 'BLOCKED', startsAt: new Date(kl('01:30')), endsAt: new Date(kl('02:30')) },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('02:30')]);
  });

  it('14. an OFF day is NOT_ROSTERED; a LEAVE day says the provider is blocked', async () => {
    const off = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [{ shiftType: 'OFF', startsAt: new Date(kl('00:00')), endsAt: new Date(kl('12:00')) }],
    });
    const leave = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        { shiftType: 'LEAVE', startsAt: new Date(kl('00:00')), endsAt: new Date(kl('12:00')) },
      ],
    });

    expect((await off.ask()).reason).toBe('NOT_ROSTERED');
    expect((await leave.ask()).reason).toBe('PROVIDER_BLOCKED');
  });

  it('15. a LOCUM shift offers time exactly as a working one does', async () => {
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        { shiftType: 'LOCUM', startsAt: new Date(kl('01:00')), endsAt: new Date(kl('02:00')) },
      ],
    });

    expect((await ask()).slots).toHaveLength(2);
  });

  it('16. bookable hours narrower than working hours offer only the narrow band', async () => {
    // The doctor works 09:00-17:00 and takes bookings only until 10:00. They
    // are still at work for the rest; it is simply not offered.
    const { ask } = createService({
      scheduleMode: 'ROSTER_LINKED',
      shifts: [
        {
          startsAt: new Date(kl('01:00')),
          endsAt: new Date(kl('09:00')),
          bookableStartsAt: new Date(kl('01:00')),
          bookableEndsAt: new Date(kl('02:00')),
        },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });
});

// ===========================================================================
describe('the per-date override beats the weekly pattern', () => {
  it('17. an override with hours replaces the roster for that date', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '17:00')],
      exception: { startTime: parseTimeToDate('14:00'), endTime: parseTimeToDate('15:00') },
    });

    expect(starts(await ask())).toEqual([kl('06:00'), kl('06:30')]);
  });
});

// ===========================================================================
describe("the clinic's booking window narrows the roster, never widens it", () => {
  const window = (first: string, last: string) => ({
    firstSessionTime: parseTimeToDate(first),
    lastSessionTime: parseTimeToDate(last),
    minimumNoticeMinutes: 0,
  });

  it('18. a doctor rostered 08:00-20:00 at a 09:00-11:00 clinic is offered 09:00-11:00', async () => {
    const { ask } = createService({
      schedules: [weekly('08:00', '20:00')],
      settings: window('09:00', '11:00'),
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30'), kl('02:00'), kl('02:30')]);
  });

  it('19. a doctor rostered INSIDE the clinic window keeps their own shorter hours', async () => {
    const { ask } = createService({
      schedules: [weekly('10:00', '11:00')],
      settings: window('09:00', '17:00'),
    });

    expect(starts(await ask())).toEqual([kl('02:00'), kl('02:30')]);
  });

  it('20. a roster entirely outside the window offers nothing, and says which', async () => {
    const { ask } = createService({
      schedules: [weekly('19:00', '20:00')],
      settings: window('09:00', '17:00'),
    });
    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('OUTSIDE_BOOKING_WINDOW');
  });

  it('21. only a LAST session set narrows one end and leaves the other alone', async () => {
    const { ask } = createService({
      schedules: [weekly('08:00', '20:00')],
      settings: { firstSessionTime: null, lastSessionTime: parseTimeToDate('09:00') },
    });

    expect(starts(await ask())).toEqual([kl('00:00'), kl('00:30')]);
  });
});

// ===========================================================================
describe("a service's own bookable hours narrow it further", () => {
  it('22. ear microsuction offered only in the mornings', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '17:00')],
      // Wednesday = 3.
      serviceHours: [
        { dayOfWeek: 3, startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('23. a day the service is not offered at all says so', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '17:00')],
      // Only Mondays.
      serviceHours: [
        { dayOfWeek: 1, startTime: parseTimeToDate('09:00'), endTime: parseTimeToDate('10:00') },
      ],
    });
    const result = await ask();

    // No rows for Wednesday means "no restriction", not "closed" — the
    // restriction is per weekday and an absent weekday is an unrestricted one.
    expect(result.reason).toBeNull();
    expect(result.slots.length).toBeGreaterThan(0);
  });

  it('24. service hours that miss the roster entirely say OUTSIDE_SERVICE_HOURS', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '12:00')],
      serviceHours: [
        { dayOfWeek: 3, startTime: parseTimeToDate('14:00'), endTime: parseTimeToDate('16:00') },
      ],
    });

    expect((await ask()).reason).toBe('OUTSIDE_SERVICE_HOURS');
  });
});

// ===========================================================================
describe('minimum notice and the booking horizon', () => {
  it('25. 60 minutes notice drops the next hour and keeps the rest', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { minimumNoticeMinutes: 60 },
      now: new Date(kl('00:45')),
    });

    expect(starts(await ask())).toEqual([kl('02:00'), kl('02:30')]);
  });

  it('26. notice that swallows the whole day says TOO_LATE_TO_BOOK, not FULLY_BOOKED', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { minimumNoticeMinutes: 60 * 24 },
      now: new Date(kl('00:00')),
    });
    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('TOO_LATE_TO_BOOK');
  });

  it('27. zero notice books the very next slot', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      settings: { minimumNoticeMinutes: 0 },
      now: new Date(kl('00:59')),
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it("28. a service's own notice overrides the clinic's", async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { minimumNoticeMinutes: 0 },
      // 105 minutes from 08:45 is 10:30 — the clinic would have allowed 09:00.
      service: { minimumNoticeMinutes: 105 },
      now: new Date(kl('00:45')),
    });

    expect(starts(await ask())).toEqual([kl('02:30')]);
  });

  it('29. a date beyond the horizon says TOO_FAR_AHEAD', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { maxAdvanceDays: 7 },
      now: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect((await ask()).reason).toBe('TOO_FAR_AHEAD');
  });

  it('30. a date INSIDE the horizon is offered normally', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { maxAdvanceDays: 60 },
      now: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect((await ask()).reason).toBeNull();
  });

  it("31. a service's own horizon overrides the clinic's", async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      settings: { maxAdvanceDays: 365 },
      service: { maxAdvanceDays: 3 },
      now: new Date('2026-07-01T00:00:00.000Z'),
    });

    expect((await ask()).reason).toBe('TOO_FAR_AHEAD');
  });

  it('32. no horizon anywhere means no limit — a clinic that never said is not narrowed', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      now: new Date('2020-01-01T00:00:00.000Z'),
    });

    expect((await ask()).reason).toBeNull();
  });
});

// ===========================================================================
describe('duration, interval and buffers are three different numbers', () => {
  it('33. a 30-minute service on a 15-minute interval starts every 15 minutes', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { durationMinutesDefault: 30, slotIntervalMinutes: 15 },
      config: null,
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:15'), kl('01:30')]);
  });

  it('34. a 45-minute service on a 30-minute interval still needs 45 free minutes', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:30')],
      service: { durationMinutesDefault: 45, slotIntervalMinutes: 30 },
      config: null,
    });
    const result = await ask();

    // 10:00 is NOT offered: it would run to 10:45 and the roster ends at 10:30.
    // The interval says how often a slot may start; the duration still has to
    // fit behind it.
    expect(starts(result)).toEqual([kl('01:00'), kl('01:30')]);
    expect(result.slots[1].end.toISOString()).toBe(kl('02:15'));
  });

  it('35. a buffer AFTER keeps the next slot clear of an existing appointment', async () => {
    // 09:00-09:30 is booked, and the service needs 15 minutes of turnover, so
    // 09:30 is no longer offered — 10:00 is the next honest answer.
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      service: { bufferAfterMinutes: 15 },
      occupied: [
        {
          scheduledStart: new Date(kl('01:00')),
          scheduledEnd: new Date(kl('01:30')),
          bufferAfterMinutes: 15,
        },
      ],
    });

    expect(starts(await ask())).toEqual([kl('02:00'), kl('02:30')]);
  });

  it('36. a buffer BEFORE keeps the preceding slot clear', async () => {
    // 10:00-10:30 is booked and needs 15 minutes of preparation, so the room
    // is occupied from 09:45 and a 09:30-10:00 slot would run into it. Note
    // the padding is the BOOKED appointment's, not the candidate's — each
    // service brings its own turnover.
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      occupied: [
        {
          scheduledStart: new Date(kl('02:00')),
          scheduledEnd: new Date(kl('02:30')),
          bufferBeforeMinutes: 15,
        },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('02:30')]);
  });

  it('37. no buffers means back-to-back is fine, exactly as before', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      occupied: [
        { scheduledStart: new Date(kl('01:00')), scheduledEnd: new Date(kl('01:30')) },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:30'), kl('02:00'), kl('02:30')]);
  });
});

// ===========================================================================
describe('capacity — the doctor, the room, and the day', () => {
  it('38. a bookable service needs no per-doctor capacity row to be offered', async () => {
    const { ask } = createService({ schedules: [weekly('09:00', '10:00')], config: null });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('39. the per-doctor slot length overrides the service duration', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { durationMinutesDefault: 30 },
      config: { slotLengthMinutes: 20, dailyCapacity: null },
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:20'), kl('01:40')]);
  });

  it('40. the concurrent limit counts the ROOM, across every doctor', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { concurrentLimit: 1 },
      occupied: [
        {
          staffId: 'another-doctor',
          scheduledStart: new Date(kl('01:00')),
          scheduledEnd: new Date(kl('01:30')),
        },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:30')]);
  });

  it('41. two rooms allow two at once and refuse the third', async () => {
    const busy = (staffId: string) => ({
      staffId,
      scheduledStart: new Date(kl('01:00')),
      scheduledEnd: new Date(kl('01:30')),
    });
    const one = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { concurrentLimit: 2 },
      occupied: [busy('doc-a')],
    });
    const two = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { concurrentLimit: 2 },
      occupied: [busy('doc-a'), busy('doc-b')],
    });

    expect(starts(await one.ask())).toContain(kl('01:00'));
    expect(starts(await two.ask())).not.toContain(kl('01:00'));
  });

  it('42. no concurrent limit means the room never blocks', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '10:00')],
      service: { concurrentLimit: null },
      occupied: [
        {
          staffId: 'doc-a',
          scheduledStart: new Date(kl('01:00')),
          scheduledEnd: new Date(kl('01:30')),
        },
      ],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('43. remaining capacity GATES the day, it does not truncate the list', async () => {
    // With a cap of 5 and 4 booked, exactly one more may be made — and the
    // patient may pick ANY free slot for it. Slicing the list to its first
    // entry, which this used to do, let them pick only the earliest.
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      config: { slotLengthMinutes: 30, dailyCapacity: 5 },
      bookedForService: 4,
    });

    expect((await ask()).slots).toHaveLength(4);
  });

  it('44. a day already at capacity says FULLY_BOOKED', async () => {
    const { ask } = createService({
      schedules: [weekly('09:00', '11:00')],
      config: { slotLengthMinutes: 30, dailyCapacity: 4 },
      bookedForService: 4,
    });
    const result = await ask();

    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('FULLY_BOOKED');
  });

  it('45. the appointment being rescheduled does not block its own move', async () => {
    const { ask, prisma } = createService({ schedules: [weekly('09:00', '10:00')] });

    await ask({ excludeAppointmentId: 'appt-1' });

    expect(prisma.appointment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { not: 'appt-1' } }),
      }),
    );
  });
});

// ===========================================================================
describe('any available provider asks the same engine, once each', () => {
  it('46. every qualified provider gets their own answer with a real staff id', async () => {
    const { service } = createService({ schedules: [weekly('09:00', '10:00')] });

    const answers = await service.findAvailabilityAcrossProviders({
      clinicId: CLINIC_ID,
      serviceId: SERVICE_ID,
      date: DATE,
      now: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(answers).toHaveLength(1);
    expect(answers[0].staffId).toBe(STAFF_ID);
    expect(answers[0].slots).toHaveLength(2);
  });
});

// ===========================================================================
// §18b — THE MODE IS A FACT ABOUT A DATE, NOT ABOUT TODAY.
//
// "Weekly from 1 September" must answer a 5 September search with the weekly
// pattern while a 25 August search still reads the monthly roster — with no
// background job flipping anything on the day. These walk the REAL resolver
// (createService hands the engine a ProviderScheduleModeService over the same
// mocked world). Every caller — staff flow, public page, reschedule — funnels
// through the same findAvailability, so what these pin holds for all of them.
// ===========================================================================
describe('the effective-dated scheduling mode — resolved for the date being asked about', () => {
  // 2026-09-02 is the Wednesday four weeks after DATE.
  const SEP2 = new Date('2026-09-02T00:00:00.000Z');
  const sep2 = (time: string) => `2026-09-02T${time}:00.000Z`;

  it('47. BEFORE the effective date, the previous model still governs', async () => {
    const { ask } = createService({
      // Legacy column says FIXED_WEEKLY; the switch to the roster arrives 1 Sep.
      modePeriods: [{ mode: 'ROSTER_LINKED', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') }],
      schedules: [{ dayOfWeek: 3, ...weekly('09:00', '10:00') }],
      shifts: [{ startsAt: new Date(sep2('01:00')), endsAt: new Date(sep2('03:00')) }],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30')]);
  });

  it('48. ON the effective date itself, the new model governs — nothing had to "arrive"', async () => {
    const { ask } = createService({
      modePeriods: [{ mode: 'ROSTER_LINKED', effectiveFrom: SEP2 }],
      schedules: [{ dayOfWeek: 3, ...weekly('09:00', '10:00') }],
      shifts: [{ startsAt: new Date(sep2('01:00')), endsAt: new Date(sep2('03:00')) }],
    });

    expect(starts(await ask({ date: SEP2 }))).toEqual([
      sep2('01:00'),
      sep2('01:30'),
      sep2('02:00'),
      sep2('02:30'),
    ]);
  });

  it('49. a SECOND decision turns the answer over again, and both sides stay right', async () => {
    // Monthly since January, weekly from September — one world, two questions.
    const { ask } = createService({
      modePeriods: [
        { mode: 'ROSTER_LINKED', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') },
        { mode: 'FIXED_WEEKLY', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') },
      ],
      schedules: [{ dayOfWeek: 3, ...weekly('09:00', '10:00') }],
      shifts: [{ startsAt: new Date(kl('01:00')), endsAt: new Date(kl('03:00')) }],
    });

    expect(starts(await ask())).toEqual([kl('01:00'), kl('01:30'), kl('02:00'), kl('02:30')]);
    expect(starts(await ask({ date: SEP2 }))).toEqual([sep2('01:00'), sep2('01:30')]);
  });

  it('50. approved HR leave blocks the day in WHICHEVER model governs it', async () => {
    const roster = createService({
      onLeave: true,
      modePeriods: [{ mode: 'ROSTER_LINKED', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') }],
      shifts: [{ startsAt: new Date(kl('01:00')), endsAt: new Date(kl('03:00')) }],
    });
    const fixed = createService({ onLeave: true, schedules: [weekly('09:00', '10:00')] });

    expect((await roster.ask()).reason).toBe('ON_LEAVE');
    expect((await fixed.ask()).reason).toBe('ON_LEAVE');
  });

  it('51. a reschedule resolves the mode of its TARGET date, not of the original booking', async () => {
    const { ask } = createService({
      modePeriods: [
        { mode: 'ROSTER_LINKED', effectiveFrom: new Date('2026-01-01T00:00:00.000Z') },
        { mode: 'FIXED_WEEKLY', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') },
      ],
      schedules: [{ dayOfWeek: 3, ...weekly('09:00', '10:00') }],
      shifts: [{ startsAt: new Date(kl('01:00')), endsAt: new Date(kl('03:00')) }],
    });

    // The move originates in roster-governed August; the September target is
    // answered by the weekly pattern.
    const result = await ask({ date: SEP2, excludeAppointmentId: 'appt-1' });
    expect(starts(result)).toEqual([sep2('01:00'), sep2('01:30')]);
  });
});
