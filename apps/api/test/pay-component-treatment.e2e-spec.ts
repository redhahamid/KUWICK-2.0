import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * THE STATUTORY TREATMENT OF A COMPONENT IS THE CLINIC'S TO SET.
 *
 * Kuwick seeds a catalogue that reproduces what the old engine did. Those
 * values are a STARTING GUESS, not a statement of Malaysian law, and clinics
 * genuinely differ: one contributes EPF on basic pay only, the next
 * contributes on allowances too. Both are lawful, and a product that ships
 * either one as immutable is wrong at half its customers.
 *
 * So a preset's treatment is editable — but never silently. This file is the
 * contract: what may change, what may not, what a change costs in evidence,
 * and what a change must never be allowed to do to a month already paid.
 */
describe('pay component statutory treatment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;

  const server = () => app.getHttpServer();

  const list = async () => {
    const res = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
    return res.body.components as Record<string, unknown>[];
  };
  const find = async (code: string) => (await list()).find((row) => row.code === code)!;
  const historyOf = async (code: string) => {
    const res = await request(server())
      .get(`/workforce/pay-components/${code}/history`)
      .set('Authorization', bearer)
      .expect(200);
    return res.body.versions as Record<string, unknown>[];
  };
  /** Send a component back with some flags moved. */
  const save = (row: Record<string, unknown>, changes: Record<string, unknown>) =>
    request(server())
      .post('/workforce/pay-components')
      .set('Authorization', bearer)
      .send({
        id: row.id,
        code: row.code,
        name: row.name,
        type: row.type,
        category: row.category,
        includeIn: row.includeIn,
        pcbLiable: row.pcbLiable,
        epfLiable: row.epfLiable,
        socsoLiable: row.socsoLiable,
        eisLiable: row.eisLiable,
        hrdLiable: row.hrdLiable,
        includeInOrpBase: row.includeInOrpBase,
        includeInUnpaidLeaveBase: row.includeInUnpaidLeaveBase,
        additionalRemuneration: row.additionalRemuneration,
        prorated: row.prorated,
        employerSide: row.employerSide,
        active: row.active,
        ...changes,
      });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Component Treatment Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    await request(server()).post('/workforce/pay-components/seed').set('Authorization', bearer).expect(201);
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('what the seed claims about itself', () => {
    it('says plainly that no flag on the page has been checked against any authority', async () => {
      const res = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
      expect(res.body.verificationNotice.anyVerified).toBe(false);
      expect(res.body.verificationNotice.statement).toContain('not a statement of Malaysian law');
    });

    it('ships every component UNVERIFIED and as Kuwick’s guess, not the clinic’s decision', async () => {
      for (const row of await list()) {
        expect(row.verificationStatus).toBe('DRAFT');
        expect(row.clinicOverride).toBe(false);
        expect(row.changeReason).toBeNull();
      }
    });
  });

  describe('a preset’s treatment belongs to the clinic', () => {
    it('lets the owner make an allowance EPF-exempt, which used to be refused outright', async () => {
      const before = await find('ALLOWANCE');
      expect(before.systemControlled).toBe(true);
      expect(before.epfLiable).toBe(true);

      await save(before, {
        epfLiable: false,
        effectiveFrom: '2026-10-01',
        reason: 'This clinic contributes EPF on basic pay only.',
      }).expect(201);

      const after = await find('ALLOWANCE');
      expect(after.epfLiable).toBe(false);
      // Still a preset — what it IS did not change, only what it is liable to.
      expect(after.systemControlled).toBe(true);
    });

    it('records WHO decided and WHY on the version itself, not only in a log', async () => {
      const after = await find('ALLOWANCE');
      expect(after.clinicOverride).toBe(true);
      expect(after.changeReason).toBe('This clinic contributes EPF on basic pay only.');
    });

    it('does not let the seed’s provenance follow the clinic’s decision', async () => {
      // Every seeded row cites "Seeded to reproduce the existing engine
      // behaviour". Carrying that onto a version the CLINIC chose would let a
      // payslip cite Kuwick as the source of somebody else's decision.
      const [current, seeded] = await historyOf('ALLOWANCE');
      expect(current.clinicOverride).toBe(true);
      expect(current.sourceRef).toBeNull();
      expect(seeded.clinicOverride).toBe(false);
      expect(seeded.sourceRef).toContain('Seeded');
    });

    it('refuses to redefine what a component IS, because the arithmetic reads that', async () => {
      const overtime = await find('OVERTIME');
      const res = await save(overtime, {
        category: 'ALLOWANCE',
        effectiveFrom: '2026-10-01',
        reason: 'Trying to turn overtime into an allowance.',
      }).expect(409);
      expect(res.body.message).toContain('cannot be redefined');
    });
  });

  describe('what a change to the money costs in evidence', () => {
    it('refuses a treatment change with no reason', async () => {
      const row = await find('COMMISSION');
      const res = await save(row, { epfLiable: false, effectiveFrom: '2026-10-01' }).expect(400);
      expect(res.body.message).toContain('Send a reason');
    });

    it('refuses a treatment change with no date, naming what would be repriced', async () => {
      const row = await find('COMMISSION');
      const res = await save(row, { epfLiable: false, reason: 'EPF on basic pay only.' }).expect(400);
      expect(res.body.message).toContain('effectiveFrom');
    });

    it('lets a LABEL be corrected without a date or a reason, because a typo is not a policy', async () => {
      const row = await find('UNIFORM');
      await save(row, { name: 'Uniform charge' }).expect(201);
      expect((await find('UNIFORM')).name).toBe('Uniform charge');
    });
  });

  describe('history, which is what an audit actually asks for', () => {
    it('keeps every version with its own dates, flags and provenance', async () => {
      const versions = await historyOf('ALLOWANCE');
      expect(versions).toHaveLength(2);
      const [current, seeded] = versions;

      expect(current.version).toBe(2);
      expect(current.effectiveFrom).toBe('2026-10-01');
      expect(current.effectiveTo).toBeNull();
      expect(current.epfLiable).toBe(false);
      expect(current.setBy).not.toBeNull();

      // The old version is CLOSED the day before the new one opens: no gap, no
      // overlap, so every period resolves to exactly one treatment.
      expect(seeded.version).toBe(1);
      expect(seeded.effectiveTo).toBe('2026-09-30');
      expect(seeded.epfLiable).toBe(true);
    });

    it('shows one row per component on the settings list, never two', async () => {
      // The list had no filter at all, so the first re-dated component appeared
      // twice with nothing to say which was which.
      const rows = (await list()).filter((row) => row.code === 'ALLOWANCE');
      expect(rows).toHaveLength(1);
    });

    it('shows a change dated in the FUTURE, with the date it starts', async () => {
      /*
       * Filtering the list to what is in force today would hide this row until
       * October, so an owner who had just made allowances EPF-exempt from the
       * 1st would reopen the screen, see EPF ✓ and conclude their decision had
       * been thrown away. The standing version is shown, and it carries the
       * date it begins.
       */
      const row = await find('ALLOWANCE');
      expect(row.version).toBe(2);
      expect(row.epfLiable).toBe(false);
      expect(row.effectiveFrom).toBe('2026-10-01');
    });
  });

  describe('the clinic’s own components', () => {
    it('creates one, and it is the clinic’s from the start', async () => {
      await request(server())
        .post('/workforce/pay-components')
        .set('Authorization', bearer)
        .send({
          code: 'PROCEDURE_INCENTIVE',
          name: 'Procedure incentive',
          type: 'ADDITION',
          category: 'REMUNERATION',
          pcbLiable: true,
          epfLiable: false,
          socsoLiable: true,
          eisLiable: true,
        })
        .expect(201);

      const created = await find('PROCEDURE_INCENTIVE');
      expect(created.systemControlled).toBe(false);
      expect(created.epfLiable).toBe(false);
      expect(created.socsoLiable).toBe(true);
      // A clinic-defined component is UNVERIFIED by construction: nobody has
      // checked it against KWSP either.
      expect(created.verificationStatus).toBe('DRAFT');
    });

    it('refuses to put overtime into the ordinary-rate base, clinic-defined or not', async () => {
      const res = await request(server())
        .post('/workforce/pay-components')
        .set('Authorization', bearer)
        .send({
          code: 'WEEKEND_OT',
          name: 'Weekend overtime',
          type: 'OVERTIME',
          category: 'REMUNERATION',
          includeInOrpBase: true,
        })
        .expect(400);
      expect(res.body.message).toContain('raise the rate paid for the next one');
    });
  });

  /**
   * THE CLINIC'S ACTUAL TABLE, as the owner gave it. Six cells across six
   * components differ from what Kuwick seeds; Overtime and Director's fee
   * already match. Every EPF ✗ here is THIS CLINIC'S POLICY — EPF on basic pay
   * only — and not a claim about the law, which is why each one carries the
   * sentence that says so.
   */
  describe('the whole table a real clinic asked for', () => {
    const WANTED: Record<string, { epf: boolean; socso: boolean; eis: boolean; pcb: boolean }> = {
      INCENTIVE: { epf: false, socso: true, eis: true, pcb: true },
      COMMISSION: { epf: false, socso: true, eis: true, pcb: true },
      ALLOWANCE: { epf: false, socso: true, eis: true, pcb: true },
      ATTENDANCE_ALLOWANCE: { epf: false, socso: true, eis: true, pcb: true },
      OVERTIME: { epf: false, socso: true, eis: true, pcb: true },
      LOCUM_FEE: { epf: false, socso: true, eis: true, pcb: true },
      DIRECTOR_FEE: { epf: false, socso: false, eis: false, pcb: true },
      MILEAGE: { epf: false, socso: false, eis: false, pcb: false },
    };

    it('can be expressed in full, one dated version per component that moves', async () => {
      for (const [code, want] of Object.entries(WANTED)) {
        const row = await find(code);
        const moved =
          row.epfLiable !== want.epf ||
          row.socsoLiable !== want.socso ||
          row.eisLiable !== want.eis ||
          row.pcbLiable !== want.pcb;
        if (!moved) continue;
        await save(row, {
          epfLiable: want.epf,
          socsoLiable: want.socso,
          eisLiable: want.eis,
          pcbLiable: want.pcb,
          effectiveFrom: '2026-11-01',
          reason: 'Clinic policy: EPF on basic pay only; the rest as this clinic remits them.',
        }).expect(201);
      }

      for (const [code, want] of Object.entries(WANTED)) {
        const row = await find(code);
        expect({ code, epf: row.epfLiable, socso: row.socsoLiable, eis: row.eisLiable, pcb: row.pcbLiable }).toEqual({
          code,
          epf: want.epf,
          socso: want.socso,
          eis: want.eis,
          pcb: want.pcb,
        });
      }
    });

    it('left Overtime and Director’s fee alone, because they already matched', async () => {
      // Nothing moved, so nothing was versioned: a no-op edit must not litter
      // the history with versions that changed nothing.
      expect(await historyOf('OVERTIME')).toHaveLength(1);
      expect(await historyOf('DIRECTOR_FEE')).toHaveLength(1);
    });

    it('still says none of it has been checked against an authority', async () => {
      const res = await request(server()).get('/workforce/pay-components').set('Authorization', bearer).expect(200);
      expect(res.body.verificationNotice.anyVerified).toBe(false);
    });
  });
});
