-- S3d (D-083) — prove "append-only by construction", instead of asserting it.
--
-- D-080 claimed visit_workflow_events was append-only and pointed at ON DELETE
-- RESTRICT. That claim was too strong. RESTRICT stops a PARENT row being
-- deleted out from under an event; it says nothing about the event itself:
--
--   UPDATE visit_workflow_events SET reason = '...'   -- allowed
--   DELETE FROM visit_workflow_events WHERE ...        -- allowed
--
-- A history anyone can rewrite is not a history.
--
-- THE MECHANISM. The table is already FORCE ROW LEVEL SECURITY with a single
-- policy covering ALL commands. Under FORCE RLS a command with NO applicable
-- policy is DENIED — including for the table owner, which is what the
-- application connects as. So splitting the one permissive policy into SELECT
-- and INSERT, and deliberately writing no UPDATE or DELETE policy, makes the
-- table append-only at the database level.
--
-- This is preferred over REVOKE because it does not depend on the role's NAME
-- (which differs per environment) and cannot be sidestepped by a connection
-- that happens to own the table. The REVOKE below is added as well, so a
-- future ALTER TABLE ... NO FORCE does not silently reopen the door.

DROP POLICY IF EXISTS tenant_isolation ON "visit_workflow_events";

CREATE POLICY workflow_event_select ON "visit_workflow_events"
  FOR SELECT
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE POLICY workflow_event_insert ON "visit_workflow_events"
  FOR INSERT
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true));

-- No UPDATE policy. No DELETE policy. That absence IS the enforcement.

-- Belt and braces, and independent of RLS: withdraw the privileges outright
-- from whichever role owns the schema. `current_user` keeps this correct in
-- every environment without hard-coding a role name.
--
-- TRUNCATE is included, and that was not obvious: it is a SEPARATE privilege
-- from DELETE, it is NOT filtered by row-level security at all, and it would
-- therefore empty the entire audit trail in one statement while every check
-- above still passed. Revoking UPDATE and DELETE without it would have left
-- the loudest possible hole behind the tidiest possible proof.
DO $$
BEGIN
  EXECUTE format(
    'REVOKE UPDATE, DELETE, TRUNCATE ON TABLE %I FROM %I',
    'visit_workflow_events',
    current_user
  );
END
$$;

-- ---------------------------------------------------------------------------
-- ROLLBACK
--
-- Restoring mutability is one statement — drop the two policies and recreate
-- the combined `tenant_isolation` policy, then GRANT UPDATE, DELETE back. It
-- is deliberately not scripted here: re-enabling edits to a clinical audit
-- trail should be a considered act with a reason attached, not a file someone
-- runs by reflex.
--
-- KNOWN LIMITATION, stated plainly: a superuser, or the role that owns the
-- database, can drop these policies or run ALTER TABLE ... NO FORCE ROW LEVEL
-- SECURITY. No in-database mechanism can prevent that. What this guarantees is
-- that the APPLICATION cannot update or delete a workflow event through any
-- route — ORM, raw SQL, or a mistake — which is the threat being addressed.
-- ---------------------------------------------------------------------------
