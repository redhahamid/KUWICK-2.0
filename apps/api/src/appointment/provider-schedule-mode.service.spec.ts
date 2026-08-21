import { ProviderScheduleModeService } from './provider-schedule-mode.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';

// ===========================================================================
// §18b — THE ONE RESOLVER. The rule it holds is small enough to say in a
// sentence — the latest decision on or before the date governs, and a
// provider who never decided anything keeps their legacy column — but it is
// the sentence the availability engine, the roster board, public booking and
// reschedule all repeat, so it gets its own pins.
// ===========================================================================

const STAFF = 'staff-1';
const day = (date: string) => new Date(`${date}T00:00:00.000Z`);

function build(world: {
  periods?: { staffId?: string; mode: string; effectiveFrom: Date }[];
  legacyMode?: string | null;
}) {
  const periods = (world.periods ?? []).map((p) => ({ staffId: STAFF, ...p }));
  const prisma = {
    providerScheduleModePeriod: {
      findFirst: jest.fn(async ({ where }: never) => {
        const w = where as { staffId: string; effectiveFrom: { lte: Date } };
        const governing = periods
          .filter((p) => p.staffId === w.staffId && p.effectiveFrom <= w.effectiveFrom.lte)
          .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
        return governing ? { mode: governing.mode } : null;
      }),
      findMany: jest.fn(async ({ where }: never) => {
        const ids = (where as { staffId: { in: string[] } }).staffId.in;
        return periods
          .filter((p) => ids.includes(p.staffId))
          .sort((a, b) => a.effectiveFrom.getTime() - b.effectiveFrom.getTime());
      }),
    },
    staff: {
      findUnique: jest.fn(async () =>
        world.legacyMode === null ? null : { appointmentScheduleMode: world.legacyMode ?? 'FIXED_WEEKLY' },
      ),
      findMany: jest.fn(async ({ where }: never) =>
        (where as { id: { in: string[] } }).id.in.map((id: string) => ({
          id,
          appointmentScheduleMode: world.legacyMode ?? 'FIXED_WEEKLY',
        })),
      ),
    },
  } as unknown as TenantScopedPrismaClient;
  return { service: new ProviderScheduleModeService(prisma), prisma };
}

describe('which model governs a provider on a date', () => {
  it('1. no decisions on record → the legacy staff column, untouched and unbackfilled', async () => {
    const { service } = build({ legacyMode: 'ROSTER_LINKED' });

    expect(await service.resolveMode(STAFF, day('2026-08-25'))).toBe('ROSTER_LINKED');
  });

  it('2. the latest decision ON OR BEFORE the date governs; later ones do not exist yet', async () => {
    const { service } = build({
      periods: [
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-01-01') },
        { mode: 'FIXED_WEEKLY', effectiveFrom: day('2026-09-01') },
      ],
    });

    expect(await service.resolveMode(STAFF, day('2026-08-31'))).toBe('ROSTER_LINKED');
    expect(await service.resolveMode(STAFF, day('2026-09-01'))).toBe('FIXED_WEEKLY');
    expect(await service.resolveMode(STAFF, day('2026-12-25'))).toBe('FIXED_WEEKLY');
  });

  it('3. once ANY decision governs, the legacy column has nothing left to say', async () => {
    const { service, prisma } = build({
      legacyMode: 'FIXED_WEEKLY',
      periods: [{ mode: 'ROSTER_LINKED', effectiveFrom: day('2026-01-01') }],
    });

    expect(await service.resolveMode(STAFF, day('2026-08-25'))).toBe('ROSTER_LINKED');
    expect((prisma as never as { staff: { findUnique: jest.Mock } }).staff.findUnique).not.toHaveBeenCalled();
  });

  it('4. a decision dated only in the future leaves today on the legacy column', async () => {
    const { service } = build({
      legacyMode: 'ROSTER_LINKED',
      periods: [{ mode: 'FIXED_WEEKLY', effectiveFrom: day('2099-09-01') }],
    });

    expect(await service.resolveMode(STAFF, day('2026-08-25'))).toBe('ROSTER_LINKED');
  });

  it('5. the owner-UAT scenario: Monthly → Weekly from 1 Sep → Monthly from 1 Oct, all decided on 21 Aug', async () => {
    // The plan the module must hold: three decisions on record at once, and
    // every date answers from whichever one governs IT.
    const { service } = build({
      periods: [
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-08-21') },
        { mode: 'FIXED_WEEKLY', effectiveFrom: day('2026-09-01') },
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-10-01') },
      ],
    });

    expect(await service.resolveMode(STAFF, day('2026-08-31'))).toBe('ROSTER_LINKED');
    expect(await service.resolveMode(STAFF, day('2026-09-01'))).toBe('FIXED_WEEKLY');
    expect(await service.resolveMode(STAFF, day('2026-09-30'))).toBe('FIXED_WEEKLY');
    expect(await service.resolveMode(STAFF, day('2026-10-01'))).toBe('ROSTER_LINKED');
    expect(await service.resolveMode(STAFF, day('2026-10-15'))).toBe('ROSTER_LINKED');
  });
});

describe('the batch answer the roster board draws from', () => {
  it('6. each provider gets their governing mode AND every scheduled change ahead, in order', async () => {
    const { service } = build({
      periods: [
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-01-01') },
        { mode: 'FIXED_WEEKLY', effectiveFrom: day('2026-09-01') },
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-10-01') },
        { staffId: 'staff-2', mode: 'FIXED_WEEKLY', effectiveFrom: day('2026-03-01') },
      ],
    });

    const answer = await service.resolveModesFor([STAFF, 'staff-2', 'staff-3'], day('2026-08-01'));

    expect(answer.get(STAFF)).toEqual({
      mode: 'ROSTER_LINKED',
      upcoming: [
        { mode: 'FIXED_WEEKLY', effectiveFrom: day('2026-09-01') },
        { mode: 'ROSTER_LINKED', effectiveFrom: day('2026-10-01') },
      ],
    });
    expect(answer.get('staff-2')).toEqual({ mode: 'FIXED_WEEKLY', upcoming: [] });
    // staff-3 never decided anything: legacy column, no change on the horizon.
    expect(answer.get('staff-3')).toEqual({ mode: 'FIXED_WEEKLY', upcoming: [] });
  });

  it('7. an empty staff list asks the database nothing', async () => {
    const { service, prisma } = build({});

    expect((await service.resolveModesFor([], day('2026-08-01'))).size).toBe(0);
    const tables = prisma as never as {
      providerScheduleModePeriod: { findMany: jest.Mock };
    };
    expect(tables.providerScheduleModePeriod.findMany).not.toHaveBeenCalled();
  });
});
