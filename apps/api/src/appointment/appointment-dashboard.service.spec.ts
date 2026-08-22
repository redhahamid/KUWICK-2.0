import { AppointmentStatus } from '@prisma/client';
import {
  AppointmentDashboardService,
  TAB_STATUSES,
  paymentStateOf,
} from './appointment-dashboard.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { SlotAvailabilityService } from './slot-availability.service';
import { tenantContextStorage } from '../core/tenant-context';

const CLINIC = 'clinic-1';

interface World {
  grouped?: { status: AppointmentStatus; count: number; fees?: number }[];
  live?: { bookingFeeAmount: number; price: number }[];
  /** Completed appointments that became visits, and what those visits billed. */
  invoices?: number[];
  rows?: Record<string, unknown>[];
  timeZone?: string;
}

function build(world: World = {}) {
  const findManyCalls: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  const prisma = {
    appointment: {
      groupBy: jest.fn(async () =>
        (world.grouped ?? []).map((row) => ({
          status: row.status,
          _count: { _all: row.count },
          _sum: { bookingFeeAmount: row.fees ?? 0 },
        })),
      ),
      findMany: jest.fn(async (args: never) => {
        const call = args as { where: { status?: unknown }; select?: unknown };
        findManyCalls.push(call);
        const status = call.where.status as { in?: AppointmentStatus[] } | AppointmentStatus;
        // The two money queries ask by status; the row query asks with an
        // include. Distinguished the same way the service distinguishes them.
        if (!call.select) return world.rows ?? [];
        // The realised-revenue query asks for completed appointments that
        // became visits, and reads the invoices on those visits.
        if (status === AppointmentStatus.COMPLETED) {
          return (world.invoices ?? []).map((_amount, index) => ({ visitId: `visit-${index}` }));
        }
        return (world.live ?? []).map((row) => ({
          bookingFeeAmount: row.bookingFeeAmount,
          service: { price: row.price },
        }));
      }),
      findUnique: jest.fn(async () => ({ id: 'appt-1', reminderSentAt: null })),
      update: jest.fn(async ({ data }: never) => {
        updates.push(data as Record<string, unknown>);
        return { id: 'appt-1', ...(data as object) };
      }),
    },
    invoice: {
      findMany: jest.fn(async () =>
        (world.invoices ?? []).map((totalAmount) => ({ totalAmount })),
      ),
    },
    waitlistEntry: { findMany: jest.fn(async () => []) },
  } as unknown as TenantScopedPrismaClient;

  const availability = {
    clinicTimeZone: jest.fn(async () => world.timeZone ?? 'Asia/Kuala_Lumpur'),
  } as unknown as SlotAvailabilityService;

  const service = new AppointmentDashboardService(prisma, availability);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, prisma, findManyCalls, updates, run };
}

const ask = (ctx: ReturnType<typeof build>, overrides: Record<string, unknown> = {}) =>
  ctx.run(() =>
    ctx.service.dashboard({
      clinicId: CLINIC,
      from: '2026-08-01',
      to: '2026-08-31',
      tab: 'UPCOMING',
      now: new Date('2026-08-18T02:00:00.000Z'),
      ...overrides,
    } as never),
  );

// ===========================================================================
// ONE QUERY SOURCE, TWO CONSUMERS.
//
// The stats bar and the reports module compute the same five numbers. Built
// twice they disagree the first time either definition moves, and the
// disagreement is found by an owner comparing a screen to a report and
// trusting neither. The definitions are pinned here.
// ===========================================================================

describe('the period is the CLINIC’s, not UTC’s', () => {
  it('1. a Malaysian August runs 31 Jul 16:00Z to 31 Aug 16:00Z', async () => {
    // Asking between UTC midnights puts the evening clinic on the wrong day
    // and quietly mis-states every count on the bar.
    const ctx = build();

    await ask(ctx);

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.scheduledStart.gte.toISOString()).toBe('2026-07-31T16:00:00.000Z');
    expect(where.scheduledStart.lt.toISOString()).toBe('2026-08-31T16:00:00.000Z');
  });

  it('2. the last day of the range is INCLUDED', async () => {
    const ctx = build();

    await ask(ctx, { from: '2026-08-18', to: '2026-08-18' });

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    // Midnight-to-midnight of that one clinic day, not a zero-width range.
    expect(where.scheduledStart.gte.toISOString()).toBe('2026-08-17T16:00:00.000Z');
    expect(where.scheduledStart.lt.toISOString()).toBe('2026-08-18T16:00:00.000Z');
  });

  it('3. a clinic in another zone gets its own day boundaries', async () => {
    const ctx = build({ timeZone: 'Asia/Kolkata' });

    await ask(ctx, { from: '2026-08-18', to: '2026-08-18' });

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.scheduledStart.gte.toISOString()).toBe('2026-08-17T18:30:00.000Z');
  });
});

describe('Phase 3 — the KPI band reacts to every active filter', () => {
  it('3a. service, source and patient-search filters reach the STATS query, not only the rows', async () => {
    // The owner's use case: filter to EAR ENDOSCOPIC SUCTION and read that
    // service's own upcoming/no-show/booked-value figures. A stats query that
    // ignored the filter would caption the whole clinic's numbers over a
    // filtered worklist.
    const ctx = build();

    await ask(ctx, {
      serviceIds: ['svc-ear', 'svc-ear-2'],
      sources: ['ONLINE_PORTAL'],
      search: 'Aminah',
    });

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.serviceId).toEqual({ in: ['svc-ear', 'svc-ear-2'] });
    expect(where.source).toEqual({ in: ['ONLINE_PORTAL'] });
    expect(where.patient.OR[0].name.contains).toBe('Aminah');
  });

  it('3b. a source string Prisma does not know is dropped, not sent', async () => {
    // Handing an unknown enum value to Prisma is a 500 nobody can act on; an
    // unknown filter filters nothing instead.
    const ctx = build();

    await ask(ctx, { sources: ['CARRIER_PIGEON'] });

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    expect(where.source).toBeUndefined();
  });

  it('3c. the row query carries the same service filter as the stats query', async () => {
    const ctx = build();

    await ask(ctx, { serviceIds: ['svc-ear'] });

    const rowCall = ctx.findManyCalls.find(
      (call) => !(call as { select?: unknown }).select,
    ) as { where: { serviceId?: unknown } };
    expect(rowCall.where.serviceId).toEqual({ in: ['svc-ear'] });
  });
});

describe('the five figures', () => {
  const world: World = {
    grouped: [
      { status: AppointmentStatus.CONFIRMED, count: 4 },
      { status: AppointmentStatus.REMINDED, count: 2 },
      { status: AppointmentStatus.COMPLETED, count: 6 },
      { status: AppointmentStatus.CANCELLED, count: 3 },
      { status: AppointmentStatus.NO_SHOW, count: 2 },
      { status: AppointmentStatus.REQUESTED, count: 5 },
    ],
  };

  it('4. upcoming counts live bookings and NOT pending requests', async () => {
    // Counting a request as upcoming tells a clinic it is expecting somebody
    // it may yet turn away, and double-counts the row against the Requests tab.
    const ctx = build(world);

    const { stats } = await ask(ctx);

    expect(stats.upcoming).toBe(6);
  });

  it('5. completed, cancelled and no-show are each their own status', async () => {
    const ctx = build(world);

    const { stats } = await ask(ctx);

    expect(stats).toMatchObject({ completed: 6, cancelled: 3, noShow: 2 });
  });

  it('6. the no-show RATE excludes cancellations from the denominator', async () => {
    // A clinic that cancels a whole clinic day has not improved its no-show
    // rate, and dividing by cancellations says it has. 2 of (6 + 2).
    const ctx = build(world);

    const { stats } = await ask(ctx);

    expect(stats.noShowRate).toBeCloseTo(0.25);
  });

  it('7. a period with nothing attendable has NO rate rather than zero', async () => {
    // Zero per cent no-shows and no appointments at all are different facts.
    const ctx = build({ grouped: [{ status: AppointmentStatus.CANCELLED, count: 3 }] });

    const { stats } = await ask(ctx);

    expect(stats.noShowRate).toBeNull();
  });
});

describe('booked value and realised revenue are different questions', () => {
  it('8. booked value is the booking fee plus the service price, over live appointments', async () => {
    const ctx = build({
      live: [
        { bookingFeeAmount: 10, price: 35 },
        { bookingFeeAmount: 0, price: 50 },
      ],
    });

    const { stats } = await ask(ctx);

    expect(stats.bookedValue).toBe(95);
  });

  it('9. asks only for LIVE appointments — a cancellation is not booked value', async () => {
    const ctx = build({ live: [{ bookingFeeAmount: 10, price: 35 }] });

    await ask(ctx);

    const moneyQuery = ctx.findManyCalls.find((call) => (call as { select?: unknown }).select);
    expect((moneyQuery as { where: { status: { in: AppointmentStatus[] } } }).where.status.in).toEqual([
      ...TAB_STATUSES.UPCOMING,
      ...TAB_STATUSES.ARRIVED,
    ]);
  });

  it('10. realised revenue comes from the INVOICES, not from the price list read twice', async () => {
    // A completed consultation that also dispensed three medicines earned more
    // than its catalogue price. Reading the catalogue again and calling the
    // second reading "realised" would be a forecast wearing an actual's name.
    const ctx = build({
      live: [{ bookingFeeAmount: 10, price: 35 }],
      invoices: [88.5, 24],
    });

    const { stats } = await ask(ctx);

    expect(stats.bookedValue).toBe(45);
    expect(stats.realisedRevenue).toBe(112.5);
  });

  it('11. a completed appointment with no linked visit contributes nothing', async () => {
    // Honest: there is no invoice to read.
    const ctx = build({ live: [{ bookingFeeAmount: 10, price: 35 }], invoices: [] });

    const { stats } = await ask(ctx);

    expect(stats.realisedRevenue).toBe(0);
  });

  it('12. money is rounded to sen, not left as a float artefact', async () => {
    const ctx = build({ live: [{ bookingFeeAmount: 0.1, price: 0.2 }] });

    const { stats } = await ask(ctx);

    expect(stats.bookedValue).toBe(0.3);
  });
});

describe('a rescheduled row is not a lost booking', () => {
  it('12. RESCHEDULED is excluded from every count', async () => {
    // It marks the OLD row of a move; the booking still exists at its new
    // time as a different row. Filing it under Cancelled would tell a clinic
    // it lost a booking it still has.
    const ctx = build();

    await ask(ctx);

    const where = (ctx.prisma.appointment.groupBy as jest.Mock).mock.calls[0][0].where;
    // Two clauses, because the fact moved: historical rows carry the
    // deprecated RESCHEDULED status, and new ones are CANCELLED with a
    // cancellation reason that says so.
    expect(where.status).toEqual({ not: AppointmentStatus.RESCHEDULED });
    // AND THE NULL BRANCH. Without it, `NOT (cancellation_reason =
    // 'RESCHEDULED')` is NULL for every live appointment — SQL's
    // three-valued logic — and the whole dashboard reads zero with a full
    // diary. This assertion exists because that shipped and the guardrail
    // caught it; a fake `where` object cannot reproduce it, so the shape is
    // pinned here instead.
    expect(where.OR).toEqual([
      { cancellationReason: null },
      { cancellationReason: { not: 'RESCHEDULED' } },
    ]);
  });

  it('13. no tab contains it either', () => {
    for (const statuses of Object.values(TAB_STATUSES)) {
      expect(statuses).not.toContain(AppointmentStatus.RESCHEDULED);
    }
  });
});

describe('the tabs', () => {
  it('14. To Be Scheduled is live appointments whose time has PASSED', async () => {
    // Somebody has to decide what happened: re-book, or record they never
    // came. An interpretation — see the comment on the query.
    const ctx = build();

    await ask(ctx, { tab: 'TO_BE_SCHEDULED' });

    const rowQuery = ctx.findManyCalls.find((call) => !(call as { select?: unknown }).select) as {
      where: { scheduledEnd?: { lt: Date }; status: { in: AppointmentStatus[] } };
    };
    expect(rowQuery.where.scheduledEnd?.lt.toISOString()).toBe('2026-08-18T02:00:00.000Z');
    expect(rowQuery.where.status.in).toEqual([...TAB_STATUSES.TO_BE_SCHEDULED]);
  });

  it('15. other tabs carry no time cut', async () => {
    const ctx = build();

    await ask(ctx, { tab: 'COMPLETED' });

    const rowQuery = ctx.findManyCalls.find((call) => !(call as { select?: unknown }).select) as {
      where: { scheduledEnd?: unknown };
    };
    expect(rowQuery.where.scheduledEnd).toBeUndefined();
  });

  it('16. Upcoming reads forwards, history reads backwards', async () => {
    const ctx = build();

    await ask(ctx, { tab: 'UPCOMING' });
    await ask(ctx, { tab: 'COMPLETED' });

    const orders = ctx.findManyCalls
      .filter((call) => !(call as { select?: unknown }).select)
      .map((call) => (call as { orderBy: { scheduledStart: string } }).orderBy.scheduledStart);
    expect(orders).toEqual(['asc', 'desc']);
  });

  it('17. search matches a patient by name or phone, never by id', async () => {
    const ctx = build();

    await ask(ctx, { search: '  012-3456  ' });

    const rowQuery = ctx.findManyCalls.find((call) => !(call as { select?: unknown }).select) as {
      where: { patient: { OR: { name?: unknown; phone?: unknown }[] } };
    };
    expect(rowQuery.where.patient.OR).toEqual([
      { name: { contains: '012-3456', mode: 'insensitive' } },
      { phone: { contains: '012-3456', mode: 'insensitive' } },
    ]);
  });

  it('18. the row list is bounded', async () => {
    // A year-wide range on a busy clinic is a page nobody can read and a
    // response nobody should send.
    const ctx = build();

    await ask(ctx);

    const rowQuery = ctx.findManyCalls.find((call) => !(call as { select?: unknown }).select) as {
      take: number;
    };
    expect(rowQuery.take).toBe(500);
  });
});

describe('payment status tells the truth about a thing nothing collects yet', () => {
  it.each([
    [0, null, 'NO_FEE'],
    [15, null, 'UNPAID'],
    [15, new Date('2026-08-01T00:00:00.000Z'), 'PAID'],
  ])('19. fee %p paid %p reads %s', (amount, paidAt, expected) => {
    expect(paymentStateOf({ bookingFeeAmount: amount, bookingFeePaidAt: paidAt }).state).toBe(expected);
  });

  it('20. a fee of zero is NO_FEE, never "unpaid" — there is nothing to pay', () => {
    expect(paymentStateOf({ bookingFeeAmount: '0.00', bookingFeePaidAt: null }).state).toBe('NO_FEE');
  });
});

describe('a reminder is a thing somebody did', () => {
  it('21. it records WHO and WHEN, and does not touch the status', async () => {
    // `REMINDED` is mutually exclusive with CONFIRMED and ARRIVED, so using it
    // would lose the appointment's real state to record a phone call.
    const ctx = build();

    await ctx.run(() => ctx.service.markReminderSent('appt-1'));

    expect(ctx.updates[0]).toMatchObject({ reminderSentByStaffId: 'staff-7' });
    expect(ctx.updates[0].reminderSentAt).toBeInstanceOf(Date);
    expect(ctx.updates[0]).not.toHaveProperty('status');
  });

  it('22. sending a second reminder overwrites the first — the last one matters', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.markReminderSent('appt-1'));
    await ctx.run(() => ctx.service.markReminderSent('appt-1'));

    expect(ctx.updates).toHaveLength(2);
  });

  it('23. an appointment that does not exist is a 404, not a silent no-op', async () => {
    const ctx = build();
    (ctx.prisma.appointment.findUnique as jest.Mock).mockResolvedValueOnce(null);

    await expect(ctx.run(() => ctx.service.markReminderSent('nope'))).rejects.toThrow(/not found/i);
  });
});

// ===========================================================================
// PHASE 8 — the setup checklist is COMPUTED, so it cannot lie.
// ===========================================================================

function buildChecklist(world: {
  settings?: boolean;
  services?: number;
  weekly?: number;
  shifts?: number;
  page?: { active: boolean; patientRescheduleMode?: string | null; patientCancelMode?: string | null } | null;
  reminders?: number;
}) {
  const prisma = {
    clinicBookingSettings: {
      findFirst: jest.fn(async () => (world.settings ? { id: 's1' } : null)),
    },
    serviceCatalog: { count: jest.fn(async () => world.services ?? 0) },
    doctorSchedule: { count: jest.fn(async () => world.weekly ?? 0) },
    providerShift: { count: jest.fn(async () => world.shifts ?? 0) },
    clinicBookingPage: {
      findFirst: jest.fn(async () =>
        world.page === undefined
          ? null
          : world.page === null
            ? null
            : {
                active: world.page.active,
                patientRescheduleMode: world.page.patientRescheduleMode ?? null,
                patientCancelMode: world.page.patientCancelMode ?? null,
              },
      ),
    },
    appointmentReminderRule: { count: jest.fn(async () => world.reminders ?? 0) },
  } as unknown as TenantScopedPrismaClient;

  const availability = {
    clinicTimeZone: jest.fn(async () => 'Asia/Kuala_Lumpur'),
  } as unknown as SlotAvailabilityService;

  const service = new AppointmentDashboardService(prisma, availability);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);
  return { service, run };
}

describe('the setup checklist reads reality', () => {
  it('24. a bare clinic fails every core item and is not complete', async () => {
    const ctx = buildChecklist({});

    const result = await ctx.run(() => ctx.service.setupChecklist(CLINIC));

    expect(result.complete).toBe(false);
    const byKey = Object.fromEntries(result.items.map((item) => [item.key, item]));
    expect(byKey.BOOKING_RULES.done).toBe(false);
    expect(byKey.SERVICES.done).toBe(false);
    expect(byKey.ROSTER.done).toBe(false);
    expect(byKey.BOOKING_PAGE.done).toBe(false);
  });

  it('25. either roster model counts — a shifts-mode branch with no weekly plan is still rostered', async () => {
    const ctx = buildChecklist({ weekly: 0, shifts: 3 });

    const result = await ctx.run(() => ctx.service.setupChecklist(CLINIC));

    expect(result.items.find((item) => item.key === 'ROSTER')?.done).toBe(true);
  });

  it('26. complete needs only the CORE four — a clinic that wants no reminders is not nagged forever', async () => {
    const ctx = buildChecklist({
      settings: true,
      services: 5,
      weekly: 2,
      page: { active: true },
      reminders: 0,
    });

    const result = await ctx.run(() => ctx.service.setupChecklist(CLINIC));

    expect(result.complete).toBe(true);
    // The recommended items still report honestly.
    expect(result.items.find((item) => item.key === 'REMINDERS')?.done).toBe(false);
    expect(result.items.find((item) => item.key === 'CHANGE_POLICY')?.done).toBe(false);
  });

  it('27. an inactive booking page is NOT a done item — the link being dead is the fact that matters', async () => {
    const ctx = buildChecklist({ settings: true, services: 1, weekly: 1, page: { active: false } });

    const result = await ctx.run(() => ctx.service.setupChecklist(CLINIC));

    expect(result.items.find((item) => item.key === 'BOOKING_PAGE')?.done).toBe(false);
    expect(result.complete).toBe(false);
  });
});
