-- D-048: named team channels alongside the single clinic-wide "General"
-- channel (owner: "any option group chat" beyond the one general thread).
-- ChatMessage.channelId replaces "orderServiceId null" as the signal for a
-- clinic-wide message; per-procedure chat (orderServiceId set) is
-- untouched and still has no channel.

-- pgcrypto for gen_random_uuid() in the backfill below — same
-- CREATE EXTENSION IF NOT EXISTS pattern already used for btree_gist in
-- 20260730120000_add_appointment_module.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- CreateTable
CREATE TABLE "chat_channels" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_general" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_channels_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_channels_clinic_id_name_key" ON "chat_channels"("clinic_id", "name");
CREATE INDEX "chat_channels_tenant_id_clinic_id_idx" ON "chat_channels"("tenant_id", "clinic_id");

-- AddForeignKey
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "chat_channels" ADD CONSTRAINT "chat_channels_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security — ENABLE only for now (not FORCE yet): the backfill
-- below needs the table owner to see/insert across every tenant, which
-- ENABLE-without-FORCE already allows by default (table owners bypass RLS
-- unless FORCE is added). FORCE is applied at the very end, once the
-- cross-tenant backfill is done.
ALTER TABLE "chat_channels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "chat_channels"
  USING (tenant_id = current_setting('app.tenant_id', true));

-- AddColumn
ALTER TABLE "chat_messages" ADD COLUMN "channel_id" TEXT;

-- chat_messages already has FORCE ROW LEVEL SECURITY from the D-046
-- migration, which — unlike chat_channels above — blocks even the table
-- owner. Lift it for the backfill (Postgres's own recommended fix when a
-- FORCE-RLS query "would be affected by row-level security policy"), then
-- restore it once the backfill is done.
ALTER TABLE "chat_messages" NO FORCE ROW LEVEL SECURITY;

-- Backfill: every clinic that already has clinic-wide messages
-- (order_service_id IS NULL, the old "general" signal) gets a real
-- "General" ChatChannel row, and those messages get repointed at it.
-- Clinics with no chat history yet — including every clinic created after
-- this migration — get their General channel lazily on first access
-- (ChatChannelService.listByClinic), not backfilled here.
INSERT INTO "chat_channels" ("id", "tenant_id", "clinic_id", "name", "is_general", "created_at")
SELECT gen_random_uuid()::text, "tenant_id", "clinic_id", 'General', true, now()
FROM (SELECT DISTINCT "tenant_id", "clinic_id" FROM "chat_messages" WHERE "order_service_id" IS NULL) AS clinics_with_chat;

UPDATE "chat_messages" cm
SET "channel_id" = cc."id"
FROM "chat_channels" cc
WHERE cm."order_service_id" IS NULL
  AND cm."clinic_id" = cc."clinic_id"
  AND cc."is_general" = true;

-- CreateIndex
CREATE INDEX "chat_messages_tenant_id_channel_id_created_at_idx" ON "chat_messages"("tenant_id", "channel_id", "created_at");

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "chat_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Restore full protection now that the backfill is complete.
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
ALTER TABLE "chat_channels" FORCE ROW LEVEL SECURITY;
