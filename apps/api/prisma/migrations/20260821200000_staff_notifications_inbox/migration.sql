-- PHASE 5 — THE STAFF NOTIFICATION INBOX.
--
-- One row per RECIPIENT per event worth telling them about: a new online
-- booking, a request needing approval, a patient cancelling. Not event
-- history (appointment_events stays canonical) and not notification_logs
-- (which records outbound deliveries on external channels): an inbox row
-- carries a staff recipient, a clinic, an unread marker and the appointment
-- to open.
--
-- Hand-authored, ADDITIVE ONLY. Same tenant RLS shape as every other
-- tenant-scoped table: ENABLE + FORCE + the app.tenant_id policy, so the
-- application role cannot read another tenant's inbox even by mistake.

CREATE TABLE "staff_notifications" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "recipient_staff_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "appointment_id" TEXT,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "staff_notifications_tenant_id_recipient_staff_id_created_at_idx"
    ON "staff_notifications"("tenant_id", "recipient_staff_id", "created_at" DESC);

CREATE INDEX "staff_notifications_tenant_id_recipient_staff_id_read_at_idx"
    ON "staff_notifications"("tenant_id", "recipient_staff_id", "read_at");

ALTER TABLE "staff_notifications"
    ADD CONSTRAINT "staff_notifications_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_notifications"
    ADD CONSTRAINT "staff_notifications_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_notifications"
    ADD CONSTRAINT "staff_notifications_recipient_staff_id_fkey"
    FOREIGN KEY ("recipient_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_notifications"
    ADD CONSTRAINT "staff_notifications_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "staff_notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_notifications" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "staff_notifications"
    USING ("tenant_id" = current_setting('app.tenant_id', true));
