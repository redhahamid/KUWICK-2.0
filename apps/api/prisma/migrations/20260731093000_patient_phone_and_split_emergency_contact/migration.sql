-- Clinical 1a Phase 1: the audited kuwick.com Patient header card shows
-- Phone, and the Documents merge-token list has separate "Emergency
-- Contact Name" and "Emergency Contact Phone" tokens — the original single
-- emergency_contact column can't represent that.

ALTER TABLE "patients" ADD COLUMN "phone" TEXT;
ALTER TABLE "patients" ADD COLUMN "emergency_contact_name" TEXT;
ALTER TABLE "patients" ADD COLUMN "emergency_contact_phone" TEXT;
ALTER TABLE "patients" DROP COLUMN "emergency_contact";
