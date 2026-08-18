import { join } from 'node:path';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * ONE-OFF: move appointment instants into the convention piece 1 established.
 *
 * BEFORE piece 1 the engine built a 09:00 clinic slot as `Date.UTC(y,m,d,9,0)`
 * — the instant 09:00Z, which is 5pm in Kuala Lumpur. The module now stores
 * real instants and renders them in the clinic's zone, so those old rows read
 * eight hours late.
 *
 * THE SHIFT IS BACKWARDS, NOT FORWARDS. A row holding 09:00Z was MEANT to be
 * 09:00 in the clinic, which is 01:00Z. Kuala Lumpur rows move by MINUS eight
 * hours. Nothing here hardcodes eight: the shift is derived per row from that
 * clinic's own `timezone`, so a clinic in another zone is corrected by its
 * own offset and a clinic already on UTC does not move at all.
 *
 *     (scheduled_start AT TIME ZONE c.timezone) AT TIME ZONE 'UTC'
 *      └─ read the stored wall clock AS the clinic's local time ...
 *                                       └─ ... and express it back in UTC.
 *
 * APPOINTMENTS ONLY. Not invoices, not visits, not stock — those are records
 * of things that happened and are corrected by looking at reality, not by
 * arithmetic. An appointment is a future operational fact: a wrong one sends a
 * patient in at the wrong hour, and correcting it is the whole point.
 *
 * RUN-ONCE. A corrected row is indistinguishable from an uncorrected one, so
 * running twice would shift twice. The run is recorded in `data_corrections`
 * and this refuses while that record stands.
 *
 *   npx tsx prisma/correct-appointment-instants.ts            # dry run
 *   npx tsx prisma/correct-appointment-instants.ts --apply
 */

config({ path: join(__dirname, '..', '.env') });

const CORRECTION = 'appointment-instants-to-clinic-zone';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

interface Preview {
  id: string;
  clinic: string;
  timezone: string;
  patient: string;
  stored: Date;
  corrected: Date;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });

  for (const tenant of tenants) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT set_config('app.tenant_id', $1, true)`, tenant.id);

      const already = await tx.dataCorrection.findFirst({ where: { name: CORRECTION } });
      if (already) {
        console.log(
          `\n=== ${tenant.name} ===\nAlready corrected on ${already.appliedAt.toISOString()} ` +
            `(${already.rowsAffected} rows). Nothing to do.`,
        );
        return;
      }

      // The cutoff is the moment piece 1's migration finished: every
      // appointment created before it was written by the old code, and every
      // one created after it was written by the new. Read from the migration
      // table rather than typed in, so nobody has to remember the deploy time.
      const [migration] = await tx.$queryRawUnsafe<{ finished_at: Date | null }[]>(
        `SELECT finished_at FROM "_prisma_migrations"
         WHERE migration_name = '20260818160000_a_clinic_can_say_when_it_is_open'`,
      );
      const cutoff = migration?.finished_at;
      if (!cutoff) {
        console.log(`\n=== ${tenant.name} ===\nPiece 1's migration has not been applied here yet. Deploy first.`);
        return;
      }

      const preview = await tx.$queryRawUnsafe<Preview[]>(
        `SELECT a."id",
                c."name"     AS clinic,
                c."timezone",
                p."name"     AS patient,
                a."scheduled_start" AS stored,
                (a."scheduled_start" AT TIME ZONE c."timezone") AT TIME ZONE 'UTC' AS corrected
         FROM "appointments" a
         JOIN "clinics"  c ON c."id" = a."clinic_id"
         JOIN "patients" p ON p."id" = a."patient_id"
         WHERE a."created_at" < $1
         ORDER BY a."scheduled_start"`,
        cutoff,
      );

      console.log(`\n=== ${tenant.name} ===`);
      console.log(`Cutoff (piece 1 deploy): ${cutoff.toISOString()}`);
      if (preview.length === 0) {
        console.log('No appointments predate the change. Nothing to correct.');
        return;
      }

      for (const row of preview.slice(0, 20)) {
        const hours = (row.stored.getTime() - row.corrected.getTime()) / 3_600_000;
        console.log(
          `  ${row.patient.padEnd(24)} ${row.stored.toISOString()} → ${row.corrected.toISOString()}` +
            `  (${hours > 0 ? '-' : '+'}${Math.abs(hours)}h, ${row.timezone})`,
        );
      }
      if (preview.length > 20) console.log(`  … and ${preview.length - 20} more`);

      if (!apply) {
        console.log(
          `\nDRY RUN — ${preview.length} appointment row${preview.length === 1 ? '' : 's'} would move. ` +
            'Nothing was changed. Re-run with --apply.',
        );
        return;
      }

      // Both ends shift together. Correcting the start alone would leave a
      // 30-minute appointment eight and a half hours long.
      const affected = await tx.$executeRawUnsafe(
        `UPDATE "appointments" a
         SET "scheduled_start" = (a."scheduled_start" AT TIME ZONE c."timezone") AT TIME ZONE 'UTC',
             "scheduled_end"   = (a."scheduled_end"   AT TIME ZONE c."timezone") AT TIME ZONE 'UTC'
         FROM "clinics" c
         WHERE c."id" = a."clinic_id" AND a."created_at" < $1`,
        cutoff,
      );

      await tx.dataCorrection.create({
        data: {
          tenantId: tenant.id,
          name: CORRECTION,
          rowsAffected: affected,
          note:
            'Appointments booked before the piece 1 timezone fix stored a wall clock as if it were UTC. ' +
            "Each row was re-expressed as the instant its wall clock names in its clinic's own zone. " +
            `Cutoff ${cutoff.toISOString()}.`,
          appliedBy: 'correct-appointment-instants.ts',
        },
      });

      console.log(`\nAPPLIED — ${affected} appointment row${affected === 1 ? '' : 's'} corrected and recorded.`);
    }, { timeout: 120_000 });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
