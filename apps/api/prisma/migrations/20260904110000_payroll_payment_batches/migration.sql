-- P1 — PAYMENT PREPARATION, AND WHAT IT MAY TRUTHFULLY CLAIM.
--
-- A payment batch is a DOCUMENT composed from an approved run's verified
-- snapshot: who is to be paid, into which account, how much. Kuwick talks to
-- no bank, so the status enum is the honesty model:
--
--   GENERATED      a document exists
--   DOWNLOADED     somebody took it
--   RECORDED_PAID  a human recorded that money moved, with a date and a
--                  reference — the ONLY state that claims a transfer
--   SUPERSEDED     regenerated after a correction or a bank-detail fix
--
-- Employees whose bank details are missing are EXCLUDED ROWS with a reason,
-- never silently dropped: the batch total plus its exclusions must equal the
-- snapshot's net total, and a batch that does not reconcile is refused at
-- generation rather than stored.
--
-- No verified bank file format is on record, so what downloads is a payment
-- INSTRUCTION LISTING for a human keying payments — labelled as such, and
-- never presented as any bank's own format (register: bank formats UNKNOWN).

CREATE TYPE "PaymentBatchStatus" AS ENUM (
  'GENERATED',
  'DOWNLOADED',
  'RECORDED_PAID',
  'SUPERSEDED'
);

CREATE TABLE "payroll_payment_batches" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "payroll_run_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "snapshot_version" INTEGER NOT NULL,
  "snapshot_hash" TEXT NOT NULL,
  "status" "PaymentBatchStatus" NOT NULL DEFAULT 'GENERATED',
  "total_cents" INTEGER NOT NULL,
  "included_count" INTEGER NOT NULL,
  "excluded_count" INTEGER NOT NULL,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "downloaded_at" TIMESTAMP(3),
  "downloaded_by_staff_id" TEXT,
  "paid_recorded_at" TIMESTAMP(3),
  "paid_recorded_by_staff_id" TEXT,
  "payment_date" TIMESTAMP(3),
  "payment_reference" TEXT,
  "note" TEXT,

  CONSTRAINT "payroll_payment_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "payroll_payment_lines" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "bank_name" TEXT,
  "bank_account_no" TEXT,
  "amount_cents" INTEGER NOT NULL,
  "included" BOOLEAN NOT NULL,
  "exclusion_reason" TEXT,

  CONSTRAINT "payroll_payment_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payroll_payment_batches_payroll_run_id_version_key"
  ON "payroll_payment_batches"("payroll_run_id", "version");
CREATE INDEX "payroll_payment_batches_tenant_id_payroll_run_id_idx"
  ON "payroll_payment_batches"("tenant_id", "payroll_run_id");
CREATE INDEX "payroll_payment_lines_tenant_id_batch_id_idx"
  ON "payroll_payment_lines"("tenant_id", "batch_id");

ALTER TABLE "payroll_payment_batches"
  ADD CONSTRAINT "payroll_payment_batches_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches"
  ADD CONSTRAINT "payroll_payment_batches_payroll_run_id_fkey"
  FOREIGN KEY ("payroll_run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_batches"
  ADD CONSTRAINT "payroll_payment_batches_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "payroll_payment_lines"
  ADD CONSTRAINT "payroll_payment_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_lines"
  ADD CONSTRAINT "payroll_payment_lines_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "payroll_payment_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_payment_lines"
  ADD CONSTRAINT "payroll_payment_lines_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ROW LEVEL SECURITY — every new table, no exceptions.

ALTER TABLE "payroll_payment_batches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_payment_batches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_payment_batches"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "payroll_payment_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_payment_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payroll_payment_lines"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- The application role reads and writes them like every other payroll table.
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payment_batches" TO kuwick_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "payroll_payment_lines" TO kuwick_app;
