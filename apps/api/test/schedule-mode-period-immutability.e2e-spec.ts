import { PrismaClient, ProviderScheduleMode, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// §18b — the effective-dated scheduling mode table, proved AT THE DATABASE:
//
//   RLS — provider_schedule_mode_periods carries the same ENABLE + FORCE +
//     tenant_isolation policy as every tenant-scoped table, so one tenant's
//     mode decisions are invisible to another even through raw SQL.
//   The append-only trigger — a period whose effective_from has already
//     governed real days (before CURRENT_DATE) can be neither rewritten nor
//     removed, by anyone at all including the table owner/superuser, because
//     re-deciding the past would silently change what every historical
//     availability answer meant. A TODAY-OR-FUTURE period stays editable:
//     withdrawing or re-deciding a change before it takes effect is a
//     correction, not a rewrite.
//   The unique key — one provider can never hold two decisions for the same
//     effective date, so "which decision governs" always has one answer.
//
// Same trap-avoidance as appointment-audit-immutability.e2e-spec.ts: the
// refusal patterns live HERE, far from the toThrow() call sites, because
// Prisma error messages quote the failing source frame and an inline literal
// can match its own assertion text.

const TRIGGER_REFUSAL = /schedule-mode history is append-only/;
const UNIQUE_REFUSAL = /Unique constraint|duplicate key/;

const OWNER_URL = process.env.TEST_OWNER_DATABASE_URL;

const PAST = new Date('2000-01-01T00:00:00.000Z');
const FUTURE = new Date('2099-09-01T00:00:00.000Z');
const LATER_FUTURE = new Date('2099-10-01T00:00:00.000Z');

describe('Provider schedule-mode periods (e2e, DB-level)', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let otherTenantId: string;
  let clinicId: string;
  let staffId: string;
  let pastPeriodId: string;
  let futurePeriodId: string;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    tenantId = randomId();
    otherTenantId = randomId();

    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Mode Period Tenant' } });
      const clinic = await tx.clinic.create({ data: { tenantId, name: 'Mode Period Clinic' } });
      clinicId = clinic.id;
      const staff = await tx.staff.create({
        data: { tenantId, clinicId, role: Role.DOCTOR_RESIDENT, fullName: 'Mode Period Doctor' },
      });
      staffId = staff.id;

      // A period that has governed real days — inserted directly because the
      // service layer (rightly) refuses to CREATE one dated in the past; the
      // trigger's job begins once such a row exists.
      const past = await tx.providerScheduleModePeriod.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          mode: ProviderScheduleMode.ROSTER_LINKED,
          effectiveFrom: PAST,
        },
      });
      pastPeriodId = past.id;

      const future = await tx.providerScheduleModePeriod.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          mode: ProviderScheduleMode.FIXED_WEEKLY,
          effectiveFrom: FUTURE,
        },
      });
      futurePeriodId = future.id;
    });

    await withTenantContext(prisma, otherTenantId, async (tx) => {
      await tx.tenant.create({ data: { id: otherTenantId, name: 'Other Tenant' } });
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function expectPastPeriodUnchanged(): Promise<void> {
    const row = await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerScheduleModePeriod.findUniqueOrThrow({ where: { id: pastPeriodId } }),
    );
    expect(row.mode).toBe(ProviderScheduleMode.ROSTER_LINKED);
    expect(row.effectiveFrom).toEqual(PAST);
  }

  // ── tenant isolation ──────────────────────────────────────────────────────

  it('another tenant cannot read the periods, even through raw SQL', async () => {
    const viaPrisma = await withTenantContext(prisma, otherTenantId, (tx) =>
      tx.providerScheduleModePeriod.findMany({ where: { staffId } }),
    );
    expect(viaPrisma).toHaveLength(0);

    const viaSql = await withTenantContext(prisma, otherTenantId, (tx) =>
      tx.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count FROM "provider_schedule_mode_periods"
      `,
    );
    expect(Number(viaSql[0].count)).toBe(0);
  });

  it("another tenant's UPDATE and DELETE match zero rows", async () => {
    const updated = await withTenantContext(prisma, otherTenantId, (tx) =>
      tx.providerScheduleModePeriod.updateMany({
        where: { id: futurePeriodId },
        data: { mode: ProviderScheduleMode.ROSTER_LINKED },
      }),
    );
    expect(updated.count).toBe(0);

    const deleted = await withTenantContext(prisma, otherTenantId, (tx) =>
      tx.providerScheduleModePeriod.deleteMany({ where: { id: futurePeriodId } }),
    );
    expect(deleted.count).toBe(0);
  });

  // ── the past is immutable (application seat) ──────────────────────────────

  it('rewriting a period that has governed past days is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`
          UPDATE "provider_schedule_mode_periods"
          SET mode = 'FIXED_WEEKLY' WHERE id = ${pastPeriodId}
        `,
      ),
    ).rejects.toThrow(TRIGGER_REFUSAL);
    await expectPastPeriodUnchanged();
  });

  it('removing a period that has governed past days is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM "provider_schedule_mode_periods" WHERE id = ${pastPeriodId}`,
      ),
    ).rejects.toThrow(TRIGGER_REFUSAL);
    await expectPastPeriodUnchanged();
  });

  // ── the future stays re-decidable ─────────────────────────────────────────

  it('a change that has not taken effect yet CAN be re-decided and withdrawn', async () => {
    const revised = await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerScheduleModePeriod.update({
        where: { id: futurePeriodId },
        data: { mode: ProviderScheduleMode.ROSTER_LINKED },
      }),
    );
    expect(revised.mode).toBe(ProviderScheduleMode.ROSTER_LINKED);

    // Withdrawing a scheduled change before its day arrives is a correction,
    // not a rewrite — the trigger lets it through.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerScheduleModePeriod.delete({ where: { id: futurePeriodId } }),
    );
    const remaining = await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerScheduleModePeriod.findMany({ where: { staffId } }),
    );
    expect(remaining.map((row) => row.id)).toEqual([pastPeriodId]);
  });

  // ── one decision per day ──────────────────────────────────────────────────

  it('two decisions for the same provider and date are refused by the unique key', async () => {
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerScheduleModePeriod.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          mode: ProviderScheduleMode.FIXED_WEEKLY,
          effectiveFrom: LATER_FUTURE,
        },
      }),
    );
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.providerScheduleModePeriod.create({
          data: {
            tenantId,
            clinicId,
            staffId,
            mode: ProviderScheduleMode.ROSTER_LINKED,
            effectiveFrom: LATER_FUTURE,
          },
        }),
      ),
    ).rejects.toThrow(UNIQUE_REFUSAL);
  });

  // ── as the table owner (migration seat) ───────────────────────────────────
  // Privileges do not bind the owner and RLS does not bind a superuser; the
  // trigger is the layer that still refuses a rewrite of governed history.

  describe('as the table owner (migration seat)', () => {
    let owner: PrismaClient;

    beforeAll(() => {
      if (!OWNER_URL) {
        throw new Error(
          'TEST_OWNER_DATABASE_URL is not set — point it at kuwick_test as the role that ran the migrations (see .env.test.example).',
        );
      }
      owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
    });

    afterAll(async () => {
      await owner?.$disconnect();
    });

    it('UPDATE of governed history is refused even for the owner/superuser', async () => {
      await expect(
        owner.$executeRaw`
          UPDATE "provider_schedule_mode_periods"
          SET mode = 'FIXED_WEEKLY' WHERE id = ${pastPeriodId}
        `,
      ).rejects.toThrow(TRIGGER_REFUSAL);
      await expectPastPeriodUnchanged();
    });

    it('DELETE of governed history is refused even for the owner/superuser', async () => {
      await expect(
        owner.$executeRaw`DELETE FROM "provider_schedule_mode_periods" WHERE id = ${pastPeriodId}`,
      ).rejects.toThrow(TRIGGER_REFUSAL);
      await expectPastPeriodUnchanged();
    });
  });
});
