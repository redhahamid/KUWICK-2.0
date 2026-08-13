import { Controller, Get, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BUILD_SHA } from './build-info';
import { CATALOGUE_TABLES, CatalogueTablesHealth, assessCatalogueTables } from './catalogue-health';
import { withSystemConnection } from './system-db';

@Controller('health')
export class HealthController implements OnModuleInit {
  private readonly logger = new Logger('Health');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Say it at BOOT, not only when asked — an unusable deployment that waits to
   * be queried is one nobody noticed, which is how staging ran for weeks with
   * one diagnosis in it.
   *
   * PHASE 0 — WHAT CHANGED AND WHY IT HAD TO. This used to COUNT catalogue rows.
   * That count was only ever correct because the application connected as a
   * superuser: `diagnosis_catalog` and `items` are tenant-scoped under RLS, so
   * without `app.tenant_id` the count is a confident ZERO. The moment the app
   * role became a real non-superuser, boot began reporting "0 diagnoses and 0
   * medications" against a database holding 162 and 236 — measured, on the very
   * first boot as `kuwick_app`.
   *
   * So boot asks a question RLS cannot filter (do the tables exist), on a
   * connection that has no tenant and never will. The per-CLINIC question —
   * "does THIS clinic have a usable catalogue?" — is answered on the
   * authenticated session, where a tenant exists. Same loud warning, moved to
   * where it is answerable.
   */
  async onModuleInit() {
    try {
      const health = await this.catalogueTables();
      if (health.ok) {
        this.logger.log('Clinical schema present. Per-clinic catalogue health is reported on sign-in.');
      } else {
        this.logger.error(health.warning);
      }
    } catch (error) {
      // A boot-time check must never be the reason the API fails to start. (The
      // superuser assertion in main.ts is a deliberate exception: it runs before
      // Nest and refusing IS its job.)
      this.logger.warn(`Could not inspect the clinical schema at startup: ${String(error)}`);
    }
  }

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    // The deployed commit, so "which build is this?" is a curl rather than a
    // guessing game across the owner, the repo and the Railway dashboard.
    return {
      status: 'ok',
      database: 'connected',
      build: BUILD_SHA,
      // Deployment-level only. This endpoint is UNAUTHENTICATED, so a per-clinic
      // fact here would be both unanswerable (no tenant) and something a
      // stranger could read.
      catalogue: await this.catalogueTables().catch(() => null),
    };
  }

  /**
   * Metadata, on the system connection: immune to row-level security because it
   * asks about the schema rather than about anybody's rows.
   */
  private async catalogueTables(): Promise<CatalogueTablesHealth> {
    const present = await withSystemConnection(async (query) => {
      const rows = await query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [[...CATALOGUE_TABLES]],
      );
      return rows.map((row) => String(row.table_name));
    });
    return assessCatalogueTables(present);
  }
}
