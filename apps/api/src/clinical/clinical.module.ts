import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ServiceCatalogController } from './service-catalog.controller';
import { ServiceCatalogService } from './service-catalog.service';
import { VisitController } from './visit.controller';
import { VisitService } from './visit.service';
import { QueueTicketController } from './queue-ticket.controller';
import { QueueTicketService } from './queue-ticket.service';

// Clinical Operations, Phase 1a. Owns ServiceCatalog, Visit, QueueTicket,
// ClinicalNote, Diagnosis, OrderService, Prescription, Document, Invoice
// (docs/DATABASE_ARCHITECTURE.md §3) — built out phase by phase; this file
// grows as each phase lands.
@Module({
  imports: [CoreModule],
  controllers: [ServiceCatalogController, VisitController, QueueTicketController],
  providers: [ServiceCatalogService, VisitService, QueueTicketService],
  exports: [ServiceCatalogService, VisitService, QueueTicketService],
})
export class ClinicalModule {}
