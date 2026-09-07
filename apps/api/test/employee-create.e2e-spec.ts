import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';
import { bearerFor, createOwnerAndBearer } from './auth';

/**
 * HIRING SOMEBODY — one act, three records.
 *
 * Kuwick keeps the staff row, the employment profile and the login separate
 * and always will: a locum with no login is legitimate, so is a manager whose
 * account exists before HR finishes their paperwork. What was missing was a
 * single door, so an owner had to know the separation existed in order to hire
 * a receptionist — and if they stopped half way, which people do, the result
 * was a staff row that looked like an employee and could not be paid.
 */
describe('Adding an employee (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let tenantId: string;
  let bearer: string;
  let clinicId: string;

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
      tx.tenant.create({ data: { id: tenantId, name: 'Klinik Ambil (Synthetic)' } }),
    );
    bearer = (await createOwnerAndBearer(prisma, tenantId)).bearer;
    const clinic = await request(server())
      .post('/clinics')
      .set('Authorization', bearer)
      .send({ name: 'Klinik Ambil' })
      .expect(201);
    clinicId = clinic.body.id;
  });

  const create = (body: Record<string, unknown>) =>
    request(server()).post('/workforce/employees').set('Authorization', bearer).send(body);

  /**
   * A SIGN-IN ADDRESS NOBODY ELSE HAS.
   *
   * These specs deliberately leave their rows behind (the house convention —
   * `kuwick_test` is disposable and every test uses a fresh random tenant), but
   * an email is not tenant-scoped the way a tenant's own rows are: a fixed
   * address is unique on the first run and a conflict on the second, and
   * signing in with one that exists in two tenants is ambiguous rather than
   * wrong. So each run gets its own.
   */
  const uniqueEmail = (who: string) => `${who}-${randomId().slice(0, 8)}@ambil-uat.kuwick.invalid`;

  // -------------------------------------------------------------------------
  it('creates the staff row and the employment profile together', async () => {
    const created = await create({
      fullName: 'Nurul Hidayah Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      employeeNo: 'E-2001',
      position: 'Staff Nurse',
      department: 'Clinical',
      startDate: '2026-09-01',
      phone: '013-2000001',
    }).expect(201);

    expect(created.body.staff.fullName).toBe('Nurul Hidayah Ujian');
    expect(created.body.employeeNo).toBe('E-2001');

    // Both records, and the profile is attached to that staff row.
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.findFirst({ where: { fullName: 'Nurul Hidayah Ujian' }, include: { employeeProfile: true } }),
    );
    expect(staff?.employeeProfile).not.toBeNull();
    expect(staff?.clinicId).toBe(clinicId);
    expect(staff?.userId).toBeNull();
  });

  it('creates a working login when one is asked for', async () => {
    const email = uniqueEmail('rahim');
    await create({
      fullName: 'Rahim Kaunter Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      position: 'Receptionist',
      loginEmail: email,
      loginPassword: 'AmbilUat!2026',
    }).expect(201);

    // The proof is that they can sign in, not that a row exists.
    const login = await request(server())
      .post('/auth/login')
      .send({ email, password: 'AmbilUat!2026' })
      .expect(201);
    expect(login.body.accessToken).toBeTruthy();
  });

  it('REFUSES a sign-in address somebody already uses', async () => {
    const email = uniqueEmail('taken');
    await create({
      fullName: 'Pertama Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      loginEmail: email,
      loginPassword: 'AmbilUat!2026',
    }).expect(201);

    const refused = await create({
      fullName: 'Kedua Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      loginEmail: email,
      loginPassword: 'AmbilUat!2026',
    });
    expect(refused.status).toBe(400);
    expect(String(refused.body.message)).toMatch(/already signs in/i);
  });

  it('REFUSES half a login rather than creating an account nobody can use', async () => {
    const refused = await create({
      fullName: 'Separuh Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      loginEmail: 'separuh@ambil-uat.kuwick.invalid',
    });
    expect(refused.status).toBe(400);
    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.findFirst({ where: { fullName: 'Separuh Ujian' } }),
    );
    expect(staff).toBeNull();
  });

  it('does not make somebody a provider merely because their job title is doctor', async () => {
    await create({
      fullName: 'Dr Tanpa Ujian',
      role: Role.DOCTOR_RESIDENT,
      clinicId,
      position: 'Resident',
    }).expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.findFirst({ where: { fullName: 'Dr Tanpa Ujian' } }),
    );
    // A REGISTRATION NUMBER is what makes a provider. "Every doctor can sign"
    // is how an unregistered locum ends up signing notes.
    expect(staff?.professionalActive).toBe(false);
    expect(staff?.canSignClinicalNotes).toBe(false);
  });

  it('makes somebody a provider when a registration number is given, and names who granted it', async () => {
    await create({
      fullName: 'Dr Berdaftar Ujian',
      role: Role.DOCTOR_RESIDENT,
      clinicId,
      medicalRegistrationNo: 'MMC-UAT-9001',
    }).expect(201);

    const staff = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.findFirst({ where: { fullName: 'Dr Berdaftar Ujian' } }),
    );
    expect(staff?.professionalActive).toBe(true);
    expect(staff?.canSignClinicalNotes).toBe(true);
    // A credential with no named granter is an assertion, not a credential.
    expect(staff?.clinicalSigningEnabledByStaffId).not.toBeNull();
    expect(staff?.professionalVerifiedByStaffId).not.toBeNull();
  });

  it('REFUSES a salary in the create, and says where salary goes', async () => {
    const refused = await create({
      fullName: 'Gaji Ujian',
      role: Role.FRONT_DESK_CLINICAL_STAFF,
      clinicId,
      basicSalary: '3000.00',
    });
    // Salary is effective-dated. Accepting it here would mean inventing "from
    // today", and the profile and the payroll run would then disagree about
    // what somebody is paid.
    expect(refused.status).toBe(400);
    expect(String(refused.body.message)).toMatch(/takes effect from/i);
  });

  it('will not let an HR clerk hand out a login', async () => {
    const clerk = await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.HR_STAFF, fullName: 'HR Clerk Ujian', clinicId } }),
    );
    const clerkBearer = bearerFor(tenantId, clerk.id, Role.HR_STAFF);

    // They may hire…
    await request(server())
      .post('/workforce/employees')
      .set('Authorization', clerkBearer)
      .send({ fullName: 'Tanpa Akaun Ujian', role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId, position: 'Nurse' })
      .expect(201);

    // …and may not give somebody the keys.
    const refused = await request(server())
      .post('/workforce/employees')
      .set('Authorization', clerkBearer)
      .send({
        fullName: 'Dengan Akaun Ujian',
        role: Role.FRONT_DESK_CLINICAL_STAFF,
        clinicId,
        loginEmail: uniqueEmail('keys'),
        loginPassword: 'AmbilUat!2026',
      });
    expect(refused.status).toBe(400);
    expect(String(refused.body.message)).toMatch(/user-management/i);
  });

  // -------------------------------------------------------------------------
  it('lists the staff who have no employment profile, so they stop being invisible', async () => {
    // Somebody created the old way: a staff row and nothing else.
    await withTenantContext(prisma, tenantId, (tx) =>
      tx.staff.create({ data: { tenantId, role: Role.FRONT_DESK_CLINICAL_STAFF, fullName: 'Belum Siap Ujian', clinicId } }),
    );
    await create({ fullName: 'Sudah Siap Ujian', role: Role.FRONT_DESK_CLINICAL_STAFF, clinicId, position: 'Nurse' }).expect(201);

    const incomplete = await request(server())
      .get('/workforce/employees/incomplete')
      .set('Authorization', bearer)
      .expect(200);

    const names = incomplete.body.map((row: { fullName: string }) => row.fullName);
    expect(names).toContain('Belum Siap Ujian');
    expect(names).not.toContain('Sudah Siap Ujian');
  });

  it('reads "incomplete" as a route and not as a staff id', async () => {
    // Nest matches in declaration order, so `employees/:staffId` above this
    // would swallow it and return a 404 for a staff member called "incomplete".
    const response = await request(server())
      .get('/workforce/employees/incomplete')
      .set('Authorization', bearer)
      .expect(200);
    expect(Array.isArray(response.body)).toBe(true);
  });
});
