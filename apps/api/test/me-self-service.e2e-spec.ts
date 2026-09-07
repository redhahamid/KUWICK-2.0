import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, ProviderShiftType, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * MY KUWICK — what a member of staff may see and do about THEMSELVES.
 *
 * Half of these are negative. That is the point: the module's security model
 * is that no route takes a staff id, so the tests that matter most are the
 * ones proving an employee cannot reach a colleague's attendance, leave,
 * claims or pay — and cannot rewrite their own attendance history either,
 * because the person whose pay depends on the number must not be the person
 * who sets it.
 */
describe('My Kuwick: employee self-service (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let ownerBearer: string;
  let ownerStaffId: string;
  let clinicId: string;

  /** An ordinary member of staff — no HR permission of any kind. */
  let nurse: string;
  let nurseBearer: string;
  /** A colleague, whose data must be unreachable from the nurse's token. */
  let colleague: string;
  let colleagueBearer: string;

  const server = () => app.getHttpServer();

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
      tx.tenant.create({ data: { id: tenantId, name: 'Klinik Sendiri (Synthetic)' } }),
    );
    const owner = await createOwnerAndBearer(prisma, tenantId);
    ownerBearer = owner.bearer;
    ownerStaffId = owner.staffId;

    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', ownerBearer)
      .send({ name: 'Klinik Sendiri' })
      .expect(201);
    clinicId = clinic.body.id;

    nurse = await makeEmployee('Nurul Ujian');
    nurseBearer = bearerFor(tenantId, nurse, Role.FRONT_DESK_CLINICAL_STAFF);
    colleague = await makeEmployee('Farid Ujian');
    colleagueBearer = bearerFor(tenantId, colleague, Role.FRONT_DESK_CLINICAL_STAFF);
  });

  async function makeEmployee(fullName: string): Promise<string> {
    return withTenantContext(prisma, tenantId, async (tx) => {
      const staff = await tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName, clinicId, active: true },
      });
      await tx.employeeProfile.create({
        data: { tenantId, staffId: staff.id, position: 'Staff Nurse', basicSalary: '3000.00' },
      });
      return staff.id;
    });
  }

  async function rosterShift(staffId: string, shiftDate: string, startUtc: string, endUtc: string) {
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.providerShift.create({
        data: {
          tenantId,
          clinicId,
          staffId,
          shiftDate: new Date(`${shiftDate}T00:00:00.000Z`),
          startsAt: new Date(startUtc),
          endsAt: new Date(endUtc),
          shiftType: ProviderShiftType.WORKING,
        },
      }),
    );
  }

  // ===========================================================================
  describe('who am I', () => {
    it('tells a member of staff their own job without telling them their salary', async () => {
      const me = await request(server()).get('/me').set('Authorization', nurseBearer).expect(200);
      expect(me.body).toMatchObject({
        staffId: nurse,
        fullName: 'Nurul Ujian',
        hasEmploymentProfile: true,
      });
      // Pay is read from a payslip — a document about one month with a total
      // that can be checked — not from a profile screen.
      expect(JSON.stringify(me.body)).not.toContain('3000');
      expect(me.body.employment).not.toHaveProperty('basicSalary');
    });

    it('says plainly when HR has not finished somebody’s employment record', async () => {
      const raw = await withTenantContext(prisma, tenantId, (tx) =>
        tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Baru Ujian', clinicId } }),
      );
      const me = await request(server())
        .get('/me')
        .set('Authorization', bearerFor(tenantId, raw.id, Role.FRONT_DESK_CLINICAL_STAFF))
        .expect(200);
      expect(me.body.hasEmploymentProfile).toBe(false);
      expect(me.body.employment).toBeNull();
    });
  });

  // ===========================================================================
  describe('clocking in and out', () => {
    it('clocks a member of staff in and out from their own token, with no HR permission', async () => {
      await rosterShift(nurse, '2026-09-21', '2026-09-21T00:00:00.000Z', '2026-09-21T09:00:00.000Z');

      const before = await request(server()).get('/me/home').set('Authorization', nurseBearer).expect(200);
      expect(before.body.clock.onDuty).toBe(false);
      expect(before.body.todayShifts).toBeDefined();

      await request(server()).post('/me/attendance/clock').set('Authorization', nurseBearer).send({}).expect(201);
      const during = await request(server()).get('/me/home').set('Authorization', nurseBearer).expect(200);
      expect(during.body.clock.onDuty).toBe(true);
      expect(during.body.clock.since).not.toBeNull();

      await request(server()).post('/me/attendance/clock').set('Authorization', nurseBearer).send({}).expect(201);
      const after = await request(server()).get('/me/home').set('Authorization', nurseBearer).expect(200);
      expect(after.body.clock.onDuty).toBe(false);
    });

    it('clocks the person holding the token — there is no field for anybody else', async () => {
      await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        // `staffId` is not in the DTO, so a whitelisting pipe drops it and the
        // punch lands on the nurse. The security is the missing field.
        .send({ staffId: colleague })
        .expect(201);

      const records = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findMany({ where: { staffId: colleague } }),
      );
      expect(records).toHaveLength(0);
    });
  });

  // ===========================================================================
  describe('attendance and corrections', () => {
    it('shows a member of staff their own attendance and nobody else’s', async () => {
      await rosterShift(nurse, '2026-09-22', '2026-09-22T00:00:00.000Z', '2026-09-22T09:00:00.000Z');
      await request(server()).post('/me/attendance/clock').set('Authorization', nurseBearer).send({}).expect(201);

      const mine = await request(server())
        .get('/me/attendance?from=2026-09-01&to=2026-09-30')
        .set('Authorization', nurseBearer)
        .expect(200);
      const theirs = await request(server())
        .get('/me/attendance?from=2026-09-01&to=2026-09-30')
        .set('Authorization', colleagueBearer)
        .expect(200);

      expect(mine.body.length).toBeGreaterThan(0);
      expect(theirs.body).toHaveLength(0);
    });

    it('lets a member of staff ASK for a correction, and refuses one on somebody else’s day', async () => {
      await request(server()).post('/me/attendance/clock').set('Authorization', nurseBearer).send({}).expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId: nurse } }),
      );

      await request(server())
        .post('/me/attendance/corrections')
        .set('Authorization', nurseBearer)
        .send({
          attendanceRecordId: record!.id,
          requestedClockOutAt: '2026-09-22T09:00:00.000Z',
          reason: 'I forgot to clock out when I left at 5pm.',
        })
        .expect(201);

      // The colleague cannot ask about a day that is not theirs.
      const refused = await request(server())
        .post('/me/attendance/corrections')
        .set('Authorization', colleagueBearer)
        .send({
          attendanceRecordId: record!.id,
          requestedClockOutAt: '2026-09-22T09:00:00.000Z',
          reason: 'Trying my luck on somebody else’s timesheet.',
        });
      expect(refused.status).toBe(403);
    });

    it('does NOT let an employee rewrite their own attendance history directly', async () => {
      await request(server()).post('/me/attendance/clock').set('Authorization', nurseBearer).send({}).expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId: nurse } }),
      );

      // The administrative correction endpoint needs hr.attendance.manage, and
      // an ordinary member of staff does not have it. The request path is the
      // only way in for them, and it lands in front of a person.
      const refused = await request(server())
        .patch(`/workforce/attendance/${record!.id}/correct`)
        .set('Authorization', nurseBearer)
        .send({ clockInAt: '2026-09-22T00:00:00.000Z', reason: 'Making myself on time.' });
      expect(refused.status).toBe(403);
    });

    it('applies an approved correction through the ONE correction path, keeping the original punch', async () => {
      await rosterShift(nurse, '2026-09-23', '2026-09-23T00:00:00.000Z', '2026-09-23T09:00:00.000Z');
      await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        .send({})
        .expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId: nurse } }),
      );
      const originalClockIn = record!.clockInAt;

      const asked = await request(server())
        .post('/me/attendance/corrections')
        .set('Authorization', nurseBearer)
        .send({
          attendanceRecordId: record!.id,
          requestedClockInAt: '2026-09-23T00:00:00.000Z',
          requestedClockOutAt: '2026-09-23T09:00:00.000Z',
          reason: 'The tablet was offline when I arrived at 8.',
        })
        .expect(201);

      await request(server())
        .post(`/workforce/attendance/corrections/${asked.body.id}/decide`)
        .set('Authorization', ownerBearer)
        .send({ approve: true, note: 'Confirmed with the front desk.' })
        .expect(201);

      const after = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findUnique({ where: { id: record!.id } }),
      );
      expect(after!.clockOutAt).not.toBeNull();
      expect(after!.correctedByStaffId).toBe(ownerStaffId);
      // The disputed fact survives: "the manager changed my clock-in" is
      // exactly what an employee argues about later.
      expect(after!.originalClockInAt?.toISOString()).toBe(originalClockIn?.toISOString());
    });

    it('will not let somebody decide their own correction request', async () => {
      await request(server()).post('/me/attendance/clock').set('Authorization', ownerBearer).send({}).expect(201);
      const record = await withTenantContext(prisma, tenantId, (tx) =>
        tx.attendanceRecord.findFirst({ where: { staffId: ownerStaffId } }),
      );
      const asked = await request(server())
        .post('/me/attendance/corrections')
        .set('Authorization', ownerBearer)
        .send({
          attendanceRecordId: record!.id,
          requestedClockOutAt: '2026-09-23T09:00:00.000Z',
          reason: 'Approving my own hours, which should not work.',
        })
        .expect(201);

      const refused = await request(server())
        .post(`/workforce/attendance/corrections/${asked.body.id}/decide`)
        .set('Authorization', ownerBearer)
        .send({ approve: true });
      expect(refused.status).toBe(400);
    });
  });

  // ===========================================================================
  describe('leave', () => {
    it('submits leave into the canonical workflow and shows it back', async () => {
      await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'ANNUAL', startDate: '2026-10-05', endDate: '2026-10-07', reason: 'Family trip.' })
        .expect(201);

      const mine = await request(server()).get('/me/leave').set('Authorization', nurseBearer).expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0]).toMatchObject({ leaveType: 'ANNUAL', status: 'PENDING' });

      // It is the SAME table the manager approves from — not a self-service copy.
      const queue = await request(server()).get('/leave-requests').set('Authorization', ownerBearer).expect(200);
      expect(queue.body.some((row: { staffId: string }) => row.staffId === nurse)).toBe(true);
    });

    it('does not show one employee another’s leave', async () => {
      await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'ANNUAL', startDate: '2026-10-05', endDate: '2026-10-07' })
        .expect(201);

      const theirs = await request(server()).get('/me/leave').set('Authorization', colleagueBearer).expect(200);
      expect(theirs.body).toHaveLength(0);
    });

    it('refuses leave that overlaps leave already asked for', async () => {
      const body = { leaveType: 'ANNUAL', startDate: '2026-10-05', endDate: '2026-10-07' };
      await request(server()).post('/me/leave').set('Authorization', nurseBearer).send(body).expect(201);
      const refused = await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ ...body, startDate: '2026-10-06', endDate: '2026-10-08' });
      expect(refused.status).toBe(400);
    });
  });

  // ===========================================================================
  describe('claims', () => {
    it('submits a claim with a receipt and explains where the money is in plain words', async () => {
      const claim = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({
          category: 'MEDICAL',
          amountClaimed: '45.50',
          claimDate: '2026-09-14',
          description: 'Clinic shoes, receipt attached.',
        })
        .expect(201);

      await request(server())
        .post(`/me/claims/${claim.body.id}/receipts`)
        .set('Authorization', nurseBearer)
        .send({
          fileName: 'receipt.jpg',
          filePath: 'synthetic/receipts/receipt.jpg',
          mimeType: 'image/jpeg',
          fileSize: 51234,
        })
        .expect(201);

      const mine = await request(server()).get('/me/claims').set('Authorization', nurseBearer).expect(200);
      expect(mine.body).toHaveLength(1);
      // Not "SUBMITTED / payoutStatus PENDING / paymentRoute null".
      expect(mine.body[0].whereTheMoneyIs).toBe('Waiting for your manager.');
      expect(mine.body[0].attachments).toHaveLength(1);
    });

    it('does not show one employee another’s claims', async () => {
      await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'MEDICAL', amountClaimed: '45.50', claimDate: '2026-09-14', description: 'Mine alone.' })
        .expect(201);
      const theirs = await request(server()).get('/me/claims').set('Authorization', colleagueBearer).expect(200);
      expect(theirs.body).toHaveLength(0);
    });

    it('refuses a receipt on a claim that is not the uploader’s', async () => {
      const claim = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'MEDICAL', amountClaimed: '20.00', claimDate: '2026-09-14', description: 'Mine.' })
        .expect(201);

      const refused = await request(server())
        .post(`/me/claims/${claim.body.id}/receipts`)
        .set('Authorization', colleagueBearer)
        .send({ fileName: 'x.jpg', filePath: 'x.jpg', mimeType: 'image/jpeg', fileSize: 10 });
      expect(refused.status).toBe(404);
    });
  });

  // ===========================================================================
  describe('payslips', () => {
    it('shows nothing at all while a run is only calculated', async () => {
      await withTenantContext(prisma, tenantId, async (tx) => {
        const run = await tx.payrollRun.create({
          data: { tenantId, period: new Date('2026-08-01T00:00:00.000Z'), status: 'CALCULATED', createdByStaffId: ownerStaffId },
        });
        await tx.payrollLine.create({
          data: {
            tenantId,
            payrollRunId: run.id,
            staffId: nurse,
            employeeSnapshot: {},
            basicSalary: '3000.00',
            grossPay: '3000.00',
            netPay: '2670.00',
          },
        });
      });

      const slips = await request(server()).get('/me/payslips').set('Authorization', nurseBearer).expect(200);
      // A calculated run is a working draft that can still change. Showing it
      // turns every rounding correction into a conversation about why somebody's
      // pay went down.
      expect(slips.body).toHaveLength(0);
    });

    it('shows an approved payslip to its owner and REFUSES it to anybody else', async () => {
      const runId = await withTenantContext(prisma, tenantId, async (tx) => {
        // Built CALCULATED and approved afterwards, because an approved run
        // is locked at the database — "correct it with a payroll adjustment,
        // not by editing a payslip line". That refusal is the product working.
        const run = await tx.payrollRun.create({
          data: { tenantId, period: new Date('2026-08-01T00:00:00.000Z'), status: 'CALCULATED', createdByStaffId: ownerStaffId },
        });
        await tx.payrollLine.create({
          data: {
            tenantId,
            payrollRunId: run.id,
            staffId: nurse,
            employeeSnapshot: {},
            basicSalary: '3000.00',
            grossPay: '3000.00',
            netPay: '2670.00',
          },
        });
        await tx.payrollRun.update({ where: { id: run.id }, data: { status: 'APPROVED' } });
        return run.id;
      });

      const mine = await request(server()).get('/me/payslips').set('Authorization', nurseBearer).expect(200);
      expect(mine.body).toHaveLength(1);

      const detail = await request(server())
        .get(`/me/payslips/${runId}`)
        .set('Authorization', nurseBearer)
        .expect(200);
      expect(detail.body.netPay).toBe('2670');
      expect(detail.body.earnings.grossPay).toBe('3000');

      // THE ONE THAT MATTERS. The colleague knows the run id — it is in a URL
      // they could have seen — and still gets nothing.
      const refused = await request(server())
        .get(`/me/payslips/${runId}`)
        .set('Authorization', colleagueBearer);
      expect(refused.status).toBe(404);

      const theirList = await request(server()).get('/me/payslips').set('Authorization', colleagueBearer).expect(200);
      expect(theirList.body).toHaveLength(0);
    });
  });

  // ===========================================================================
  it('refuses every self-service route to a request with no staff token', async () => {
    for (const path of ['/me', '/me/home', '/me/leave', '/me/claims', '/me/payslips']) {
      const refused = await request(server()).get(path);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    }
  });
});
