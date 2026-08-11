-- G4.5d5b-3 — make the label print audit actually append-only.
--
-- The G4.5d5b-2 migration created `label_prints` with a single permissive
-- `tenant_isolation` policy and a `GRANT SELECT, INSERT`, and its comment
-- said "no DELETE grant is issued". Both halves of that were true and the
-- conclusion was still wrong:
--
--   * a policy with no `FOR` clause covers ALL commands, so the tenant
--     predicate happily authorised DELETE and UPDATE;
--   * the application connects as the role that OWNS the table, and an owner
--     holds every privilege regardless of what was granted, so declining to
--     grant DELETE withheld nothing.
--
-- The live verification caught it: a plain `DELETE FROM label_prints` against
-- the running database succeeded. An audit trail anyone can rewrite answers
-- no question worth asking, so this closes it the same way S3d (D-083) closed
-- it for `visit_workflow_events` — and for the same reason that fix chose
-- policy shape over grants.
--
-- THE MECHANISM. Under FORCE ROW LEVEL SECURITY a command with NO applicable
-- policy is DENIED, including for the table owner. Splitting the one policy
-- into SELECT and INSERT, and deliberately writing no UPDATE and no DELETE
-- policy, makes the table append-only at the database level without depending
-- on a role name that differs per environment.

DROP POLICY IF EXISTS tenant_isolation ON "label_prints";

CREATE POLICY label_print_select ON "label_prints"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY label_print_insert ON "label_prints"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- No UPDATE policy. No DELETE policy. That absence IS the enforcement.

-- Belt and braces, independent of RLS, so a future ALTER TABLE ... NO FORCE
-- does not silently reopen the door. `current_user` keeps this correct in
-- every environment without hard-coding a role name.
--
-- TRUNCATE is included deliberately: it is a SEPARATE privilege from DELETE
-- and is not filtered by row-level security at all, so revoking DELETE alone
-- would leave one statement able to empty the whole print history.
DO $$
BEGIN
  EXECUTE format(
    'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I',
    'label_prints',
    current_user
  );
END
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Drop the two policies, recreate the combined `tenant_isolation` policy and
-- GRANT UPDATE, DELETE back. Not scripted here: re-enabling edits to a
-- clinical audit trail should be a considered act with a reason attached.
--
-- KNOWN LIMITATION, stated plainly: a superuser can drop these policies or
-- disable FORCE. No in-database mechanism prevents that. What this guarantees
-- is that the APPLICATION cannot update or delete a label print through any
-- route — ORM, raw SQL, or a mistake — which is the threat being addressed.
-- ---------------------------------------------------------------------------
