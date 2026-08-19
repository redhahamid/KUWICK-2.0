import { DoctorScheduleService } from './doctor-schedule.service';
import { TenantScopedPrismaClient } from '../core/tenant-scoped-prisma.provider';
import { tenantContextStorage } from '../core/tenant-context';

// ===========================================================================
// THE ROSTER DATA-LOSS DEFECT.
//
// Two screens wrote `doctor_schedules` with opposite mental models:
//
//   /management/operation/doctor-schedules — adds EFFECTIVE-DATED rows.
//       "Dr Redha works Tuesdays, 1 March to 30 June."
//   /settings/scheduling/provider-availability — seven toggles, saved as one
//       statement, implemented as `deleteMany` + recreate.
//
// Saving the second silently destroyed everything the first had recorded,
// dating included. No error, no warning, no way to tell afterwards. This file
// exists so that never comes back.
// ===========================================================================

const STAFF = 'doc-1';
const CLINIC = 'clinic-1';

function build() {
  const operations: { table: string; op: string; args: Record<string, unknown> }[] = [];
  const record = (table: string, op: string) => (args: Record<string, unknown>) => {
    operations.push({ table, op, args });
    return { __op: `${table}.${op}` };
  };

  const prisma = {
    doctorSchedule: {
      updateMany: record('doctorSchedule', 'updateMany'),
      deleteMany: record('doctorSchedule', 'deleteMany'),
      create: record('doctorSchedule', 'create'),
      findMany: jest.fn(async () => []),
    },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  } as unknown as TenantScopedPrismaClient;

  const service = new DoctorScheduleService(prisma);
  const run = <T>(fn: () => Promise<T>) =>
    tenantContextStorage.run({ tenantId: 't1', staffId: 'staff-7', userId: 'u1' }, fn);

  return { service, prisma, operations, run };
}

const MONDAY = { dayOfWeek: 1, startTime: '09:00', endTime: '17:00' };

describe('saving the weekly pattern preserves what the other screen recorded', () => {
  it('1. no unconditional deleteMany — the destructive call is gone', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.setWeekly({ staffId: STAFF, clinicId: CLINIC, days: [MONDAY] }));

    const deletes = ctx.operations.filter((o) => o.op === 'deleteMany');
    // There is exactly one, and it is NARROW: only rows that had not taken
    // effect before today. A delete with no date bound is the defect.
    expect(deletes).toHaveLength(1);
    const where = (deletes[0].args as { where: Record<string, unknown> }).where;
    expect(where.effectiveFrom).toBeDefined();
  });

  it('2. rows already in force are END-DATED, not removed', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.setWeekly({ staffId: STAFF, clinicId: CLINIC, days: [MONDAY] }));

    const endDate = ctx.operations.find((o) => o.op === 'updateMany');
    expect(endDate).toBeDefined();
    const args = endDate!.args as { where: Record<string, unknown>; data: { effectiveTo: Date } };
    expect(args.data.effectiveTo).toBeInstanceOf(Date);
    // Yesterday: the old pattern was true up to and including yesterday.
    const today = new Date(new Date().toISOString().slice(0, 10));
    expect(args.data.effectiveTo.getTime()).toBe(today.getTime() - 24 * 60 * 60 * 1000);
  });

  it('3. the end-dating only touches rows that are actually current', async () => {
    // A row that already ended in March must not have its end date rewritten
    // to yesterday — that would move a historical fact.
    const ctx = build();

    await ctx.run(() => ctx.service.setWeekly({ staffId: STAFF, clinicId: CLINIC, days: [MONDAY] }));

    const where = (ctx.operations.find((o) => o.op === 'updateMany')!.args as {
      where: Record<string, unknown>;
    }).where;
    expect(where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gte: expect.any(Date) } }]);
  });

  it('4. the new pattern is written effective from today, open-ended', async () => {
    const ctx = build();

    await ctx.run(() => ctx.service.setWeekly({ staffId: STAFF, clinicId: CLINIC, days: [MONDAY] }));

    const created = ctx.operations.filter((o) => o.op === 'create');
    expect(created).toHaveLength(1);
    const data = (created[0].args as { data: Record<string, unknown> }).data;
    expect(data.effectiveTo).toBeNull();
    expect(data.effectiveFrom).toBeInstanceOf(Date);
  });

  it('5. every write happens in ONE transaction', async () => {
    // A failed third request must not leave a week half-changed.
    const ctx = build();

    await ctx.run(() => ctx.service.setWeekly({ staffId: STAFF, clinicId: CLINIC, days: [MONDAY] }));

    expect(ctx.prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('an overnight weekly row is a night shift, not a mistake', () => {
  it('6. 23:00 to 09:00 is accepted', async () => {
    // It used to be refused as "ends before it starts", which made a night
    // doctor impossible to roster on this screen at all.
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.setWeekly({
          staffId: STAFF,
          clinicId: CLINIC,
          days: [{ dayOfWeek: 3, startTime: '23:00', endTime: '09:00' }],
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('7. a row that starts and ends at the same time is still refused', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.setWeekly({
          staffId: STAFF,
          clinicId: CLINIC,
          days: [{ dayOfWeek: 3, startTime: '09:00', endTime: '09:00' }],
        }),
      ),
    ).rejects.toThrow(/nothing could be booked/i);
  });

  it('8. the same weekday twice is refused', async () => {
    const ctx = build();

    await expect(
      ctx.run(() =>
        ctx.service.setWeekly({
          staffId: STAFF,
          clinicId: CLINIC,
          days: [MONDAY, { ...MONDAY, startTime: '18:00', endTime: '20:00' }],
        }),
      ),
    ).rejects.toThrow(/listed twice/i);
  });
});
