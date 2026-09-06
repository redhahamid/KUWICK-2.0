import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor } from './auth';

/**
 * THE UAT OWNER CAN RUN MANAGEMENT. THE UAT DOCTOR CANNOT.
 *
 * Written after a real support round: the Management A–Z guide handed the
 * owner `owner@admin-uat.kuwick.invalid`, which is the LOCAL two-branch
 * fixture's account, while the deployed environment had been built by
 * `seed-staging-uat.ts`, whose owner is `owner@uat.kuwick.invalid`. The wrong
 * address does not authenticate, and the only account the owner could get in
 * with was the synthetic DOCTOR — from which every Management screen is
 * correctly refused. Two hours of "the deployment is broken" for a credential
 * that was never in that database.
 *
 * The credential itself is a documentation fact and lives in the guide. What
 * belongs in the suite is the thing the guide is asserting ON BEHALF of: that
 * the role the UAT seeds give the owner really does reach all six Management
 * domains, and the role they give the doctor really does not reach any of
 * them. Both halves matter — an owner who cannot open Payroll is a broken UAT,
 * and a doctor who can is a broken product.
 *
 * `OWNER_ADMIN` and `DOCTOR_RESIDENT` are exactly the roles both UAT seeds
 * write (`seed-staging-uat.ts` ROLES, `seed-admin-uat.ts` staff profiles), so
 * this drives the same authorisation path a seeded login does.
 */
describe('UAT owner and doctor: who may run Management (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let owner: string;
  let doctor: string;

  const server = () => app.getHttpServer();

  /**
   * One read per Management domain, chosen because each is the first call the
   * module's landing screen makes — so a refusal here is a module the owner
   * cannot open at all.
   */
  const MANAGEMENT = [
    { module: 'Operation', path: '/operations/overview' },
    { module: 'Stock', path: '/stock-admin/movements' },
    { module: 'Panel', path: '/panel-workspace/reconciliation' },
    { module: 'HR', path: '/workforce/employees' },
    { module: 'Payroll', path: '/workforce/payroll/runs' },
    { module: 'Payroll (readiness)', path: '/workforce/payroll/readiness' },
    { module: 'Payroll (statutory rules)', path: '/workforce/payroll/statutory-rules' },
    { module: 'Finance', path: '/finance/receivables/patients' },
  ] as const;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Klinik UAT Access (Synthetic)' } }),
    );

    const ownerStaff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.OWNER_ADMIN, fullName: 'UAT Owner (Synthetic)' } }),
    );
    owner = bearerFor(tenantId, ownerStaff.id, Role.OWNER_ADMIN);

    // A single branch, exactly as the staging UAT environment has, so the
    // owner's reads resolve without naming one.
    await request(server()).post('/clinics').set('Authorization', owner).send({ name: 'Klinik UAT Access' }).expect(201);

    const doctorStaff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Dr UAT Doctor (Synthetic)' } }),
    );
    doctor = bearerFor(tenantId, doctorStaff.id, Role.DOCTOR_RESIDENT);
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  describe('the synthetic OWNER can open every Management module', () => {
    it.each(MANAGEMENT)('$module', async ({ path }) => {
      // 200, not "not 403": a module that answers 404 because its route moved
      // is just as unopenable to the owner running UAT.
      await request(server()).get(path).set('Authorization', owner).expect(200);
    });
  });

  describe('the synthetic DOCTOR is refused every one of them', () => {
    it.each(MANAGEMENT)('$module', async ({ path }) => {
      // 403 specifically. A 401 would mean the token was rejected rather than
      // the capability, and would pass this test while proving nothing about
      // what a signed-in doctor may do.
      await request(server()).get(path).set('Authorization', doctor).expect(403);
    });
  });

  /**
   * The one that the support round actually turned on: the owner is not merely
   * able to LOOK at payroll, but holds the authority the module is gated on.
   */
  it('gives the owner payroll authority the doctor does not have', async () => {
    const { can } = await import('../src/core/permissions');
    // `active: true` and NO explicit assignment — a staff row exactly as both
    // UAT seeds write it, so this resolves through LEGACY_ROLE_FALLBACK, which
    // is the path a seeded login actually takes. An inactive row holds nothing
    // at all, and an empty assignment array is not the same fact as none.
    const asOwner = (permission: Parameters<typeof can>[1]) =>
      can({ role: Role.OWNER_ADMIN, active: true } as never, permission);
    const asDoctor = (permission: Parameters<typeof can>[1]) =>
      can({ role: Role.DOCTOR_RESIDENT, active: true } as never, permission);

    for (const permission of ['hr.payroll.view', 'hr.payroll.run', 'hr.payroll.approve', 'hr.salary.view'] as const) {
      expect([permission, asOwner(permission)]).toEqual([permission, true]);
      expect([permission, asDoctor(permission)]).toEqual([permission, false]);
    }
  });
});
