-- ===========================================================================
-- ADMIN PROGRAMME — WAVE 5: OPERATIONS ANALYTICS
--
-- Additive only, and nothing is seeded. A tenant that configures no segments
-- gets a segment report that says "no segments configured" — never five
-- invented ones, and never a clinical indicator derived from data the clinic
-- does not record.
-- ===========================================================================


-- CreateTable
CREATE TABLE "business_segments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "colour" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_mapping_rules" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "segment_id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "service_catalog_id" TEXT,
    "item_id" TEXT,
    "item_category" TEXT,
    "service_category" TEXT,
    "description_match" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "segment_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clinic_programmes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "service_catalog_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "item_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diagnosis_codes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clinic_programmes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "programme_enrolments" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "programme_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    "enrolled_at" DATE NOT NULL,
    "exited_at" DATE,
    "exit_reason" TEXT,
    "notes" TEXT,
    "enrolled_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "programme_enrolments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_audiences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "criteria" JSONB NOT NULL,
    "notes" TEXT,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_audiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "placeholders" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "category" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketing_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_dispatches" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "template_id" TEXT,
    "patient_id" TEXT NOT NULL,
    "audience_name" TEXT,
    "rendered_body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARED',
    "opened_at" TIMESTAMP(3),
    "prepared_by_staff_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_segments_tenant_id_active_idx" ON "business_segments"("tenant_id", "active");

-- CreateIndex
CREATE UNIQUE INDEX "business_segments_tenant_id_code_key" ON "business_segments"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "segment_mapping_rules_tenant_id_priority_idx" ON "segment_mapping_rules"("tenant_id", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "clinic_programmes_tenant_id_code_key" ON "clinic_programmes"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "programme_enrolments_tenant_id_programme_id_exited_at_idx" ON "programme_enrolments"("tenant_id", "programme_id", "exited_at");

-- CreateIndex
CREATE UNIQUE INDEX "programme_enrolments_programme_id_patient_id_enrolled_at_key" ON "programme_enrolments"("programme_id", "patient_id", "enrolled_at");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_audiences_tenant_id_name_key" ON "marketing_audiences"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_templates_tenant_id_name_key" ON "marketing_templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "marketing_dispatches_tenant_id_created_at_idx" ON "marketing_dispatches"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "marketing_dispatches_tenant_id_patient_id_idx" ON "marketing_dispatches"("tenant_id", "patient_id");

-- AddForeignKey
ALTER TABLE "business_segments" ADD CONSTRAINT "business_segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_mapping_rules" ADD CONSTRAINT "segment_mapping_rules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segment_mapping_rules" ADD CONSTRAINT "segment_mapping_rules_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "business_segments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clinic_programmes" ADD CONSTRAINT "clinic_programmes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_enrolments" ADD CONSTRAINT "programme_enrolments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_enrolments" ADD CONSTRAINT "programme_enrolments_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "clinic_programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_enrolments" ADD CONSTRAINT "programme_enrolments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "programme_enrolments" ADD CONSTRAINT "programme_enrolments_enrolled_by_staff_id_fkey" FOREIGN KEY ("enrolled_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_audiences" ADD CONSTRAINT "marketing_audiences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_audiences" ADD CONSTRAINT "marketing_audiences_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_templates" ADD CONSTRAINT "marketing_templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_templates" ADD CONSTRAINT "marketing_templates_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_dispatches" ADD CONSTRAINT "marketing_dispatches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_dispatches" ADD CONSTRAINT "marketing_dispatches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "marketing_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_dispatches" ADD CONSTRAINT "marketing_dispatches_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_dispatches" ADD CONSTRAINT "marketing_dispatches_prepared_by_staff_id_fkey" FOREIGN KEY ("prepared_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Row-level security.
ALTER TABLE "business_segments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "business_segments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "business_segments"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "segment_mapping_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "segment_mapping_rules" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "segment_mapping_rules"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "clinic_programmes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clinic_programmes" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinic_programmes"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "programme_enrolments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programme_enrolments" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "programme_enrolments"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "marketing_audiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_audiences" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_audiences"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "marketing_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_templates" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_templates"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "marketing_dispatches" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "marketing_dispatches" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "marketing_dispatches"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- A dispatch says what was PREPARED and, at most, that a person opened
-- WhatsApp with it. There is no SENT and no DELIVERED, because Kuwick receives
-- acknowledgement of neither. The constraint keeps it that way when somebody
-- later reaches for a friendlier-sounding word.
ALTER TABLE "marketing_dispatches" ADD CONSTRAINT marketing_dispatches_honest_status
  CHECK (status IN ('PREPARED', 'OPENED'));

-- A mapping rule that matches nothing is a configuration error, and a rule with
-- no criterion at all would otherwise sit in the table looking like a rule.
ALTER TABLE "segment_mapping_rules" ADD CONSTRAINT segment_mapping_rules_has_a_criterion
  CHECK (
    service_catalog_id IS NOT NULL
    OR item_id IS NOT NULL
    OR item_category IS NOT NULL
    OR service_category IS NOT NULL
    OR description_match IS NOT NULL
  );
