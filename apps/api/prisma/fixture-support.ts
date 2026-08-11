import { unlink } from 'node:fs/promises';
import * as path from 'node:path';
import { PrismaClient } from '@prisma/client';

// G0 closure — shared support for the local verification scripts.
//
// These scripts create real clinical records to test against. Two problems
// followed from that, both raised in G0 review:
//
//   1. They accumulated. Every run left visits, notes, attachments and
//      uploaded files behind, so the dev database drifted and later audits
//      were reading a pile of test debris.
//   2. Nothing stopped them being pointed at a real database. A script that
//      creates and then DELETES clinical records must never be one stray
//      DATABASE_URL away from doing that to a clinic's data.
//
// So: everything created is tagged and tracked, cleanup runs in a finally
// block even when the run fails, and the guard below fails CLOSED.

export const FIXTURE_TAG = 'KUWICK-FIXTURE';

// Anything the scripts create carries this in a human-visible field
// (presenting complaint, patient name, file name), so test-generated data is
// identifiable at a glance even if cleanup is ever interrupted.
export function fixtureLabel(what: string): string {
  return `${FIXTURE_TAG} ${what}`;
}

/**
 * Refuse to run anywhere that is not an explicitly-approved local dev
 * database. Every condition must hold; any doubt is a refusal.
 *
 * Deliberately NOT satisfiable by a single environment variable — an
 * accidentally-exported KUWICK_ALLOW_FIXTURES must not be enough on its own
 * to let this loose on a remote host.
 */
export function assertFixturesAllowed(): void {
  const problems: string[] = [];

  if (process.env.NODE_ENV === 'production') {
    problems.push('NODE_ENV is production');
  }

  const url = process.env.DATABASE_URL ?? '';
  if (!url) {
    problems.push('DATABASE_URL is not set');
  } else {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      problems.push('DATABASE_URL could not be parsed — refusing to guess');
      host = '';
    }
    if (host && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
      problems.push(`DATABASE_URL points at "${host}", which is not a local database`);
    }
  }

  if (process.env.KUWICK_ALLOW_FIXTURES !== 'yes') {
    problems.push('KUWICK_ALLOW_FIXTURES is not set to "yes"');
  }

  if (problems.length > 0) {
    throw new Error(
      `Refusing to run fixture script — these scripts create and delete clinical records.\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\n\nRun against a local dev database with KUWICK_ALLOW_FIXTURES=yes.`,
    );
  }
}

// Every table that hangs off a visit, children before parents. Shared by the
// per-run ledger and the orphan sweep so the two can never drift apart and
// leave one of them deleting a parent while its children remain.
//
// G4.5d5b-3 — PRESCRIPTIONS AND VISITS ARE SOFT-CLOSED, NOT DELETED.
//
// `label_prints` is append-only: no UPDATE, DELETE or TRUNCATE policy under
// FORCE row-level security, and those privileges revoked from the owning role
// as well. It references `prescriptions` ON DELETE RESTRICT, and PostgreSQL's
// referential-integrity check locks the referencing rows — which needs one of
// exactly the privileges that were revoked.
//
// The consequence is broader than it first looks, and was measured rather than
// assumed: a prescription with ZERO label prints still cannot be deleted,
// because the check runs regardless of whether it matches anything. Visits
// inherit that through their own prescriptions.
//
// That is the audit guarantee working, and it costs nothing in production —
// prescriptions have always been soft-deleted there (`deletedAt`), and no
// application route hard-deletes a visit. It costs this helper the ability to
// erase them, so it stops pretending otherwise: the rows are closed and
// tagged, which is what `sweepOrphanedFixtures` and the FIXTURE_TAG prefixes
// exist to make identifiable.
function visitDeleteStatements(idList: string): string[] {
  return [
    `DELETE FROM clinical_note_revisions WHERE note_id IN (SELECT id FROM clinical_notes WHERE visit_id IN (${idList}))`,
    `DELETE FROM visit_observation_revisions WHERE observation_id IN (SELECT id FROM visit_observations WHERE visit_id IN (${idList}))`,
    `DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${idList}))`,
    `DELETE FROM invoices WHERE visit_id IN (${idList})`,
    `DELETE FROM attachments WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${idList}))`,
    `DELETE FROM chat_messages WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${idList}))`,
    `UPDATE prescriptions SET deleted_at = now(), status = 'CANCELLED' WHERE visit_id IN (${idList})`,
    `DELETE FROM order_services WHERE visit_id IN (${idList})`,
    `DELETE FROM diagnoses WHERE visit_id IN (${idList})`,
    `DELETE FROM documents WHERE visit_id IN (${idList})`,
    `DELETE FROM clinical_notes WHERE visit_id IN (${idList})`,
    `DELETE FROM visit_observations WHERE visit_id IN (${idList})`,
    `DELETE FROM visit_attachments WHERE visit_id IN (${idList})`,
    `UPDATE queue_tickets SET status = 'COMPLETED' WHERE visit_id IN (${idList})`,
    `UPDATE visits SET check_out_at = COALESCE(check_out_at, now()) WHERE id IN (${idList})`,
    `UPDATE patients SET deleted_at = now()
      WHERE id IN (SELECT patient_id FROM visits WHERE id IN (${idList}))`,
  ];
}

// Complaint prefixes that identify a fixture visit. FIXTURE_TAG is what new
// runs write; the rest are the untagged complaints earlier versions of these
// scripts used, kept so the debris they already left can be swept up too.
const FIXTURE_COMPLAINT_PREFIXES = [FIXTURE_TAG, 'G0a ', 'G0b ', 'G0 '];

/**
 * Retire fixture visits left behind by an interrupted or pre-cleanup run.
 *
 * Matches only on the fixture complaint prefixes above, so it can never touch
 * a visit a human created. Files for any attachments on those visits cannot be
 * removed here (that needs the API), so it reports what it found instead of
 * pretending the disk is clean.
 */
export async function sweepOrphanedFixtures(prisma: PrismaClient, tenantId: string): Promise<number> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const where = FIXTURE_COMPLAINT_PREFIXES.map((p) => `presenting_complaint LIKE '${p}%'`).join(' OR ');
    const rows = await tx.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM visits WHERE ${where}`);
    if (rows.length === 0) return 0;

    const list = rows.map((r) => `'${r.id}'`).join(',');
    for (const sql of visitDeleteStatements(list)) {
      await tx.$executeRawUnsafe(sql);
    }
    return rows.length;
  });
}

const UPLOADS_ROOT = process.env.UPLOADS_DIR ?? path.join(process.cwd(), 'uploads');

export interface FixturePatientRecord {
  patientId: string;
  patientName: string;
  visitIds: string[];
  visitNumbers: string[];
  filePaths: string[];
}

/**
 * D-072 — find, and optionally retire, fixture data identified by the PATIENT
 * name tag.
 *
 * `sweepOrphanedFixtures` matches on the presenting complaint, which works for
 * scripts that clean up after themselves. It does not work for a deliberately
 * long-lived review record: `g45-canvas-populate.ts` writes a real complaint
 * ("Fever and cough for 3 days") because a reviewer has to read a realistic
 * record, and a complaint reading "KUWICK-FIXTURE …" would defeat the point.
 *
 * The patient NAME still carries the tag, is visible in the record header, and
 * is what makes the data unmistakably test data. So retirement keys on that.
 *
 * `dryRun` is the default at every call site. Deleting clinical rows is not
 * something a script should do because it was run, only because it was run and
 * then confirmed.
 */
export async function findFixturePatients(
  prisma: PrismaClient,
  tenantId: string,
  namePrefix: string,
): Promise<FixturePatientRecord[]> {
  if (!namePrefix.startsWith(FIXTURE_TAG)) {
    // A prefix that is not the fixture tag could match a real patient. There
    // is no version of this that is worth being flexible about.
    throw new Error(`Refusing to search on "${namePrefix}" — it must start with ${FIXTURE_TAG}.`);
  }

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    const patients = await tx.$queryRawUnsafe<{ id: string; name: string }[]>(
      `SELECT id, name FROM patients WHERE tenant_id = '${tenantId}' AND name LIKE '${namePrefix}%' ORDER BY name`,
    );

    const out: FixturePatientRecord[] = [];
    for (const patient of patients) {
      const visits = await tx.$queryRawUnsafe<{ id: string; visit_number: string }[]>(
        `SELECT id, visit_number FROM visits WHERE patient_id = '${patient.id}' ORDER BY visit_number`,
      );
      const list = visits.length > 0 ? visits.map((v) => `'${v.id}'`).join(',') : `'00000000-0000-0000-0000-000000000000'`;
      const files = await tx.$queryRawUnsafe<{ file_path: string }[]>(
        `SELECT file_path FROM visit_attachments WHERE visit_id IN (${list})
         UNION ALL
         SELECT file_path FROM attachments
          WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${list}))`,
      );
      out.push({
        patientId: patient.id,
        patientName: patient.name,
        visitIds: visits.map((v) => v.id),
        visitNumbers: visits.map((v) => v.visit_number),
        filePaths: files.map((f) => f.file_path),
      });
    }
    return out;
  });
}

/**
 * Retire the records `findFixturePatients` returned.
 *
 * Uses the SAME `visitDeleteStatements` ordering as the per-run ledger and the
 * orphan sweep, so a third deletion path cannot drift from the other two and
 * leave a parent deleted with its children behind.
 *
 * G4.5d5b-3 — "retire" is now literal rather than loose. Clinical detail
 * (notes, observations, diagnoses, documents, invoices, attachments and their
 * files) is deleted as before; the visit, its prescriptions, its queue ticket
 * and the patient are CLOSED and tagged, because `label_prints` is append-only
 * and holds the prescriptions in place. See `visitDeleteStatements`. The
 * patient delete below therefore no-ops while any visit survives, which is
 * correct — it was always guarded on exactly that condition.
 *
 * Visit numbers are NOT reclaimed. `visit_number_counters` is monotonic by
 * design (D-068) — that is precisely what makes deletion safe — so retiring
 * this data leaves a gap in the sequence and no collision. That is correct
 * behaviour, not residue.
 */
export async function retireFixturePatients(
  prisma: PrismaClient,
  tenantId: string,
  records: FixturePatientRecord[],
): Promise<void> {
  const visitIds = records.flatMap((r) => r.visitIds);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;

    if (visitIds.length > 0) {
      const list = visitIds.map((id) => `'${id}'`).join(',');
      for (const sql of visitDeleteStatements(list)) {
        await tx.$executeRawUnsafe(sql);
      }
    }
    for (const record of records) {
      await tx.$executeRawUnsafe(
        `DELETE FROM patients WHERE id = '${record.patientId}'
         AND NOT EXISTS (SELECT 1 FROM visits WHERE patient_id = '${record.patientId}')`,
      );
    }
  });

  // Files last and only this fixture's own, so a failed row delete above can
  // never leave a real record pointing at a file that is already gone.
  for (const filePath of records.flatMap((r) => r.filePaths)) {
    await unlink(path.join(UPLOADS_ROOT, filePath)).catch(() => undefined);
  }
}

/**
 * Tracks what a run created so it can be removed again.
 *
 * G3a (D-062) — attachments used to be cleaned up through
 * `DELETE /visits/:id/attachments/:id`, because that endpoint also unlinked
 * the file. That endpoint is gone: clinical files are never destroyed through
 * the application any more. So the ledger removes its own files directly, and
 * ONLY its own — every path it unlinks belongs to an attachment hanging off a
 * visit this run created. Nothing else on disk is touched, examined or listed.
 */
export class FixtureLedger {
  readonly visitIds: string[] = [];
  readonly patientIds: string[] = [];

  constructor(
    private readonly prisma: PrismaClient,
    private readonly apiBase: string,
    private readonly token: string,
    private readonly tenantId: string,
  ) {}

  visit(id: string): string {
    this.visitIds.push(id);
    return id;
  }

  patient(id: string): string {
    this.patientIds.push(id);
    return id;
  }

  /** Never throws — cleanup failure must not mask the real test result. */
  async cleanup(): Promise<void> {
    void this.apiBase;
    void this.token;
    if (this.visitIds.length === 0 && this.patientIds.length === 0) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${this.tenantId}, true)`;

        if (this.visitIds.length > 0) {
          const list = this.visitIds.map((id) => `'${id}'`).join(',');

          // Files first, scoped strictly to this run's own visits. If the row
          // delete below then fails, the worst case is a dangling row — never
          // a file belonging to someone else's record.
          const files = await tx.$queryRawUnsafe<{ file_path: string }[]>(
            `SELECT file_path FROM visit_attachments WHERE visit_id IN (${list})
             UNION ALL
             SELECT file_path FROM attachments
              WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${list}))`,
          );
          for (const { file_path } of files) {
            await unlink(path.join(UPLOADS_ROOT, file_path)).catch(() => undefined);
          }

          for (const sql of visitDeleteStatements(list)) {
            await tx.$executeRawUnsafe(sql);
          }
        }

        // Only patients this run created, and only if nothing else now
        // references them — never a blanket delete by name pattern.
        for (const patientId of this.patientIds) {
          await tx.$executeRawUnsafe(
            `DELETE FROM patients WHERE id = '${patientId}'
             AND NOT EXISTS (SELECT 1 FROM visits WHERE patient_id = '${patientId}')`,
          );
        }
      });
    } catch (error) {
      console.warn(`  cleanup: ${(error as Error).message}`);
    }
  }
}
