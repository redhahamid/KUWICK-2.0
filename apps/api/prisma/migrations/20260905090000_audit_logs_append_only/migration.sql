-- AUDIT LOGS ARE APPEND-ONLY — by refusal, not by convention.
--
-- Every other record of consequence in this schema already refuses rewriting:
-- payroll snapshots, payroll lines and runs, adjustments, appointment events,
-- payments, stock movements, patient identity changes. The audit log — the
-- table every one of those histories ultimately rests on, and the one the
-- 20260828200000 migration's own header calls the most sensitive per-person
-- data in the system — had row-level security only. RLS scopes WHO can touch
-- a row; it says nothing about WHAT they may do to it, so an UPDATE or DELETE
-- from inside the same tenant was permitted at the database level. A history
-- anyone can rewrite is not a history.
--
-- The trigger is the enforcement: it binds every role, the table owner and a
-- superuser restore included. The REVOKE below is defence in depth for roles
-- reached through PUBLIC; the application role's own grant is trimmed in
-- provision-app-role.sql, which re-runs on every deploy (a REVOKE here would
-- be silently re-granted by its ALL TABLES grant).

CREATE OR REPLACE FUNCTION audit_logs_are_append_only() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'An audit log row cannot be % — the audit trail is append-only.', lower(TG_OP);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_append_only_trigger ON "audit_logs";
CREATE TRIGGER audit_logs_append_only_trigger
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM PUBLIC;
