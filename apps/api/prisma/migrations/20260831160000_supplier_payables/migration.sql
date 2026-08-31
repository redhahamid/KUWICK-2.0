-- ACCOUNTS PAYABLE — the largest gap the clinic's stock workbooks exposed.
--
-- Kuwick tracked what was ordered and what was received, and then stopped.
-- "What do we owe suppliers" had no answer in the system at all, which is why
-- the clinic runs a payable listing with ONE SHEET PER SUPPLIER, thirty of them
-- (docs/STOCK_LEGACY_WORKFLOW_AUDIT.md §5). That workbook's own roll-up sums
-- the payment-date column instead of the balance column, so the clinic's
-- headline "what we owe" figure is built from dates.
--
-- Three tables, the same shape as the panel remittance chain and for the same
-- reason: what has been paid is DERIVED from allocated payments, never typed
-- onto an invoice, so it cannot drift from the bank.

CREATE TYPE "SupplierInvoiceStatus" AS ENUM ('OPEN', 'PAID', 'DISPUTED', 'CANCELLED');

-- Supplier terms, out of spreadsheet prose and into fields. All nullable:
-- NULL means nobody has recorded it, and no invoice is called overdue against
-- a term nobody set.
ALTER TABLE "suppliers"
  ADD COLUMN "payment_term_days" INTEGER,
  ADD COLUMN "credit_limit_amount" DECIMAL(12,2),
  ADD COLUMN "delivery_sla_days" INTEGER,
  ADD COLUMN "account_reference" TEXT,
  ADD COLUMN "notes" TEXT;

CREATE TABLE "supplier_invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "invoice_date" DATE NOT NULL,
    "due_date" DATE,
    "total_amount" DECIMAL(12,2) NOT NULL,
    "tax_amount" DECIMAL(12,2),
    "status" "SupplierInvoiceStatus" NOT NULL DEFAULT 'OPEN',
    "dispute_reason" TEXT,
    "goods_received_note_id" TEXT,
    "purchase_order_id" TEXT,
    "document_url" TEXT,
    "notes" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "supplier_invoices_pkey" PRIMARY KEY ("id")
);

-- An invoice number is unique PER SUPPLIER, not globally: two suppliers issuing
-- "INV-001" in the same month is ordinary, and a global unique would reject the
-- second one for no reason.
CREATE UNIQUE INDEX "supplier_invoices_tenant_supplier_number_key"
  ON "supplier_invoices"("tenant_id", "supplier_id", "invoice_number");
CREATE INDEX "supplier_invoices_tenant_supplier_due_idx"
  ON "supplier_invoices"("tenant_id", "supplier_id", "due_date");

CREATE TABLE "supplier_payments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "supplier_id" TEXT NOT NULL,
    "paid_at" DATE NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "notes" TEXT,
    "recorded_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "supplier_payments_tenant_supplier_paid_idx"
  ON "supplier_payments"("tenant_id", "supplier_id", "paid_at");

CREATE TABLE "supplier_payment_allocations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "payment_id" TEXT NOT NULL,
    "supplier_invoice_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "supplier_payment_allocations_payment_invoice_key"
  ON "supplier_payment_allocations"("payment_id", "supplier_invoice_id");
CREATE INDEX "supplier_payment_allocations_tenant_invoice_idx"
  ON "supplier_payment_allocations"("tenant_id", "supplier_invoice_id");

ALTER TABLE "supplier_invoices"
  ADD CONSTRAINT "supplier_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_invoices_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_invoices_grn_fkey" FOREIGN KEY ("goods_received_note_id") REFERENCES "goods_received_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_invoices_po_fkey" FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_invoices_recorded_by_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payments"
  ADD CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_payments_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_payments_recorded_by_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "supplier_payment_allocations"
  ADD CONSTRAINT "supplier_payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_payment_allocations_payment_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "supplier_payment_allocations_invoice_fkey" FOREIGN KEY ("supplier_invoice_id") REFERENCES "supplier_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is never negative in this schema: direction is which table a row is in.
ALTER TABLE "supplier_invoices" ADD CONSTRAINT supplier_invoices_total_positive CHECK (total_amount > 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT supplier_payments_amount_positive CHECK (amount > 0);
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT supplier_payment_allocations_amount_positive CHECK (amount > 0);

-- A dispute has to say why. Same rule as a payment reversal: the reason is the
-- only thing that makes it auditable rather than just a status.
ALTER TABLE "supplier_invoices" ADD CONSTRAINT supplier_invoices_dispute_has_reason
  CHECK (status <> 'DISPUTED' OR dispute_reason IS NOT NULL);

-- Tenant isolation, on the same terms as every other table in this schema.
ALTER TABLE "supplier_invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_invoices" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_invoices"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payments"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "supplier_payment_allocations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supplier_payment_allocations" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "supplier_payment_allocations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- provision-app-role.sql grants on ALL TABLES and sets default privileges, but
-- only for objects the role that ran it goes on to create. Granting here too is
-- idempotent and makes a table created by a different migration runner work
-- without a re-provision. Guarded, because on a fresh database the role may not
-- exist until provisioning runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "supplier_invoices", "supplier_payments", "supplier_payment_allocations" TO kuwick_app;
  END IF;
END $$;
