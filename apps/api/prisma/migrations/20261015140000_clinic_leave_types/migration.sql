-- Section D (14 October 2026): leave types become the clinic's own.
-- The fixed enum is turned into text IN PLACE (USING), so every existing
-- request, balance and policy row keeps its value (ANNUAL, MEDICAL, ...).
ALTER TABLE "leave_requests" ALTER COLUMN "leave_type" TYPE TEXT USING "leave_type"::text;
ALTER TABLE "leave_policy_entitlements" ALTER COLUMN "leave_type" TYPE TEXT USING "leave_type"::text;
ALTER TABLE "leave_balances" ALTER COLUMN "leave_type" TYPE TEXT USING "leave_type"::text;
DROP TYPE "LeaveType";

-- A stored balance row may now leave the entitlement to the leave type.
ALTER TABLE "leave_balances" ALTER COLUMN "entitled_days" DROP NOT NULL;

CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paid" BOOLEAN NOT NULL DEFAULT true,
    "days_per_year" DECIMAL(5,1),
    "document_required" BOOLEAN NOT NULL DEFAULT false,
    "carry_forward_cap" DECIMAL(5,1),
    "statutory" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "leave_types_tenant_id_code_key" ON "leave_types"("tenant_id", "code");

ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "leave_types" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "leave_types" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "leave_types"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "leave_types" TO kuwick_app;
  END IF;
END $$;
