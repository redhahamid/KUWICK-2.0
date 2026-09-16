import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, withTenantContext } from './test-db';
import { createOwnerAndBearer } from './auth';

const randomId = () => crypto.randomUUID();

/**
 * A CLINIC MAY CHOOSE NOT TO PAY UNTAKEN LEAVE OUT, ON THE RECORD.
 *
 * Section 60E(3) of the Employment Act owes the ordinary rate of pay for every
 * day of paid annual leave the employee was entitled to and had not taken when
 * the contract of service ended — ended by EITHER party, which is the half that
 * catches clinics out, because it means a resignation is covered as squarely as
 * a dismissal.
 *
 * Kuwick's default is therefore to pay it. An employer who decides otherwise is
 * choosing not to meet a statutory obligation, and that decision is theirs to
 * take — so Kuwick STORES IT RATHER THAN REFUSING IT, in exactly the shape a
 * below-Act overtime multiplier already uses: the off position needs a tick and
 * a written reason together, and the answer is kept against the name of whoever
 * gave it and the date they gave it.
 *
 * What must never happen is the choice being made silently, which is what these
 * tests are for.
 */
describe('the choice not to pay untaken leave (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;

  const http = () => request(app.getHttpServer());
  const policies = () => http().get('/workforce/leave/policies').set('Authorization', bearer).expect(200);
  const save = (body: Record<string, unknown>) => http().post('/workforce/leave/policies').set('Authorization', bearer).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    prisma = createTestPrismaClient();
    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) => tx.tenant.create({ data: { id: tenantId, name: 'Leave Choice Tenant' } }));
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
  });

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('pays it by default, because that is what the Act says', async () => {
    const created = (await save({ name: 'Default policy' }).expect(201)).body;
    const row = ((await policies()).body as { id: string; payUntakenLeaveOnExit: boolean; notPaying: unknown }[]).find(
      (entry) => entry.id === created.id,
    );
    expect(row?.payUntakenLeaveOnExit).toBe(true);
    // Nothing to mark on screen while the policy does what the Act requires.
    expect(row?.notPaying).toBeNull();
  });

  it('refuses to switch the payout off silently, and says which section and why it matters', async () => {
    const created = (await save({ name: 'Silent switch' }).expect(201)).body;
    const refused = await save({ id: created.id, name: 'Silent switch', payUntakenLeaveOnExit: false }).expect(400);

    expect(refused.body.message).toContain('60E(3)');
    // The half a clinic whose staff all resign would otherwise assume is theirs.
    expect(refused.body.message).toContain('resignation as much as a dismissal');
    expect(refused.body.message).toContain('choosing not to meet that obligation');
    // Refused, so the stored answer is untouched.
    const row = ((await policies()).body as { id: string; payUntakenLeaveOnExit: boolean }[]).find((entry) => entry.id === created.id);
    expect(row?.payUntakenLeaveOnExit).toBe(true);
  });

  it('refuses a tick with no reason, and a reason with no tick', async () => {
    const created = (await save({ name: 'Half an answer' }).expect(201)).body;
    await save({ id: created.id, name: 'Half an answer', payUntakenLeaveOnExit: false, notPayingAcknowledged: true }).expect(400);
    await save({
      id: created.id,
      name: 'Half an answer',
      payUntakenLeaveOnExit: false,
      notPayingReason: 'Clinic practice since 2019',
    }).expect(400);
  });

  it('stores the choice with the name and the date once both are given', async () => {
    const created = (await save({ name: 'On the record' }).expect(201)).body;
    await save({
      id: created.id,
      name: 'On the record',
      payUntakenLeaveOnExit: false,
      notPayingAcknowledged: true,
      notPayingReason: 'Clinic practice since 2019; staff are told at hire',
    }).expect(201);

    const row = (
      (await policies()).body as { id: string; payUntakenLeaveOnExit: boolean; notPaying: { reason: string; at: string; by: string } | null }[]
    ).find((entry) => entry.id === created.id);
    expect(row?.payUntakenLeaveOnExit).toBe(false);
    expect(row?.notPaying?.reason).toBe('Clinic practice since 2019; staff are told at hire');
    // A name and a date, so the mark on screen says who decided and when.
    expect(row?.notPaying?.by).toBeTruthy();
    expect(row?.notPaying?.at).toBeTruthy();
  });

  it('does not ask again when an unrelated edit leaves the choice alone', async () => {
    const created = (await save({ name: 'Rename me' }).expect(201)).body;
    await save({
      id: created.id,
      name: 'Rename me',
      payUntakenLeaveOnExit: false,
      notPayingAcknowledged: true,
      notPayingReason: 'Decided at the January meeting',
    }).expect(201);

    // A rename, with nothing said about the payout. The decision already taken
    // stands; demanding the same conversation for ordinary housekeeping would
    // teach people to type anything into the box.
    await save({ id: created.id, name: 'Renamed', carryForwardDays: 3 }).expect(201);
    const row = (
      (await policies()).body as { id: string; name: string; payUntakenLeaveOnExit: boolean; notPaying: { reason: string } | null }[]
    ).find((entry) => entry.id === created.id);
    expect(row?.name).toBe('Renamed');
    expect(row?.payUntakenLeaveOnExit).toBe(false);
    expect(row?.notPaying?.reason).toBe('Decided at the January meeting');
  });

  it('clears the record when the payout is switched back on', async () => {
    const created = (await save({ name: 'Back to the Act' }).expect(201)).body;
    await save({
      id: created.id,
      name: 'Back to the Act',
      payUntakenLeaveOnExit: false,
      notPayingAcknowledged: true,
      notPayingReason: 'Cash was tight in 2025',
    }).expect(201);
    await save({ id: created.id, name: 'Back to the Act', payUntakenLeaveOnExit: true }).expect(201);

    const row = ((await policies()).body as { id: string; payUntakenLeaveOnExit: boolean; notPaying: unknown }[]).find(
      (entry) => entry.id === created.id,
    );
    expect(row?.payUntakenLeaveOnExit).toBe(true);
    // No decision left to hold anybody to, so no mark and no stale reason.
    expect(row?.notPaying).toBeNull();
    const stored = await withTenantContext(prisma, tenantId, (tx) => tx.leavePolicy.findUnique({ where: { id: created.id } }));
    expect(stored?.notPayingReason).toBeNull();
    expect(stored?.notPayingAcknowledgedAt).toBeNull();
    expect(stored?.notPayingAcknowledgedByStaffId).toBeNull();
  });
});
