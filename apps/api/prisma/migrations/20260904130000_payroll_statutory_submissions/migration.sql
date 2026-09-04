-- P1 — RECORDING A STATUTORY FILING, WITHOUT EVER CLAIMING ONE.
--
-- Kuwick's boundary is CALCULATE -> PREPARE -> VALIDATE -> EXPORT ->
-- RECONCILE. Submission to KWSP, PERKESO, HASiL or HRD Corp happens at the
-- authority's own portal, by a person. This table is that person writing down
-- that they did it — date, reference, actor — for one scheme of one approved
-- run, tied to the exact snapshot the figures came from.
--
-- Nothing else in the product may describe a filing as submitted. A prepared
-- listing is a document; only this row is a filing.

CREATE TABLE "payroll_statutory_submissions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "payroll_run_id" TEXT NOT NULL,
  "scheme" TEXT NOT NULL,
  "snapshot_version" INTEGER NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "submitted_date" DATE NOT NULL,
  "reference" TEXT NOT NULL,
  "note" TEXT,
  "recorded_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "payroll_statutory_submissions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_statutory_submissions_payroll_run_id_scheme_key"
  ON "payroll_statutory_submissions"("payroll_run_id", "scheme");
CREATE INDEX "payroll_statutory_submissions_tenant_id_payroll_run_id_idx"
  ON "payroll_statutory_submissions"("tenant_id", "payroll_run_id");

ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_payroll_run_id_fkey"
  FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_statutory_submissions"
  ADD CONSTRAINT "payroll_statutory_submissions_recorded_by_staff_id_fkey"
  FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_statutory_submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_statutory_submissions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_statutory_submissions"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_statutory_submissions" TO kuwick_app;
