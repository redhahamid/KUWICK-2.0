-- WHO IS PAYING BEHIND THE PANEL, AND WHO THE PATIENT IS TO THEM (N-5).
--
-- Owner answer, 2026-11-03: the employer is "a real list per panel, with
-- quick-add at the counter", not free text — because free text cannot answer
-- "what did we bill for Company X", and because a per-employer payment term
-- needs somewhere to live.
--
-- G-9, WHICH THIS CLOSES. One panel in the clinic's workbook states its term as
-- `VARY BASED ON COMPANY`. Kuwick could record only THAT it varies
-- (`panel_clinics.payment_term_varies_by_payer`), so no claim on that panel
-- could be given a due date or called overdue. Correct, but it left a whole
-- panel's receivable unchaseable. With the company recorded, its own term can
-- be too.
CREATE TYPE "PanelRelationship" AS ENUM ('SELF', 'SPOUSE', 'CHILD', 'PARENT', 'OTHER');

-- SCOPED TO ONE PANEL, not to the tenant: the same company reached through two
-- TPAs is two agreements, with two terms and two sets of claim numbers.
CREATE TABLE "panel_employers" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "panel_clinic_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    -- NULL means this employer takes the panel's own term. Set, it governs as a
    -- WHOLE — see `payment-terms.effectiveTerm`.
    "payment_term_days" INTEGER,
    "payment_term_max_days" INTEGER,
    "payment_term_unit" "PanelTermUnit",
    "payment_term_anchor" "PanelTermAnchor",
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "panel_employers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "panel_employers_tenant_id_panel_clinic_id_name_key"
    ON "panel_employers"("tenant_id", "panel_clinic_id", "name");

CREATE INDEX "panel_employers_tenant_id_panel_clinic_id_active_idx"
    ON "panel_employers"("tenant_id", "panel_clinic_id", "active");

ALTER TABLE "panel_employers"
    ADD CONSTRAINT "panel_employers_tenant_id_fkey"
        FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "panel_employers"
    ADD CONSTRAINT "panel_employers_panel_clinic_id_fkey"
        FOREIGN KEY ("panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TENANT ISOLATION. Every tenant-scoped table in this schema carries row-level
-- security; a new one without it is a table every clinic can read.
ALTER TABLE "panel_employers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "panel_employers" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "panel_employers"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- Guarded, as every other table's grant is: the application role does not
-- exist on a database that has only ever had migrations applied to it, and an
-- unguarded GRANT there fails the whole migration.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "panel_employers" TO kuwick_app;
  END IF;
END
$$;

-- ON THE VISIT. Both NULLABLE with no backfill: an existing visit genuinely
-- has no recorded employer, and `panel_relationship` is deliberately NOT
-- defaulted to SELF — a wrongly-recorded SELF is a claim rejected for a member
-- mismatch, while a blank is a question somebody can still answer.
ALTER TABLE "visits" ADD COLUMN "panel_employer_id" TEXT;
ALTER TABLE "visits" ADD COLUMN "panel_relationship" "PanelRelationship";

ALTER TABLE "visits"
    ADD CONSTRAINT "visits_panel_employer_id_fkey"
        FOREIGN KEY ("panel_employer_id") REFERENCES "panel_employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "visits_tenant_id_panel_employer_id_idx"
    ON "visits"("tenant_id", "panel_employer_id");
