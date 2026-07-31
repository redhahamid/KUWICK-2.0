import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ClinicalModule } from '../clinical/clinical.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

// Reports & Analytics, Phase 1f (docs/DEVELOPMENT_ROADMAP.md) — read-only
// aggregation over Clinical Operations' (1a/1e) and Appointment's (1b)
// tables. Imports ClinicalModule to reuse ClaimBatchService's outstanding-
// aging computation rather than duplicating it (docs/CODING_STANDARDS.md
// §3: no other module writes to another's tables directly — this module
// only reads, via each owning module's own service).
@Module({
  imports: [CoreModule, ClinicalModule],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
