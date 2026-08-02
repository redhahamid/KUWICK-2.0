-- C0 closure (D-051) — auditable professional identity / signing permission.
--
-- Staff.updatedAt alone cannot answer "who granted this doctor the right to
-- sign clinical notes, and when" — the question that matters medicolegally.
-- One append-only row per changed field.
--
-- No backfill: existing professional fields were introduced minutes ago by
-- the C0 migration with fail-safe defaults and no history to reconstruct.
-- Inventing audit rows for them would be fabricated provenance.

CREATE TYPE "ProfessionalAuditField" AS ENUM (
  'PROFESSIONAL_TYPE',
  'MEDICAL_REGISTRATION_NO',
  'PROFESSIONAL_ACTIVE',
  'PROFESSIONAL_VERIFIED_AT',
  'PROFESSIONAL_VERIFIED_BY',
  'CAN_SIGN_CLINICAL_NOTES',
  'CLINICAL_SIGNING_ENABLED_AT',
  'CLINICAL_SIGNING_ENABLED_BY'
);

CREATE TABLE "staff_professional_audits" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT,
    "staff_id" TEXT NOT NULL,
    "field" "ProfessionalAuditField" NOT NULL,
    "previous_value" TEXT,
    "new_value" TEXT,
    "changed_by_staff_id" TEXT,
    "changed_by_name_snapshot" TEXT,
    "changed_by_role_snapshot" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "staff_professional_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_professional_audits_tenant_id_staff_id_changed_at_idx"
  ON "staff_professional_audits"("tenant_id", "staff_id", "changed_at");

ALTER TABLE "staff_professional_audits"
  ADD CONSTRAINT "staff_professional_audits_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_professional_audits_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "staff_professional_audits_changed_by_staff_id_fkey" FOREIGN KEY ("changed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS: explicit policy with BOTH USING and WITH CHECK before FORCE, so the
-- table is never left protected-but-policyless and a row can't be inserted
-- under another tenant's id. No backfill runs here, so ENABLE→FORCE in one
-- step is safe (nothing needs owner-bypass).
ALTER TABLE "staff_professional_audits" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "staff_professional_audits"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));
ALTER TABLE "staff_professional_audits" FORCE ROW LEVEL SECURITY;
