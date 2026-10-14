-- ROSTER A3 (UAT, 14 October 2026): a branch's month of roster is published
-- before staff see it in My Kuwick, and external locum slots carry a name.
-- CreateTable
CREATE TABLE "roster_publications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,
    "published_by_staff_id" TEXT,

    CONSTRAINT "roster_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roster_locum_slots" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "shift_date" DATE NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "locum_name" TEXT NOT NULL,
    "template_id" TEXT,
    "night" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roster_locum_slots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roster_publications_tenant_id_idx" ON "roster_publications"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "roster_publications_clinic_id_month_key" ON "roster_publications"("clinic_id", "month");

-- CreateIndex
CREATE INDEX "roster_locum_slots_tenant_id_clinic_id_shift_date_idx" ON "roster_locum_slots"("tenant_id", "clinic_id", "shift_date");

-- AddForeignKey
ALTER TABLE "roster_publications" ADD CONSTRAINT "roster_publications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_publications" ADD CONSTRAINT "roster_publications_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_publications" ADD CONSTRAINT "roster_publications_published_by_staff_id_fkey" FOREIGN KEY ("published_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_locum_slots" ADD CONSTRAINT "roster_locum_slots_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_locum_slots" ADD CONSTRAINT "roster_locum_slots_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_locum_slots" ADD CONSTRAINT "roster_locum_slots_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "shift_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roster_locum_slots" ADD CONSTRAINT "roster_locum_slots_created_by_staff_id_fkey" FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Every month that already has shifts stays visible to staff: it counts as
-- published now, so nobody's roster disappears from My Kuwick.
-- provider_shifts has FORCE ROW LEVEL SECURITY, which blocks even the owner:
-- lifted for this one read, as earlier backfills did, and restored at once.
ALTER TABLE "provider_shifts" NO FORCE ROW LEVEL SECURITY;
INSERT INTO "roster_publications" ("id", "tenant_id", "clinic_id", "month", "published_at")
SELECT gen_random_uuid()::text, "tenant_id", "clinic_id", to_char("shift_date", 'YYYY-MM'), now()
FROM "provider_shifts"
GROUP BY "tenant_id", "clinic_id", to_char("shift_date", 'YYYY-MM');
ALTER TABLE "provider_shifts" FORCE ROW LEVEL SECURITY;

ALTER TABLE "roster_publications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roster_publications" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roster_publications"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

ALTER TABLE "roster_locum_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "roster_locum_slots" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "roster_locum_slots"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "roster_publications" TO kuwick_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "roster_locum_slots" TO kuwick_app;
  END IF;
END $$;
