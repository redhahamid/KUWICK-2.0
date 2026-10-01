-- STATUTORY AND PAYSLIP, BATCH 5.
--
--   additional_pcb_cents      on top of the computed MTD each month — a CP38
--   additional_pcb_note       direction from LHDN, or the employee's own
--                             request — recorded on the dated standing so an
--                             earlier month keeps what was true then. Never
--                             added to a hand-entered PCB figure, which is the
--                             month's whole figure.
--
--   payroll_warning_acknowledgements
--                             a warning that is a POLICY DECISION rather than a
--                             monthly accident (the employer-selected EPF basis
--                             sitting below the assessment) is acknowledged
--                             once per selection per year; the months after
--                             carry a one-line note instead of the warning.
--
-- Defaulted and nullable throughout: no existing standing or run moves.
ALTER TABLE "employee_statutory_classifications"
  ADD COLUMN "additional_pcb_cents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "additional_pcb_note" TEXT;

CREATE TABLE "payroll_warning_acknowledgements" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "acknowledged_by_staff_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_warning_acknowledgements_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_warning_acknowledgements_tenant_id_code_subject_id_year_key"
  ON "payroll_warning_acknowledgements"("tenant_id", "code", "subject_id", "year");
CREATE INDEX "payroll_warning_acknowledgements_tenant_id_idx" ON "payroll_warning_acknowledgements"("tenant_id");
ALTER TABLE "payroll_warning_acknowledgements"
    ADD CONSTRAINT "payroll_warning_acknowledgements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_warning_acknowledgements"
    ADD CONSTRAINT "payroll_warning_acknowledgements_acknowledged_by_staff_id_fkey" FOREIGN KEY ("acknowledged_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_warning_acknowledgements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_warning_acknowledgements" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_warning_acknowledgements"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- The application role reads and writes the new table the moment it exists,
-- whatever the default privileges happen to be on this database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_warning_acknowledgements" TO kuwick_app;
  END IF;
END $$;
