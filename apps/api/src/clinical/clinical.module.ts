import { Module } from '@nestjs/common';
import { CoreModule } from '../core/core.module';
import { ServiceCatalogController } from './service-catalog.controller';
import { ServiceCatalogService } from './service-catalog.service';
import { VisitController } from './visit.controller';
import { VisitService } from './visit.service';
import { DoctorCompletionService } from './doctor-completion.service';
import { PanelBenefitService } from './panel-benefit.service';
import { BillingWorklistService } from './billing-worklist.service';
import { ConsultationTariffService } from './consultation-tariff.service';
import { QueueBoardService } from './queue-board.service';
import { DispensaryService } from './dispensary.service';
import { DispensaryBoardService } from './dispensary-board.service';
import { DispensaryController } from './dispensary.controller';
import { LabelPrintService } from './label-print.service';
import { ConsultationTariffController } from './consultation-tariff.controller';
import { VisitCompletionService } from './visit-completion.service';
import { VisitHistoryController } from './visit-history.controller';
import { VisitHistoryService } from './visit-history.service';
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
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { DocumentTemplateController } from './document-template.controller';
import { DocumentTemplateService } from './document-template.service';
import { QueueDisplayConfigService } from './queue-display-config.service';
import { PublicQueueController } from './public-queue.controller';
import { PublicQueueService } from './public-queue.service';
import { VisitAttachmentController } from './visit-attachment.controller';
import { VisitAttachmentService } from './visit-attachment.service';
import { VisitObservationController } from './visit-observation.controller';
import { VisitObservationService } from './visit-observation.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatChannelService } from './chat-channel.service';

// Clinical Operations, Phase 1a. Owns ServiceCatalog, Visit, QueueTicket,
// ClinicalNote, Diagnosis, OrderService, Prescription, Document, Invoice
// (docs/DATABASE_ARCHITECTURE.md §3) — built out phase by phase; this file
// grows as each phase lands.
@Module({
  imports: [CoreModule],
  controllers: [
    DispensaryController,
    ServiceCatalogController,
    VisitController,
    VisitHistoryController,
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
    ConsultationTariffController,
    FormTemplateController,
    PanelPricingController,
    ClaimBatchController,
    RoomController,
    PublicQueueController,
    DocumentTemplateController,
    VisitAttachmentController,
    VisitObservationController,
    ChatController,
  ],
  providers: [
    ServiceCatalogService,
    VisitService,
    DoctorCompletionService,
    PanelBenefitService,
    BillingWorklistService,
    ConsultationTariffService,
    QueueBoardService,
    DispensaryService,
    DispensaryBoardService,
    LabelPrintService,
    VisitCompletionService,
    VisitHistoryService,
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
    RoomService,
    QueueDisplayConfigService,
    PublicQueueService,
    DocumentTemplateService,
    VisitAttachmentService,
    VisitObservationService,
    ChatService,
    ChatChannelService,
  ],
  exports: [
    ServiceCatalogService,
    VisitService,
    DoctorCompletionService,
    PanelBenefitService,
    BillingWorklistService,
    ConsultationTariffService,
    QueueBoardService,
    DispensaryService,
    DispensaryBoardService,
    LabelPrintService,
    VisitCompletionService,
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
