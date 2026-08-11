-- CreateEnum
CREATE TYPE "PanelVerificationStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'FAILED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "PanelCoverageType" AS ENUM ('UNLIMITED', 'VISIT_LIMIT');

-- CreateEnum
CREATE TYPE "PanelCopaymentType" AS ENUM ('NONE', 'FIXED_AMOUNT', 'PERCENTAGE');

-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_channel_id_fkey";

-- DropForeignKey
ALTER TABLE "chat_messages" DROP CONSTRAINT "chat_messages_order_service_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_notes" DROP CONSTRAINT "clinical_notes_author_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_notes" DROP CONSTRAINT "clinical_notes_clinic_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_notes" DROP CONSTRAINT "clinical_notes_signed_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "clinical_notes" DROP CONSTRAINT "clinical_notes_supersedes_note_id_fkey";

-- DropForeignKey
ALTER TABLE "documents" DROP CONSTRAINT "documents_signed_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "form_templates" DROP CONSTRAINT "form_templates_service_catalog_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_source_order_service_id_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_source_prescription_id_fkey";

-- DropForeignKey
ALTER TABLE "leave_requests" DROP CONSTRAINT "leave_requests_approved_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "order_services" DROP CONSTRAINT "order_services_form_template_id_fkey";

-- DropForeignKey
ALTER TABLE "panel_exclusions" DROP CONSTRAINT "panel_exclusions_item_id_fkey";

-- DropForeignKey
ALTER TABLE "panel_exclusions" DROP CONSTRAINT "panel_exclusions_service_catalog_id_fkey";

-- DropForeignKey
ALTER TABLE "panel_price_overrides" DROP CONSTRAINT "panel_price_overrides_item_id_fkey";

-- DropForeignKey
ALTER TABLE "panel_price_overrides" DROP CONSTRAINT "panel_price_overrides_service_catalog_id_fkey";

-- DropForeignKey
ALTER TABLE "staff_professional_audits" DROP CONSTRAINT "staff_professional_audits_changed_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_batches" DROP CONSTRAINT "stock_batches_added_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "stock_batches" DROP CONSTRAINT "stock_batches_supplier_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_observations" DROP CONSTRAINT "visit_observations_recorded_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_observations" DROP CONSTRAINT "visit_observations_updated_by_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_workflow_events" DROP CONSTRAINT "visit_workflow_events_new_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "visit_workflow_events" DROP CONSTRAINT "visit_workflow_events_previous_staff_id_fkey";

-- DropForeignKey
ALTER TABLE "visits" DROP CONSTRAINT "visits_panel_clinic_id_fkey";

-- DropForeignKey
ALTER TABLE "visits" DROP CONSTRAINT "visits_staff_id_fkey";

-- DropIndex
DROP INDEX "diagnoses_tenant_added_by_idx";

-- DropIndex
DROP INDEX "documents_tenant_authorisation_idx";

-- DropIndex
DROP INDEX "documents_tenant_visit_status_idx";

-- AlterTable
ALTER TABLE "clinical_notes" ALTER COLUMN "clinic_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "documents" ALTER COLUMN "issued_date" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "panel_exclusion_reason" TEXT,
ADD COLUMN     "panel_responsibility_amount" DECIMAL(10,2),
ADD COLUMN     "patient_responsibility_amount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "visit_number_counters" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visit_observations" ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "visits" ADD COLUMN     "panel_benefit_overridden_at" TIMESTAMP(3),
ADD COLUMN     "panel_benefit_overridden_by_staff_id" TEXT,
ADD COLUMN     "panel_benefit_override_reason" TEXT,
ADD COLUMN     "panel_copayment_type" "PanelCopaymentType",
ADD COLUMN     "panel_copayment_value" DECIMAL(10,2),
ADD COLUMN     "panel_coverage_type" "PanelCoverageType",
ADD COLUMN     "panel_member_reference" TEXT,
ADD COLUMN     "panel_original_copayment_type" "PanelCopaymentType",
ADD COLUMN     "panel_original_copayment_value" DECIMAL(10,2),
ADD COLUMN     "panel_original_coverage_type" "PanelCoverageType",
ADD COLUMN     "panel_original_verification_status" "PanelVerificationStatus",
ADD COLUMN     "panel_original_visit_limit_amount" DECIMAL(10,2),
ADD COLUMN     "panel_verification_reference" TEXT,
ADD COLUMN     "panel_verification_status" "PanelVerificationStatus",
ADD COLUMN     "panel_verified_at" TIMESTAMP(3),
ADD COLUMN     "panel_verified_by_staff_id" TEXT,
ADD COLUMN     "panel_visit_limit_amount" DECIMAL(10,2);

-- CreateIndex
CREATE INDEX "clinical_notes_tenant_id_supersedes_note_id_idx" ON "clinical_notes"("tenant_id", "supersedes_note_id");

-- RenameForeignKey
ALTER TABLE "service_catalog" RENAME CONSTRAINT "appointment_services_tenant_id_fkey" TO "service_catalog_tenant_id_fkey";

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_templates" ADD CONSTRAINT "form_templates_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_batches" ADD CONSTRAINT "stock_batches_added_by_staff_id_fkey" FOREIGN KEY ("added_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_price_overrides" ADD CONSTRAINT "panel_price_overrides_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "panel_exclusions" ADD CONSTRAINT "panel_exclusions_service_catalog_id_fkey" FOREIGN KEY ("service_catalog_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_panel_verified_by_staff_id_fkey" FOREIGN KEY ("panel_verified_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_panel_benefit_overridden_by_staff_id_fkey" FOREIGN KEY ("panel_benefit_overridden_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_panel_clinic_id_fkey" FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_workflow_events" ADD CONSTRAINT "visit_workflow_events_previous_staff_id_fkey" FOREIGN KEY ("previous_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_workflow_events" ADD CONSTRAINT "visit_workflow_events_new_staff_id_fkey" FOREIGN KEY ("new_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_staff_id_fkey" FOREIGN KEY ("author_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signed_by_staff_id_fkey" FOREIGN KEY ("signed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_supersedes_note_id_fkey" FOREIGN KEY ("supersedes_note_id") REFERENCES "clinical_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_observations" ADD CONSTRAINT "visit_observations_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_observations" ADD CONSTRAINT "visit_observations_updated_by_staff_id_fkey" FOREIGN KEY ("updated_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_professional_audits" ADD CONSTRAINT "staff_professional_audits_changed_by_staff_id_fkey" FOREIGN KEY ("changed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_services" ADD CONSTRAINT "order_services_form_template_id_fkey" FOREIGN KEY ("form_template_id") REFERENCES "form_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_order_service_id_fkey" FOREIGN KEY ("order_service_id") REFERENCES "order_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_by_staff_id_fkey" FOREIGN KEY ("signed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_order_service_id_fkey" FOREIGN KEY ("source_order_service_id") REFERENCES "order_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_source_prescription_id_fkey" FOREIGN KEY ("source_prescription_id") REFERENCES "prescriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "attachments_tenant_order_status_idx" RENAME TO "attachments_tenant_id_order_service_id_record_status_idx";

-- RenameIndex
ALTER INDEX "chat_messages_tenant_id_clinic_id_order_service_id_created_idx" RENAME TO "chat_messages_tenant_id_clinic_id_order_service_id_created__idx";

-- RenameIndex
ALTER INDEX "diagnoses_tenant_visit_status_idx" RENAME TO "diagnoses_tenant_id_visit_id_record_status_idx";

-- RenameIndex
ALTER INDEX "doctor_service_qualifications_tenant_id_staff_id_service_key" RENAME TO "doctor_service_qualifications_tenant_id_staff_id_service_id_key";

-- RenameIndex
ALTER INDEX "slot_capacity_configs_tenant_id_clinic_id_staff_id_service_key" RENAME TO "slot_capacity_configs_tenant_id_clinic_id_staff_id_service__key";

-- RenameIndex
ALTER INDEX "visit_attachments_tenant_visit_status_idx" RENAME TO "visit_attachments_tenant_id_visit_id_record_status_idx";

-- RenameIndex
ALTER INDEX "visit_workflow_events_tenant_actor_created_idx" RENAME TO "visit_workflow_events_tenant_id_actor_staff_id_created_at_idx";

-- RenameIndex
ALTER INDEX "visit_workflow_events_tenant_clinic_created_idx" RENAME TO "visit_workflow_events_tenant_id_clinic_id_created_at_idx";

-- RenameIndex
ALTER INDEX "visit_workflow_events_tenant_type_created_idx" RENAME TO "visit_workflow_events_tenant_id_event_type_created_at_idx";

-- RenameIndex
ALTER INDEX "visit_workflow_events_tenant_visit_created_idx" RENAME TO "visit_workflow_events_tenant_id_visit_id_created_at_idx";
