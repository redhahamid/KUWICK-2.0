-- STATUTORY STANDING BECOMES A DATED RECORD.
--
-- Every classification that decides a Malaysian statutory figure lived as a
-- mutable column on employee_profiles, so recording somebody's permanent
-- residence in September repriced March. Same failure employee_salaries was
-- built to fix, same place, figures of the same size.
--
-- The old columns are NOT dropped. Delivery plan: backfill into the first
-- version, stop reading them, and remove them only after a full period has run
-- on the new table.

CREATE TYPE "HrdRegistrationClass" AS ENUM ('MANDATORY_SECTION_14', 'OPTIONAL_SECTION_15', 'NOT_REGISTERED');

CREATE TABLE "employee_statutory_classifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "staff_id" TEXT NOT NULL,
    "epf_applicable" BOOLEAN NOT NULL DEFAULT true,
    "epf_membership" "EpfMembership",
    "epf_employee_rate" DECIMAL(4,2),
    "socso_applicable" BOOLEAN NOT NULL DEFAULT true,
    "eis_applicable" BOOLEAN NOT NULL DEFAULT true,
    "lindung_participation" "LindungParticipation",
    "pcb_applicable" BOOLEAN NOT NULL DEFAULT true,
    "tax_residence" "TaxResidence",
    "pcb_category" "PcbCategory",
    "qualifying_children" INTEGER NOT NULL DEFAULT 0,
    "disabled_self" BOOLEAN NOT NULL DEFAULT false,
    "disabled_spouse" BOOLEAN NOT NULL DEFAULT false,
    "rest_day_of_week" INTEGER,
    "overtime_contract_policy" "OvertimeContractPolicy",
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "note" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_statutory_classifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_employer_statutory_profiles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "legal_employer_id" TEXT NOT NULL,
    "hrd_registration" "HrdRegistrationClass" NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" TEXT,
    "note" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_employer_statutory_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_statutory_classifications_staff_id_effective_from_key"
    ON "employee_statutory_classifications"("staff_id", "effective_from");
CREATE INDEX "employee_statutory_classifications_tenant_id_staff_id_effect_idx"
    ON "employee_statutory_classifications"("tenant_id", "staff_id", "effective_from");
CREATE UNIQUE INDEX "legal_employer_statutory_profiles_legal_employer_id_effectiv_key"
    ON "legal_employer_statutory_profiles"("legal_employer_id", "effective_from");
CREATE INDEX "legal_employer_statutory_profiles_tenant_id_legal_employer_i_idx"
    ON "legal_employer_statutory_profiles"("tenant_id", "legal_employer_id", "effective_from");

ALTER TABLE "employee_statutory_classifications" ADD CONSTRAINT "employee_statutory_classifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_classifications" ADD CONSTRAINT "employee_statutory_classifications_staff_id_fkey"
    FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_statutory_classifications" ADD CONSTRAINT "employee_statutory_classifications_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "legal_employer_statutory_profiles" ADD CONSTRAINT "legal_employer_statutory_profiles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_employer_statutory_profiles" ADD CONSTRAINT "legal_employer_statutory_profiles_legal_employer_id_fkey"
    FOREIGN KEY ("legal_employer_id") REFERENCES "legal_employers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "legal_employer_statutory_profiles" ADD CONSTRAINT "legal_employer_statutory_profiles_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ROW-LEVEL SECURITY. Same shape as every other tenant-scoped table: the app
-- role is not a superuser and reads nothing outside its tenant.
ALTER TABLE "employee_statutory_classifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employee_statutory_classifications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "employee_statutory_classifications"
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "legal_employer_statutory_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_employer_statutory_profiles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "legal_employer_statutory_profiles"
    USING (tenant_id = current_setting('app.tenant_id', true))
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "employee_statutory_classifications" TO kuwick_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "legal_employer_statutory_profiles" TO kuwick_app;
  END IF;
END $$;

-- BACKFILL — the first version, dated from employment.
--
-- effective_from is the earlier of the hire date and the day the record was
-- created. Dating it from "now" would leave every historical period with no
-- classification in force, so a run recalculated over last March would start
-- refusing employees it paid correctly last March. The values copied here are
-- exactly what the run used yesterday, so this changes no figure — it only
-- gives that answer a date it can be held to.
INSERT INTO "employee_statutory_classifications" (
    "id", "tenant_id", "staff_id",
    "epf_applicable", "epf_membership", "epf_employee_rate",
    "socso_applicable", "eis_applicable", "lindung_participation",
    "pcb_applicable", "tax_residence", "pcb_category",
    "qualifying_children", "disabled_self", "disabled_spouse",
    "rest_day_of_week", "overtime_contract_policy",
    "effective_from", "reason", "note", "created_at"
)
SELECT
    gen_random_uuid()::text, p."tenant_id", p."staff_id",
    p."epf_applicable", p."epf_membership", p."epf_employee_rate",
    p."socso_applicable", p."eis_applicable", p."lindung_participation",
    p."pcb_applicable", p."tax_residence", p."pcb_category",
    p."qualifying_children", p."disabled_self", p."disabled_spouse",
    p."rest_day_of_week", p."overtime_contract_policy",
    LEAST(COALESCE(p."start_date", p."created_at"::date), p."created_at"::date),
    'Migrated from the employee profile',
    'The statutory standing this employee''s payroll already used, given the date it has applied from.',
    p."created_at"
FROM "employee_profiles" p;

-- The employer's HRD class. hrd_category was free text, so it is READ rather
-- than trusted: an unrecognised value becomes NOT_REGISTERED, which charges no
-- levy — and no levy is charged today either, because nothing computed one.
INSERT INTO "legal_employer_statutory_profiles" (
    "id", "tenant_id", "legal_employer_id", "hrd_registration",
    "effective_from", "reason", "note", "created_at"
)
SELECT
    gen_random_uuid()::text, e."tenant_id", e."id",
    CASE
        WHEN e."hrd_registration_no" IS NULL THEN 'NOT_REGISTERED'::"HrdRegistrationClass"
        WHEN upper(coalesce(e."hrd_category", '')) LIKE '%15%' THEN 'OPTIONAL_SECTION_15'::"HrdRegistrationClass"
        WHEN upper(coalesce(e."hrd_category", '')) LIKE '%14%' THEN 'MANDATORY_SECTION_14'::"HrdRegistrationClass"
        WHEN e."hrd_levy_rate" IS NOT NULL AND e."hrd_levy_rate" <= 0.005 THEN 'OPTIONAL_SECTION_15'::"HrdRegistrationClass"
        WHEN e."hrd_levy_rate" IS NOT NULL THEN 'MANDATORY_SECTION_14'::"HrdRegistrationClass"
        ELSE 'NOT_REGISTERED'::"HrdRegistrationClass"
    END,
    e."created_at"::date,
    'Migrated from the legal employer record',
    'Read from the free-text HRD category and levy rate that preceded this table. No levy was computed from either.',
    e."created_at"
FROM "legal_employers" e;
