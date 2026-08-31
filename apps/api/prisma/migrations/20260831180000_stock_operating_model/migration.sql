-- THE STOCK OPERATING MODEL — four things the clinic's workbooks do that Kuwick
-- could not. See docs/STOCK_LEGACY_WORKFLOW_AUDIT.md §2 and §3.
--
--  1. PROMOTIONAL PRICE. The order queue quotes a list price and a bonus price
--     and values every line at MIN(unit, bonus) x quantity. Kuwick had one
--     price and no concept of the other.
--  2. PRICE CHANGE AT GOODS-IN. The queue records "old price / new price" at
--     receipt, because the moment a cost actually changes is the moment stock
--     arrives at a different price. Kuwick had no audit of a price change at
--     all, from any source.
--  3. ACTIVATION ON RECEIPT. A new medication exists in the catalogue only once
--     it has physically arrived — the queue keeps a whole sheet for it.
--  4. NEW-ITEM REQUEST. Asking for an item that does not exist yet, which the
--     clinic runs as five columns with the approval as a text note.

-- 1 ------------------------------------------------------------------------
ALTER TABLE "purchase_order_lines" ADD COLUMN "bonus_unit_cost" DECIMAL(10,2);
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT purchase_order_lines_bonus_positive CHECK (bonus_unit_cost IS NULL OR bonus_unit_cost >= 0);

-- 3 ------------------------------------------------------------------------
ALTER TABLE "items"
  ADD COLUMN "awaiting_first_receipt" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "activated_at" TIMESTAMP(3);

-- Every item that already exists is already in use: it was activated whenever
-- it was created, and it is waiting for nothing. Backfilling `activated_at`
-- from `created_at` is the honest reading — inventing NULL would make the
-- entire catalogue look un-activated.
UPDATE "items" SET "activated_at" = "created_at" WHERE "active" = true;

-- 2 ------------------------------------------------------------------------
CREATE TABLE "item_price_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "previous_cost" DECIMAL(10,2),
    "new_cost" DECIMAL(10,2),
    "previous_sell_price" DECIMAL(10,2),
    "new_sell_price" DECIMAL(10,2),
    "source" TEXT NOT NULL,
    "goods_received_note_id" TEXT,
    "note" TEXT,
    "changed_by_staff_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "item_price_changes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "item_price_changes_tenant_item_at_idx"
  ON "item_price_changes"("tenant_id", "item_id", "changed_at");

ALTER TABLE "item_price_changes"
  ADD CONSTRAINT "item_price_changes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "item_price_changes_item_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "item_price_changes_grn_fkey" FOREIGN KEY ("goods_received_note_id") REFERENCES "goods_received_notes"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "item_price_changes_staff_fkey" FOREIGN KEY ("changed_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- APPEND-ONLY, enforced rather than asserted. A price history somebody can
-- edit is a price history that will eventually be edited to match whatever
-- number is under dispute — the same rule the payment and movement ledgers
-- already carry.
CREATE OR REPLACE FUNCTION item_price_changes_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'item_price_changes is append-only: a price history that can be edited is not a history';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER item_price_changes_append_only_trigger
  BEFORE UPDATE OR DELETE ON "item_price_changes"
  FOR EACH ROW EXECUTE FUNCTION item_price_changes_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "item_price_changes" FROM PUBLIC;

-- 4 ------------------------------------------------------------------------
CREATE TYPE "NewItemRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "new_item_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "requested_name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "comments" TEXT,
    "suggested_supplier_id" TEXT,
    "pack_size_note" TEXT,
    "indicative_cost" DECIMAL(10,2),
    "indicative_price" DECIMAL(10,2),
    "status" "NewItemRequestStatus" NOT NULL DEFAULT 'PENDING',
    "possible_duplicate_item_id" TEXT,
    "decision_note" TEXT,
    "decided_by_staff_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_item_id" TEXT,
    "requested_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "new_item_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "new_item_requests_tenant_status_idx" ON "new_item_requests"("tenant_id", "status");

ALTER TABLE "new_item_requests"
  ADD CONSTRAINT "new_item_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_clinic_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_supplier_fkey" FOREIGN KEY ("suggested_supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_duplicate_fkey" FOREIGN KEY ("possible_duplicate_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_created_item_fkey" FOREIGN KEY ("created_item_id") REFERENCES "items"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_requested_by_fkey" FOREIGN KEY ("requested_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "new_item_requests_decided_by_fkey" FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A decision has to say who made it and when. Same rule as every other
-- approval in this schema.
ALTER TABLE "new_item_requests" ADD CONSTRAINT new_item_requests_decision_is_attributed
  CHECK (status = 'PENDING' OR (decided_by_staff_id IS NOT NULL AND decided_at IS NOT NULL));

-- Tenant isolation, on the same terms as every other table in this schema.
ALTER TABLE "item_price_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "item_price_changes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "item_price_changes"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "new_item_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "new_item_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "new_item_requests"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT ON "item_price_changes" TO kuwick_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "new_item_requests" TO kuwick_app;
  END IF;
END $$;
