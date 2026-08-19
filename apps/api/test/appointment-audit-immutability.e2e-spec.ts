import {
  AppointmentEventType,
  AppointmentSource,
  AppointmentStatus,
  BookingFieldType,
  PrismaClient,
  Role,
} from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { createTestPrismaClient, randomId, withTenantContext } from './test-db';

// Proves §1 of the pre-merge hardening pass: appointment_events (and its
// sibling appointment_form_answers) is append-only AT THE DATABASE — not
// merely by application-code discipline. Three independent layers exist, and
// this file observes each from the seat it actually defends against:
//
//   privileges — provision-app-role.sql grants the application role
//     INSERT+SELECT only on the audit tables (the append-only carve-out), so
//     from the application's own connection every UPDATE/DELETE/TRUNCATE is
//     refused outright (SQLSTATE 42501). Asserted below as kuwick_app.
//   RLS with no UPDATE/DELETE policy — under FORCE ROW LEVEL SECURITY a
//     command with no applicable policy matches zero rows (migration
//     20260819160000_a_history_anyone_can_rewrite_is_not_a_history). Shields
//     a non-superuser OWNER, e.g. a future migration role.
//   BEFORE triggers that RAISE (SQLSTATE P0001) — fire even for a superuser,
//     the one seat both other layers wave through. Asserted below as the
//     owner role, which is a superuser in CI and in the dev container.
//
// The UPDATE case was a REAL defect: before that migration,
//   UPDATE appointment_events SET reason='TAMPERED' WHERE id=...
// as kuwick_app returned UPDATE 1. A history anyone can rewrite is not a
// history; this file is what keeps that door closed.
//
// TWO TRAPS this file deliberately avoids:
//   - No inline regex literals in the toThrow() calls: Prisma error messages
//     embed a source-code frame of the failing call site, so a pattern
//     written next to the invocation MATCHES ITS OWN QUOTED ASSERTION and
//     the test passes no matter what the database said. (Observed: a
//     /append-only/ literal "passed" against a permission-denied error.)
//     The patterns live here, far above every call site.
//   - No cleanup: these rows CANNOT be deleted — that is the property under
//     test — and neither can the parent appointment once it has history.
//     kuwick_test is disposable (CODING_STANDARDS.md §5) and every id is a
//     fresh uuid, so leftovers collide with nothing.

// What a refusal looks like, by layer: 42501 insufficient_privilege
// (privileges), P0001 raise_exception (the append-only triggers).
const REFUSED = /permission denied|append-only/;
const TRIGGER_REFUSAL = /append-only and are never/;

// The database the migrations were applied by — the table OWNER's seat.
// CI: kuwick_dev, the postgres image superuser. Local: the same. Without it
// the owner-side tests cannot run, and silently skipping a security test is
// how it quietly stops existing — so its absence fails loudly instead.
const OWNER_URL = process.env.TEST_OWNER_DATABASE_URL;

describe('Appointment audit immutability (e2e, DB-level)', () => {
  let prisma: PrismaClient;
  let tenantId: string;
  let appointmentId: string;
  let eventId: string;
  let answerId: string;

  beforeAll(async () => {
    prisma = createTestPrismaClient();
    tenantId = randomId();

    await withTenantContext(prisma, tenantId, async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, name: 'Audit Immutability Tenant' } });
      const clinic = await tx.clinic.create({ data: { tenantId, name: 'Audit Clinic' } });
      const patient = await tx.patient.create({
        data: { tenantId, identifierType: 'NRIC', identifierValue: '900101015010', name: 'Audit Patient' },
      });
      const staff = await tx.staff.create({
        data: { tenantId, role: Role.DOCTOR_RESIDENT, fullName: 'Audit Doctor' },
      });
      const service = await tx.serviceCatalog.create({
        data: { tenantId, name: 'Audit Consultation', durationMinutesDefault: 15 },
      });
      const appointment = await tx.appointment.create({
        data: {
          tenantId,
          clinicId: clinic.id,
          patientId: patient.id,
          staffId: staff.id,
          serviceId: service.id,
          status: AppointmentStatus.CONFIRMED,
          source: AppointmentSource.FRONT_DESK,
          scheduledStart: new Date('2026-09-01T01:00:00Z'),
          scheduledEnd: new Date('2026-09-01T01:15:00Z'),
        },
      });
      appointmentId = appointment.id;
      const event = await tx.appointmentEvent.create({
        data: {
          tenantId,
          appointmentId,
          eventType: AppointmentEventType.CREATED,
          toStatus: AppointmentStatus.CONFIRMED,
          reason: 'original reason',
          actorLabel: 'Audit Doctor',
        },
      });
      eventId = event.id;
      const answer = await tx.appointmentFormAnswer.create({
        data: {
          tenantId,
          appointmentId,
          label: 'Reason for visit',
          fieldType: BookingFieldType.SHORT_TEXT,
          answer: 'original answer',
        },
      });
      answerId = answer.id;
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // The invariant, checked after every attempt below: whatever layer refused
  // (and whatever the refusal looked like), the history still reads back
  // exactly as written.
  async function expectHistoryUnchanged(): Promise<void> {
    const event = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentEvent.findUniqueOrThrow({ where: { id: eventId } }),
    );
    expect(event.reason).toBe('original reason');
    const answer = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentFormAnswer.findUniqueOrThrow({ where: { id: answerId } }),
    );
    expect(answer.answer).toBe('original answer');
  }

  // ── as the application role (kuwick_app) ─────────────────────────────────

  it('raw SQL UPDATE on appointment_events is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`UPDATE "appointment_events" SET reason = 'TAMPERED' WHERE id = ${eventId}`,
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('Prisma updateMany on AppointmentEvent is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.appointmentEvent.updateMany({ where: { id: eventId }, data: { reason: 'TAMPERED' } }),
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('raw SQL UPDATE on appointment_form_answers is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`UPDATE "appointment_form_answers" SET answer = 'TAMPERED' WHERE id = ${answerId}`,
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('raw SQL DELETE on appointment_events is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM "appointment_events" WHERE id = ${eventId}`,
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('Prisma deleteMany on AppointmentEvent is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.appointmentEvent.deleteMany({ where: { id: eventId } }),
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('raw SQL DELETE on appointment_form_answers is refused', async () => {
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.$executeRaw`DELETE FROM "appointment_form_answers" WHERE id = ${answerId}`,
      ),
    ).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('TRUNCATE appointment_events is refused', async () => {
    await expect(prisma.$executeRawUnsafe('TRUNCATE "appointment_events"')).rejects.toThrow(REFUSED);
    await expectHistoryUnchanged();
  });

  it('an appointment with history cannot be hard-deleted (the cascade is refused)', async () => {
    // appointment_events.appointment_id is ON DELETE CASCADE, so deleting the
    // appointment cascades into the audit table — where it is refused. Net
    // effect: history makes its appointment permanent, which is exactly the
    // module constraint ("do not hard-delete historical appointments").
    await expect(
      withTenantContext(prisma, tenantId, (tx) =>
        tx.appointment.delete({ where: { id: appointmentId } }),
      ),
    ).rejects.toThrow(REFUSED);

    const still = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointment.findUnique({ where: { id: appointmentId } }),
    );
    expect(still).not.toBeNull();
  });

  it('a new AppointmentEvent row can still be appended', async () => {
    // Append-only means the APPEND half must keep working: corrections are
    // new rows, not edits.
    const appended = await withTenantContext(prisma, tenantId, (tx) =>
      tx.appointmentEvent.create({
        data: {
          tenantId,
          appointmentId,
          eventType: AppointmentEventType.NOTE_ADDED,
          reason: 'correction recorded as a NEW row',
          actorLabel: 'Audit Doctor',
        },
      }),
    );
    expect(appended.id).toBeDefined();
  });

  it('the application role holds only INSERT and SELECT on the append-only tables', async () => {
    // Regression net for the provisioning ordering hazard: CI re-runs
    // provision-app-role.sql AFTER `migrate deploy`, and its broad GRANT used
    // to silently re-open UPDATE/DELETE on the audit tables every time. The
    // carve-out in that file is what this pins — drop it and this fails.
    const rows = await prisma.$queryRaw<{ table_name: string; privilege_type: string }[]>`
      SELECT table_name::text, privilege_type::text
      FROM information_schema.role_table_grants
      WHERE grantee = current_user
        AND table_name IN ('appointment_events', 'appointment_form_answers', 'visit_workflow_events')
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(['INSERT', 'SELECT']).toContain(row.privilege_type);
    }
  });

  // ── as the table owner ────────────────────────────────────────────────────
  // The privilege layer does not bind this seat (it owns the tables), and if
  // it is a superuser — as in CI and the dev container — RLS does not bind it
  // either. The BEFORE triggers are the layer that catches it, and they must,
  // because "the migration role can rewrite history" is precisely the D-083
  // known limitation this narrows.

  describe('as the table owner (migration seat)', () => {
    let owner: PrismaClient;

    beforeAll(() => {
      if (!OWNER_URL) {
        throw new Error(
          'TEST_OWNER_DATABASE_URL is not set — point it at kuwick_test as the role that ran the migrations (see .env.test.example).',
        );
      }
      owner = new PrismaClient({ adapter: new PrismaPg({ connectionString: OWNER_URL }) });
    });

    afterAll(async () => {
      await owner?.$disconnect();
    });

    it('UPDATE is refused by the trigger even for the owner/superuser', async () => {
      await expect(
        owner.$executeRaw`UPDATE "appointment_events" SET reason = 'TAMPERED' WHERE id = ${eventId}`,
      ).rejects.toThrow(TRIGGER_REFUSAL);
      await expectHistoryUnchanged();
    });

    it('DELETE is refused by the trigger even for the owner/superuser', async () => {
      await expect(
        owner.$executeRaw`DELETE FROM "appointment_events" WHERE id = ${eventId}`,
      ).rejects.toThrow(TRIGGER_REFUSAL);
      await expectHistoryUnchanged();
    });

    it('TRUNCATE is refused by the trigger even for the owner/superuser', async () => {
      await expect(owner.$executeRawUnsafe('TRUNCATE "appointment_events"')).rejects.toThrow(
        TRIGGER_REFUSAL,
      );
      await expectHistoryUnchanged();
    });

    it('UPDATE on appointment_form_answers is refused the same way', async () => {
      await expect(
        owner.$executeRaw`UPDATE "appointment_form_answers" SET answer = 'TAMPERED' WHERE id = ${answerId}`,
      ).rejects.toThrow(TRIGGER_REFUSAL);
      await expectHistoryUnchanged();
    });
  });
});
