-- C0 — Clinical Record Integrity (D-051).
--
-- Owner requirement: "every clinical-note entry must record the actual
-- person who made the entry, together with date and time", and "a staff
-- member recording vitals must not become the author of the doctor's
-- narrative". This migration:
--   1. gives Staff a professional (clinical) identity separate from `role`
--   2. gives ClinicalNote real narrative authorship + signing + amendments
--   3. moves vitals to their own attributed VisitObservation record
--   4. adds append-only revision tables for both
--   5. backfills legacy rows WITHOUT inventing authorship
--
-- RLS ordering note (the D-048 lesson, extended). clinical_notes carries
-- FORCE ROW LEVEL SECURITY, which blocks even the table owner when
-- app.tenant_id is unset, so a cross-tenant backfill matches ZERO rows and
-- still reports success. The extension learned here the hard way: it is not
-- enough to lift FORCE on the table being WRITTEN — every table the backfill
-- READS must be lifted too. The first version of this migration lifted only
-- clinical_notes and joined `visits`, which is also FORCEd; the join matched
-- nothing, clinic_id stayed NULL, and the subsequent SET NOT NULL failed with
-- 23502. Both tables are therefore bracketed below, and restored immediately
-- afterwards.
--
-- Note also that clinical_notes' tenant_isolation policy has no
-- app.bypass_tenant_scope clause (unlike tenants/users/staff/clinics), so
-- ad-hoc inspection scripts MUST set app.tenant_id per tenant or they will
-- silently report zero rows.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "ProfessionalType"       AS ENUM ('NON_CLINICAL', 'MEDICAL_DOCTOR');
CREATE TYPE "ClinicalNoteType"       AS ENUM ('DOCTOR_NARRATIVE', 'STAFF_REMARK');
CREATE TYPE "ClinicalNoteStatus"     AS ENUM ('DRAFT', 'SIGNED');
CREATE TYPE "ClinicalNoteEntryType"  AS ENUM ('STANDARD', 'AMENDMENT');
CREATE TYPE "ClinicalNoteChangeType" AS ENUM ('CREATED', 'UPDATED', 'SIGNED');
CREATE TYPE "ObservationSource"      AS ENUM ('MANUAL', 'DEVICE', 'IMPORTED');
CREATE TYPE "ObservationChangeType"  AS ENUM ('CREATED', 'CORRECTED');

-- ---------------------------------------------------------------------------
-- 2. Staff professional identity
--    Every default is the NON-signing state, so a fresh deploy has zero
--    eligible signers until a Clinic Group explicitly records verification
--    and enables signing. Fail-safe by construction.
-- ---------------------------------------------------------------------------
ALTER TABLE "staff"
  ADD COLUMN "professional_type" "ProfessionalType" NOT NULL DEFAULT 'NON_CLINICAL',
  ADD COLUMN "medical_registration_no" TEXT,
  ADD COLUMN "medical_registration_no_normalised" TEXT,
  ADD COLUMN "professional_active" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_sign_clinical_notes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "professional_verified_at" TIMESTAMP(3),
  ADD COLUMN "professional_verified_by_staff_id" TEXT,
  ADD COLUMN "clinical_signing_enabled_at" TIMESTAMP(3),
  ADD COLUMN "clinical_signing_enabled_by_staff_id" TEXT;

-- Duplicate DETECTION only. A hard tenant-scoped partial unique index is
-- deliberately NOT created in C0: a tenant could currently be using
-- duplicate Staff rows as a multi-branch workaround (UserClinicAccess is
-- still unwired), and production data could not be preflighted from the
-- development environment. The constraint lands in the multi-branch phase
-- once that is proven safe.
CREATE INDEX "staff_tenant_id_medical_registration_no_normalised_idx"
  ON "staff"("tenant_id", "medical_registration_no_normalised");

-- ---------------------------------------------------------------------------
-- 3. ClinicalNote — narrative authorship, signing, amendments, late entries
--    All columns nullable at first so existing rows survive; CHECK
--    constraints are added only AFTER the backfill in section 7.
-- ---------------------------------------------------------------------------
ALTER TABLE "clinical_notes"
  ADD COLUMN "clinic_id" TEXT,
  ADD COLUMN "note_type"  "ClinicalNoteType"      NOT NULL DEFAULT 'DOCTOR_NARRATIVE',
  ADD COLUMN "status"     "ClinicalNoteStatus"    NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "entry_type" "ClinicalNoteEntryType" NOT NULL DEFAULT 'STANDARD',
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "author_staff_id" TEXT,
  ADD COLUMN "author_name_snapshot" TEXT,
  ADD COLUMN "author_role_snapshot" TEXT,
  ADD COLUMN "author_designation_snapshot" TEXT,
  ADD COLUMN "signed_by_staff_id" TEXT,
  ADD COLUMN "signer_name_snapshot" TEXT,
  ADD COLUMN "signer_role_snapshot" TEXT,
  ADD COLUMN "signer_designation_snapshot" TEXT,
  ADD COLUMN "signed_at" TIMESTAMP(3),
  ADD COLUMN "clinical_entry_at" TIMESTAMP(3),
  ADD COLUMN "late_entry_reason" TEXT,
  ADD COLUMN "supersedes_note_id" TEXT,
  ADD COLUMN "amendment_reason" TEXT,
  ADD COLUMN "legacy_author_unknown" BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- 4. clinical_note_revisions (append-only)
--    ENABLE + explicit policy now; FORCE at the very end (section 9) after
--    the policy has been verified to exist and function.
-- ---------------------------------------------------------------------------
CREATE TABLE "clinical_note_revisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "note_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "content_hash" TEXT,
    "hash_schema_version" INTEGER,
    "change_type" "ClinicalNoteChangeType" NOT NULL,
    "previous_status" "ClinicalNoteStatus",
    "new_status" "ClinicalNoteStatus" NOT NULL,
    "edited_by_staff_id" TEXT,
    "editor_name_snapshot" TEXT,
    "editor_role_snapshot" TEXT,
    "editor_designation_snapshot" TEXT,
    "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" TEXT,
    CONSTRAINT "clinical_note_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "clinical_note_revisions_note_id_version_no_key"
  ON "clinical_note_revisions"("note_id", "version_no");
CREATE INDEX "clinical_note_revisions_tenant_id_note_id_idx"
  ON "clinical_note_revisions"("tenant_id", "note_id");

-- ---------------------------------------------------------------------------
-- 5. visit_observations + visit_observation_revisions
-- ---------------------------------------------------------------------------
CREATE TABLE "visit_observations" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "clinic_id" TEXT NOT NULL,
    "visit_id" TEXT NOT NULL,
    "recorded_by_staff_id" TEXT,
    "recorder_name_snapshot" TEXT,
    "recorder_role_snapshot" TEXT,
    "recorder_designation_snapshot" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_staff_id" TEXT,
    "updater_name_snapshot" TEXT,
    "updater_role_snapshot" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 1,
    "bp_systolic" INTEGER,
    "bp_diastolic" INTEGER,
    "pulse" INTEGER,
    "temperature" DECIMAL(4,1),
    "spo2" INTEGER,
    "resp_rate" INTEGER,
    "pain_score" INTEGER,
    "weight" DECIMAL(5,2),
    "height" DECIMAL(5,2),
    "head_circumference" DECIMAL(5,2),
    "glucose" DECIMAL(5,2),
    "source" "ObservationSource" NOT NULL DEFAULT 'MANUAL',
    "legacy_recorder_unknown" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "visit_observations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "visit_observations_tenant_id_visit_id_recorded_at_idx"
  ON "visit_observations"("tenant_id", "visit_id", "recorded_at");

CREATE TABLE "visit_observation_revisions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "content_snapshot" JSONB NOT NULL,
    "content_hash" TEXT,
    "hash_schema_version" INTEGER,
    "change_type" "ObservationChangeType" NOT NULL,
    "edited_by_staff_id" TEXT,
    "editor_name_snapshot" TEXT,
    "editor_role_snapshot" TEXT,
    "editor_designation_snapshot" TEXT,
    "edited_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "correction_reason" TEXT,
    CONSTRAINT "visit_observation_revisions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "visit_observation_revisions_observation_id_version_no_key"
  ON "visit_observation_revisions"("observation_id", "version_no");
CREATE INDEX "visit_observation_revisions_tenant_id_observation_id_idx"
  ON "visit_observation_revisions"("tenant_id", "observation_id");

-- ---------------------------------------------------------------------------
-- 6. Foreign keys
-- ---------------------------------------------------------------------------
ALTER TABLE "clinical_notes"
  ADD CONSTRAINT "clinical_notes_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_notes_author_staff_id_fkey" FOREIGN KEY ("author_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_notes_signed_by_staff_id_fkey" FOREIGN KEY ("signed_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_notes_supersedes_note_id_fkey" FOREIGN KEY ("supersedes_note_id") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "clinical_note_revisions"
  ADD CONSTRAINT "clinical_note_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "clinical_note_revisions_note_id_fkey" FOREIGN KEY ("note_id") REFERENCES "clinical_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "visit_observations"
  ADD CONSTRAINT "visit_observations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_observations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_observations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_observations_recorded_by_staff_id_fkey" FOREIGN KEY ("recorded_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_observations_updated_by_staff_id_fkey" FOREIGN KEY ("updated_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "visit_observation_revisions"
  ADD CONSTRAINT "visit_observation_revisions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "visit_observation_revisions_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "visit_observations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 7. Legacy backfill — RLS bracketed (D-048)
--    NOTHING here invents authorship. Branch is copied from the visit
--    because that is a verifiable fact; the recorder/author of historical
--    data is genuinely unknown and stays NULL.
-- ---------------------------------------------------------------------------
-- Lift FORCE on the table being written AND on every table the backfill
-- reads (`visits`), or the joins below silently match zero rows.
ALTER TABLE "clinical_notes" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "visits" NO FORCE ROW LEVEL SECURITY;

-- (a) every pre-existing note predates authorship tracking
UPDATE "clinical_notes" SET "legacy_author_unknown" = true;

-- (b) branch from the visit — factual, not inferred
UPDATE "clinical_notes" cn
SET "clinic_id" = v."clinic_id"
FROM "visits" v
WHERE cn."visit_id" = v."id" AND cn."clinic_id" IS NULL;

-- (c) lift legacy vitals into their own observation rows, recorder UNKNOWN.
--     recorded_at reuses the note's created_at (the only timestamp evidence
--     that exists). Only notes that actually carry a vital produce a row.
INSERT INTO "visit_observations" (
  "id", "tenant_id", "clinic_id", "visit_id",
  "recorded_by_staff_id", "recorder_name_snapshot", "recorder_role_snapshot",
  "recorded_at", "updated_at", "version",
  "bp_systolic", "bp_diastolic", "pulse", "temperature", "spo2", "resp_rate",
  "pain_score", "weight", "height", "head_circumference", "glucose",
  "source", "legacy_recorder_unknown"
)
SELECT
  gen_random_uuid()::text, cn."tenant_id", v."clinic_id", cn."visit_id",
  NULL, NULL, NULL,
  cn."created_at", cn."created_at", 1,
  cn."bp_systolic", cn."bp_diastolic", cn."pulse", cn."temperature", cn."spo2",
  cn."resp_rate", cn."pain_score", cn."weight", cn."height",
  cn."head_circumference", cn."glucose",
  'IMPORTED', true
FROM "clinical_notes" cn
JOIN "visits" v ON v."id" = cn."visit_id"
WHERE cn."bp_systolic" IS NOT NULL OR cn."bp_diastolic" IS NOT NULL
   OR cn."pulse" IS NOT NULL OR cn."temperature" IS NOT NULL
   OR cn."spo2" IS NOT NULL OR cn."resp_rate" IS NOT NULL
   OR cn."pain_score" IS NOT NULL OR cn."weight" IS NOT NULL
   OR cn."height" IS NOT NULL OR cn."head_circumference" IS NOT NULL
   OR cn."glucose" IS NOT NULL;

-- Restore full protection on both tables immediately after the backfill.
ALTER TABLE "clinical_notes" FORCE ROW LEVEL SECURITY;
ALTER TABLE "visits" FORCE ROW LEVEL SECURITY;

-- Guard: if any note still lacks a branch the backfill did not do its job
-- (the exact failure mode that RLS causes silently). Fail loudly here rather
-- than let SET NOT NULL produce a confusing 23502 further down.
DO $$
DECLARE orphaned INTEGER;
BEGIN
  SELECT count(*) INTO orphaned FROM "clinical_notes" WHERE "clinic_id" IS NULL;
  IF orphaned > 0 THEN
    RAISE EXCEPTION 'clinic_id backfill affected too few rows: % clinical_notes still NULL. '
      'This usually means a FORCE ROW LEVEL SECURITY table was read without lifting it.', orphaned;
  END IF;
END $$;

-- clinic_id is now populated for every row that has a visit (all of them —
-- visit_id is NOT NULL), so it can be tightened.
ALTER TABLE "clinical_notes" ALTER COLUMN "clinic_id" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 8. CHECK constraints — added AFTER the backfill, or legacy rows would fail
-- ---------------------------------------------------------------------------

-- A non-legacy note must carry full author identity.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_author_identity_check" CHECK (
  "legacy_author_unknown" = true
  OR ("author_staff_id" IS NOT NULL
      AND "author_name_snapshot" IS NOT NULL
      AND "author_role_snapshot" IS NOT NULL)
);

-- Signature state is all-or-nothing; a DRAFT can never look partly signed.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_signature_state_check" CHECK (
  ("status" = 'DRAFT'  AND "signed_by_staff_id" IS NULL AND "signed_at" IS NULL
                       AND "signer_name_snapshot" IS NULL AND "signer_role_snapshot" IS NULL)
  OR
  ("status" = 'SIGNED' AND "signed_by_staff_id" IS NOT NULL AND "signed_at" IS NOT NULL
                       AND "signer_name_snapshot" IS NOT NULL AND "signer_role_snapshot" IS NOT NULL)
);

-- A staff remark is structurally impossible to sign, and can never be an
-- amendment of a doctor's note.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_staff_remark_unsigned_check" CHECK (
  "note_type" <> 'STAFF_REMARK'
  OR ("status" = 'DRAFT' AND "signed_by_staff_id" IS NULL AND "signed_at" IS NULL
      AND "entry_type" = 'STANDARD')
);

-- An amendment must say what it amends and why.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_amendment_check" CHECK (
  "entry_type" <> 'AMENDMENT'
  OR ("supersedes_note_id" IS NOT NULL
      AND "amendment_reason" IS NOT NULL
      AND length(btrim("amendment_reason")) > 0)
);

-- A note can never supersede itself.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_no_self_supersede_check" CHECK (
  "supersedes_note_id" IS NULL OR "supersedes_note_id" <> "id"
);

-- Late entry (clinical event earlier than system entry) must be justified.
-- createdAt is never backdated; both timestamps are kept.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_late_entry_check" CHECK (
  "clinical_entry_at" IS NULL
  OR ("late_entry_reason" IS NOT NULL AND length(btrim("late_entry_reason")) > 0)
);

ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_version_positive_check" CHECK ("version" >= 1);

-- Observations: a non-legacy row must carry full recorder identity.
ALTER TABLE "visit_observations" ADD CONSTRAINT "visit_observations_recorder_identity_check" CHECK (
  "legacy_recorder_unknown" = true
  OR ("recorded_by_staff_id" IS NOT NULL
      AND "recorder_name_snapshot" IS NOT NULL
      AND "recorder_role_snapshot" IS NOT NULL)
);
ALTER TABLE "visit_observations" ADD CONSTRAINT "visit_observations_version_positive_check" CHECK ("version" >= 1);

ALTER TABLE "clinical_note_revisions" ADD CONSTRAINT "clinical_note_revisions_version_positive_check" CHECK ("version_no" >= 1);
ALTER TABLE "visit_observation_revisions" ADD CONSTRAINT "visit_observation_revisions_version_positive_check" CHECK ("version_no" >= 1);

-- ---------------------------------------------------------------------------
-- 9. Row-Level Security on the three new tables.
--    Explicit USING (read/update visibility) AND WITH CHECK (write
--    admission) — USING alone would let a row be INSERTed under another
--    tenant's id. FORCE only after the policy exists, so the table is never
--    left protected-but-policyless.
-- ---------------------------------------------------------------------------
ALTER TABLE "visit_observations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "visit_observations"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "visit_observation_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "visit_observation_revisions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "clinical_note_revisions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "clinical_note_revisions"
  USING (tenant_id = current_setting('app.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

ALTER TABLE "visit_observations" FORCE ROW LEVEL SECURITY;
ALTER TABLE "visit_observation_revisions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "clinical_note_revisions" FORCE ROW LEVEL SECURITY;
