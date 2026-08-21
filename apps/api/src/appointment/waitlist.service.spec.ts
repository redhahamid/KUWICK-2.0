import { BadRequestException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { WaitlistService } from './waitlist.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { SlotAvailabilityService } from './slot-availability.service';
import { tenantContextStorage } from '../core/tenant-context';
import { staffRow } from './appointment-test-harness';

// ===========================================================================
// §44 — THE WAITLIST.
//
// Its own table, and not an appointment in a WAITLIST status. An entry has no
// time: it has a service, a RANGE of acceptable dates and possibly a daypart.
// Forcing that into a row whose defining facts are `scheduledStart` and
// `scheduledEnd` would mean inventing times nobody agreed to — and an invented
// time occupies a slot.
//
// MATCHING IS NOT AUTOMATIC, and these tests pin what it does instead: it
// produces the list a receptionist rings down, in the order the clinic said to
// ring it.
// ===========================================================================

const CLINIC = 'clinic-1';
const SERVICE = 'svc-1';
const DOC = 'doc-1';

interface World {
  entries?: Record<string, unknown>[];
  assignedRoles?: SystemRole[];
  directGrants?: string[];
}

function build(world: World = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  let lastQuery: Record<string, unknown> | undefined;

  const tables = {
    $executeRaw: jest.fn(async () => 1),
    staff: { findUnique: jest.fn(async () => staffRow()) },
    staffRoleAssignment: {
      findMany: jest.fn(async () =>
        (world.assignedRoles ?? ['ADMINISTRATOR']).map((role) => ({ role })),
      ),
    },
    staffPermissionGrant: {
      findMany: jest.fn(async () =>
        (world.directGrants ?? []).map((permission) => ({ permission })),
      ),
    },
    waitlistEntry: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return { id: 'wl-1', ...data };
      }),
      findUnique: jest.fn(async () => ({ id: 'wl-1', priority: 0, status: 'ACTIVE' })),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updated.push(data);
        return data;
      }),
    },
  };

  const scoped = {
    waitlistEntry: {
      findMany: jest.fn(async (args: Record<string, unknown>) => {
        lastQuery = args;
        return world.entries ?? [];
      }),
    },
  } as unknown as TenantScopedPrismaClient;

  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tables) => Promise<unknown>) => fn(tables)),
  } as unknown as PrismaService;

  const availability = {
    clinicTimeZone: jest.fn(async () => 'Asia/Kuala_Lumpur'),
  } as unknown as SlotAvailabilityService;

  const staffNotifications = { notify: jest.fn(async () => 0) } as never;
  const service = new WaitlistService(scoped, rawPrisma, availability, staffNotifications);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, tables, scoped, created, updated, run, query: () => lastQuery };
}

const ENTRY = { clinicId: CLINIC, patientId: 'pat-1', serviceId: SERVICE };

describe('adding somebody to the waitlist', () => {
  it('1. an entry with no dates at all is valid — "any time you have"', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.create(ENTRY));

    expect(ctx.created[0]).toMatchObject({ earliestDate: null, latestDate: null, priority: 0 });
  });

  it('2. a range that ends before it starts is refused', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.create({ ...ENTRY, earliestDate: '2026-09-10', latestDate: '2026-09-01' }),
      ),
    ).rejects.toThrow(/before the first/i);
  });

  it('3. raising the priority is a queue-jump and needs the override permission', async () => {
    // Somebody is being put ahead of somebody else, and that should be
    // answerable — the same reasoning as booking past a full diary.
    const ctx = build({ assignedRoles: ['ADMINISTRATOR'] });

    await expect(
      ctx.run(() => ctx.service.create({ ...ENTRY, priority: 5 })),
    ).rejects.toThrow(BadRequestException);
  });

  it('4. somebody holding it by name may raise the priority', async () => {
    const ctx = build({
      assignedRoles: ['ADMINISTRATOR'],
      directGrants: ['appointment.override'],
    });

    await expect(
      ctx.run(() => ctx.service.create({ ...ENTRY, priority: 5 })),
    ).resolves.toMatchObject({ priority: 5 });
  });

  it('5. priority ZERO needs nothing — it is the normal case', async () => {
    const ctx = build({ assignedRoles: ['ADMINISTRATOR'] });

    await expect(ctx.run(() => ctx.service.create({ ...ENTRY, priority: 0 }))).resolves.toBeDefined();
  });
});

describe('who fits a slot that just came free', () => {
  const askFor = (ctx: ReturnType<typeof build>, iso: string) =>
    ctx.service.matchesFor({
      clinicId: CLINIC,
      serviceId: SERVICE,
      staffId: DOC,
      start: new Date(iso),
    });

  it('6. a 09:00 Kuala Lumpur slot is a MORNING slot, read in the clinic’s clock', async () => {
    // 01:00Z. Read in the runner's zone it would be an overnight slot, and
    // every "mornings only" entry would be skipped.
    const ctx = build();

    const result = await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect(result.slot.daypart).toBe('MORNING');
  });

  it('7. a 15:00 Kuala Lumpur slot is an AFTERNOON one', async () => {
    const ctx = build();

    const result = await askFor(ctx, '2026-09-01T07:00:00.000Z');

    expect(result.slot.daypart).toBe('AFTERNOON');
  });

  it('8. only ACTIVE entries for THIS service are considered', async () => {
    const ctx = build();

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect(ctx.query()!.where).toMatchObject({
      clinicId: CLINIC,
      serviceId: SERVICE,
      status: 'ACTIVE',
    });
  });

  it('9. an entry naming a DIFFERENT provider is excluded; one naming nobody is not', async () => {
    const ctx = build();

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect((ctx.query()!.where as Record<string, unknown>).OR).toEqual([
      { preferredStaffId: null },
      { preferredStaffId: DOC },
    ]);
  });

  it('10. the date range and the daypart are both honoured, and nulls mean "any"', async () => {
    const ctx = build();

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    const and = (ctx.query()!.where as { AND: Record<string, unknown>[] }).AND;
    expect(and[0]).toEqual({ OR: [{ earliestDate: null }, { earliestDate: { lte: expect.any(Date) } }] });
    expect(and[1]).toEqual({ OR: [{ latestDate: null }, { latestDate: { gte: expect.any(Date) } }] });
    expect(and[2]).toEqual({
      OR: [{ preferredDaypart: null }, { preferredDaypart: 'ANY' }, { preferredDaypart: 'MORNING' }],
    });
  });

  it('11. priority first, then who asked first', async () => {
    // A clinic that raises somebody's priority expects to see them move; a
    // clinic that does not expects the queue to be a queue.
    const ctx = build();

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect(ctx.query()!.orderBy).toEqual([{ priority: 'desc' }, { createdAt: 'asc' }]);
  });

  it('12. the list is BOUNDED — a receptionist rings people, not a mailing list', async () => {
    const ctx = build();

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect(ctx.query()!.take).toBe(25);
  });

  it('13. nothing is offered, notified or booked by this call', async () => {
    // Matching produces a LIST. Texting the top of it is a judgement — the 4pm
    // that suits a retiree does not suit a parent — and a system that got it
    // wrong often enough would be turned off.
    const ctx = build({ entries: [{ id: 'wl-1', patient: { id: 'p1', name: 'A' } }] });

    await askFor(ctx, '2026-09-01T01:00:00.000Z');

    expect(ctx.tables.waitlistEntry.update).not.toHaveBeenCalled();
  });
});

describe('an entry that produced a booking', () => {
  it('14. is marked BOOKED and keeps the appointment id — it is not deleted', async () => {
    // "We rang eleven people and booked two" is a fact a clinic wants back,
    // and a deleted row cannot say it.
    const ctx = build();

    await ctx.run(() => ctx.service.markBooked('wl-1', 'appt-9'));

    expect(ctx.updated[0]).toEqual({ status: 'BOOKED', bookedAppointmentId: 'appt-9' });
  });

  it('15. marking one OFFERED stamps when it was offered', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.update('wl-1', { status: 'OFFERED' }));

    expect(ctx.updated[0]).toMatchObject({ status: 'OFFERED' });
    expect((ctx.updated[0] as { offeredAt: Date }).offeredAt).toBeInstanceOf(Date);
  });
});
