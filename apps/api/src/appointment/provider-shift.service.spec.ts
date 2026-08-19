import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { ProviderShiftService, datesInMonth } from './provider-shift.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { PrismaService } from '../core/prisma.service';
import { tenantContextStorage } from '../core/tenant-context';
import { staffRow } from './appointment-test-harness';

// ===========================================================================
// THE ROSTER — the model that can hold a night shift and a split day.
//
// The representation it replaces (weekday + start TIME + end TIME) could
// express neither, and the availability engine's slot loop simply ran zero
// times over an inverted window: a night doctor was unbookable with no error
// and no empty state to explain it.
// ===========================================================================

const CLINIC = 'clinic-1';
const DOC = 'doc-1';

interface World {
  shifts?: Record<string, unknown>[];
  leave?: Record<string, unknown>[];
  closed?: Record<string, unknown>[];
  providers?: Record<string, unknown>[];
  assignedRoles?: SystemRole[];
  actor?: Record<string, unknown>;
  appointmentCount?: number;
  directGrants?: string[];
}

function build(world: World = {}) {
  const created: Record<string, unknown>[] = [];
  const deleted: Record<string, unknown>[] = [];

  const tables = {
    providerShift: {
      findMany: jest.fn(async () => world.shifts ?? []),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        (world.shifts ?? []).find((s) => s.id === where.id) ?? null,
      ),
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        created.push(...data);
        return { count: data.length };
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
      delete: jest.fn(async () => ({})),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        deleted.push(where);
        return { count: 0 };
      }),
    },
    leaveRequest: { findMany: jest.fn(async () => world.leave ?? []) },
    clinicClosedDate: { findMany: jest.fn(async () => world.closed ?? []) },
    clinic: {
      findUnique: jest.fn(async () => ({ timezone: 'Asia/Kuala_Lumpur' })),
      count: jest.fn(async () => 1),
    },
    staff: {
      findMany: jest.fn(
        async () =>
          world.providers ?? [
            {
              id: DOC,
              fullName: 'Dr Redha',
              appointmentScheduleMode: 'ROSTER_LINKED',
              calendarColor: null,
              professionalType: 'MEDICAL_DOCTOR',
            },
          ],
      ),
      findUnique: jest.fn(async () => staffRow(world.actor)),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    staffRoleAssignment: {
      findMany: jest.fn(async () => (world.assignedRoles ?? ['OWNER']).map((role) => ({ role }))),
    },
    staffPermissionGrant: {
      findMany: jest.fn(async () => (world.directGrants ?? []).map((permission) => ({ permission }))),
    },
    appointment: { count: jest.fn(async () => world.appointmentCount ?? 0) },
    $executeRaw: jest.fn(async () => 1),
  };

  const prisma = tables as unknown as TenantScopedPrismaClient;
  const rawPrisma = {
    $transaction: jest.fn(async (fn: (t: typeof tables) => Promise<unknown>) => fn(tables)),
  } as unknown as PrismaService;

  const service = new ProviderShiftService(prisma, rawPrisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, tables, created, deleted, run };
}

const iso = (d: string) => new Date(`${d}T00:00:00.000Z`);

describe('a shift is two instants, so midnight is not a special case', () => {
  it('1. 09:00-17:00 becomes 01:00Z-09:00Z on the same day', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '09:00',
        endTime: '17:00',
      }),
    );

    expect(ctx.created[0].startsAt).toEqual(new Date('2026-08-19T01:00:00.000Z'));
    expect(ctx.created[0].endsAt).toEqual(new Date('2026-08-19T09:00:00.000Z'));
  });

  it('2. 23:00-09:00 ends on the FOLLOWING day and is still one row', async () => {
    // The case the old model could not hold. 23:00 KL on the 19th is 15:00Z,
    // and 09:00 KL on the 20th is 01:00Z — ten hours later, as it should be.
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '23:00',
        endTime: '09:00',
      }),
    );

    expect(ctx.created).toHaveLength(1);
    expect(ctx.created[0].startsAt).toEqual(new Date('2026-08-19T15:00:00.000Z'));
    expect(ctx.created[0].endsAt).toEqual(new Date('2026-08-20T01:00:00.000Z'));
    // The shift still BELONGS to the 19th — that is how a roster is read aloud
    // and how it is paid.
    expect(ctx.created[0].shiftDate).toEqual(iso('2026-08-19'));
  });

  it('3. a shift crossing a MONTH boundary is unremarkable', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-31'],
        startTime: '23:00',
        endTime: '09:00',
      }),
    );

    expect(ctx.created[0].endsAt).toEqual(new Date('2026-09-01T01:00:00.000Z'));
  });

  it('4. two shifts on one date are two rows, and neither displaces the other', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '08:00',
        endTime: '15:00',
      }),
    );
    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '20:00',
        endTime: '23:00',
      }),
    );

    expect(ctx.created).toHaveLength(2);
    expect(ctx.deleted).toHaveLength(0);
  });

  it('5. one call can roster a whole selection of dates', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19', '2026-08-20', '2026-08-21'],
        startTime: '09:00',
        endTime: '17:00',
      }),
    );

    expect(ctx.created).toHaveLength(3);
  });

  it('6. replaceExisting clears the date first — that is what "OFF" means', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '00:00',
        endTime: '23:59',
        shiftType: 'OFF',
        replaceExisting: true,
      }),
    );

    expect(ctx.deleted).toHaveLength(1);
    expect(ctx.created[0].shiftType).toBe('OFF');
  });
});

describe('bookable hours may be narrower than working hours, never wider', () => {
  it('7. a band inside the shift is accepted', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.create({
        clinicId: CLINIC,
        staffId: DOC,
        dates: ['2026-08-19'],
        startTime: '09:00',
        endTime: '17:00',
        bookableStartTime: '09:00',
        bookableEndTime: '12:00',
      }),
    );

    expect(ctx.created[0].bookableEndsAt).toEqual(new Date('2026-08-19T04:00:00.000Z'));
  });

  it('8. a band running past the end of the shift is refused', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.create({
          clinicId: CLINIC,
          staffId: DOC,
          dates: ['2026-08-19'],
          startTime: '09:00',
          endTime: '12:00',
          bookableStartTime: '09:00',
          bookableEndTime: '17:00',
        }),
      ),
    ).rejects.toThrow(/inside the shift/i);
  });

  it('9. half a band is refused — one end alone would quietly widen the roster', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.create({
          clinicId: CLINIC,
          staffId: DOC,
          dates: ['2026-08-19'],
          startTime: '09:00',
          endTime: '17:00',
          bookableStartTime: '09:00',
        }),
      ),
    ).rejects.toThrow(BadRequestException);
  });
});

describe('the monthly matrix reads HR rather than copying it', () => {
  it('10. approved leave appears in the cell WITHOUT a shift row being written', async () => {
    // Two records of the same absence is how they come to disagree. The leave
    // is read from `LeaveRequest`, where the person who took it entered it.
    const ctx = build({
      leave: [
        {
          staffId: DOC,
          startDate: iso('2026-08-20'),
          endDate: iso('2026-08-21'),
          leaveType: 'ANNUAL',
        },
      ],
    });

    const matrix = await ctx.service.month(CLINIC, '2026-08');
    const row = matrix.providers[0];

    expect(row.cells['2026-08-20'].leave).toEqual({ leaveType: 'ANNUAL' });
    expect(row.cells['2026-08-21'].leave).toEqual({ leaveType: 'ANNUAL' });
    expect(row.cells['2026-08-19'].leave).toBeNull();
    expect(ctx.created).toHaveLength(0);
  });

  it('11. a closed date is a property of the MONTH, not of any provider', async () => {
    const ctx = build({ closed: [{ date: iso('2026-08-31'), reason: 'Merdeka' }] });

    const matrix = await ctx.service.month(CLINIC, '2026-08');

    expect(matrix.closedDates['2026-08-31']).toBe('Merdeka');
  });

  it('12. an overnight shift is flagged so the cell can draw "11PM–9AM"', async () => {
    const ctx = build({
      shifts: [
        {
          id: 's1',
          staffId: DOC,
          shiftDate: iso('2026-08-19'),
          startsAt: new Date('2026-08-19T15:00:00.000Z'),
          endsAt: new Date('2026-08-20T01:00:00.000Z'),
          shiftType: 'WORKING',
          bookableStartsAt: null,
          bookableEndsAt: null,
          note: null,
        },
      ],
    });

    const cell = (await ctx.service.month(CLINIC, '2026-08')).providers[0].cells['2026-08-19'];

    expect(cell.shifts[0]).toMatchObject({
      startTime: '23:00',
      endTime: '09:00',
      crossesMidnight: true,
    });
  });

  it('13. the whole month is four queries, not one per provider per day', async () => {
    const ctx = build();

    await ctx.service.month(CLINIC, '2026-08');

    expect(ctx.tables.providerShift.findMany).toHaveBeenCalledTimes(1);
    expect(ctx.tables.leaveRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it('14. a malformed month is refused rather than producing an empty grid', async () => {
    const ctx = build();

    await expect(ctx.service.month(CLINIC, 'August')).rejects.toThrow(/YYYY-MM/);
  });
});

describe('copying a month aligns by weekday, because a roster is a weekly rhythm', () => {
  it('15. a Wednesday shift lands on a Wednesday', async () => {
    // 2026-08-05 is a Wednesday; the first Wednesday of September 2026 is the
    // 2nd. Copying date-for-date would have made it a Saturday.
    const ctx = build({
      shifts: [
        {
          id: 's1',
          clinicId: CLINIC,
          staffId: DOC,
          shiftDate: iso('2026-08-05'),
          startsAt: new Date('2026-08-05T01:00:00.000Z'),
          endsAt: new Date('2026-08-05T09:00:00.000Z'),
          shiftType: 'WORKING',
          bookableStartsAt: null,
          bookableEndsAt: null,
          note: null,
        },
      ],
    });

    const result = await ctx.run(() =>
      ctx.service.copyMonth({ clinicId: CLINIC, fromMonth: '2026-08', toMonth: '2026-09' }),
    );

    expect(result.created).toBe(1);
    expect(ctx.created[0].shiftDate).toEqual(iso('2026-09-02'));
    expect(new Date(ctx.created[0].shiftDate as Date).getUTCDay()).toBe(3);
  });

  it('16. the target month is cleared first, so copying twice does not double the roster', async () => {
    const ctx = build({
      shifts: [
        {
          id: 's1',
          clinicId: CLINIC,
          staffId: DOC,
          shiftDate: iso('2026-08-05'),
          startsAt: new Date('2026-08-05T01:00:00.000Z'),
          endsAt: new Date('2026-08-05T09:00:00.000Z'),
          shiftType: 'WORKING',
          bookableStartsAt: null,
          bookableEndsAt: null,
          note: null,
        },
      ],
    });

    await ctx.run(() =>
      ctx.service.copyMonth({ clinicId: CLINIC, fromMonth: '2026-08', toMonth: '2026-09' }),
    );

    expect(ctx.deleted).toHaveLength(1);
    expect(ctx.deleted[0]).toMatchObject({ staffId: { in: [DOC] } });
  });

  it('17. an empty source month copies nothing rather than clearing the target', async () => {
    const ctx = build({ shifts: [] });

    const result = await ctx.run(() =>
      ctx.service.copyMonth({ clinicId: CLINIC, fromMonth: '2026-08', toMonth: '2026-09' }),
    );

    expect(result).toEqual({ created: 0, skipped: 0 });
    expect(ctx.deleted).toHaveLength(0);
  });
});

describe('removing a shift does not silently discard the appointments in it', () => {
  it('18. the count of orphaned bookings is returned so somebody can act on it', async () => {
    const ctx = build({
      appointmentCount: 3,
      shifts: [
        {
          id: 's1',
          clinicId: CLINIC,
          staffId: DOC,
          shiftDate: iso('2026-08-19'),
          startsAt: new Date('2026-08-19T01:00:00.000Z'),
          endsAt: new Date('2026-08-19T09:00:00.000Z'),
        },
      ],
    });

    const result = await ctx.run(() => ctx.service.remove('s1'));

    expect(result).toEqual({ removed: true, orphanedAppointments: 3 });
  });
});

describe('the roster is not open to everybody who can log in', () => {
  it('19. a receptionist cannot write the roster', async () => {
    const ctx = build({ assignedRoles: ['ADMINISTRATOR'] });

    await expect(
      ctx.run(() =>
        ctx.service.create({
          clinicId: CLINIC,
          staffId: DOC,
          dates: ['2026-08-19'],
          startTime: '09:00',
          endTime: '17:00',
        }),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  it('20. somebody granted appointment.manage_roster by name can', async () => {
    // The permission is individually grantable precisely so a practice manager
    // who is not an owner can write the roster without being made one.
    const ctx = build({
      assignedRoles: ['ADMINISTRATOR'],
      directGrants: ['appointment.manage_roster'],
    });

    await expect(
      ctx.run(() =>
        ctx.service.create({
          clinicId: CLINIC,
          staffId: DOC,
          dates: ['2026-08-19'],
          startTime: '09:00',
          endTime: '17:00',
        }),
      ),
    ).resolves.toEqual({ created: 1 });
  });

  it('21. switching scheduling mode is a roster act, and it destroys nothing', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY' }));

    expect(ctx.tables.staff.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { appointmentScheduleMode: 'FIXED_WEEKLY' } }),
    );
    expect(ctx.deleted).toHaveLength(0);
  });
});

describe('datesInMonth', () => {
  it('22. February 2028 has 29 days', () => {
    expect(datesInMonth('2028-02')).toHaveLength(29);
    expect(datesInMonth('2028-02')[28]).toBe('2028-02-29');
  });

  it('23. February 2026 has 28', () => {
    expect(datesInMonth('2026-02')).toHaveLength(28);
  });
});
