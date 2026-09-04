-- STAGE 3 — LINDUNG 24 JAM ON THE PAYSLIP LINE
--
-- The contribution was previously folded into `socso_employee`, which made it
-- invisible: a payslip could not say that RM44.65 of a SOCSO deduction belonged
-- to a different scheme, with a different start date, that the employee had
-- joined voluntarily and could leave.
--
-- EMPLOYEE-BORNE, so there is deliberately no employer column. The employer
-- remits this money on the employee's behalf without paying any of it, and a
-- schema that offered an employer field would invite a figure that does not
-- exist.

ALTER TABLE "payroll_lines" ADD COLUMN "lindung_employee" DECIMAL(12,2);

COMMENT ON COLUMN "payroll_lines"."lindung_employee" IS
  'LINDUNG 24 JAM (SKBBK), employee-borne. No employer share exists for this scheme.';
