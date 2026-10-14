-- Section E (14 October 2026): claim types become the clinic's own.
-- The fixed category enum is turned into text IN PLACE, so every existing
-- claim keeps its category (MEDICAL, TRAVEL, ...).
ALTER TABLE "staff_claims" ALTER COLUMN "category" TYPE TEXT USING "category"::text;
DROP TYPE "StaffClaimCategory";

-- What was not paid and why (kilometres over the daily cap, decision 9).
ALTER TABLE "staff_claims" ADD COLUMN "unpaid_note" TEXT;

CREATE TABLE "claim_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "rate_per_unit" DECIMAL(8,2),
    "daily_unit_cap" DECIMAL(7,1),
    "receipt_required" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claim_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "claim_types_tenant_id_code_key" ON "claim_types"("tenant_id", "code");

ALTER TABLE "claim_types" ADD CONSTRAINT "claim_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "claim_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "claim_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "claim_types"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "claim_types" TO kuwick_app;
  END IF;
END $$;
