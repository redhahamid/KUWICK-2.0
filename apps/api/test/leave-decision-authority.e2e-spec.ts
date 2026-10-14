import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { LeaveStatus, PrismaClient, Role } from '@prisma/client';
import { LeaveType } from '../src/hr/leave-types';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * WHO APPROVED THIS LEAVE.
 *
 * The decision used to take the approver's id FROM THE REQUEST BODY, with no
 * permission check and no audit row: any caller could approve any request in
 * anybody else's name, and the record would say so for good. The screen above
 * it had grown a matching "Approving/Rejecting as" picker, so the hole looked
 * like a feature and got documented as one.
 *
 * Approving leave moves the roster and reaches money — unpaid leave becomes a
 * payroll deduction — so it is `hr.leave.approve`, the approver is whoever is
 * signed in, and the decision is audited like every other one in this product.
 */
describe('Leave decisions are made by whoever is signed in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicId: string;
  let ownerId: string;
  let ownerBearer: string;
  let nurseId: string;
  let nurseBearer: string;

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
    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Klinik Cuti (Synthetic)' } });
      const clinic = await tx.clinic.create({
        data: { tenantId, name: 'Klinik Cuti', timezone: 'Asia/Kuala_Lumpur' },
      });
      clinicId = clinic.id;
    });
    const owner = await createOwnerAndBearer(prisma, tenantId);
    ownerId = owner.staffId;
    ownerBearer = owner.bearer;

    const nurse = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Nurul Ujian', clinicId, active: true },
      }),
    );
    nurseId = nurse.id;
    nurseBearer = bearerFor(tenantId, nurseId, Role.FRONT_DESK_CLINICAL_STAFF);
  });

  const pendingRequest = (staffId: string) =>
    withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveRequest.create({
        data: {
          tenantId,
          staffId,
          leaveType: LeaveType.ANNUAL,
          startDate: new Date('2026-10-05'),
          endDate: new Date('2026-10-07'),
          reason: 'Family trip',
        },
      }),
    );

  // -------------------------------------------------------------------------
  it('records the SIGNED-IN owner as the approver, whatever the body says', async () => {
    const leave = await pendingRequest(nurseId);

    // The old field, still sent. It must not be honoured — and because the
    // pipe whitelists, it is not even carried into the DTO.
    await request(server())
      .patch(`/leave-requests/${leave.id}/approve`)
      .set('Authorization', ownerBearer)
      .send({ approvedByStaffId: nurseId })
      .expect(200);

    const saved = await withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveRequest.findUnique({ where: { id: leave.id } }),
    );
    expect(saved?.status).toBe(LeaveStatus.APPROVED);
    // The owner approved it. Not the nurse the caller nominated.
    expect(saved?.approvedByStaffId).toBe(ownerId);
    expect(saved?.approvedByStaffId).not.toBe(nurseId);
  });

  it('REFUSES somebody without hr.leave.approve', async () => {
    const leave = await pendingRequest(nurseId);
    const colleague = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Rakan Ujian', clinicId, active: true },
      }),
    );

    await request(server())
      .patch(`/leave-requests/${leave.id}/approve`)
      .set('Authorization', bearerFor(tenantId, colleague.id, Role.FRONT_DESK_CLINICAL_STAFF))
      .send({})
      .expect(403);

    const saved = await withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveRequest.findUnique({ where: { id: leave.id } }),
    );
    expect(saved?.status).toBe(LeaveStatus.PENDING);
  });

  it('refuses to let somebody approve their OWN leave', async () => {
    // The owner holds the permission; holding it is not the same as being
    // allowed to decide your own request, exactly as with overtime and claims.
    const leave = await pendingRequest(ownerId);

    const refused = await request(server())
      .patch(`/leave-requests/${leave.id}/approve`)
      .set('Authorization', ownerBearer)
      .send({});
    expect(refused.status).toBe(400);
    expect(String(refused.body.message)).toMatch(/your own/i);
  });

  it('refuses to decide a request that was already decided', async () => {
    const leave = await pendingRequest(nurseId);
    await request(server())
      .patch(`/leave-requests/${leave.id}/approve`)
      .set('Authorization', ownerBearer)
      .send({})
      .expect(200);

    const again = await request(server())
      .patch(`/leave-requests/${leave.id}/reject`)
      .set('Authorization', ownerBearer)
      .send({ rejectReason: 'Changed my mind' });
    expect(again.status).toBe(400);
    expect(String(again.body.message)).toMatch(/already approved/i);
  });

  it('writes an audit row naming the decision and the person', async () => {
    const leave = await pendingRequest(nurseId);
    await request(server())
      .patch(`/leave-requests/${leave.id}/reject`)
      .set('Authorization', ownerBearer)
      .send({ rejectReason: 'Understaffed that week' })
      .expect(200);

    const audit = await withTenantContext(prisma, tenantId, (tx) =>
      tx.auditLog.findMany({ where: { tenantId, entityType: 'LeaveRequest', entityId: leave.id } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].action).toBe('leave.decided');
    // The reason is folded into `after._reason` — the audit table has no column
    // of its own for it, and the WHO is `actorUserId`, which is null for a
    // staff member with no login. That the right PERSON is recorded as the
    // approver is proved on the request itself, in the first test above.
    const after = audit[0].after as Record<string, unknown>;
    expect(after.status).toBe('REJECTED');
    expect(after.staff).toBe('Nurul Ujian');
    expect(after._reason).toBe('Understaffed that week');
  });

  it('a rejection keeps its reason on the request', async () => {
    const leave = await pendingRequest(nurseId);
    await request(server())
      .patch(`/leave-requests/${leave.id}/reject`)
      .set('Authorization', ownerBearer)
      .send({ rejectReason: 'Understaffed that week' })
      .expect(200);

    const saved = await withTenantContext(prisma, tenantId, (tx) =>
      tx.leaveRequest.findUnique({ where: { id: leave.id } }),
    );
    expect(saved?.status).toBe(LeaveStatus.REJECTED);
    expect(saved?.rejectReason).toBe('Understaffed that week');
    expect(saved?.approvedByStaffId).toBe(ownerId);
  });

  /*
   * THE CARRY-FORWARD CAP — a number that existed for a year and bound nothing.
   *
   * `LeavePolicy.carryForwardDays` says how many unused annual days a clinic
   * lets cross into the next year. Nothing read it: there is no year-end
   * rollover in this API, so the only way a day is carried in is somebody
   * typing it into a balance adjustment — and that writer never consulted the
   * policy. A clinic could set "carry forward 8" and have 20 typed in over it,
   * with the screen showing the 20 and no complaint anywhere.
   */
  describe('the carry-forward cap', () => {
    const policyFor = (carryForwardDays: number | null) =>
      withTenantContext(prisma, tenantId, async (tx) => {
        const policy = await tx.leavePolicy.create({
          data: { tenantId, name: `Cuti ${randomId().slice(0, 8)}`, carryForwardDays },
        });
        await tx.leavePolicyEntitlement.create({
          data: { tenantId, leavePolicyId: policy.id, leaveType: LeaveType.ANNUAL, daysPerYear: 14, paid: true },
        });
        await tx.employeeProfile.create({
          data: {
            tenantId,
            staffId: nurseId,
            employeeNo: `N-${randomId().slice(0, 6)}`,
            employmentType: 'PERMANENT',
            employmentStatus: 'ACTIVE',
            startDate: new Date('2024-01-01'),
            leavePolicyId: policy.id,
          },
        });
        return policy;
      });

    const adjust = (carriedInDays: number) =>
      request(server())
        .post('/workforce/leave/balances/adjust')
        .set('Authorization', ownerBearer)
        .send({
          staffId: nurseId,
          leaveType: LeaveType.ANNUAL,
          benefitYear: 2026,
          carriedInDays,
          reason: 'Carrying last year forward.',
        });

    it('refuses more carried-in days than the policy allows, and says what the cap is', async () => {
      await policyFor(8);
      const refused = await adjust(20).expect(400);
      expect(refused.body.message).toContain('8 days');
      expect(refused.body.message).toContain('20 was entered');
    });

    it('accepts the cap exactly, because a cap is a limit and not a barrier', async () => {
      await policyFor(8);
      await adjust(8).expect(201);
      const saved = await withTenantContext(prisma, tenantId, (tx) =>
        tx.leaveBalance.findFirst({ where: { staffId: nurseId, leaveType: LeaveType.ANNUAL, benefitYear: 2026 } }),
      );
      expect(Number(saved?.carriedInDays)).toBe(8);
    });

    it('refuses nothing where the clinic has recorded no cap, because null is undecided and not zero', async () => {
      await policyFor(null);
      await adjust(20).expect(201);
    });

    it('leaves medical leave alone: carrying forward is an ANNUAL rule and not a general one', async () => {
      await policyFor(8);
      await request(server())
        .post('/workforce/leave/balances/adjust')
        .set('Authorization', ownerBearer)
        .send({
          staffId: nurseId,
          leaveType: LeaveType.MEDICAL,
          benefitYear: 2026,
          carriedInDays: 20,
          reason: 'Not the field\'s business.',
        })
        .expect(201);
    });

    it('publishes the cap with the balances, so a number that now binds is legible', async () => {
      await policyFor(8);
      const balances = await request(server())
        .get('/workforce/leave/balances?year=2026')
        .set('Authorization', ownerBearer)
        .expect(200);
      const nurse = balances.body.employees.find((row: { staffId: string }) => row.staffId === nurseId);
      expect(nurse.carryForwardCap).toBe(8);
    });
  });
});
