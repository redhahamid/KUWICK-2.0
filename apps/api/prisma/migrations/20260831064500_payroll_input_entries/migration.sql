-- A payroll input: something a person supplies for a period that the system
-- cannot derive. Includes PCB, which this system does not calculate.
CREATE TABLE "payroll_input_entries" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "staff_id" TEXT NOT NULL,
    "period" DATE NOT NULL,
    "component_code" TEXT NOT NULL,
    "label" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "earned_period" DATE,
    "note" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payroll_input_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_input_entries_tenant_id_staff_id_period_component_co_key"
  ON "payroll_input_entries"("tenant_id", "staff_id", "period", "component_code");
CREATE INDEX "payroll_input_entries_tenant_id_period_idx"
  ON "payroll_input_entries"("tenant_id", "period");

ALTER TABLE "payroll_input_entries"
  ADD CONSTRAINT "payroll_input_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_input_entries_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_input_entries_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "payroll_input_entries_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation, on the same terms as every other table in this schema.
ALTER TABLE "payroll_input_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_input_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_input_entries"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
