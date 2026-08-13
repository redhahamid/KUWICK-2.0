-- b1 PHASE 1 — PRESCRIPTION REFERENCE DATA.
--
-- Five catalogues that decide what a prescription can say and what its printed
-- label says in Malay, plus the per-medicine defaults that fill the prescribing
-- form. Before this, the form asked a doctor to TYPE the frequency and the unit
-- as free text — which is how one clinic gets "TDS", "tds", "3x daily" and
-- "tiga kali" meaning the same thing on four labels, and how a patient label
-- ends up in a language the patient does not read.
--
-- THE PLATFORM MODEL. SYSTEM rows are the platform's defaults, seeded into each
-- tenant and refused by the API when a clinic tries to change them. CUSTOM rows
-- are the clinic's own. Seeded PER TENANT rather than as null-tenant globals,
-- matching `diagnosis_catalog` — the existing precedent for this exact shape —
-- so no RLS policy has to learn about rows that belong to nobody.
--
-- "RETIRE IT, NEVER DELETE IT" IS ENFORCED BY A TRIGGER, NOT BY RLS ALONE.
--
-- The obvious approach — omit the DELETE policy under FORCE ROW LEVEL SECURITY,
-- as `patient_alerts` does — was implemented, then MEASURED, and it did not
-- hold: a plain `DELETE` succeeded. RLS is not applied to a superuser, and the
-- role the application connects as is a superuser both in the local container
-- and in CI (the postgres image makes POSTGRES_USER one). `REVOKE` does not
-- help either, for the same reason it did not help `label_prints`: privileges
-- are irrelevant to a role that holds them all.
--
-- A BEFORE DELETE trigger fires for every role, superuser included, so the
-- guarantee below is true regardless of who connects. The RLS policies stay —
-- they are what enforces TENANT isolation, which is a different question — but
-- the append-only claim rests on the trigger.
--
-- Why it matters: a frequency or a unit is referenced by prescriptions already
-- dispensed and printed, and a label that cannot be reprinted because a lookup
-- row vanished is a medicolegal gap. `active = false` retires a row.

CREATE TYPE "CatalogOrigin" AS ENUM ('SYSTEM', 'CUSTOM');
CREATE TYPE "DurationUnit" AS ENUM ('DAY', 'WEEK', 'MONTH');

-- ---------------------------------------------------------------------------
-- 1A · frequencies   1B · dosage units   1C · consumption methods
-- 1D · indications   1E · stock units
-- ---------------------------------------------------------------------------

CREATE TABLE "prescription_frequencies" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "doctor_display" TEXT NOT NULL,
    "patient_label_bm" TEXT NOT NULL,
    -- NULL is a real answer: PRN and STAT have no daily count, and quantity
    -- auto-compute must SKIP them rather than read the absence as 1.
    "times_per_day" INTEGER,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'CUSTOM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prescription_frequencies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dosage_units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "system_name_en" TEXT NOT NULL,
    "patient_label_bm" TEXT NOT NULL,
    "use_case" TEXT,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'CUSTOM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dosage_units_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consumption_methods" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "method_bilingual" TEXT NOT NULL,
    "patient_instruction_bm" TEXT NOT NULL,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'CUSTOM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "consumption_methods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "indication_presets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "label_en" TEXT NOT NULL,
    "label_bm" TEXT NOT NULL,
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'CUSTOM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "indication_presets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stock_units" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Defaults to SYSTEM, unlike the others: this is the platform's list. The
    -- NUMBER beside it on the medicine is the clinic's, because only they know
    -- whether their strips hold 10 or 12.
    "origin" "CatalogOrigin" NOT NULL DEFAULT 'SYSTEM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_units_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "prescription_frequencies_tenant_id_code_key" ON "prescription_frequencies"("tenant_id", "code");
CREATE INDEX "prescription_frequencies_tenant_id_active_idx" ON "prescription_frequencies"("tenant_id", "active");
CREATE UNIQUE INDEX "dosage_units_tenant_id_system_name_en_key" ON "dosage_units"("tenant_id", "system_name_en");
CREATE INDEX "dosage_units_tenant_id_active_idx" ON "dosage_units"("tenant_id", "active");
CREATE UNIQUE INDEX "consumption_methods_tenant_id_method_bilingual_key" ON "consumption_methods"("tenant_id", "method_bilingual");
CREATE INDEX "consumption_methods_tenant_id_active_idx" ON "consumption_methods"("tenant_id", "active");
CREATE UNIQUE INDEX "indication_presets_tenant_id_label_en_key" ON "indication_presets"("tenant_id", "label_en");
CREATE INDEX "indication_presets_tenant_id_active_idx" ON "indication_presets"("tenant_id", "active");
CREATE UNIQUE INDEX "stock_units_tenant_id_name_key" ON "stock_units"("tenant_id", "name");
CREATE INDEX "stock_units_tenant_id_active_idx" ON "stock_units"("tenant_id", "active");

ALTER TABLE "prescription_frequencies" ADD CONSTRAINT "prescription_frequencies_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dosage_units" ADD CONSTRAINT "dosage_units_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consumption_methods" ADD CONSTRAINT "consumption_methods_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "indication_presets" ADD CONSTRAINT "indication_presets_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_units" ADD CONSTRAINT "stock_units_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Row-level security. SELECT / INSERT / UPDATE per tenant; NO DELETE policy,
-- so PostgreSQL refuses a hard delete outright (see the header).
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prescription_frequencies', 'dosage_units', 'consumption_methods',
    'indication_presets', 'stock_units'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_select ON %I FOR SELECT USING (tenant_id = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON %I FOR INSERT WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true))', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON %I FOR UPDATE USING (tenant_id = current_setting(''app.tenant_id'', true))', t);
    -- Kept for defence in depth against a NON-superuser role, which is what a
    -- properly provisioned production database should use. It is not what the
    -- guarantee rests on; see the trigger below.
    EXECUTE format('REVOKE DELETE, TRUNCATE ON %I FROM PUBLIC', t);
  END LOOP;
END $$;

-- The guarantee itself. Fires for every role, superuser included.
CREATE OR REPLACE FUNCTION kuwick_refuse_catalog_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Reference catalogue rows are never deleted — set active = false to retire %.%',
    TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING HINT = 'Prescriptions already printed reference these rows; a label that cannot be reprinted is a medicolegal gap.';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prescription_frequencies', 'dosage_units', 'consumption_methods',
    'indication_presets', 'stock_units'
  ]
  LOOP
    -- Statement-level as well as row-level: a `DELETE FROM ... WHERE false`
    -- matches no rows and must still be refused, so that a script which
    -- "successfully deleted nothing" cannot be read as permission to try
    -- harder. FOR EACH STATEMENT fires even when no row qualifies.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_catalog_delete()',
      t || '_no_delete', t);
    -- TRUNCATE is its own command and its own privilege, and `TRUNCATE ...
    -- CASCADE` would walk straight past a DELETE trigger. That is the exact
    -- hole the label_prints audit found; it is closed here at the same time
    -- rather than after somebody discovers it.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_catalog_delete()',
      t || '_no_truncate', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1F · per-medicine prescription defaults, and 1E's counting pair.
--
-- All nullable. A medicine with no defaults opens the prescribing form EMPTY,
-- because inventing a dose for a real drug is the one thing a default must
-- never do. Additive to the free-text doseDefault/frequencyDefault columns,
-- which still hold the imported catalogue's own values.
-- ---------------------------------------------------------------------------
ALTER TABLE "items"
    ADD COLUMN "default_dose_amount" DECIMAL(10,2),
    ADD COLUMN "default_dose_unit_id" TEXT,
    ADD COLUMN "default_frequency_id" TEXT,
    ADD COLUMN "default_duration_value" INTEGER,
    ADD COLUMN "default_duration_unit" "DurationUnit",
    ADD COLUMN "default_quantity" INTEGER,
    ADD COLUMN "default_consumption_method_id" TEXT,
    ADD COLUMN "defaults_from_seed" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "stock_unit_id" TEXT,
    ADD COLUMN "quantity_per_stock_unit" INTEGER;

ALTER TABLE "items" ADD CONSTRAINT "items_default_dose_unit_id_fkey"
    FOREIGN KEY ("default_dose_unit_id") REFERENCES "dosage_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_default_frequency_id_fkey"
    FOREIGN KEY ("default_frequency_id") REFERENCES "prescription_frequencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_default_consumption_method_id_fkey"
    FOREIGN KEY ("default_consumption_method_id") REFERENCES "consumption_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "items" ADD CONSTRAINT "items_stock_unit_id_fkey"
    FOREIGN KEY ("stock_unit_id") REFERENCES "stock_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "items_tenant_id_default_frequency_id_idx" ON "items"("tenant_id", "default_frequency_id");
