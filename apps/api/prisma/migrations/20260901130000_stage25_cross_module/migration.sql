-- STAGE 2.5 — CROSS-MODULE PAYROLL INTEGRATION (structural)
--
-- ADDITIVE ONLY. Nothing is dropped and no figure any existing payroll produces
-- changes, EXCEPT that a locum engaged as a contractor stops being carried into
-- an employee payroll run — which is the point, and which is a correction
-- rather than a change of behaviour anybody was relying on.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "EngagementType" AS ENUM ('EMPLOYEE', 'CONTRACTOR');
CREATE TYPE "PaymentRoute" AS ENUM ('PAYROLL', 'FINANCE');
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'IN_PAYROLL', 'PAID', 'VOID');
CREATE TYPE "StaffClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED');
CREATE TYPE "StaffClaimCategory" AS ENUM ('MEDICAL', 'TRAVEL', 'MEAL', 'TRAINING', 'EQUIPMENT', 'PROFESSIONAL_FEE', 'OTHER');
CREATE TYPE "LocumSessionStatus" AS ENUM ('PLANNED', 'COMPLETED', 'APPROVED', 'CANCELLED');

-- ---------------------------------------------------------------------------
-- 1. ENGAGEMENT — employee or contractor.
--
-- `employment_type = 'LOCUM'` conflated a locum who IS an employee paid hourly
-- with a self-employed locum invoicing for sessions. EPF, SOCSO, EIS and PCB
-- apply to the first and not the second.
--
-- The backfill treats existing LOCUM rows as CONTRACTOR, which is the reading
-- the seeded data and the clinic's own spreadsheet already use (they carry
-- epf_applicable = false). A clinic that genuinely employs its locum changes
-- the engagement deliberately, and that change is audited.
-- ---------------------------------------------------------------------------
ALTER TABLE "employee_profiles"
  ADD COLUMN "engagement" "EngagementType" NOT NULL DEFAULT 'EMPLOYEE';

UPDATE "employee_profiles"
   SET "engagement" = 'CONTRACTOR'
 WHERE "employment_type" = 'LOCUM';

-- ---------------------------------------------------------------------------
-- 2. STAFF CLAIMS — the workflow behind a reimbursement.
-- ---------------------------------------------------------------------------
CREATE TABLE "staff_claims" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "clinic_id" TEXT,
  "staff_id" TEXT NOT NULL,
  "category" "StaffClaimCategory" NOT NULL,
  "amount_claimed" DECIMAL(12,2) NOT NULL,
  "amount_approved" DECIMAL(12,2),
  "claim_date" DATE NOT NULL,
  "description" TEXT NOT NULL,
  "status" "StaffClaimStatus" NOT NULL DEFAULT 'DRAFT',
  "submitted_by_staff_id" TEXT NOT NULL,
  "submitted_at" TIMESTAMP(3),
  "decided_by_staff_id" TEXT,
  "decided_at" TIMESTAMP(3),
  "decision_reason" TEXT,
  "payment_route" "PaymentRoute",
  "payout_status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "payroll_period" DATE,
  "payroll_input_entry_id" TEXT,
  "finance_reference" TEXT,
  "paid_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staff_claims_pkey" PRIMARY KEY ("id")
);

-- THE DUPLICATE GUARD. One claim backs at most one payroll input, so a second
-- materialisation fails on the constraint rather than quietly paying twice.
CREATE UNIQUE INDEX "staff_claims_payroll_input_entry_id_key"
  ON "staff_claims"("payroll_input_entry_id");
CREATE INDEX "staff_claims_tenant_staff_status_idx" ON "staff_claims"("tenant_id", "staff_id", "status");
CREATE INDEX "staff_claims_tenant_status_payout_idx" ON "staff_claims"("tenant_id", "status", "payout_status");
CREATE INDEX "staff_claims_tenant_period_idx" ON "staff_claims"("tenant_id", "payroll_period");

ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_submitted_by_staff_id_fkey"
  FOREIGN KEY ("submitted_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_decided_by_staff_id_fkey"
  FOREIGN KEY ("decided_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_payroll_input_entry_id_fkey"
  FOREIGN KEY ("payroll_input_entry_id") REFERENCES "payroll_input_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A claim cannot be in payroll without naming the input that carries it, and
-- cannot name one unless its route is PAYROLL. Enforced here rather than only
-- in the service, because "paid twice" survives a code review more easily than
-- it survives a constraint.
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_payroll_route_consistent"
  CHECK (
    ("payroll_input_entry_id" IS NULL AND "payout_status" <> 'IN_PAYROLL')
    OR ("payroll_input_entry_id" IS NOT NULL AND "payment_route" = 'PAYROLL')
  );

-- An approved amount is required once approved, and forbidden before.
ALTER TABLE "staff_claims" ADD CONSTRAINT "staff_claims_approved_amount_present"
  CHECK (("status" = 'APPROVED') = ("amount_approved" IS NOT NULL));

CREATE TABLE "staff_claim_attachments" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_claim_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "file_path" TEXT NOT NULL,
  "mime_type" TEXT NOT NULL,
  "file_size" INTEGER NOT NULL,
  "uploaded_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_claim_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_claim_attachments_tenant_claim_idx" ON "staff_claim_attachments"("tenant_id", "staff_claim_id");
ALTER TABLE "staff_claim_attachments" ADD CONSTRAINT "staff_claim_attachments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claim_attachments" ADD CONSTRAINT "staff_claim_attachments_staff_claim_id_fkey"
  FOREIGN KEY ("staff_claim_id") REFERENCES "staff_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_claim_attachments" ADD CONSTRAINT "staff_claim_attachments_uploaded_by_staff_id_fkey"
  FOREIGN KEY ("uploaded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "staff_claim_events" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "staff_claim_id" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "detail" TEXT,
  "from_status" "StaffClaimStatus",
  "to_status" "StaffClaimStatus",
  "actor_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_claim_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_claim_events_tenant_claim_idx" ON "staff_claim_events"("tenant_id", "staff_claim_id");
ALTER TABLE "staff_claim_events" ADD CONSTRAINT "staff_claim_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "staff_claim_events" ADD CONSTRAINT "staff_claim_events_staff_claim_id_fkey"
  FOREIGN KEY ("staff_claim_id") REFERENCES "staff_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "staff_claim_events" ADD CONSTRAINT "staff_claim_events_actor_staff_id_fkey"
  FOREIGN KEY ("actor_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 3. LOCUM SESSIONS — a payable, never a payslip.
-- ---------------------------------------------------------------------------
CREATE TABLE "locum_sessions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "clinic_id" TEXT NOT NULL,
  "staff_id" TEXT NOT NULL,
  "session_date" DATE NOT NULL,
  "label" TEXT,
  "hours" DECIMAL(6,2),
  "hourly_rate" DECIMAL(10,2),
  "session_fee" DECIMAL(12,2),
  "status" "LocumSessionStatus" NOT NULL DEFAULT 'PLANNED',
  "approved_amount" DECIMAL(12,2),
  "approved_by_staff_id" TEXT,
  "approved_at" TIMESTAMP(3),
  "payment_route" "PaymentRoute" NOT NULL DEFAULT 'FINANCE',
  "payout_status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "invoice_reference" TEXT,
  "paid_at" TIMESTAMP(3),
  "note" TEXT,
  "created_by_staff_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "locum_sessions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "locum_sessions_tenant_staff_date_idx" ON "locum_sessions"("tenant_id", "staff_id", "session_date");
CREATE INDEX "locum_sessions_tenant_status_payout_idx" ON "locum_sessions"("tenant_id", "status", "payout_status");

ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_clinic_id_fkey"
  FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_staff_id_fkey"
  FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_approved_by_staff_id_fkey"
  FOREIGN KEY ("approved_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_created_by_staff_id_fkey"
  FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A contractor's fee never routes through payroll. The invariant is in the
-- data, not only in the service that writes it.
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_never_payroll"
  CHECK ("payment_route" = 'FINANCE');
ALTER TABLE "locum_sessions" ADD CONSTRAINT "locum_sessions_approved_amount_present"
  CHECK (("status" = 'APPROVED') = ("approved_amount" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- 3b. PAYROLL INPUT IDENTITY — component AND upstream row.
--
-- Stage 1/2 added a partial unique index on
-- (tenant, staff, period, component_code, source_record_id)
-- WHERE source_record_id IS NOT NULL, so that two imports of the same
-- attendance row cannot pay somebody twice. But the ORIGINAL four-column
-- unique key survived alongside it, and that one still says a component may
-- appear at most once per person per period — so two approved claims in the
-- same month collide, and the second silently overwrites the first.
--
-- Replaced by two partial indexes that together say what was meant:
--   derived inputs are unique on their upstream row (already true);
--   hand-keyed inputs are unique on the component, as before.
-- ---------------------------------------------------------------------------
ALTER TABLE "payroll_input_entries"
  DROP CONSTRAINT IF EXISTS "payroll_input_entries_tenant_id_staff_id_period_component_co_ke";
DROP INDEX IF EXISTS "payroll_input_entries_tenant_id_staff_id_period_component_co_ke";

CREATE UNIQUE INDEX "payroll_input_entries_manual_key"
  ON "payroll_input_entries"("tenant_id", "staff_id", "period", "component_code")
  WHERE "source_record_id" IS NULL;

-- ---------------------------------------------------------------------------
-- 4. Row-level security. Same shape as every other tenant-scoped table.
-- ---------------------------------------------------------------------------
ALTER TABLE "staff_claims" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_claims" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_claims"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "staff_claim_attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_claim_attachments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_claim_attachments"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "staff_claim_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_claim_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_claim_events"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "locum_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "locum_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "locum_sessions"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- provision-app-role.sql grants on ALL TABLES and sets default privileges, but
-- only for objects the role that ran it goes on to create. Granting here too is
-- idempotent and makes a table created by a different migration runner work
-- without a re-provision. Guarded, because on a fresh database the role may not
-- exist until provisioning runs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON
      "staff_claims", "staff_claim_attachments", "staff_claim_events", "locum_sessions"
      TO kuwick_app;
  END IF;
END $$;
