import { PrismaClient } from '@prisma/client';
import { augmentationRefusals, augmentHrUat } from '../prisma/augment-hr-uat';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * THE UAT AUGMENTATION, RUN TWICE.
 *
 * The whole point of an augmentation rather than a seed is that it is safe to
 * run again: it never deletes, never resets, and a second run against a world
 * somebody has already been testing in must leave that world exactly as it
 * found it. Every write in the script is guarded by a lookup — but "every
 * write is guarded" is a claim about 500 lines that somebody will edit, and
 * the only honest form of that claim is a test that runs it twice and counts.
 *
 * The environment guard (`assertSafe`) is deliberately NOT exercised here by
 * running the CLI: its entire job is to refuse a database holding more than
 * one tenant, and `kuwick_test` holds hundreds. Its DECISION is a pure
 * function and is tested as one.
 */
describe('HR UAT augmentation (e2e)', () => {
  let prisma: PrismaClient;
  let tenantId: string;

  beforeAll(() => {
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // A synthetic tenant with the two things the augmentation requires and does
  // not create: somewhere to work, and somebody to attribute approvals to.
  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Klinik Tambah (Synthetic)' } });
      await tx.clinic.create({ data: { tenantId, name: 'Klinik Tambah', timezone: 'Asia/Kuala_Lumpur' } });
    });
    await createOwnerAndBearer(prisma, tenantId);
  });

  const census = () =>
    withTenantContext(prisma, tenantId, async (tx) => ({
      staff: await tx.staff.count({ where: { tenantId } }),
      profiles: await tx.employeeProfile.count({ where: { tenantId } }),
      salaries: await tx.employeeSalary.count({ where: { tenantId } }),
      shifts: await tx.providerShift.count({ where: { tenantId } }),
      attendance: await tx.attendanceRecord.count({ where: { tenantId } }),
      leave: await tx.leaveRequest.count({ where: { tenantId } }),
      claims: await tx.staffClaim.count({ where: { tenantId } }),
      corrections: await tx.attendanceCorrectionRequest.count({ where: { tenantId } }),
      users: await tx.user.count({ where: { tenantId } }),
    }));

  // -------------------------------------------------------------------------
  it('writes a workforce world with history in it', async () => {
    await augmentHrUat(prisma, tenantId);
    const after = await census();

    // Six people, each with employment and — bar the locum — a salary.
    expect(after.staff).toBeGreaterThanOrEqual(6);
    expect(after.profiles).toBe(6);
    expect(after.salaries).toBe(5);
    // Two months of roster, and a month of punches behind it.
    expect(after.shifts).toBeGreaterThan(100);
    expect(after.attendance).toBeGreaterThan(50);
    // And the decisions September is deliberately left waiting on.
    expect(after.leave).toBeGreaterThan(0);
    expect(after.claims).toBeGreaterThan(0);
    expect(after.corrections).toBeGreaterThan(0);
  }, 180_000);

  it('RUNS TWICE AND CHANGES NOTHING THE SECOND TIME', async () => {
    await augmentHrUat(prisma, tenantId);
    const first = await census();
    await augmentHrUat(prisma, tenantId);
    const second = await census();

    // Not "roughly the same" — the same. A second Nurul, a duplicated shift or
    // a second copy of August's punches would each be a different failure and
    // all three would be invisible in a total that merely grew a little.
    expect(second).toEqual(first);
  }, 300_000);

  it('a third run is still the same world', async () => {
    // Twice can pass by accident where the first run creates and the second
    // updates in place. Three times is the shape of "runs on a Monday, runs
    // again on Friday, runs again when somebody is not sure whether it ran".
    await augmentHrUat(prisma, tenantId);
    await augmentHrUat(prisma, tenantId);
    const second = await census();
    await augmentHrUat(prisma, tenantId);
    expect(await census()).toEqual(second);
  }, 420_000);

  it('does not touch another tenant living in the same database', async () => {
    const neighbour = randomId();
    await withTenantContext(prisma, neighbour, (tx) =>
      tx.tenant.create({ data: { id: neighbour, name: 'Klinik Jiran (Synthetic)' } }),
    );
    const before = await withTenantContext(prisma, neighbour, (tx) => tx.staff.count({ where: { tenantId: neighbour } }));

    await augmentHrUat(prisma, tenantId);

    const after = await withTenantContext(prisma, neighbour, (tx) => tx.staff.count({ where: { tenantId: neighbour } }));
    expect(after).toBe(before);
  }, 180_000);
});

/**
 * WHERE IT WILL AND WILL NOT RUN — the decision, without a database.
 */
describe('HR UAT augmentation guard', () => {
  const ok = { nodeEnv: 'development', flag: 'yes', databaseUrl: 'postgresql://x/y' };
  const synthetic = [{ name: 'Kuwick UAT Staging (Synthetic)' }];

  it('runs against a single synthetic tenant with the flag set', () => {
    expect(augmentationRefusals(ok, synthetic)).toEqual([]);
  });

  it('refuses without the explicit flag', () => {
    expect(augmentationRefusals({ ...ok, flag: undefined }, synthetic)).toContain(
      'KUWICK_HR_UAT_AUGMENT is not "yes"',
    );
  });

  it('refuses in production', () => {
    expect(augmentationRefusals({ ...ok, nodeEnv: 'production' }, synthetic)).toContain('NODE_ENV is production');
  });

  it('REFUSES a database holding anything that is not marked synthetic', () => {
    // The one that matters. A real clinic's database has a real clinic's name
    // in it, and this is what stands between a UAT script and that clinic.
    const refusals = augmentationRefusals(ok, [...synthetic, { name: 'Klinik Hijraa Sdn Bhd' }]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/not marked synthetic/);
    expect(refusals[0]).toContain('Klinik Hijraa Sdn Bhd');
  });

  it('refuses to guess between two synthetic tenants', () => {
    expect(augmentationRefusals(ok, [...synthetic, { name: 'Klinik Contoh (UAT)' }])[0]).toMatch(/Refusing to guess/);
  });

  it('refuses an empty database rather than seeding one', () => {
    expect(augmentationRefusals(ok, [])).toEqual(['No tenant here. Seed a UAT world first.']);
  });

  it('is not fooled by a real name that merely contains the letters u-a-t', () => {
    // "Klinik Suatu" contains "uat". A substring test would have let this
    // through, which is why the synthetic test is word-boundary anchored.
    expect(augmentationRefusals(ok, [{ name: 'Klinik Suatu Sdn Bhd' }])[0]).toMatch(/not marked synthetic/);
  });
});
