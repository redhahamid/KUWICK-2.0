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
    // Since Piece 3g a claim cannot be sent without its receipt (the clinic's
    // policy, on by default): the receipt is uploaded first, as the person's
    // own file, and named on the claim.
    const uploadReceipt = async (bearer: string) => {
      const uploaded = await request(server())
        .post('/me/files?kind=RECEIPT')
        .set('Authorization', bearer)
        .attach('file', PNG, { filename: 'receipt.png', contentType: 'image/png' })
        .expect(201);
      return uploaded.body.id as string;
    };

    it('submits a claim with a receipt and explains where the money is in plain words', async () => {
      const claim = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({
          category: 'MEDICAL',
          amountClaimed: '45.50',
          claimDate: '2026-09-14',
          description: 'Clinic shoes, receipt attached.',
          receiptFileId: await uploadReceipt(nurseBearer),
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
      // The receipt it was sent with, and the one added after by the metadata route.
      expect(mine.body[0].attachments).toHaveLength(2);
    });

    it('does not show one employee another’s claims', async () => {
      await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'MEDICAL', amountClaimed: '45.50', claimDate: '2026-09-14', description: 'Mine alone.', receiptFileId: await uploadReceipt(nurseBearer) })
        .expect(201);
      const theirs = await request(server()).get('/me/claims').set('Authorization', colleagueBearer).expect(200);
      expect(theirs.body).toHaveLength(0);
    });

    it('refuses a receipt on a claim that is not the uploader’s', async () => {
      const claim = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'MEDICAL', amountClaimed: '20.00', claimDate: '2026-09-14', description: 'Mine.', receiptFileId: await uploadReceipt(nurseBearer) })
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

    it('shows a PAID payslip to its owner, hides an approved-but-unpaid one, and REFUSES it to anybody else', async () => {
      const runId = await withTenantContext(prisma, tenantId, async (tx) => {
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

      // Approved is not paid. A corrected revision can still follow an
      // approval; the portal shows the month once the money has gone out.
      const approvedOnly = await request(server()).get('/me/payslips').set('Authorization', nurseBearer).expect(200);
      expect(approvedOnly.body).toHaveLength(0);
      await request(server()).get(`/me/payslips/${runId}`).set('Authorization', nurseBearer).expect(404);

      await withTenantContext(prisma, tenantId, (tx) =>
        tx.payrollRun.update({
          where: { id: runId },
          data: { status: 'PAID', paymentDate: new Date('2026-08-28T00:00:00.000Z') },
        }),
      );

      const mine = await request(server()).get('/me/payslips').set('Authorization', nurseBearer).expect(200);
      expect(mine.body).toHaveLength(1);

      const detail = await request(server())
        .get(`/me/payslips/${runId}`)
        .set('Authorization', nurseBearer)
        .expect(200);
      expect(detail.body.netPay).toBe('2670');
      expect(detail.body.earnings.grossPay).toBe('3000');

      const home = await request(server()).get('/me/home').set('Authorization', nurseBearer).expect(200);
      expect(home.body.latestPayslip).toMatchObject({ runId, period: '2026-08', netPay: '2670', paymentDate: '2026-08-28' });
      expect(home.body.payslips).toHaveLength(1);
      expect(home.body.recent[0]).toMatchObject({ kind: 'payslip', title: 'Payslip August', state: 'ready', href: '/my/payslips' });

      const refused = await request(server())
        .get(`/me/payslips/${runId}`)
        .set('Authorization', colleagueBearer);
      expect(refused.status).toBe(404);
      // The PDF route is identity-checked the same way. (Its happy path needs
      // an approved snapshot, which a hand-made run has not got — see
      // payroll-payslip.e2e-spec.ts for that.)
      await request(server()).get(`/me/payslips/${runId}/pdf`).set('Authorization', colleagueBearer).expect(404);

      const theirList = await request(server()).get('/me/payslips').set('Authorization', colleagueBearer).expect(200);
      expect(theirList.body).toHaveLength(0);
    });
  });

  describe('leave balances and a preview of a request', () => {
    it('shows balances by type and what a request would take, including who else is away', async () => {
      await withTenantContext(prisma, tenantId, async (tx) => {
        const policy = await tx.leavePolicy.create({
          data: {
            tenantId,
            name: 'Standard (Synthetic)',
            proRateOnJoin: false,
            entitlements: {
              create: [
                { tenantId, leaveType: 'ANNUAL', daysPerYear: 16, paid: true, requiresAttachment: false },
                { tenantId, leaveType: 'MEDICAL', daysPerYear: 14, paid: true, requiresAttachment: true },
              ],
            },
          },
        });
        await tx.employeeProfile.update({ where: { staffId: nurse }, data: { leavePolicyId: policy.id } });
        await tx.leaveRequest.create({
          data: {
            tenantId,
            staffId: colleague,
            leaveType: 'ANNUAL',
            startDate: new Date('2026-09-21T00:00:00.000Z'),
            endDate: new Date('2026-09-21T00:00:00.000Z'),
            status: 'APPROVED',
          },
        });
        await tx.publicHoliday.create({
          data: { tenantId, date: new Date('2026-09-16T00:00:00.000Z'), name: 'Malaysia Day' },
        });
      });

      const balances = await request(server()).get('/me/leave/balances').set('Authorization', nurseBearer).expect(200);
      expect(balances.body.policyName).toBe('Standard (Synthetic)');
      const annual = balances.body.balances.find((row: { leaveType: string }) => row.leaveType === 'ANNUAL');
      expect(annual).toMatchObject({ available: 16, taken: 0, pending: 0, remaining: 16 });
      expect(balances.body.unpaidTaken).toEqual({ days: 0, lastMonth: null });

      const preview = await request(server())
        .get('/me/leave/preview?leaveType=ANNUAL&startDate=2026-09-21&endDate=2026-09-23&halfDay=false')
        .set('Authorization', nurseBearer)
        .expect(200);
      expect(preview.body.days).toBe(3);
      expect(preview.body.balanceAfter).toEqual({ remaining: 13, available: 16, overdrawn: false });
      expect(preview.body.clashes).toEqual([
        expect.objectContaining({ name: 'Farid Ujian', firstDay: '2026-09-21', status: 'APPROVED' }),
      ]);
      expect(preview.body.ownClash).toBeNull();

      const holiday = await request(server())
        .get('/me/leave/preview?leaveType=ANNUAL&startDate=2026-09-14&endDate=2026-09-18')
        .set('Authorization', nurseBearer)
        .expect(200);
      expect(holiday.body.publicHolidays).toEqual([{ date: '2026-09-16', name: 'Malaysia Day' }]);
      expect(holiday.body.clashes).toEqual([]);

      await request(server())
        .get('/me/leave/preview?leaveType=ANNUAL&startDate=nonsense&endDate=2026-09-18')
        .set('Authorization', nurseBearer)
        .expect(400);
    });
  });

  describe('medical benefit', () => {
    it('says there is no account this year, then the allowance, used and left once there is one', async () => {
      const none = await request(server()).get('/me/benefits').set('Authorization', nurseBearer).expect(200);
      expect(none.body.medical).toBeNull();

      const year = new Date().getUTCFullYear();
      await withTenantContext(prisma, tenantId, async (tx) => {
        const account = await tx.staffBenefitAccount.create({
          data: { tenantId, staffId: nurse, benefitYear: year, allowance: '1000.00' },
        });
        await tx.staffBenefitUsage.create({
          data: { tenantId, accountId: account.id, usedAt: new Date(), amount: '380.00', recordedByStaffId: ownerStaffId },
        });
      });

      const mine = await request(server()).get('/me/benefits').set('Authorization', nurseBearer).expect(200);
      expect(mine.body).toEqual({ year, medical: { allowance: '1000.00', used: '380.00', remaining: '620.00' } });

      const theirs = await request(server()).get('/me/benefits').set('Authorization', colleagueBearer).expect(200);
      expect(theirs.body.medical).toBeNull();
    });
  });

  // A 1×1 PNG: the smallest thing a phone could plausibly hand in.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const todayKey = () =>
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shiftDay = (key: string, days: number) => new Date(new Date(`${key}T00:00:00.000Z`).getTime() + days * 86400000).toISOString().slice(0, 10);

  describe('files, consent and a clock-in with proof (Piece 3g)', () => {
    it('keeps a file for its owner, serves it to them and to HR, and to nobody else', async () => {
      const uploaded = await request(server())
        .post('/me/files?kind=SELFIE')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'selfie.png', contentType: 'image/png' })
        .expect(201);
      expect(uploaded.body.path).toBe(`/me/files/${uploaded.body.id}`);
      expect(uploaded.body.kind).toBe('SELFIE');

      const own = await request(server()).get(uploaded.body.path).set('Authorization', nurseBearer).expect(200);
      expect(own.headers['content-type']).toBe('image/png');
      await request(server()).get(uploaded.body.path).set('Authorization', colleagueBearer).expect(404);
      await request(server()).get(`/workforce/staff-files/${uploaded.body.id}`).set('Authorization', ownerBearer).expect(200);
      await request(server()).get(`/workforce/staff-files/${uploaded.body.id}`).set('Authorization', colleagueBearer).expect(403);

      await request(server())
        .post('/me/files?kind=SELFIE')
        .set('Authorization', nurseBearer)
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'not-a-selfie.pdf', contentType: 'application/pdf' })
        .expect(400);
      await request(server())
        .post('/me/files?kind=POSTCARD')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'x.png', contentType: 'image/png' })
        .expect(400);
    });

    it('refuses a selfie before consent, then records the punch with its position, judged against the branch', async () => {
      // The branch is at KLCC, 150 m around it.
      await request(server())
        .post('/workforce/attendance/policy')
        .set('Authorization', ownerBearer)
        .send({ clinicId, geofenceLat: 3.1579, geofenceLng: 101.7116, geofenceRadiusMetres: 150 })
        .expect(201);
      const policy = await request(server()).get(`/workforce/attendance/policy?clinicId=${clinicId}`).set('Authorization', ownerBearer).expect(200);
      expect(policy.body.policy).toMatchObject({ geofenceLat: 3.1579, geofenceLng: 101.7116, geofenceRadiusMetres: 150 });

      const selfie = await request(server())
        .post('/me/files?kind=SELFIE')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'selfie.png', contentType: 'image/png' })
        .expect(201);

      const before = await request(server()).get('/me').set('Authorization', nurseBearer).expect(200);
      expect(before.body.selfieConsentAt).toBeNull();
      const refused = await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        .send({ lat: 3.1494, lng: 101.6963, proofFileId: selfie.body.id });
      expect(refused.status).toBe(400);
      expect(String(refused.body.message)).toMatch(/consent/i);

      const consent = await request(server()).post('/me/consent/selfie').set('Authorization', nurseBearer).expect(201);
      expect(consent.body.selfieConsentAt).toBeTruthy();
      const after = await request(server()).get('/me').set('Authorization', nurseBearer).expect(200);
      expect(after.body.selfieConsentAt).toBe(consent.body.selfieConsentAt);

      // Clock in from Masjid Jamek, about 2 km from the branch: kept, and flagged.
      const clockedIn = await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        .send({ lat: 3.1494, lng: 101.6963, proofFileId: selfie.body.id })
        .expect(201);
      expect(clockedIn.body.source).toBe('PORTAL');
      expect(clockedIn.body.outsideClinic).toBe(true);
      expect(clockedIn.body.distanceMetres).toBeGreaterThan(1900);
      expect(clockedIn.body.proofUrl).toBe(`/me/files/${selfie.body.id}`);

      // Clock out from inside the fence: the day stays flagged, the out-position is kept.
      const clockedOut = await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        .send({ lat: 3.158, lng: 101.7117 })
        .expect(201);
      expect(clockedOut.body.outsideClinic).toBe(true);
      expect(Number(clockedOut.body.clockOutLat)).toBeCloseTo(3.158, 3);
      expect(clockedOut.body.clockOutProofUrl).toBeNull();

      const key = todayKey();
      const mine = await request(server())
        .get(`/me/attendance?from=${shiftDay(key, -1)}&to=${shiftDay(key, 1)}`)
        .set('Authorization', nurseBearer)
        .expect(200);
      expect(mine.body[0]).toMatchObject({ source: 'PORTAL', outsideClinic: true, proofUrl: `/me/files/${selfie.body.id}` });

      const sheet = await request(server())
        .get(`/workforce/attendance/timesheet?clinicId=${clinicId}&from=${shiftDay(key, -1)}&to=${shiftDay(key, 1)}`)
        .set('Authorization', ownerBearer)
        .expect(200);
      const row = sheet.body.staff.find((entry: { staffId: string }) => entry.staffId === nurse);
      expect(row.days[0]).toMatchObject({ outsideClinic: true, source: 'PORTAL', proofUrl: `/me/files/${selfie.body.id}` });
      expect(row.days[0].distanceMetres).toBeGreaterThan(1900);
    });

    it('does not judge a punch when the branch has no point, and marks HR\'s own entries MANUAL', async () => {
      const punched = await request(server())
        .post('/me/attendance/clock')
        .set('Authorization', nurseBearer)
        .send({ lat: 3.1494, lng: 101.6963 })
        .expect(201);
      expect(punched.body.outsideClinic).toBe(false);
      expect(punched.body.distanceMetres).toBeNull();
      expect(Number(punched.body.lat)).toBeCloseTo(3.1494, 3);

      const byHr = await request(server())
        .post('/workforce/attendance/clock')
        .set('Authorization', ownerBearer)
        .send({ staffId: colleague, clinicId })
        .expect(201);
      expect(byHr.body.source).toBe('MANUAL');
    });
  });

  describe('the MC the leave policy asks for (Piece 3g)', () => {
    it('refuses medical leave without the MC, takes it with one, and says so on the balances', async () => {
      await withTenantContext(prisma, tenantId, async (tx) => {
        const policy = await tx.leavePolicy.create({
          data: {
            tenantId,
            name: 'Standard (Synthetic)',
            proRateOnJoin: false,
            entitlements: {
              create: [
                { tenantId, leaveType: 'ANNUAL', daysPerYear: 16, paid: true, requiresAttachment: false },
                { tenantId, leaveType: 'MEDICAL', daysPerYear: 14, paid: true, requiresAttachment: true },
              ],
            },
          },
        });
        await tx.employeeProfile.update({ where: { staffId: nurse }, data: { leavePolicyId: policy.id } });
      });

      const balances = await request(server()).get('/me/leave/balances').set('Authorization', nurseBearer).expect(200);
      expect(balances.body.balances.find((row: { leaveType: string }) => row.leaveType === 'MEDICAL').requiresAttachment).toBe(true);
      expect(balances.body.balances.find((row: { leaveType: string }) => row.leaveType === 'ANNUAL').requiresAttachment).toBe(false);

      const bare = await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'MEDICAL', startDate: '2026-10-05', endDate: '2026-10-05' });
      expect(bare.status).toBe(400);
      expect(String(bare.body.message)).toMatch(/MC/);

      const mc = await request(server())
        .post('/me/files?kind=MEDICAL_CERTIFICATE')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'mc.png', contentType: 'image/png' })
        .expect(201);
      // A receipt is not an MC: the wrong kind is refused, not quietly accepted.
      const receipt = await request(server())
        .post('/me/files?kind=RECEIPT')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'r.png', contentType: 'image/png' })
        .expect(201);
      await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'MEDICAL', startDate: '2026-10-05', endDate: '2026-10-05', attachmentFileId: receipt.body.id })
        .expect(403);

      await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'MEDICAL', startDate: '2026-10-05', endDate: '2026-10-05', attachmentFileId: mc.body.id })
        .expect(201);
      const mine = await request(server()).get('/me/leave').set('Authorization', nurseBearer).expect(200);
      expect(mine.body[0].attachments).toEqual([expect.objectContaining({ fileName: 'mc.png', filePath: `/me/files/${mc.body.id}` })]);

      // Annual leave needs nothing attached.
      await request(server())
        .post('/me/leave')
        .set('Authorization', nurseBearer)
        .send({ leaveType: 'ANNUAL', startDate: '2026-10-12', endDate: '2026-10-13' })
        .expect(201);
    });
  });

  describe('mileage priced by the clinic, receipt required (Piece 3g)', () => {
    it('prices the kilometres at the rate of the day, freezes it on the claim, and insists on the receipt', async () => {
      const policy = await request(server()).get('/me/claim-policy').set('Authorization', nurseBearer).expect(200);
      expect(policy.body).toMatchObject({ mileageRatePerKm: '0.60', receiptRequired: true });

      const bare = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'TRAVEL', amountClaimed: '1.00', claimDate: '2026-09-09', description: 'Deliver vaccine stock', distanceKm: 42 });
      expect(bare.status).toBe(400);
      expect(String(bare.body.message)).toMatch(/receipt/i);

      const receipt = await request(server())
        .post('/me/files?kind=RECEIPT')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'odometer-start.png', contentType: 'image/png' })
        .expect(201);
      const claim = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({
          category: 'TRAVEL',
          amountClaimed: '1.00',
          claimDate: '2026-09-09',
          description: 'Mileage 42 km, Contoh Central to Contoh Bandar: Deliver vaccine stock',
          distanceKm: 42,
          receiptFileId: receipt.body.id,
        })
        .expect(201);
      // The server priced it: 42 × 0.60, whatever amount was sent.
      expect(Number(claim.body.amountClaimed)).toBeCloseTo(25.2, 2);
      expect(Number(claim.body.distanceKm)).toBe(42);
      expect(Number(claim.body.mileageRate)).toBeCloseTo(0.6, 2);

      const mine = await request(server()).get('/me/claims').set('Authorization', nurseBearer).expect(200);
      expect(mine.body[0].attachments).toEqual([expect.objectContaining({ fileName: 'odometer-start.png' })]);

      // The clinic raises the rate: tomorrow's claim is dearer, yesterday's is not.
      await request(server())
        .put('/workforce/claim-policy')
        .set('Authorization', ownerBearer)
        .send({ mileageRatePerKm: '0.80', reason: 'Fuel went up' })
        .expect(200);
      const receipt2 = await request(server())
        .post('/me/files?kind=RECEIPT')
        .set('Authorization', nurseBearer)
        .attach('file', PNG, { filename: 'odometer-2.png', contentType: 'image/png' })
        .expect(201);
      const later = await request(server())
        .post('/me/claims')
        .set('Authorization', nurseBearer)
        .send({ category: 'TRAVEL', amountClaimed: '1.00', claimDate: '2026-09-10', description: 'Mileage again', distanceKm: 10, receiptFileId: receipt2.body.id })
        .expect(201);
      expect(Number(later.body.amountClaimed)).toBeCloseTo(8, 2);
      const again = await request(server()).get('/me/claims').set('Authorization', nurseBearer).expect(200);
      expect(Number(again.body.find((row: { id: string }) => row.id === claim.body.id).amountClaimed)).toBeCloseTo(25.2, 2);

      // Nobody but the owner sets the rate.
      await request(server())
        .put('/workforce/claim-policy')
        .set('Authorization', nurseBearer)
        .send({ mileageRatePerKm: '9.99' })
        .expect(403);
    });
  });

  it('refuses every self-service route to a request with no staff token', async () => {
    for (const path of ['/me', '/me/home', '/me/leave', '/me/claims', '/me/payslips']) {
      const refused = await request(server()).get(path);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(refused.status).toBeLessThan(500);
    }
  });
});
