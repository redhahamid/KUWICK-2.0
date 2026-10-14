-- A PAYSLIP LOOKED AT: "Mark as checked" in the payslip preview, per person
-- per run, with the gross and net it was checked at.
CREATE TABLE "payroll_payslip_checks" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payroll_run_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "gross_cents" INTEGER NOT NULL,
    "net_cents" INTEGER NOT NULL,
    "checked_by_staff_id" TEXT NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_payslip_checks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_payslip_checks_payroll_run_id_staff_id_key" ON "payroll_payslip_checks"("payroll_run_id", "staff_id");
CREATE INDEX "payroll_payslip_checks_tenant_id_idx" ON "payroll_payslip_checks"("tenant_id");
ALTER TABLE "payroll_payslip_checks"
    ADD CONSTRAINT "payroll_payslip_checks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payslip_checks"
    ADD CONSTRAINT "payroll_payslip_checks_payroll_run_id_fkey" FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_payslip_checks"
    ADD CONSTRAINT "payroll_payslip_checks_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payslip_checks"
    ADD CONSTRAINT "payroll_payslip_checks_checked_by_staff_id_fkey" FOREIGN KEY ("checked_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_payslip_checks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_payslip_checks" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_payslip_checks"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- The application role reads and writes the new table the moment it exists,
-- whatever the default privileges happen to be on this database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payslip_checks" TO kuwick_app;
  END IF;
END $$;
