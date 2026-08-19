-- A HISTORY ANYONE CAN REWRITE IS NOT A HISTORY.
--
-- `appointment_events` shipped with RLS, a `tenant_isolation` policy and
-- BEFORE DELETE / BEFORE TRUNCATE triggers, and its table comment called it
-- append-only. **That claim was too strong, and it was measured, not guessed:**
--
--     SET app.tenant_id = '…';
--     UPDATE appointment_events SET reason = 'TAMPERED' WHERE id = '…';
--     -- UPDATE 1
--
-- as the ordinary, non-superuser application role. The combined
-- `tenant_isolation` policy covers ALL commands, so it PERMITTED the update
-- for any row whose tenant matched — which is every row the application can
-- see. Deletion was blocked and rewriting was not, which is the worse half:
-- a deleted audit row is a gap somebody notices, and an edited one is a lie
-- nobody does.
--
-- This is the same defect D-083 found in `visit_workflow_events`, in a table
-- written eight days later. It is fixed the same way, in the same three
-- layers, because that mechanism was already proven here.
--
--   1. SPLIT THE POLICY. Under FORCE ROW LEVEL SECURITY a command with NO
--      applicable policy is DENIED — including for the table owner. Writing a
--      SELECT policy and an INSERT policy and deliberately writing no UPDATE
--      or DELETE policy IS the enforcement. Preferred over REVOKE because it
--      does not depend on a role NAME, which differs per environment.
--   2. REVOKE the privileges outright, so a future
--      `ALTER TABLE … NO FORCE ROW LEVEL SECURITY` does not silently reopen
--      the door. TRUNCATE is included: it is a separate privilege, it is not
--      filtered by RLS at all, and it would empty the audit trail in one
--      statement while every other check still passed.
--   3. A BEFORE UPDATE TRIGGER, which fires for EVERY role including a
--      superuser — the layer that survives a misconfigured environment, and
--      the one the phase-0 audit added after finding RLS inert against the
--      superuser role every environment was then running as.
--
-- `appointment_form_answers` gets layers 1–3 for UPDATE as well. It is a
-- SNAPSHOT of the question as it was asked and the answer as it was given; a
-- snapshot that can be edited is not a snapshot, and the whole reason the
-- label and the field type are copied rather than joined is that a clinic
-- rewording a question must not change what an older booking appears to have
-- been asked.

-- ═════════════════════════════════════════════════════════════════════════════
-- 1. THE POLICIES
-- ═════════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS tenant_isolation ON "appointment_events";

CREATE POLICY appointment_event_select ON "appointment_events"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY appointment_event_insert ON "appointment_events"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- No UPDATE policy. No DELETE policy. That absence IS the enforcement.

DROP POLICY IF EXISTS tenant_isolation ON "appointment_form_answers";

CREATE POLICY appointment_form_answer_select ON "appointment_form_answers"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY appointment_form_answer_insert ON "appointment_form_answers"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- ═════════════════════════════════════════════════════════════════════════════
-- 2. THE PRIVILEGES
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointment_events', 'appointment_form_answers']
  LOOP
    -- `current_user` keeps this correct in every environment without
    -- hard-coding a role name, and PUBLIC covers the grant the schema
    -- provisioner hands out.
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I', t, current_user);
    EXECUTE format('REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM PUBLIC', t);
  END LOOP;
END $$;

-- ═════════════════════════════════════════════════════════════════════════════
-- 3. THE TRIGGERS — the layer that fires for a superuser too
-- ═════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION kuwick_refuse_append_only_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Rows in %.% are append-only and are never modified.', TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING HINT = 'This is an audit record. Write a NEW row describing the correction instead.';
END $$ LANGUAGE plpgsql;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['appointment_events', 'appointment_form_answers']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_update', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_delete', t);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    -- ROW level for UPDATE, so the exception names the row somebody tried to
    -- change; STATEMENT level for the other two, so `DELETE … WHERE false` is
    -- refused as well and "successfully deleted nothing" is never read as
    -- permission to try harder.
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION kuwick_refuse_append_only_update()',
      t || '_no_update', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete()',
      t || '_no_delete', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION kuwick_refuse_append_only_delete()',
      t || '_no_truncate', t);
  END LOOP;
END $$;

COMMENT ON TABLE "appointment_events" IS
  'Append-only, enforced in three layers: RLS with SELECT and INSERT policies only (no UPDATE or DELETE policy, which under FORCE RLS is a denial), REVOKE UPDATE/DELETE/TRUNCATE, and BEFORE UPDATE/DELETE/TRUNCATE triggers that fire for every role including a superuser. Correct a mistaken entry by writing a NEW row that describes the correction.';

COMMENT ON TABLE "appointment_form_answers" IS
  'Append-only snapshot of the booking question AS ASKED and the answer AS GIVEN. The label and field type are copied rather than joined so that rewording a question later cannot change what an older booking appears to have been asked — which only holds if the copy cannot be edited. Same three-layer enforcement as appointment_events.';

-- ─────────────────────────────────────────────────────────────────────────────
-- WHAT THIS DOES NOT CLAIM.
--
-- A superuser, or the role owning the database, can drop these policies and
-- these triggers. No in-database mechanism can prevent that, and pretending
-- otherwise is how the first version of this comment came to be wrong. What is
-- guaranteed is that the APPLICATION cannot modify or remove an appointment
-- audit record through any route — ORM, raw SQL, or a mistake.
--
-- ROLLBACK is deliberately not scripted. Re-enabling edits to an audit trail
-- should be a considered act with a reason attached, not a file somebody runs
-- by reflex.
-- ─────────────────────────────────────────────────────────────────────────────
