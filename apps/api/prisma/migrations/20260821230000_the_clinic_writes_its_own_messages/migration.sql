-- PHASE 8 — THE CLINIC WRITES ITS OWN MESSAGES.
--
-- Until now the one patient message Kuwick could produce was a hardcoded
-- English reminder sentence. This table holds a clinic's OWN wording, one row
-- per customised (message type, language) pair. Absent rows render the
-- built-in defaults, so:
--   - nothing changes for any clinic by migration (the table starts empty);
--   - "reset to default" is a DELETE, not a copy of stale text;
--   - a future improvement to a default reaches every clinic that never
--     customised that template.
--
-- The CHECK caps a template at 1000 characters: these travel as WhatsApp
-- text a receptionist pastes, not documents.

CREATE TABLE "appointment_message_templates" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointment_message_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "appointment_message_templates_body_sane"
        CHECK (char_length("body") >= 1 AND char_length("body") <= 1000)
);

CREATE UNIQUE INDEX "appointment_message_templates_clinic_id_template_key_langua_key"
    ON "appointment_message_templates"("clinic_id", "template_key", "language");

CREATE INDEX "appointment_message_templates_tenant_id_clinic_id_idx"
    ON "appointment_message_templates"("tenant_id", "clinic_id");

ALTER TABLE "appointment_message_templates"
    ADD CONSTRAINT "appointment_message_templates_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointment_message_templates"
    ADD CONSTRAINT "appointment_message_templates_clinic_id_fkey"
    FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "appointment_message_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "appointment_message_templates" FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "appointment_message_templates"
    USING ("tenant_id" = current_setting('app.tenant_id', true));
