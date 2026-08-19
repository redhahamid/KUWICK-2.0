import { BadRequestException } from '@nestjs/common';
import { ClinicBookingSettingsService, DEFAULT_BOOKING_SETTINGS } from './clinic-booking-settings.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';
import { parseTimeToDate } from './time.util';

const TENANT = 'tenant-1';
const CLINIC = 'clinic-1';

function build(world: { settings?: Record<string, unknown> | null; closed?: Record<string, unknown>[] } = {}) {
  const created: Record<string, unknown>[] = [];
  const updated: Record<string, unknown>[] = [];
  const deleted: Record<string, unknown>[] = [];
  let settings = world.settings === undefined ? null : world.settings;
  const closed = world.closed ?? [];

  const prisma = {
    clinicBookingSettings: {
      findFirst: jest.fn(async () => settings),
      create: jest.fn(async ({ data }: never) => {
        created.push(data as Record<string, unknown>);
        settings = data as Record<string, unknown>;
        return data;
      }),
      update: jest.fn(async ({ data }: never) => {
        updated.push(data as Record<string, unknown>);
        settings = { ...(settings as object), ...(data as object) };
        return data;
      }),
    },
    clinicClosedDate: {
      findMany: jest.fn(async () => closed),
      findFirst: jest.fn(async ({ where }: never) => {
        const query = where as { date: Date };
        return closed.find((row) => (row.date as Date).getTime() === query.date.getTime()) ?? null;
      }),
      create: jest.fn(async ({ data }: never) => {
        created.push(data as Record<string, unknown>);
        return data;
      }),
      deleteMany: jest.fn(async ({ where }: never) => {
        deleted.push(where as Record<string, unknown>);
        return { count: 1 };
      }),
    },
  } as unknown as TenantScopedPrismaClient;

  const service = new ClinicBookingSettingsService(prisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: TENANT, staffId: 'staff-1', userId: 'user-1' }, fn);

  return { service, prisma, created, updated, deleted, run };
}

describe('an unconfigured clinic still has an answer', () => {
  it('1. a clinic with no row reads back the defaults, flagged as unset', async () => {
    // The screen and the engine must agree about a clinic nobody has
    // configured. `null` is not something a form can render or an engine can
    // compare against.
    const ctx = build();

    const result = await ctx.run(() => ctx.service.get(CLINIC));

    expect(result).toMatchObject({ ...DEFAULT_BOOKING_SETTINGS, configured: false });
  });

  it('2. the default notice is ZERO — an unconfigured clinic is not silently narrowed', async () => {
    expect(DEFAULT_BOOKING_SETTINGS.minimumNoticeMinutes).toBe(0);
  });

  it('3. a configured clinic reads back its own hours as HH:MM', async () => {
    const ctx = build({
      settings: {
        firstSessionTime: parseTimeToDate('08:30'),
        lastSessionTime: parseTimeToDate('21:00'),
        minimumNoticeMinutes: 120,
      },
    });

    const result = await ctx.run(() => ctx.service.get(CLINIC));

    expect(result).toMatchObject({
      firstSessionTime: '08:30',
      lastSessionTime: '21:00',
      minimumNoticeMinutes: 120,
      configured: true,
    });
  });
});

describe('the window has to be a window', () => {
  it('4. a last session before the first is refused, in words', async () => {
    // The CHECK constraint refuses it too, but being refused by PostgreSQL is
    // not an explanation anybody can act on.
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upsert(CLINIC, {
          firstSessionTime: '17:00',
          lastSessionTime: '09:00',
          minimumNoticeMinutes: 0,
        }),
      ),
    ).rejects.toThrow(/last session must be after the first/i);
    expect(ctx.created).toHaveLength(0);
  });

  it('5. a last session EQUAL to the first is refused — it books nothing', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upsert(CLINIC, {
          firstSessionTime: '09:00',
          lastSessionTime: '09:00',
          minimumNoticeMinutes: 0,
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });

  it.each(['9:00', '25:00', '09:60', 'morning'])('6. %p is not a time', async (bad) => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.upsert(CLINIC, {
          firstSessionTime: bad,
          lastSessionTime: '17:00',
          minimumNoticeMinutes: 0,
        }),
      ),
    ).rejects.toThrow(/HH:MM/);
  });

  it('6b. BLANK is a real answer — a 24-hour clinic narrows neither end', async () => {
    // This used to be refused, and the refusal was the bug: both columns were
    // NOT NULL with a 09:00-17:00 default, which silently amputated a night
    // roster the first time anybody saved this form.
    const ctx = build();

    const saved = await ctx.run(() =>
      ctx.service.upsert(CLINIC, {
        firstSessionTime: '',
        lastSessionTime: '',
        minimumNoticeMinutes: 0,
      }),
    );

    expect(saved.firstSessionTime).toBeNull();
    expect(saved.lastSessionTime).toBeNull();
  });

  it('7. a valid window is written once, as a create', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.upsert(CLINIC, {
        firstSessionTime: '08:00',
        lastSessionTime: '20:00',
        minimumNoticeMinutes: 30,
      }),
    );

    expect(ctx.created).toHaveLength(1);
    expect(ctx.created[0]).toMatchObject({ tenantId: TENANT, clinicId: CLINIC, minimumNoticeMinutes: 30 });
  });

  it('8. a second save UPDATES rather than creating a second answer', async () => {
    const ctx = build({ settings: { id: 'row-1', firstSessionTime: parseTimeToDate('09:00'), lastSessionTime: parseTimeToDate('17:00'), minimumNoticeMinutes: 0 } });

    await ctx.run(() =>
      ctx.service.upsert(CLINIC, {
        firstSessionTime: '09:00',
        lastSessionTime: '18:00',
        minimumNoticeMinutes: 15,
      }),
    );

    expect(ctx.created).toHaveLength(0);
    expect(ctx.updated).toHaveLength(1);
  });
});

describe('closed dates', () => {
  it('9. a date is recorded with its author', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.addClosedDate(CLINIC, { date: '2026-12-25', reason: 'Christmas' }));

    expect(ctx.created[0]).toMatchObject({
      clinicId: CLINIC,
      reason: 'Christmas',
      createdByStaffId: 'staff-1',
    });
    expect((ctx.created[0].date as Date).toISOString()).toBe('2026-12-25T00:00:00.000Z');
  });

  it('10. a blank reason is stored as nothing, not as an empty string', async () => {
    // The public page renders one and prints the other.
    const ctx = build();

    await ctx.run(() => ctx.service.addClosedDate(CLINIC, { date: '2026-12-25', reason: '   ' }));

    expect(ctx.created[0].reason).toBeNull();
  });

  it('11. the same date twice is refused, in words', async () => {
    const ctx = build({ closed: [{ id: 'c1', date: new Date('2026-12-25T00:00:00.000Z') }] });

    await expect(
      ctx.run(() => ctx.service.addClosedDate(CLINIC, { date: '2026-12-25' })),
    ).rejects.toThrow(/already marked closed/i);
  });

  it('12. removal is scoped to the clinic — an id alone is not authority', async () => {
    // `deleteMany` with both, never `delete` by id: an id from another
    // clinic's list must not delete across the boundary.
    const ctx = build();

    await ctx.run(() => ctx.service.removeClosedDate(CLINIC, 'closed-9'));

    expect(ctx.deleted[0]).toEqual({ id: 'closed-9', clinicId: CLINIC });
  });

  it('13. the list is upcoming-only by default', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.listClosedDates(CLINIC));

    const where = (ctx.prisma.clinicClosedDate.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.date?.gte).toBeInstanceOf(Date);
  });

  it('14. asking for history drops the date filter', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.listClosedDates(CLINIC, true));

    const where = (ctx.prisma.clinicClosedDate.findMany as jest.Mock).mock.calls[0][0].where;
    expect(where.date).toBeUndefined();
  });
});
