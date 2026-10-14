-- Clinical access on the employee record (UAT, 15 October 2026). Null: follows doctor or staff.
-- AlterTable
ALTER TABLE "staff" ADD COLUMN     "clinical_access" BOOLEAN;

