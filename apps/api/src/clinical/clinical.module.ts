import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ServiceCatalogController } from './service-catalog.controller';
import { ServiceCatalogService } from './service-catalog.service';
import { VisitController } from './visit.controller';
import { VisitService } from './visit.service';
import { QueueTicketController } from './queue-ticket.controller';
import { QueueTicketService } from './queue-ticket.service';
import { ClinicalNoteController } from './clinical-note.controller';
import { ClinicalNoteService } from './clinical-note.service';
import { DiagnosisController } from './diagnosis.controller';
import { DiagnosisCatalogController } from './diagnosis-catalog.controller';
import { DiagnosisService } from './diagnosis.service';
import { OrderServiceController } from './order-service.controller';
import { ProcedureQueueController } from './procedure-queue.controller';
import { OrderServiceService } from './order-service.service';
import { PrescriptionController } from './prescription.controller';
import { PrescriptionService } from './prescription.service';
import { PanelClinicController } from './panel-clinic.controller';
import { PanelClinicService } from './panel-clinic.service';
import { DocumentController } from './document.controller';
import { DocumentService } from './document.service';
import { InvoiceController } from './invoice.controller';
import { InvoiceService } from './invoice.service';
import { FormTemplateController } from './form-template.controller';
import { FormTemplateService } from './form-template.service';
import { PanelPricingController } from './panel-pricing.controller';
import { PanelPricingService } from './panel-pricing.service';
import { ClaimBatchController } from './claim-batch.controller';
import { ClaimBatchService } from './claim-batch.service';

// Clinical Operations, Phase 1a. Owns ServiceCatalog, Visit, QueueTicket,
// ClinicalNote, Diagnosis, OrderService, Prescription, Document, Invoice
// (docs/DATABASE_ARCHITECTURE.md §3) — built out phase by phase; this file
// grows as each phase lands.
@Module({
  imports: [CoreModule],
  controllers: [
    ServiceCatalogController,
    VisitController,
    QueueTicketController,
    ClinicalNoteController,
    DiagnosisController,
    DiagnosisCatalogController,
    OrderServiceController,
    ProcedureQueueController,
    PrescriptionController,
    PanelClinicController,
    DocumentController,
    InvoiceController,
    FormTemplateController,
    PanelPricingController,
    ClaimBatchController,
  ],
  providers: [
    ServiceCatalogService,
    VisitService,
    QueueTicketService,
    ClinicalNoteService,
    DiagnosisService,
    OrderServiceService,
    PrescriptionService,
    PanelClinicService,
    DocumentService,
    InvoiceService,
    FormTemplateService,
    PanelPricingService,
    ClaimBatchService,
  ],
  exports: [
    ServiceCatalogService,
    VisitService,
    QueueTicketService,
    ClinicalNoteService,
    DiagnosisService,
    OrderServiceService,
    PrescriptionService,
    PanelClinicService,
    DocumentService,
    InvoiceService,
    FormTemplateService,
    PanelPricingService,
    ClaimBatchService,
  ],
})
export class ClinicalModule {}
