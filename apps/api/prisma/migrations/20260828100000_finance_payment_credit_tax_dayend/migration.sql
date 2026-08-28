-- ===========================================================================
-- ADMIN PROGRAMME — WAVE 1: THE FINANCIAL MODEL
--
-- Additive only. Nothing here drops a column, rewrites an amount, or changes
-- what any existing query returns: `invoices.tax_amount` and
-- `invoice_lines.tax_amount` default to 0, and no tax code is mapped to
-- anything until a clinic configures one, so every invoice in the database
-- keeps the total it already had.
--
-- Four facts become recordable that were not:
--   payments          — money moving, more than once, on its own date
--   credit_notes      — revenue corrected without destroying what was billed
--   tax_codes/rates   — effective-dated service tax, decided per line
--   day_end_closings  — what a named person counted, against what was expected
--
-- The backfill at the bottom gives every already-settled invoice the one
-- Payment row it always implied, so "sum of payments" and
-- "invoice.patient_paid_amount" agree from the first minute rather than
-- after a cutover.
-- ===========================================================================


-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "PaymentTender" AS ENUM ('CASH', 'CARD', 'QR', 'EWALLET', 'BANK_TRANSFER', 'CHEQUE', 'PANEL', 'OTHER');

-- CreateEnum
CREATE TYPE "CreditNoteStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD_RATED', 'ZERO_RATED', 'EXEMPT');

-- CreateEnum
CREATE TYPE "DayEndStatus" AS ENUM ('OPEN', 'COUNTED', 'CLOSED');

-- AlterTable
ALTER TABLE "service_catalog" ADD COLUMN     "tax_code_id" TEXT;

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "tax_code_id" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "invoice_lines" ADD COLUMN     "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN     "tax_code_id" TEXT,
ADD COLUMN     "tax_rate_percent" DECIMAL(6,3),
ADD COLUMN     "tax_treatment" "TaxTreatment";

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "tender" "PaymentTender" NOT NULL,
    "method_label" TEXT,
    "amount" DECIMAL(10,2) NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL,
    "reference_no" TEXT,
    "received_by_staff_id" TEXT NOT NULL,
    "notes" TEXT,
    "reverses_payment_id" TEXT,
    "reversal_reason" TEXT,
    "reversed_at" TIMESTAMP(3),
    "day_end_closing_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_notes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "credit_note_number" TEXT NOT NULL,
    "invoice_id" TEXT NOT NULL,
    "status" "CreditNoteStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT NOT NULL,
    "subtotal_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_by_staff_id" TEXT NOT NULL,
    "approved_by_staff_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "issued_at" TIMESTAMP(3),
    "voided_by_staff_id" TEXT,
    "voided_at" TIMESTAMP(3),
    "void_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_note_lines" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "credit_note_id" TEXT NOT NULL,
    "invoice_line_id" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "tax_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "treatment" "TaxTreatment" NOT NULL DEFAULT 'STANDARD_RATED',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "tax_code_id" TEXT NOT NULL,
    "rate_percent" DECIMAL(6,3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "day_end_closings" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "business_date" DATE NOT NULL,
    "status" "DayEndStatus" NOT NULL DEFAULT 'OPEN',
    "expected_cash" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_card" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_qr" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_other" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "expected_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "counted_cash" DECIMAL(12,2),
    "counted_card" DECIMAL(12,2),
    "counted_qr" DECIMAL(12,2),
    "counted_other" DECIMAL(12,2),
    "variance_amount" DECIMAL(12,2),
    "variance_reason" TEXT,
    "invoice_count" INTEGER NOT NULL DEFAULT 0,
    "payment_count" INTEGER NOT NULL DEFAULT 0,
    "snapshot" JSONB,
    "counted_by_staff_id" TEXT,
    "counted_at" TIMESTAMP(3),
    "closed_by_staff_id" TEXT,
    "closed_at" TIMESTAMP(3),
    "reopened_by_staff_id" TEXT,
    "reopened_at" TIMESTAMP(3),
    "reopen_reason" TEXT,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "day_end_closings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_tenant_id_invoice_id_idx" ON "payments"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_clinic_id_received_at_idx" ON "payments"("tenant_id", "clinic_id", "received_at");

-- CreateIndex
CREATE INDEX "payments_tenant_id_day_end_closing_id_idx" ON "payments"("tenant_id", "day_end_closing_id");

-- CreateIndex
CREATE INDEX "credit_notes_tenant_id_invoice_id_idx" ON "credit_notes"("tenant_id", "invoice_id");

-- CreateIndex
CREATE INDEX "credit_notes_tenant_id_clinic_id_status_idx" ON "credit_notes"("tenant_id", "clinic_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_notes_tenant_id_credit_note_number_key" ON "credit_notes"("tenant_id", "credit_note_number");

-- CreateIndex
CREATE INDEX "credit_note_lines_tenant_id_credit_note_id_idx" ON "credit_note_lines"("tenant_id", "credit_note_id");

-- CreateIndex
CREATE INDEX "tax_codes_tenant_id_idx" ON "tax_codes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tenant_id_code_key" ON "tax_codes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "tax_rates_tenant_id_tax_code_id_effective_from_idx" ON "tax_rates"("tenant_id", "tax_code_id", "effective_from");

-- CreateIndex
CREATE INDEX "day_end_closings_tenant_id_clinic_id_business_date_idx" ON "day_end_closings"("tenant_id", "clinic_id", "business_date");

-- CreateIndex
CREATE UNIQUE INDEX "day_end_closings_tenant_id_clinic_id_business_date_key" ON "day_end_closings"("tenant_id", "clinic_id", "business_date");

-- CreateIndex
CREATE INDEX "invoice_lines_tenant_id_tax_code_id_idx" ON "invoice_lines"("tenant_id", "tax_code_id");

-- AddForeignKey
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_received_by_staff_id_fkey" FOREIGN KEY ("received_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_payment_id_fkey" FOREIGN KEY ("reverses_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_day_end_closing_id_fkey" FOREIGN KEY ("day_end_closing_id") REFERENCES "day_end_closings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_approved_by_staff_id_fkey" FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_voided_by_staff_id_fkey" FOREIGN KEY ("voided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_note_lines" ADD CONSTRAINT "credit_note_lines_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_closings" ADD CONSTRAINT "day_end_closings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_closings" ADD CONSTRAINT "day_end_closings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_closings" ADD CONSTRAINT "day_end_closings_counted_by_staff_id_fkey" FOREIGN KEY ("counted_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_closings" ADD CONSTRAINT "day_end_closings_closed_by_staff_id_fkey" FOREIGN KEY ("closed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "day_end_closings" ADD CONSTRAINT "day_end_closings_reopened_by_staff_id_fkey" FOREIGN KEY ("reopened_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- ROW-LEVEL SECURITY
--
-- Same shape as every other table in this schema (see
-- force_rls_core_foundation for why ENABLE and FORCE are both required: ENABLE
-- alone does not bind the table's owner, which is the role that runs
-- migrations). A finance table without this is a cross-tenant revenue leak.
-- ---------------------------------------------------------------------------
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "payments"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_notes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "credit_notes"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "credit_note_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_note_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "credit_note_lines"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "tax_codes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_codes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_codes"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "tax_rates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tax_rates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tax_rates"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "day_end_closings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "day_end_closings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "day_end_closings"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- ---------------------------------------------------------------------------
-- PAYMENTS ARE APPEND-ONLY, ENFORCED — not merely documented.
--
-- The same treatment visit_workflow_events and appointment_events already
-- carry (append_only_is_enforced_not_claimed, a_history_anyone_can_rewrite).
-- A money-received row that an application bug can silently rewrite is not a
-- record of anything.
--
-- TWO columns may be updated after insert, and nothing else:
--   reversed_at         — stamped when a reversal row is created against it
--   day_end_closing_id  — stamped when the day it belongs to is closed
-- Both are one-way: once set, they cannot be changed again, so a closed day
-- cannot be quietly re-attributed to a different one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION payments_append_only() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'payments is append-only: a payment is reversed, never deleted';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id
     OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.tender IS DISTINCT FROM OLD.tender
     OR NEW.method_label IS DISTINCT FROM OLD.method_label
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.received_at IS DISTINCT FROM OLD.received_at
     OR NEW.reference_no IS DISTINCT FROM OLD.reference_no
     OR NEW.received_by_staff_id IS DISTINCT FROM OLD.received_by_staff_id
     OR NEW.notes IS DISTINCT FROM OLD.notes
     OR NEW.reverses_payment_id IS DISTINCT FROM OLD.reverses_payment_id
     OR NEW.reversal_reason IS DISTINCT FROM OLD.reversal_reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'payments is append-only: only reversed_at and day_end_closing_id may be stamped after insert';
  END IF;

  IF OLD.reversed_at IS NOT NULL AND NEW.reversed_at IS DISTINCT FROM OLD.reversed_at THEN
    RAISE EXCEPTION 'payments.reversed_at is write-once';
  END IF;

  IF OLD.day_end_closing_id IS NOT NULL AND NEW.day_end_closing_id IS DISTINCT FROM OLD.day_end_closing_id THEN
    RAISE EXCEPTION 'payments.day_end_closing_id is write-once: reopen the day instead';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payments_append_only_trigger
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION payments_append_only();

-- Belt as well as braces: withdraw DELETE at the privilege level too, from
-- PUBLIC and from the migration-running owner. `provision-app-role.sql` has a
-- matching carve-out for kuwick_app, whose grants are re-asserted on every
-- deploy and would otherwise reinstate what this line withdraws.
REVOKE DELETE, TRUNCATE ON TABLE "payments" FROM PUBLIC;

-- A payment is money, and money is never negative in this schema: direction is
-- `kind`, so a signed amount here would mean the same fact could be written
-- two ways and every SUM would have to know which.
ALTER TABLE "payments" ADD CONSTRAINT payments_amount_positive CHECK (amount > 0);

-- A reversal has to say why. The reason is the only thing that makes the
-- reversal auditable rather than just a second number.
ALTER TABLE "payments" ADD CONSTRAINT payments_reversal_has_reason
  CHECK (reverses_payment_id IS NULL OR reversal_reason IS NOT NULL);

-- ---------------------------------------------------------------------------
-- BACKFILL — every invoice that has already been settled gets the Payment row
-- it always implied.
--
-- Without this, "payments received" would read zero for the entire history of
-- the clinic on the day this ships, and every reconciliation screen would show
-- a cliff at the migration date. The source is `patient_paid_amount`, which is
-- exactly what the old all-or-nothing `pay()` recorded, and `paid_at` for the
-- date. Fully panel-covered invoices collected nothing at the counter and get
-- no row: their settlement is the CLAIM, not a payment, and inventing an RM0
-- receipt for them would put a counter event in the day-end that never
-- happened.
--
-- Idempotent by construction: it inserts only where no payment row already
-- points at the invoice, so a re-run adds nothing.
-- ---------------------------------------------------------------------------
INSERT INTO "payments" (
  "id", "tenant_id", "clinic_id", "invoice_id", "kind", "tender", "method_label",
  "amount", "received_at", "received_by_staff_id", "notes", "created_at"
)
SELECT
  gen_random_uuid()::text,
  i."tenant_id",
  v."clinic_id",
  i."id",
  'PAYMENT',
  CASE upper(coalesce(i."payment_method", ''))
    WHEN 'CASH' THEN 'CASH'::"PaymentTender"
    WHEN 'CARD' THEN 'CARD'::"PaymentTender"
    WHEN 'CREDIT CARD' THEN 'CARD'::"PaymentTender"
    WHEN 'DEBIT CARD' THEN 'CARD'::"PaymentTender"
    WHEN 'QR' THEN 'QR'::"PaymentTender"
    WHEN 'DUITNOW QR' THEN 'QR'::"PaymentTender"
    WHEN 'EWALLET' THEN 'EWALLET'::"PaymentTender"
    WHEN 'E-WALLET' THEN 'EWALLET'::"PaymentTender"
    WHEN 'BANK TRANSFER' THEN 'BANK_TRANSFER'::"PaymentTender"
    WHEN 'CHEQUE' THEN 'CHEQUE'::"PaymentTender"
    WHEN 'PANEL' THEN 'PANEL'::"PaymentTender"
    ELSE 'OTHER'::"PaymentTender"
  END,
  i."payment_method",
  coalesce(i."patient_paid_amount", 0),
  coalesce(i."paid_at", i."updated_at"),
  i."created_by_staff_id",
  'Backfilled from invoice settlement (wave-1 finance migration)',
  coalesce(i."paid_at", i."updated_at")
FROM "invoices" i
JOIN "visits" v ON v."id" = i."visit_id"
WHERE i."status" = 'PAID'
  -- A fully panel-covered invoice collected exactly RM0 from the patient, and
  -- the amount CHECK above forbids a zero payment (deliberately: direction is
  -- `kind`, and a zero-amount money movement is not one). Those invoices are
  -- skipped here — `panel_covered_amount` on the invoice remains their record,
  -- and the panel side is settled through the claim, not the counter.
  AND coalesce(i."patient_paid_amount", 0) > 0
  AND NOT EXISTS (SELECT 1 FROM "payments" p WHERE p."invoice_id" = i."id");
