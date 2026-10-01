import { INestApplication, ValidationPipe } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { createTestPrismaClient, randomId, withTenantContext } from "./test-db";
import { createOwnerAndBearer } from "./auth";

/**
 * A LATER EDITION OF A STATUTORY TABLE, added by the platform, read by the
 * clinic — and priced from its date, never before.
 *
 * Only a platform-admin token may add one; the content is checked band by
 * band and a refusal names the problem; a clinic's rates screen resolves a
 * month to the edition in force then; an edition already in force cannot be
 * withdrawn.
 */
describe("Statutory table editions (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let clinicBearer: string;
  let platformBearer: string;
  let createdId: string;

  const server = () => app.getHttpServer();
  const content2099 = {
    ceilingCents: 700_000,
    bands: [
      [0, 3_000, 10, 10],
      [3_000, 700_000, 1_400, 1_400],
      [700_000, null, 1_400, 1_400],
    ],
  };

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
      tx.tenant.create({ data: { id: tenantId, name: "Editions Tenant" } }),
    );
    clinicBearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;

    const admin = await prisma.platformAdmin.create({
      data: {
        email: `owner-${randomId().slice(0, 8)}@kuwick.invalid`,
        passwordHash: "x",
        fullName: "Kuwick Owner (test)",
      },
    });
    const jwt = new JwtService({});
    platformBearer = `Bearer ${jwt.sign({ sub: admin.id, type: "platform" }, { secret: process.env.JWT_ACCESS_SECRET as string, expiresIn: "1h" })}`;
  });

  afterAll(async () => {
    await prisma.statutoryTableVersion.deleteMany({
      where: { sourceDocument: { startsWith: "TEST " } },
    });
    await prisma.$disconnect();
    await app.close();
  });

  it("a clinic token cannot add an edition; a platform token can, and a broken one is refused by name", async () => {
    await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", clinicBearer)
      .send({})
      .expect(401);

    const broken = await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .send({
        scheme: "EIS",
        year: 2099,
        inForceFrom: "2099-01-01",
        sourceDocument: "TEST broken",
        content: {
          ceilingCents: 700_000,
          bands: [
            [0, 3_000, 10, 10],
            [5_000, null, 1_400, 1_400],
          ],
        },
      })
      .expect(400);
    expect(JSON.stringify(broken.body)).toMatch(/band 2 starts at 5000/);

    const tooEarly = await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .send({
        scheme: "EIS",
        year: 2025,
        inForceFrom: "2025-10-01",
        sourceDocument: "TEST same date as built-in",
        content: content2099,
      })
      .expect(400);
    expect(String(tooEarly.body.message)).toMatch(
      /must be in force from a later date/,
    );

    const created = await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .send({
        scheme: "EIS",
        year: 2099,
        inForceFrom: "2099-01-01",
        sourceDocument: "TEST Act 800 rate table, 2099 edition",
        sourceUrl: "https://example.invalid/act800-2099",
        content: content2099,
      })
      .expect(201);
    createdId = created.body.id;
    expect(created.body).toMatchObject({
      scheme: "EIS",
      year: 2099,
      inForceFrom: "2099-01-01",
      readable: true,
      createdBy: "Kuwick Owner (test)",
    });
    expect(created.body.summary).toMatch(/3 bands, ceiling RM7,000/);

    const again = await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .send({
        scheme: "EIS",
        year: 2099,
        inForceFrom: "2099-01-01",
        sourceDocument: "TEST duplicate",
        content: content2099,
      });
    expect(again.status).toBe(409);

    const list = await request(server())
      .get("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .expect(200);
    expect(list.body.versions.map((row: { id: string }) => row.id)).toContain(
      createdId,
    );
    expect(
      list.body.builtIn.map((row: { scheme: string }) => row.scheme),
    ).toEqual(expect.arrayContaining(["EPF", "SOCSO", "EIS", "PCB"]));
  });

  it("the clinic reads the edition in force for a month: built-in before its date, the platform edition from it", async () => {
    const before = await request(server())
      .get("/workforce/payroll/statutory-rates?period=2026-06")
      .set("Authorization", clinicBearer)
      .expect(200);
    expect(before.body.period).toBe("2026-06");
    expect(before.body.editions.EIS.origin).toBe("BUILT_IN");
    expect(before.body.tables.eis.ceilingCents).toBe(600_000);
    expect(before.body.tables.epf.parts).toHaveLength(4);
    expect(before.body.tables.epf.parts[0].bands.length).toBeGreaterThan(100);
    expect(before.body.tables.pcb.table1.length).toBeGreaterThan(3);

    const after = await request(server())
      .get("/workforce/payroll/statutory-rates?period=2099-02")
      .set("Authorization", clinicBearer)
      .expect(200);
    expect(after.body.editions.EIS).toMatchObject({
      origin: "PLATFORM",
      id: createdId,
      inForceFrom: "2099-01-01",
    });
    expect(after.body.tables.eis.ceilingCents).toBe(700_000);
    expect(after.body.eis.schedule.id).toBe(`platform:${createdId}`);
    expect(after.body.versions.map((row: { id: string }) => row.id)).toContain(
      createdId,
    );

    await request(server())
      .get("/workforce/payroll/statutory-rates?period=2026-13")
      .set("Authorization", clinicBearer)
      .expect(400);
  });

  it("an edition not yet in force can be withdrawn; one already in force cannot", async () => {
    await request(server())
      .delete(`/platform/statutory-tables/${createdId}`)
      .set("Authorization", platformBearer)
      .expect(200);
    const list = await request(server())
      .get("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .expect(200);
    expect(
      list.body.versions.map((row: { id: string }) => row.id),
    ).not.toContain(createdId);

    const inForce = await request(server())
      .post("/platform/statutory-tables")
      .set("Authorization", platformBearer)
      .send({
        scheme: "HRD_LEVY",
        year: 2026,
        inForceFrom: "2026-01-01",
        sourceDocument: "TEST levy guideline, already in force",
        content: { mandatoryPercent: 1, optionalPercent: 0.5 },
      })
      .expect(201);
    const refused = await request(server())
      .delete(`/platform/statutory-tables/${inForce.body.id}`)
      .set("Authorization", platformBearer);
    expect(refused.status).toBe(400);
    expect(String(refused.body.message)).toMatch(/cannot be withdrawn/);
    await prisma.statutoryTableVersion.delete({
      where: { id: inForce.body.id },
    });
  });
});
