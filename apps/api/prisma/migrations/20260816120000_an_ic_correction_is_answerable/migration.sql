-- AN IC CORRECTION MUST BE ANSWERABLE LATER.
--
-- IC and date of birth were read-only in the patient profile, which sounded
-- safe and was not: a typo taken at registration could not be corrected, so the
-- counter's only remaining move was to create a SECOND patient — splitting one
-- person's visits, invoices and claims across two files. Staging carries the
-- proof: an 11-digit IC, and a date of birth of 05/05/2026.
--
-- Making them editable is therefore the safer option, but only if the change
-- leaves a record. An identifier is what ties a person's visits, panel claims
-- and (when it lands) e-Invoice submissions together; a silent edit would make
-- every one of those answerable to nothing.
--
-- APPEND-ONLY, like every other consequential record here. Not `audit_logs`:
-- that table is generic, has no RLS at all, and names an actor by a nullable
-- user id. This one is tenant-scoped, carries the author's name and role as
-- SNAPSHOTS (a staff member who leaves must not turn last year's correction
-- into a blank), and is refused DELETE and TRUNCATE by triggers that fire for
-- every role including a superuser — the same three layers
-- `patient_alerts` got in 20260813140000.
--
-- ONE ROW PER FIELD CHANGED. "IC: 12345678901 → 900101145566, by X, on the
-- 16th" is a sentence; a single row holding a JSON blob of everything that
-- moved at once is not.

CREATE TABLE "patient_identity_changes" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "patient_id" TEXT NOT NULL,
    -- 'identifierType' | 'identifierValue' | 'dob'. A plain string rather than
    -- an enum: this is a record of what a column used to say, and a later
    -- rename of the column must not rewrite history.
    "field" TEXT NOT NULL,
    -- Nullable because a date of birth may not have been recorded at all, and
    -- "was blank" is a different fact from "was wrong".
    "old_value" TEXT,
    "new_value" TEXT,
    "changed_by_staff_id" TEXT NOT NULL,
    "changed_by_name_snapshot" TEXT NOT NULL,
    "changed_by_role_snapshot" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_identity_changes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "patient_identity_changes_tenant_id_patient_id_idx"
    ON "patient_identity_changes"("tenant_id", "patient_id");

ALTER TABLE "patient_identity_changes"
    ADD CONSTRAINT "patient_identity_changes_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_identity_changes"
    ADD CONSTRAINT "patient_identity_changes_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "patient_identity_changes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_identity_changes" FORCE ROW LEVEL SECURITY;

CREATE POLICY patient_identity_change_select ON "patient_identity_changes"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY patient_identity_change_insert ON "patient_identity_changes"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- No UPDATE policy and no DELETE policy. Unlike patient_alerts there is not
-- even a deactivation to record: a correction that happened, happened.

DROP TRIGGER IF EXISTS "patient_identity_changes_no_delete" ON "patient_identity_changes";
DROP TRIGGER IF EXISTS "patient_identity_changes_no_truncate" ON "patient_identity_changes";

CREATE TRIGGER "patient_identity_changes_no_delete"
  BEFORE DELETE ON "patient_identity_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete();

CREATE TRIGGER "patient_identity_changes_no_truncate"
  BEFORE TRUNCATE ON "patient_identity_changes"
  FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete();

COMMENT ON TABLE "patient_identity_changes" IS
  'Append-only. Every correction to a patient IC, identifier type or date of birth, '
  'with the author''s name and role snapshotted at the time. Enforced by three layers: '
  'a non-superuser application role, RLS with no UPDATE/DELETE policy, and BEFORE '
  'DELETE/TRUNCATE triggers that fire for every role including a superuser.';
