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
function visitDeleteStatements(idList: string): string[] {
  return [
    `DELETE FROM clinical_note_revisions WHERE note_id IN (SELECT id FROM clinical_notes WHERE visit_id IN (${idList}))`,
    `DELETE FROM visit_observation_revisions WHERE observation_id IN (SELECT id FROM visit_observations WHERE visit_id IN (${idList}))`,
    `DELETE FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE visit_id IN (${idList}))`,
    `DELETE FROM invoices WHERE visit_id IN (${idList})`,
    `DELETE FROM attachments WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${idList}))`,
    `DELETE FROM chat_messages WHERE order_service_id IN (SELECT id FROM order_services WHERE visit_id IN (${idList}))`,
    `DELETE FROM prescriptions WHERE visit_id IN (${idList})`,
    `DELETE FROM order_services WHERE visit_id IN (${idList})`,
    `DELETE FROM diagnoses WHERE visit_id IN (${idList})`,
    `DELETE FROM documents WHERE visit_id IN (${idList})`,
    `DELETE FROM clinical_notes WHERE visit_id IN (${idList})`,
    `DELETE FROM visit_observations WHERE visit_id IN (${idList})`,
    `DELETE FROM visit_attachments WHERE visit_id IN (${idList})`,
    `DELETE FROM queue_tickets WHERE visit_id IN (${idList})`,
    `DELETE FROM visits WHERE id IN (${idList})`,
  ];
}

// Complaint prefixes that identify a fixture visit. FIXTURE_TAG is what new
// runs write; the rest are the untagged complaints earlier versions of these
// scripts used, kept so the debris they already left can be swept up too.
const FIXTURE_COMPLAINT_PREFIXES = [FIXTURE_TAG, 'G0a ', 'G0b ', 'G0 '];

/**
 * Remove fixture visits left behind by an interrupted or pre-cleanup run.
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

/**
 * Tracks what a run created so it can be removed again.
 *
 * Attachments are deleted through the API rather than the database, because
 * the endpoint also removes the file from disk — a direct row delete would
 * leave orphaned uploads accumulating under uploads/.
 */
export class FixtureLedger {
  readonly visitIds: string[] = [];
  readonly patientIds: string[] = [];
  private readonly attachments: { visitId: string; attachmentId: string }[] = [];

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

  attachment(visitId: string, attachmentId: string): void {
    this.attachments.push({ visitId, attachmentId });
  }

  /** Never throws — cleanup failure must not mask the real test result. */
  async cleanup(): Promise<void> {
    for (const { visitId, attachmentId } of this.attachments) {
      try {
        await fetch(`${this.apiBase}/visits/${visitId}/attachments/${attachmentId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${this.token}` },
        });
      } catch {
        console.warn(`  cleanup: could not delete attachment ${attachmentId}`);
      }
    }

    if (this.visitIds.length === 0 && this.patientIds.length === 0) return;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_tenant_scope', 'true', true)`;
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${this.tenantId}, true)`;

        if (this.visitIds.length > 0) {
          const list = this.visitIds.map((id) => `'${id}'`).join(',');
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
