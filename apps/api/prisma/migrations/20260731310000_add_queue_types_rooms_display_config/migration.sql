-- Queue overhaul (D-038): 4-stream A/C/W/E numbering, rooms/stations, and
-- per-clinic waiting-room display configuration.

-- CreateEnum
CREATE TYPE "QueueType" AS ENUM ('APPOINTMENT', 'OTC', 'WALK_IN', 'EMERGENCY');

-- AlterTable
ALTER TABLE "queue_tickets" ADD COLUMN "display_number" TEXT;
ALTER TABLE "queue_tickets" ADD COLUMN "queue_type" "QueueType" NOT NULL DEFAULT 'WALK_IN';
ALTER TABLE "queue_tickets" ADD COLUMN "room_id" TEXT;

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_display_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "youtube_url" TEXT,
    "running_text" TEXT,
    "voice_name" TEXT,
    "voice_rate" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "voice_pitch" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "voice_volume" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "queue_display_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rooms_tenant_id_clinic_id_name_key" ON "rooms"("tenant_id", "clinic_id", "name");
CREATE INDEX "rooms_tenant_id_clinic_id_idx" ON "rooms"("tenant_id", "clinic_id");
CREATE UNIQUE INDEX "queue_display_configs_clinic_id_key" ON "queue_display_configs"("clinic_id");
CREATE INDEX "queue_display_configs_tenant_id_idx" ON "queue_display_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "queue_tickets" ADD CONSTRAINT "queue_tickets_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queue_display_configs" ADD CONSTRAINT "queue_display_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "queue_display_configs" ADD CONSTRAINT "queue_display_configs_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Standard tenant-isolation RLS, same as every other tenant-scoped table.
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "rooms"
  USING (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "queue_display_configs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "queue_display_configs" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "queue_display_configs"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- The public waiting-room monitor endpoint (unauthenticated, keyed by
-- clinic id) needs one bootstrap read — resolving a clinic's tenant_id from
-- its id — before it can set app.tenant_id and run every subsequent query
-- under ordinary RLS. Same narrow-escape-hatch pattern as the login
-- tenant-by-slug lookup (migration 20260731280000, D-036), extended to the
-- clinics policy only.
ALTER POLICY tenant_isolation ON "clinics"
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_tenant_scope', true) = 'true'
  );
