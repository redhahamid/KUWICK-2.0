import { BadRequestException } from '@nestjs/common';
import { AppointmentSeriesService } from './appointment-series.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import {
  AppointmentBookingValidator,
  BookingCheck,
} from './appointment-booking-validator.service';
import { tenantContextStorage } from '../core/tenant-context';
import { staffRow } from './appointment-test-harness';

// ===========================================================================
// §43 — RECURRING APPOINTMENTS.
//
// Every session is its own row. The alternative — one row plus a recurrence
// rule, expanded at read time — cannot hold the fact that week three moved to
// a Tuesday or that week four was a no-show. A diary is a record of particular
// events, not a formula.
// ===========================================================================

function build(world: { checks?: BookingCheck[]; assignedRoles?: string[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const events: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  let checkIndex = 0;

  const tx = {
    $executeRaw: jest.fn(async () => 1),
    staff: { findUnique: jest.fn(async () => staffRow()) },
    staffRoleAssignment: {
      findMany: jest.fn(async () => (world.assignedRoles ?? ['ADMINISTRATOR']).map((role) => ({ role }))),
    },
    staffPermissionGrant: { findMany: jest.fn(async () => []) },
    appointmentSeries: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'series-1',
        ...data,
      })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return data;
      }),
    },
    appointment: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: `appt-${created.length}`, ...data };
      }),
      findUnique: jest.fn(async () => ({
        id: 'appt-2',
        seriesId: 'series-1',
        status: 'CONFIRMED',
        scheduledStart: new Date('2026-09-08T01:00:00.000Z'),
      })),
      findMany: jest.fn(async () => [
        {
          id: 'appt-2',
          status: 'CONFIRMED',
          scheduledStart: new Date('2026-09-08T01:00:00.000Z'),
        },
        {
          id: 'appt-3',
          status: 'CONFIRMED',
          scheduledStart: new Date('2026-09-15T01:00:00.000Z'),
        },
      ]),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return data;
      }),
    },
    appointmentEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      }),
    },
  };

  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  } as unknown as PrismaService;

  const validator = {
    check: jest.fn(async (): Promise<BookingCheck> => {
      const answer = world.checks?.[checkIndex] ?? { ok: true };
      checkIndex += 1;
      return answer;
    }),
  } as unknown as AppointmentBookingValidator;

  const service = new AppointmentSeriesService(
    {} as TenantScopedPrismaClient,
    rawPrisma,
    validator,
  );
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, tx, created, events, updates, run };
}

const COURSE = {
  clinicId: 'clinic-1',
  patientId: 'pat-1',
  staffId: 'doc-1',
  serviceId: 'svc-1',
  frequency: 'WEEKLY' as const,
  occurrences: 4,
  firstStart: '2026-09-01T01:00:00.000Z',
  firstEnd: '2026-09-01T01:30:00.000Z',
};

describe('a course of appointments is a course of appointments', () => {
  it('1. four weekly sessions are four rows, one week apart', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.create(COURSE));

    expect(ctx.created).toHaveLength(4);
    expect(ctx.created.map((row) => (row.scheduledStart as Date).toISOString())).toEqual([
      '2026-09-01T01:00:00.000Z',
      '2026-09-08T01:00:00.000Z',
      '2026-09-15T01:00:00.000Z',
      '2026-09-22T01:00:00.000Z',
    ]);
  });

  it('2. each row knows the series and its place in it', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.create(COURSE));

    expect(ctx.created[2]).toMatchObject({ seriesId: 'series-1', seriesIndex: 3 });
  });

  it('3. every session keeps its own duration', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.create(COURSE));

    for (const row of ctx.created) {
      const minutes =
        ((row.scheduledEnd as Date).getTime() - (row.scheduledStart as Date).getTime()) / 60000;
      expect(minutes).toBe(30);
    }
  });

  it('4. fortnightly is fourteen days, not "every other week" computed twice', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.create({ ...COURSE, frequency: 'FORTNIGHTLY', occurrences: 3 }));

    expect((ctx.created[1].scheduledStart as Date).toISOString()).toBe('2026-09-15T01:00:00.000Z');
  });

  it('5. monthly means the same DATE next month, not thirty days', async () => {
    // "The same date next month" is what a patient understands, and it drifts
    // through the week — which is fine, because each occurrence is checked.
    const ctx = build();

    await ctx.run(() => ctx.service.create({ ...COURSE, frequency: 'MONTHLY', occurrences: 3 }));

    expect((ctx.created[1].scheduledStart as Date).toISOString()).toBe('2026-10-01T01:00:00.000Z');
    expect((ctx.created[2].scheduledStart as Date).toISOString()).toBe('2026-11-01T01:00:00.000Z');
  });

  it('6. a custom recurrence with no interval is refused rather than guessed', async () => {
    const ctx = build();

    await expect(
      ctx.run(() => ctx.service.create({ ...COURSE, frequency: 'CUSTOM_DAYS' })),
    ).rejects.toThrow(/number of days/i);
  });
});

describe('occurrences the engine cannot honour are reported, never invented', () => {
  it('7. by default the whole course is refused, naming the session that failed', async () => {
    // A bare "unavailable" would send the receptionist to try each of four
    // dates by hand.
    const ctx = build({
      checks: [
        { ok: true },
        { ok: false, reason: 'CLINIC_CLOSED', message: 'The clinic is closed on that date.' },
      ],
    });

    await expect(ctx.run(() => ctx.service.create(COURSE))).rejects.toThrow(
      /Session 2 of 4.*closed/i,
    );
  });

  it('8. skipUnavailable books what it can and REPORTS what it could not', async () => {
    const ctx = build({
      checks: [
        { ok: true },
        { ok: false, reason: 'CLINIC_CLOSED', message: 'The clinic is closed on that date.' },
        { ok: true },
        { ok: true },
      ],
    });

    const result = await ctx.run(() =>
      ctx.service.create({ ...COURSE, skipUnavailable: true }),
    );

    expect(result.booked).toHaveLength(3);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toMatchObject({ index: 2 });
  });

  it('9. no appointment is created on a day the clinic is shut', async () => {
    const ctx = build({
      checks: [{ ok: false, reason: 'CLINIC_CLOSED', message: 'closed' }],
    });

    await ctx.run(() => ctx.service.create({ ...COURSE, occurrences: 2, skipUnavailable: true }));

    expect(ctx.created).toHaveLength(1);
  });

  it('10. a session that ends before it starts is refused up front', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.create({ ...COURSE, firstEnd: '2026-09-01T00:30:00.000Z' }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('editing a course: this, this and future, or all of it', () => {
  it('11. THIS cancels one session only', async () => {
    const ctx = build();
    ctx.tx.appointment.findMany = jest.fn(async () => [
      { id: 'appt-2', status: 'CONFIRMED', scheduledStart: new Date('2026-09-08T01:00:00.000Z') },
    ]);

    const result = await ctx.run(() =>
      ctx.service.cancelScope({
        seriesId: 'series-1',
        fromAppointmentId: 'appt-2',
        scope: 'THIS',
      }),
    );

    expect(result.cancelled).toBe(1);
  });

  it('12. THIS_AND_FUTURE ends the series as well as the sessions', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.cancelScope({
        seriesId: 'series-1',
        fromAppointmentId: 'appt-2',
        scope: 'THIS_AND_FUTURE',
      }),
    );

    expect(ctx.updates).toContainEqual({ active: false });
  });

  it('13. cancelling a course cannot un-happen a session that already happened', async () => {
    // Only live statuses are targeted; a COMPLETED session stays completed.
    const ctx = build();

    await ctx.run(() =>
      ctx.service.cancelScope({ seriesId: 'series-1', fromAppointmentId: 'appt-2', scope: 'ALL' }),
    );

    const where = (ctx.tx.appointment.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.status.in).toEqual(['REQUESTED', 'CONFIRMED', 'REMINDED']);
  });

  it('14. every cancelled session gets its own history entry', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.cancelScope({ seriesId: 'series-1', fromAppointmentId: 'appt-2', scope: 'ALL' }),
    );

    expect(ctx.events.filter((e) => e.eventType === 'CANCELLED')).toHaveLength(2);
  });
});
