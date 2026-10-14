-- My Kuwick (testing, 15 October 2026): an employee asks for a new bank
-- account; HR approves it before pay goes there.
ALTER TYPE "StaffFileKind" ADD VALUE IF NOT EXISTS 'BANK_PROOF';

CREATE TABLE "bank_change_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "bank_name" TEXT NOT NULL,
    "bank_account_no" TEXT NOT NULL,
    "bank_account_name" TEXT NOT NULL,
    "proof_file_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decided_by_staff_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_change_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_change_requests_tenant_id_status_idx" ON "bank_change_requests"("tenant_id", "status");
CREATE INDEX "bank_change_requests_tenant_id_staff_id_idx" ON "bank_change_requests"("tenant_id", "staff_id");

ALTER TABLE "bank_change_requests" ADD CONSTRAINT "bank_change_requests_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_change_requests" ADD CONSTRAINT "bank_change_requests_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "bank_change_requests" ADD CONSTRAINT "bank_change_requests_decided_by_staff_id_fkey" FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "bank_change_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_change_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_change_requests"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_change_requests" TO kuwick_app;
  END IF;
END $$;
