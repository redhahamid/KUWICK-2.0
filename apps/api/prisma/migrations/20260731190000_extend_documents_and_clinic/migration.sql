-- Clinical Operations, Phase A4 (owner feedback round 2). MC/Quarantine
-- need a date range + diagnosis + issuing doctor + issued date; Referral
-- needs a "referred to" field and the clinic's contact details for the
-- letterhead.

-- AlterEnum
ALTER TYPE "DocumentType" ADD VALUE 'QUARANTINE';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN "issued_date" DATE NOT NULL DEFAULT CURRENT_DATE;
ALTER TABLE "documents" ADD COLUMN "start_date" DATE;
ALTER TABLE "documents" ADD COLUMN "end_date" DATE;
ALTER TABLE "documents" ADD COLUMN "diagnosis_text" TEXT;
ALTER TABLE "documents" ADD COLUMN "referred_to" TEXT;

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN "phone" TEXT;
ALTER TABLE "clinics" ADD COLUMN "email" TEXT;
