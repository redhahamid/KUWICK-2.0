-- PHASE 6 — PUBLIC BOOKING MEDIA LIVES IN THE DATABASE.
--
-- Service photos and booking-page logos were URL-only: a clinic needed
-- somewhere else to host an image before its own booking page could show
-- one. This table stores the bytes here instead — deliberately in Postgres,
-- because Railway's container filesystem is ephemeral (a redeploy would
-- blank every photo) and a volume or object store is deployment surgery a
-- handful of ≤2 MB images does not justify. Backups carry them; RLS guards
-- them.
--
-- NO second (public) policy on this table. Public serving resolves the
-- tenant through the booking page's slug bootstrap exactly like every other
-- public read, so `clinic_booking_pages` remains the only table with a
-- public policy. Hand-authored, additive only.

CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_staff_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "media_assets_tenant_id_kind_idx" ON "media_assets"("tenant_id", "kind");

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_created_by_staff_id_fkey"
    FOREIGN KEY ("created_by_staff_id") REFERENCES "staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A shelf of small pictures, enforced where lying is hardest.
ALTER TABLE "media_assets"
    ADD CONSTRAINT "media_assets_size_sane"
    CHECK ("byte_size" > 0 AND "byte_size" <= 2097152);

ALTER TABLE "media_assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "media_assets" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "media_assets"
    USING ("tenant_id" = current_setting('app.tenant_id', true));
