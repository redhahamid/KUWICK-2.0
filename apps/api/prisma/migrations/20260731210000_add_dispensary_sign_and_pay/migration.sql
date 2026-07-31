-- Clinical Operations, Phase A6 (Dispensary workflow end-to-end). Document
-- "sign MC" and Invoice "mark as paid" steps.

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "signed_at" TIMESTAMP(3);
ALTER TABLE "documents" ADD COLUMN "signed_by_staff_id" TEXT;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_signed_by_staff_id_fkey" FOREIGN KEY ("signed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "invoices" ADD COLUMN "payment_method" TEXT;
