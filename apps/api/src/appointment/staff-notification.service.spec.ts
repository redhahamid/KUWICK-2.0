import { StaffNotificationService } from './staff-notification.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// PHASE 5 — WHO IS TOLD, AND WHO IS NOT.
//
// Routing is the whole product here: a notification centre that tells the
// stock clerk about bookings, tells the actor about their own click, or
// leaks branch B's diary to branch A's desk is worse than none. Each pin
// below is one of those failure modes.
// ===========================================================================

const CLINIC = 'clinic-1';

interface StaffRow {
  id: string;
  role: string;
  active: boolean;
  clinicId: string | null;
}

function build(world: { staff?: StaffRow[]; notifications?: Record<string, unknown>[] } = {}) {
  const staff = world.staff ?? [];
  const created: Record<string, unknown>[][] = [];
  const updates: { where: unknown; data: unknown }[] = [];
  const notifications = world.notifications ?? [];

  const prisma = {
    staff: {
      findMany: jest.fn(async ({ where }: never) => {
        const query = where as {
          role: { in: string[] };
          OR: { clinicId: string | null }[];
        };
        return staff
          .filter((row) => row.active)
          .filter((row) => query.role.in.includes(row.role))
          .filter((row) =>
            query.OR.some((clause) => clause.clinicId === row.clinicId),
          )
          .map((row) => ({ id: row.id }));
      }),
    },
    staffNotification: {
      createMany: jest.fn(async ({ data }: never) => {
        created.push(data as Record<string, unknown>[]);
        return { count: (data as unknown[]).length };
      }),
      count: jest.fn(async () => notifications.filter((row) => !row.readAt).length),
      findMany: jest.fn(async () => notifications.map((row) => ({ ...row, clinic: { name: 'Branch A' } }))),
      updateMany: jest.fn(async (args: { where: unknown; data: unknown }) => {
        updates.push(args);
        return { count: 1 };
      }),
    },
  } as unknown as TenantScopedPrismaClient;

  const service = new StaffNotificationService(prisma);
  const run = <T>(fn: () => Promise<T>, staffId = 'me') =>
    tenantContextStorage.run({ tenantId: 't1', staffId, userId: 'u1' }, fn);

  return { service, prisma, created, updates, run };
}

const WORLD: StaffRow[] = [
  { id: 'owner-1', role: 'OWNER_ADMIN', active: true, clinicId: null },
  { id: 'desk-1', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: CLINIC },
  { id: 'desk-other-branch', role: 'FRONT_DESK_CLINICAL_STAFF', active: true, clinicId: 'clinic-2' },
  { id: 'stock-1', role: 'STOCK_STAFF', active: true, clinicId: CLINIC },
  { id: 'desk-gone', role: 'FRONT_DESK_CLINICAL_STAFF', active: false, clinicId: CLINIC },
  { id: 'doc-1', role: 'DOCTOR_RESIDENT', active: true, clinicId: CLINIC },
];

const EVENT = {
  clinicId: CLINIC,
  type: 'NEW_BOOKING' as const,
  title: 'New online booking',
  body: 'Nurul Izzah · GP Consultation · 22 Aug, 10:00 · Dr Priya',
  appointmentId: 'appt-1',
};

describe('who hears about a desk event', () => {
  it('1. the branch desk and tenant-wide admins — not the stock clerk, not another branch, not the departed', async () => {
    const ctx = build({ staff: WORLD });

    await ctx.run(() =>
      ctx.service.notify({ ...EVENT, includeDesk: true, assignedStaffId: 'doc-1' }),
    );

    const recipients = ctx.created[0].map((row) => row.recipientStaffId).sort();
    expect(recipients).toEqual(['desk-1', 'doc-1', 'owner-1']);
  });

  it('2. the ACTOR is never told about their own action', async () => {
    const ctx = build({ staff: WORLD });

    await ctx.run(() =>
      ctx.service.notify({
        ...EVENT,
        includeDesk: true,
        assignedStaffId: 'doc-1',
        actorStaffId: 'desk-1',
      }),
    );

    const recipients = ctx.created[0].map((row) => row.recipientStaffId);
    expect(recipients).not.toContain('desk-1');
    expect(recipients).toContain('doc-1');
  });

  it('3. an ordinary staff-created booking reaches only the assigned provider', async () => {
    // §5F — the desk does not need a toast for the booking a colleague just
    // typed in front of them.
    const ctx = build({ staff: WORLD });

    await ctx.run(() =>
      ctx.service.notify({
        ...EVENT,
        includeDesk: false,
        assignedStaffId: 'doc-1',
        actorStaffId: 'desk-1',
      }),
    );

    expect(ctx.created[0].map((row) => row.recipientStaffId)).toEqual(['doc-1']);
  });

  it('4. a doctor booking their own follow-up hears nothing at all', async () => {
    const ctx = build({ staff: WORLD });

    const count = await ctx.run(() =>
      ctx.service.notify({
        ...EVENT,
        includeDesk: false,
        assignedStaffId: 'doc-1',
        actorStaffId: 'doc-1',
      }),
    );

    expect(count).toBe(0);
    expect(ctx.created).toHaveLength(0);
  });

  it('5. every row carries the appointment to open and the words to show', async () => {
    const ctx = build({ staff: WORLD });

    await ctx.run(() => ctx.service.notify({ ...EVENT, includeDesk: true }));

    expect(ctx.created[0][0]).toMatchObject({
      tenantId: 't1',
      clinicId: CLINIC,
      type: 'NEW_BOOKING',
      title: 'New online booking',
      appointmentId: 'appt-1',
    });
  });

  it('6. a failure to write the inbox is swallowed — the booking it describes must survive', async () => {
    const ctx = build({ staff: WORLD });
    (ctx.prisma.staffNotification.createMany as jest.Mock).mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      ctx.run(() => ctx.service.notify({ ...EVENT, includeDesk: true })),
    ).resolves.toBe(0);
  });
});

describe('the inbox is the CALLER’s own', () => {
  it('7. marking read is scoped to the recipient — an id from another inbox marks nothing', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.markRead('note-9'), 'me');

    expect(ctx.updates[0].where).toMatchObject({ id: 'note-9', recipientStaffId: 'me' });
  });

  it('8. read-all touches only the caller’s unread rows', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.markAllRead(), 'me');

    expect(ctx.updates[0].where).toMatchObject({ recipientStaffId: 'me', readAt: null });
  });

  it('9. a session with no staff seat has no inbox rather than an error', async () => {
    const ctx = build();

    const result = await tenantContextStorage.run(
      { tenantId: 't1', staffId: undefined, userId: 'u1' } as never,
      () => ctx.service.listMine(),
    );

    expect(result).toEqual({ unread: 0, rows: [] });
  });
});
