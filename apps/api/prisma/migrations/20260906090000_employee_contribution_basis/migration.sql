-- THE EMPLOYER'S SELECTED CONTRIBUTION BASIS — a preference, never an
-- assessment.
--
-- Which components ARE a scheme's wages is the pay-component catalogue's
-- question. This table answers which of those wages the employer has CHOSEN
-- to contribute on: per employee, per scheme (EPF only accepts one today),
-- effective-dated like the salary beside it. No backfill on purpose — an
-- employee with no row contributes on everything the assessment marks
-- liable, which is exactly what every run did yesterday.

CREATE TYPE "ContributionBasisMode" AS ENUM ('BASIC_ONLY', 'BASIC_PLUS_SELECTED', 'ALL_APPLICABLE');

CREATE TABLE "employee_contribution_bases" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "scheme" TEXT NOT NULL DEFAULT 'EPF',
    "mode" "ContributionBasisMode" NOT NULL,
    "included_component_codes" TEXT[],
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "note" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_contribution_bases_pkey" PRIMARY KEY ("id")
);

-- NOT unique on (staff, scheme, effective_from): a same-day re-record
-- SUPERSEDES the earlier row (closed into an empty interval that resolution
-- ignores and history keeps), so a selection tried and reverted inside one
-- month leaves a truthful trail instead of a dead end.
CREATE INDEX "employee_contribution_bases_staff_id_scheme_effective_from_idx"
    ON "employee_contribution_bases"("staff_id", "scheme", "effective_from");
CREATE INDEX "employee_contribution_bases_tenant_id_staff_id_effective_fr_idx"
    ON "employee_contribution_bases"("tenant_id", "staff_id", "effective_from");

ALTER TABLE "employee_contribution_bases" ADD CONSTRAINT "employee_contribution_bases_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_contribution_bases" ADD CONSTRAINT "employee_contribution_bases_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_contribution_bases" ADD CONSTRAINT "employee_contribution_bases_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ROW-LEVEL SECURITY. Same shape as every other tenant-scoped table: the app
-- role is not a superuser and reads nothing outside its tenant.
ALTER TABLE "employee_contribution_bases" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_contribution_bases" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_contribution_bases"
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_contribution_bases" TO kuwick_app;
  END IF;
END $$;
