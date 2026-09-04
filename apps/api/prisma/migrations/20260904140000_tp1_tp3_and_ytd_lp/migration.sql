-- P1 — TP1 AND TP3 BECOME RECORDS, AND THE CUMULATIVE YEAR STOPS LEAKING.
--
-- The MTD engine has carried the LP1/∑LP slots since it was transcribed from
-- HASiL's 2026 computerised-calculation specification — Exhibit 5's own
-- worked example includes a TP1 month — and nothing captured the forms, so
-- every month was computed "as though none had been filed" and said so.
--
--   * employee_tp1_entries — the employer's approved figure off the
--     employee's Form TP1, one row per employee-month: LP1, self-paid zakat,
--     the form's items for the record, who approved it and when. The relief
--     CATALOGUE and its annual caps stay UNVERIFIED in the register, so
--     nothing here polices caps Kuwick has no authoritative table for: the
--     employer approves the form in law, and this row is that decision.
--
--   * employee_tp3_records — a mid-year joiner's previous employment this
--     tax year, feeding the accumulators (∑Y, ∑K, X, Z, ∑LP) so cumulative
--     tax carries on from where it stood. Distinct from the opening-balance
--     import, which is THIS employer's own pre-Kuwick months; the write
--     paths refuse the overlap so the same money cannot arrive twice.
--
--   * employee_ytd.deductions_cents — the LP a month actually applied, so
--     ∑LP is read from the approved record rather than re-derived from
--     whatever TP1 rows exist today.
--
-- Two continuity defects fixed alongside (write-path changes, no DDL):
-- payroll-deducted zakat was never written to employee_ytd (always 0), so
-- the following month's Z was short; and LINDUNG's column existed and was
-- never written.

ALTER TABLE "employee_ytd" ADD COLUMN "deductions_cents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "employee_tp1_entries" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "legal_employer_id" TEXT NOT NULL,
  "period" DATE NOT NULL,
  "deductions_cents" INTEGER NOT NULL,
  "zakat_self_paid_cents" INTEGER NOT NULL DEFAULT 0,
  "items" JSONB,
  "received_date" DATE,
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_tp1_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_tp3_records" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "legal_employer_id" TEXT NOT NULL,
  "tax_year" INTEGER NOT NULL,
  "previous_employer_name" TEXT NOT NULL,
  "employment_from" DATE,
  "employment_to" DATE,
  "gross_cents" INTEGER NOT NULL,
  "epf_cents" INTEGER NOT NULL,
  "mtd_paid_cents" INTEGER NOT NULL,
  "zakat_cents" INTEGER NOT NULL DEFAULT 0,
  "deductions_cents" INTEGER NOT NULL DEFAULT 0,
  "source" TEXT NOT NULL,
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "employee_tp3_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_tp1_entries_staff_id_period_key"
  ON "employee_tp1_entries"("staff_id", "period");
CREATE INDEX "employee_tp1_entries_tenant_id_staff_id_period_idx"
  ON "employee_tp1_entries"("tenant_id", "staff_id", "period");
CREATE UNIQUE INDEX "employee_tp3_records_staff_id_tax_year_previous_employer_key"
  ON "employee_tp3_records"("staff_id", "tax_year", "previous_employer_name");
CREATE INDEX "employee_tp3_records_tenant_id_staff_id_tax_year_idx"
  ON "employee_tp3_records"("tenant_id", "staff_id", "tax_year");

ALTER TABLE "employee_tp1_entries"
  ADD CONSTRAINT "employee_tp1_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp1_entries"
  ADD CONSTRAINT "employee_tp1_entries_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp1_entries"
  ADD CONSTRAINT "employee_tp1_entries_legal_employer_id_fkey"
  FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp1_entries"
  ADD CONSTRAINT "employee_tp1_entries_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tp3_records"
  ADD CONSTRAINT "employee_tp3_records_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp3_records"
  ADD CONSTRAINT "employee_tp3_records_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp3_records"
  ADD CONSTRAINT "employee_tp3_records_legal_employer_id_fkey"
  FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_tp3_records"
  ADD CONSTRAINT "employee_tp3_records_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "employee_tp1_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_tp1_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_tp1_entries"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "employee_tp3_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_tp3_records" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_tp3_records"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_tp1_entries" TO kuwick_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_tp3_records" TO kuwick_app;
