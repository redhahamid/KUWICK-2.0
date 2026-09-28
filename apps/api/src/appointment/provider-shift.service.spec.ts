import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { SystemRole } from '@prisma/client';
import { ProviderShiftService, datesInMonth } from './provider-shift.service';
import { ProviderScheduleModeService } from './provider-schedule-mode.service';
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
  /** Pre-existing effective-dated mode decisions (§18b). */
  modePeriods?: { staffId: string; mode: string; effectiveFrom: Date }[];
  assignedRoles?: SystemRole[];
  actor?: Record<string, unknown>;
  appointmentCount?: number;
  directGrants?: string[];
}

function build(world: World = {}) {
  const created: Record<string, unknown>[] = [];
  const deleted: Record<string, unknown>[] = [];
  let periodSeq = 0;
  const periods: { id: string; staffId: string; mode: string; effectiveFrom: Date }[] = (
    world.modePeriods ?? []
  ).map((p) => ({ id: `seed-${(periodSeq += 1)}`, ...p }));

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
      // The branch scope reads the tenant's branches; one branch, and the actor holds it.
      findMany: jest.fn(async () => [{ id: CLINIC }]),
    },
    userClinicAccess: { findMany: jest.fn(async () => []) },
    staff: {
      findMany: jest.fn(
        async () =>
          world.providers ?? [
            {
              id: DOC,
              fullName: 'Dr Redha',
              // The board now selects the role, because it decides which part
              // of the workforce a row is and whether bookings can land in it.
              role: 'DOCTOR_RESIDENT',
              appointmentScheduleMode: 'ROSTER_LINKED',
              calendarColor: null,
              professionalType: 'MEDICAL_DOCTOR',
            },
          ],
      ),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === DOC
          ? { id: DOC, fullName: 'Dr Redha', clinicId: CLINIC, appointmentScheduleMode: 'ROSTER_LINKED' }
          : staffRow(world.actor),
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    providerScheduleModePeriod: {
      upsert: jest.fn(
        async ({ where, create, update }: { where: Record<string, never>; create: Record<string, never>; update: Record<string, never> }) => {
          const key = where.tenantId_staffId_effectiveFrom as unknown as {
            staffId: string;
            effectiveFrom: Date;
          };
          const existing = periods.find(
            (p) => p.staffId === key.staffId && p.effectiveFrom.getTime() === key.effectiveFrom.getTime(),
          );
          if (existing) {
            existing.mode = update.mode as unknown as string;
            return { mode: existing.mode, effectiveFrom: existing.effectiveFrom };
          }
          const row = {
            id: `p-${(periodSeq += 1)}`,
            staffId: create.staffId as unknown as string,
            mode: create.mode as unknown as string,
            effectiveFrom: create.effectiveFrom as unknown as Date,
          };
          periods.push(row);
          return { mode: row.mode, effectiveFrom: row.effectiveFrom };
        },
      ),
      findUnique: jest.fn(async ({ where }: { where: Record<string, never> }) => {
        const key = where.tenantId_staffId_effectiveFrom as unknown as {
          staffId: string;
          effectiveFrom: Date;
        };
        const existing = periods.find(
          (p) => p.staffId === key.staffId && p.effectiveFrom.getTime() === key.effectiveFrom.getTime(),
        );
        return existing ? { mode: existing.mode } : null;
      }),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const index = periods.findIndex((p) => p.id === where.id);
        const [row] = index >= 0 ? periods.splice(index, 1) : [];
        return row ?? null;
      }),
      findFirst: jest.fn(async ({ where }: { where: Record<string, never> }) => {
        const lte = (where.effectiveFrom as unknown as { lte: Date }).lte;
        const staffId = where.staffId as unknown as string;
        const governing = periods
          .filter((p) => p.staffId === staffId && p.effectiveFrom <= lte)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        return governing ? { mode: governing.mode } : null;
      }),
      findMany: jest.fn(async ({ where }: { where?: Record<string, never> } = {}) => {
        let rows = [...periods];
        const staffWhere = where?.staffId as unknown as { in?: string[] } | string | undefined;
        if (typeof staffWhere === 'string') rows = rows.filter((p) => p.staffId === staffWhere);
        else if (staffWhere?.in) rows = rows.filter((p) => staffWhere.in!.includes(p.staffId));
        const gt = (where?.effectiveFrom as unknown as { gt?: Date } | undefined)?.gt;
        if (gt) rows = rows.filter((p) => p.effectiveFrom > gt);
        return rows
          .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime())
          .map((p) => ({ id: p.id, staffId: p.staffId, mode: p.mode, effectiveFrom: p.effectiveFrom }));
      }),
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

  const service = new ProviderShiftService(prisma, rawPrisma, new ProviderScheduleModeService(prisma));
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

    const matrix = await ctx.run(() => ctx.service.month(CLINIC, '2026-08'));
    const row = matrix.providers[0];

    expect(row.cells['2026-08-20'].leave).toEqual({ leaveType: 'ANNUAL' });
    expect(row.cells['2026-08-21'].leave).toEqual({ leaveType: 'ANNUAL' });
    expect(row.cells['2026-08-19'].leave).toBeNull();
    expect(ctx.created).toHaveLength(0);
  });

  it('11. a closed date is a property of the MONTH, not of any provider', async () => {
    const ctx = build({ closed: [{ date: iso('2026-08-31'), reason: 'Merdeka' }] });

    const matrix = await ctx.run(() => ctx.service.month(CLINIC, '2026-08'));

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

    const cell = (await ctx.run(() => ctx.service.month(CLINIC, '2026-08'))).providers[0].cells['2026-08-19'];

    expect(cell.shifts[0]).toMatchObject({
      startTime: '23:00',
      endTime: '09:00',
      crossesMidnight: true,
    });
  });

  it('13. the whole month is four queries, not one per provider per day', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.month(CLINIC, '2026-08'));

    expect(ctx.tables.providerShift.findMany).toHaveBeenCalledTimes(1);
    expect(ctx.tables.leaveRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it('14. a malformed month is refused rather than producing an empty grid', async () => {
    const ctx = build();

    await expect(ctx.run(() => ctx.service.month(CLINIC, 'August'))).rejects.toThrow(/YYYY-MM/);
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

  it('21. switching scheduling mode writes a DATED DECISION, and destroys nothing', async () => {
    const ctx = build();

    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );

    // A period row, never the legacy staff column — two independently
    // editable mode values is how they come to disagree (§18b).
    expect(ctx.tables.providerScheduleModePeriod.upsert).toHaveBeenCalledTimes(1);
    expect(ctx.tables.staff.update).not.toHaveBeenCalled();
    expect(ctx.deleted).toHaveLength(0);
    expect(result.applied).toBe(true);
    expect(result.effectiveFrom).toBe('2099-09-01');
    // Until the date arrives, the resolver still answers with what governs
    // today — the legacy column, since no period has started yet.
    expect(result.modeToday).toBe('ROSTER_LINKED');
    expect(result.upcoming).toEqual([{ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }]);
  });

  it('22. a date already passed at the clinic is refused — history is not re-decided', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2000-01-01' }),
      ),
    ).rejects.toThrow(/already passed/i);
    expect(ctx.tables.providerScheduleModePeriod.upsert).not.toHaveBeenCalled();
  });

  it('23. re-deciding a scheduled change back to the current mode WITHDRAWS it', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );
    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'ROSTER_LINKED', effectiveFrom: '2099-09-01' }),
    );

    // "Monthly from 1 Sep" when Monthly already runs decides nothing — the
    // net effect is that the 1 Sep change is gone and the plan reads clean,
    // rather than the timeline accumulating a row that changes no answer.
    expect(result.applied).toBe(false);
    expect(result.withdrew).toBe(true);
    expect(result.upcoming).toEqual([]);
    expect(result.modeToday).toBe('ROSTER_LINKED');
  });

  it('24. the board reports the month mode, the next change, and the from-today plan', async () => {
    const ctx = build({
      modePeriods: [
        { staffId: DOC, mode: 'ROSTER_LINKED', effectiveFrom: iso('2020-01-01') },
        { staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: iso('2099-09-01') },
      ],
    });

    const row = (await ctx.run(() => ctx.service.month(CLINIC, '2026-08'))).providers[0];

    expect(row.scheduleMode).toBe('ROSTER_LINKED');
    expect(row.modeChange).toEqual({ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' });
    // The planning view is anchored to TODAY, whatever month is on screen —
    // the scheduling dialog always adds decisions from now.
    expect(row.modeToday).toBe('ROSTER_LINKED');
    expect(row.upcomingChanges).toEqual([{ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }]);
  });

  it('25. the whole plan is arrangeable TODAY — Monthly → Weekly from Sep → Monthly from Oct', async () => {
    const ctx = build({
      modePeriods: [{ staffId: DOC, mode: 'ROSTER_LINKED', effectiveFrom: iso('2020-01-01') }],
    });

    await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );
    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'ROSTER_LINKED', effectiveFrom: '2099-10-01' }),
    );

    // Both future decisions stand — genuinely different periods are never
    // consolidated — and nothing waited for 1 Sep to arrive.
    expect(result.applied).toBe(true);
    expect(result.upcoming).toEqual([
      { mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' },
      { mode: 'ROSTER_LINKED', effectiveFrom: '2099-10-01' },
    ]);
    expect(ctx.tables.providerScheduleModePeriod.delete).not.toHaveBeenCalled();
    expect(ctx.deleted).toHaveLength(0);
  });

  it('26. moving a switch EARLIER removes the later duplicate it makes redundant', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );
    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-08-15' }),
    );

    // Weekly from 15 Aug followed by Weekly from 1 Sep is one decision told
    // twice; the timeline keeps the one that decides something.
    expect(result.applied).toBe(true);
    expect(result.removedRedundant).toEqual([{ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }]);
    expect(result.upcoming).toEqual([{ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-08-15' }]);
  });

  it('27. scheduling a mode that would already govern that date is a stated no-op, not a stored row', async () => {
    const ctx = build();

    await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );
    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-10-01' }),
    );

    expect(result.applied).toBe(false);
    expect(result.withdrew).toBe(false);
    expect(result.upcoming).toEqual([{ mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }]);
  });

  it('28. consolidation never touches a decision that has governed real days', async () => {
    // A past period identical to what preceded it stays on record — the
    // trigger would refuse the delete, and the service does not try.
    const ctx = build({
      modePeriods: [{ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: iso('2020-01-01') }],
    });

    const result = await ctx.run(() =>
      ctx.service.setScheduleMode({ staffId: DOC, mode: 'FIXED_WEEKLY', effectiveFrom: '2099-09-01' }),
    );

    // The new row repeated the standing mode and was the redundant one; the
    // 2020 decision is untouched and still governs.
    expect(result.applied).toBe(false);
    expect(result.modeToday).toBe('FIXED_WEEKLY');
    const deleteCalls = ctx.tables.providerScheduleModePeriod.delete.mock
      .calls as unknown as [{ where: { id: string } }][];
    expect(deleteCalls.map((call) => call[0].where.id)).not.toContain('seed-1');
  });
});

describe('datesInMonth', () => {
  it('29. February 2028 has 29 days', () => {
    expect(datesInMonth('2028-02')).toHaveLength(29);
    expect(datesInMonth('2028-02')[28]).toBe('2028-02-29');
  });

  it('30. February 2026 has 28', () => {
    expect(datesInMonth('2026-02')).toHaveLength(28);
  });
});
