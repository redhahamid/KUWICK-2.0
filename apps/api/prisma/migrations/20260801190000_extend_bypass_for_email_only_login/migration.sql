-- D-049: email-only login (owner: "remove the clinic id column? just by
-- username and password will do"). Resolving which tenant an email belongs
-- to requires one cross-tenant read of users (and their staff record for
-- the active check) *before* any tenant context exists — the same narrow
-- escape-hatch pattern already used for tenants (login-by-slug, migration
-- 20260731280000) and clinics (public queue monitor, 20260731310000).
-- The GUC is only ever set by trusted backend code paths inside a
-- transaction; no request-controlled value reaches it.
ALTER POLICY tenant_isolation ON "users"
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_tenant_scope', true) = 'true'
  );

ALTER POLICY tenant_isolation ON "staff"
  USING (
    tenant_id = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_tenant_scope', true) = 'true'
  );
