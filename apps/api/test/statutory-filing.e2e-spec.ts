import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Role } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { bearerFor, createOwnerAndBearer } from "./auth";
import { createTestPrismaClient, withTenantContext } from "./test-db";

const randomId = () => crypto.randomUUID();

/*
 * THE FILING HELPER — the approved month per agency, with who joined and
 * who left, and "submitted" recorded per agency.
 *
 * KWSP, PERKESO and LHDN each take one filing a month, and PERKESO's covers
 * three schemes at once. A joiner has to be ADDED at the portal before the
 * figures are keyed and a leaver REMOVED after, which the per-scheme
 * listings never said. This spec builds February and March for a small
 * clinic — somebody who started in March, somebody whose last day is in
 * March, somebody who left in February — and checks the helper says so.
 */
describe("Statutory filing helper (e2e)", () => {
  let app: INestApplication;
  let prisma: ReturnType<typeof createTestPrismaClient>;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;
  let legalEmployerId: string;
  let marchRunId: string;
  const server = () => app.getHttpServer();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    prisma = createTestPrismaClient();

    tenantId = randomId();
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.tenant.create({ data: { id: tenantId, name: "Filing Tenant" } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    clinicId = (
      await request(server())
        .post("/clinics")
        .set("Authorization", bearer)
        .send({ name: "Filing Clinic" })
        .expect(201)
    ).body.id;
    legalEmployerId = (
      await request(server())
        .post("/workforce/legal-employers")
        .set("Authorization", bearer)
        .send({ name: "Filing Employer Sdn Bhd" })
        .expect(201)
    ).body.id;
    await request(server())
      .post(`/workforce/legal-employers/${legalEmployerId}/statutory-profile`)
      .set("Authorization", bearer)
      .send({
        effectiveFrom: "2024-01-01",
        hrdRegistration: "NOT_REGISTERED",
        reason: "Below headcount",
      })
      .expect(201);
    // The component catalogue: without it a payslip line cannot say what it
    // is liable to, and the run refuses to calculate.
    await request(server())
      .post("/workforce/pay-components/seed")
      .set("Authorization", bearer)
      .expect(201);

    // Amir has always been here. Bella starts on 10 March. Chong's last day
    // is 20 March. Devi left on 15 February, so she is on February's
    // payroll and not March's.
    await makeEmployee("Amir Demo", "3000.00", { startDate: "2024-01-01" });
    await makeEmployee("Chong Demo", "3200.00", {
      startDate: "2024-01-01",
      endDate: "2026-03-20",
    });
    const deviId = await makeEmployee("Devi Demo", "2600.00", {
      startDate: "2024-01-01",
    });

    await approveMonth("2026-02");
    // Bella starts in March, so she is created after February is approved:
    // a run picks everyone on the books, and an employee with no salary yet
    // would block February rather than simply not be on it.
    await makeEmployee("Bella Demo", "2800.00", { startDate: "2026-03-10" });
    // Devi's resignation is recorded after February is approved: a run picks
    // its people by employment status, so a resigned employee is simply not
    // on March's list — which is exactly what the portal needs to be told.
    await request(server())
      .post(`/workforce/employees/${deviId}`)
      .set("Authorization", bearer)
      .send({ employmentStatus: "RESIGNED", endDate: "2026-02-15" })
      .expect(201);
    marchRunId = await approveMonth("2026-03");
  }, 120_000);

  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  async function makeEmployee(
    name: string,
    salary: string,
    opts: { startDate: string; endDate?: string },
  ) {
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: {
          tenantId,
          role: Role.FRONT_DESK_CLINICAL_STAFF,
          fullName: name,
          clinicId,
        },
      }),
    );
    await request(server())
      .post(`/workforce/employees/${staff.id}`)
      .set("Authorization", bearer)
      .send({
        employeeNo: `F-${Math.floor(Math.random() * 100000)}`,
        position: "Clinic Assistant",
        employmentType: "PERMANENT",
        employmentStatus: "ACTIVE",
        startDate: opts.startDate,
        ...(opts.endDate ? { endDate: opts.endDate } : {}),
        dateOfBirth: "1991-03-03",
        identifierType: "NRIC",
        identifierValue: `9103030${Math.floor(Math.random() * 90000 + 10000)}`,
        bankName: "Maybank",
        bankAccountNo: "514499887766",
      })
      .expect(201);
    await request(server())
      .post(`/workforce/employees/${staff.id}/statutory-classification`)
      .set("Authorization", bearer)
      .send({
        effectiveFrom: opts.startDate,
        epfMembership: "MALAYSIAN_CITIZEN",
        taxResidence: "RESIDENT",
        pcbCategory: "CATEGORY_1",
        qualifyingChildren: 0,
        restDayOfWeek: 0,
        lindungParticipation: "ENROLLED",
        overtimeContractPolicy: "PAY_AT_STATUTORY_RATES",
        reason: "Recorded at hire",
      })
      .expect(201);
    await request(server())
      .patch(`/workforce/employees/${staff.id}/legal-employer`)
      .set("Authorization", bearer)
      .send({ legalEmployerId })
      .expect(200);
    await request(server())
      .post(`/workforce/employees/${staff.id}/salary`)
      .set("Authorization", bearer)
      .send({
        amount: salary,
        basis: "MONTHLY",
        effectiveFrom: opts.startDate,
        reason: "Starting salary",
      })
      .expect(201);
    return staff.id;
  }

  async function approveMonth(period: string): Promise<string> {
    const run = await request(server())
      .post("/workforce/payroll/runs")
      .set("Authorization", bearer)
      .send({ period, clinicId, legalEmployerId })
      .expect(201);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/calculate`)
      .set("Authorization", bearer)
      .expect(200);
    await request(server())
      .patch(`/workforce/payroll/runs/${run.body.id}/approve`)
      .set("Authorization", bearer)
      .send({ acknowledgeStatutoryGap: true })
      .expect(200);
    return run.body.id as string;
  }

  it("groups the month per agency, lists people by name, and says who to add and who to remove", async () => {
    const res = await request(server())
      .get(`/workforce/payroll/runs/${marchRunId}/filing`)
      .set("Authorization", bearer)
      .expect(200);
    expect(
      res.body.agencies.map((row: { agency: string }) => row.agency),
    ).toEqual(["KWSP", "PERKESO", "LHDN", "HRD"]);
    expect(res.body.previousMonth).toBe("February 2026");

    const kwsp = res.body.agencies[0];
    expect(kwsp.rows.map((row: { name: string }) => row.name)).toEqual([
      "Amir Demo",
      "Bella Demo",
      "Chong Demo",
    ]);
    expect(kwsp.rows[0].identifier).toMatch(/^9103030\d{5}$/);
    expect(kwsp.joiners).toEqual([
      expect.objectContaining({
        name: "Bella Demo",
        reason: "Started 10 Mar 2026",
      }),
    ]);
    expect(
      kwsp.leavers.map((row: { name: string; reason: string }) => [
        row.name,
        row.reason,
      ]),
    ).toEqual([
      [
        "Chong Demo",
        "Last day 20 Mar 2026: on this month's filing, then removed",
      ],
      ["Devi Demo", "On February 2026's payroll; last day 15 Feb 2026"],
    ]);

    // PERKESO's total is the three schemes together, to the sen, and each
    // person's row shows the three shares it is made of.
    const perkeso = res.body.agencies[1];
    expect(perkeso.schemes).toEqual(["SOCSO", "EIS", "LINDUNG"]);
    const amir = perkeso.rows[0];
    expect(Object.keys(amir.parts).sort()).toEqual(["EIS", "LINDUNG", "SOCSO"]);
    expect(amir.totalCents).toBe(
      amir.parts.SOCSO.employeeCents +
        amir.parts.SOCSO.employerCents +
        amir.parts.EIS.employeeCents +
        amir.parts.EIS.employerCents +
        amir.parts.LINDUNG.employeeCents,
    );
    expect(perkeso.totalCents).toBe(
      perkeso.rows.reduce(
        (sum: number, row: { totalCents: number }) => sum + row.totalCents,
        0,
      ),
    );
    expect(perkeso.totalCents).toBeGreaterThan(0);

    // An employer not registered with HRD Corp has nothing to file there.
    const hrd = res.body.agencies[3];
    expect(hrd.applicable).toBe(false);
    expect(hrd.rows).toEqual([]);
    expect(hrd.submission.state).toBe("NOT_APPLICABLE");
  });

  it("records a PERKESO submission on all three schemes at once, and only once", async () => {
    const first = await request(server())
      .post(
        `/workforce/payroll/runs/${marchRunId}/filing/perkeso/record-submission`,
      )
      .set("Authorization", bearer)
      .send({ submittedDate: "2026-04-05", reference: "ASSIST-2026-03-0042" })
      .expect(201);
    const perkeso = first.body.agencies.find(
      (row: { agency: string }) => row.agency === "PERKESO",
    );
    expect(perkeso.submission).toMatchObject({
      state: "RECORDED",
      submittedDate: "2026-04-05",
      reference: "ASSIST-2026-03-0042",
    });
    expect(
      perkeso.submission.perScheme.map(
        (row: { recorded: boolean }) => row.recorded,
      ),
    ).toEqual([true, true, true]);

    const rows = await withTenantContext(prisma, tenantId, (tx) =>
      tx.payrollStatutorySubmission.findMany({
        where: { payrollRunId: marchRunId },
        orderBy: { scheme: "asc" },
      }),
    );
    expect(rows.map((row) => row.scheme)).toEqual(["EIS", "LINDUNG", "SOCSO"]);
    expect(new Set(rows.map((row) => row.reference))).toEqual(
      new Set(["ASSIST-2026-03-0042"]),
    );

    // KWSP is untouched by PERKESO's record.
    expect(first.body.agencies[0].submission.state).toBe("NOT_RECORDED");

    const again = await request(server())
      .post(
        `/workforce/payroll/runs/${marchRunId}/filing/perkeso/record-submission`,
      )
      .set("Authorization", bearer)
      .send({ submittedDate: "2026-04-06", reference: "ASSIST-2026-03-0043" })
      .expect(409);
    expect(again.body.message).toMatch(/already recorded/);

    await request(server())
      .post(
        `/workforce/payroll/runs/${marchRunId}/filing/hrd/record-submission`,
      )
      .set("Authorization", bearer)
      .send({ submittedDate: "2026-04-05", reference: "HRD-0001" })
      .expect(409);
  });

  it("needs the statutory export permission, like the listings it is made of", async () => {
    const counter = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({
        data: {
          tenantId,
          role: Role.FRONT_DESK_CLINICAL_STAFF,
          fullName: "Counter Demo",
          clinicId,
        },
      }),
    );
    await request(server())
      .get(`/workforce/payroll/runs/${marchRunId}/filing`)
      .set(
        "Authorization",
        bearerFor(tenantId, counter.id, Role.FRONT_DESK_CLINICAL_STAFF),
      )
      .expect(403);
  });
});
