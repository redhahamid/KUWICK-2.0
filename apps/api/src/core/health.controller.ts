import { Controller, Get, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { BUILD_SHA } from './build-info';
import { assessCatalogue, CatalogueHealth } from './catalogue-health';

@Controller('health')
export class HealthController implements OnModuleInit {
  private readonly logger = new Logger('Health');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Say it at BOOT, not only when asked. An unusable clinic that waits to be
   * queried is an unusable clinic nobody noticed — which is exactly how
   * staging ran for weeks with one diagnosis in it.
   */
  async onModuleInit() {
    try {
      const health = await this.catalogueHealth();
      if (health.ok) {
        this.logger.log(
          `Clinical catalogue: ${health.diagnoses} diagnoses, ${health.medications} medications.`,
        );
      } else {
        this.logger.error(health.warning);
      }
    } catch (error) {
      // A boot-time check must never be the reason the API fails to start.
      this.logger.warn(`Could not read the clinical catalogue at startup: ${String(error)}`);
    }
  }

  @Get()
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
    // The deployed commit, so "which build is this?" is a curl, not a
    // guessing game across the owner, the repo and the Railway dashboard.
    // The catalogue, so "why is the diagnosis box empty?" is the same curl.
    return {
      status: 'ok',
      database: 'connected',
      build: BUILD_SHA,
      catalogue: await this.catalogueHealth().catch(() => null),
    };
  }

  /**
   * Counted ACROSS tenants deliberately: this is a deployment-level question
   * ("was anything ever loaded into this database?"), asked before any
   * request context exists, so there is no tenant to scope to. It returns
   * counts only — never a row, never a name.
   */
  private async catalogueHealth(): Promise<CatalogueHealth> {
    const [diagnoses, medications] = await Promise.all([
      this.prisma.diagnosisCatalog.count(),
      this.prisma.item.count({ where: { category: 'Medication' } }),
    ]);
    return assessCatalogue({ diagnoses, medications });
  }
}
