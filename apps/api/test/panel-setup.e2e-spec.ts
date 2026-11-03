import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

/**
 * SETTING UP THE PANEL MODULE WHEN IT IS EMPTY (N-2), against a real
 * PostgreSQL.
 *
 * Through HTTP rather than unit-mocked, because every guarantee here is one a
 * mocked Prisma client cannot show: `withAdminTx` resolves a real actor and
 * asserts a real permission, the all-or-nothing promise is a real transaction,
 * and the duplicate check reads rows under RLS.
 *
 * What these prove:
 *   - the wizard opens on an empty module and closes when it is not
 *   - the platform's suggestions exclude panels the clinic already has
 *   - a clinic that answers only "these are my panels" gets working panels
 *   - an unanswered term and an unanswered fee are recorded as unanswered,
 *     never as a default that looks like somebody's decision
 *   - every panel gets an opening fee term, so the mirror has a history behind it
 *   - a duplicate name is refused before anything is written
 *   - a failure writes NOTHING
 */
describe('Panel: setting the module up (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  beforeEach(async () => {
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: 'Setup Tenant' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
  });

  const status = () =>
    request(app.getHttpServer()).get('/panel-workspace/setup').set('Authorization', bearer);

  const setup = (panels: unknown[]) =>
    request(app.getHttpServer())
      .post('/panel-workspace/setup')
      .set('Authorization', bearer)
      .send({ panels });

  it('says the module needs setting up while the clinic has no panels', async () => {
    const empty = await status().expect(200);
    expect(empty.body.needsSetup).toBe(true);
    expect(empty.body.panels).toEqual([]);

    await setup([{ name: 'Contoh TPA' }]).expect(201);

    const after = await status().expect(200);
    expect(after.body.needsSetup).toBe(false);
    expect(after.body.panels).toHaveLength(1);
  });

  /**
   * A clinic that has deactivated every panel is as stuck as one that never
   * had any — it also lands on a blank workspace with nowhere to go.
   */
  it('reopens when every panel has been deactivated', async () => {
    const created = await setup([{ name: 'Contoh TPA' }]).expect(201);
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.update({ where: { id: created.body.created[0].id }, data: { active: false } }),
    );

    const after = await status().expect(200);
    expect(after.body.needsSetup).toBe(true);
    // The panel is still listed, so the wizard can say it is there but off.
    expect(after.body.panels[0].active).toBe(false);
  });

  it('suggests the platform list, minus what the clinic already has', async () => {
    await prisma.defaultPanelClinic.createMany({
      data: [
        { name: 'Contoh TPA', panelType: 'TPA', url: 'https://portal.example.test' },
        { name: 'Contoh Insurer', panelType: 'INSURER' },
        { name: 'Contoh Retired', panelType: 'TPA', active: false },
      ],
    });

    const before = await status().expect(200);
    const offered = before.body.suggestions.map((row: { name: string }) => row.name);
    expect(offered).toContain('Contoh TPA');
    expect(offered).toContain('Contoh Insurer');
    // An inactive platform row is not offered to anybody.
    expect(offered).not.toContain('Contoh Retired');
    // The portal URL travels with the suggestion, so the clinic does not
    // re-type what the operator already recorded.
    expect(
      before.body.suggestions.find((row: { name: string }) => row.name === 'Contoh TPA').portalUrl,
    ).toBe('https://portal.example.test');

    await setup([{ name: 'Contoh TPA' }]).expect(201);

    const after = await status().expect(200);
    const stillOffered = after.body.suggestions.map((row: { name: string }) => row.name);
    expect(stillOffered).not.toContain('Contoh TPA');
    expect(stillOffered).toContain('Contoh Insurer');
  });

  /**
   * THE WIZARD'S WHOLE PREMISE. Answer one question — which panels — and the
   * module works. What was not answered is recorded as unanswered.
   */
  it('accepts a name alone, and records the unanswered parts as unanswered', async () => {
    const response = await setup([{ name: 'Contoh TPA' }, { name: 'Contoh Insurer' }]).expect(201);

    expect(response.body.created).toHaveLength(2);
    expect(response.body.withoutTerm).toBe(2);
    expect(response.body.feeUnsettled).toBe(2);

    const panels = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.findMany({ orderBy: { name: 'asc' } }),
    );
    for (const panel of panels) {
      // NOT a 30-day default. A guessed term decides when a claim reads as
      // overdue, and this one would have been nobody's decision.
      expect(panel.paymentTermDays).toBeNull();
      // NOT NO_FEE either: "nobody has asked" and "this panel charges nothing"
      // are different facts, and collapsing them is what D-112 fixed.
      expect(panel.feeTreatment).toBe('UNCONFIGURED');
      expect(panel.panelType).toBeNull();
    }
  });

  it('stores the answers it was given', async () => {
    await setup([
      {
        name: 'Contoh TPA',
        panelType: 'TPA',
        portalUrl: 'https://portal.example.test',
        paymentTermDays: 20,
        paymentTermUnit: 'WORKING_DAYS',
        paymentTermAnchor: 'SUBMISSION_DATE',
        feeTreatment: 'WITHHELD_FROM_CLAIM',
        claimFeeType: 'AMOUNT',
        claimFeeValue: 8,
      },
    ]).expect(201);

    const panel = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelClinic.findFirstOrThrow({ where: { name: 'Contoh TPA' } }),
    );
    expect(panel.panelType).toBe('TPA');
    expect(panel.portalUrl).toBe('https://portal.example.test');
    expect(panel.paymentTermDays).toBe(20);
    expect(panel.paymentTermUnit).toBe('WORKING_DAYS');
    expect(panel.feeTreatment).toBe('WITHHELD_FROM_CLAIM');
    expect(Number(panel.claimFeeValue)).toBe(8);
  });

  /**
   * `PanelClinic.feeTreatment` is a MIRROR of the effective-dated history
   * (D-112). A mirror with nothing behind it is the one state that convention
   * cannot survive — the next edit would write the panel's first term dated
   * today, and any claim raised before that would fall before the history
   * starts.
   */
  it('gives every panel an opening fee term, including an unconfigured one', async () => {
    await setup([
      { name: 'Contoh TPA', feeTreatment: 'NO_FEE' },
      { name: 'Contoh Insurer' },
    ]).expect(201);

    const terms = await withTenantContext(prisma, tenantId, (tx) =>
      tx.panelFeeTerm.findMany({ include: { panelClinic: true } }),
    );
    expect(terms).toHaveLength(2);
    expect(terms.find((term) => term.panelClinic.name === 'Contoh TPA')!.feeTreatment).toBe('NO_FEE');
    expect(terms.find((term) => term.panelClinic.name === 'Contoh Insurer')!.feeTreatment).toBe(
      'UNCONFIGURED',
    );
    // One wizard pass is one act in the history, not a scatter of terms.
    expect(new Set(terms.map((term) => term.effectiveFrom.toISOString())).size).toBe(1);
  });

  it('refuses the same panel twice in one list, however it is spelled', async () => {
    const response = await setup([{ name: 'Contoh TPA' }, { name: '  contoh   tpa ' }]).expect(400);
    expect(response.body.message).toContain('same panel');

    const panels = await withTenantContext(prisma, tenantId, (tx) => tx.panelClinic.findMany());
    expect(panels).toEqual([]);
  });

  it('refuses a panel the clinic already has', async () => {
    await setup([{ name: 'Contoh TPA' }]).expect(201);
    const response = await setup([{ name: 'CONTOH TPA' }, { name: 'Contoh Insurer' }]).expect(400);
    expect(response.body.message).toContain('Already set up');

    // And the good panel in that request was not written either.
    const panels = await withTenantContext(prisma, tenantId, (tx) => tx.panelClinic.findMany());
    expect(panels.map((panel) => panel.name)).toEqual(['Contoh TPA']);
  });

  it('refuses a fee on a panel that charges nothing', async () => {
    const response = await setup([
      { name: 'Contoh TPA', feeTreatment: 'NO_FEE', claimFeeType: 'AMOUNT', claimFeeValue: 8 },
    ]).expect(400);
    expect(response.body.message).toContain('charge no fee');
  });

  /**
   * ALL OR NOTHING. A wizard that wrote nine of twelve panels would leave
   * somebody guessing which three to re-enter — and re-running it would then
   * trip the duplicate check on the nine that landed.
   */
  it('writes nothing at all when one row in the list is bad', async () => {
    await setup([
      { name: 'Contoh One' },
      { name: 'Contoh Two' },
      { name: 'Contoh Three', feeTreatment: 'NO_FEE', claimFeeValue: 12 },
    ]).expect(400);

    const panels = await withTenantContext(prisma, tenantId, (tx) => tx.panelClinic.findMany());
    expect(panels).toEqual([]);
    const terms = await withTenantContext(prisma, tenantId, (tx) => tx.panelFeeTerm.findMany());
    expect(terms).toEqual([]);
  });

  it('records who set each panel up', async () => {
    await setup([{ name: 'Contoh TPA' }]).expect(201);
    const audits = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { action: 'panel.created' } }),
    );
    expect(audits).toHaveLength(1);
    // `_actor` in the payload is where `recordAudit` keeps the staff identity:
    // `actorUserId` is the USER, and a staff member may have none.
    const actor = (audits[0].after as { _actor?: { staffId?: string } })._actor;
    expect(actor?.staffId).toBeTruthy();
    expect((audits[0].after as { name?: string }).name).toBe('Contoh TPA');
  });
});
