-- Fixes a real-auth bug (D-034): the tenants table's tenant_isolation
-- policy requires id = current_setting('app.tenant_id') for every command
-- (SELECT/INSERT/UPDATE/DELETE, since no FOR clause means FOR ALL, and no
-- WITH CHECK means the USING expression is reused for it too). That works
-- for every other tenant-scoped table, but tenants itself has two
-- legitimate callers that cannot possibly know a tenant's id in advance:
--   1. AuthService.login resolving a tenant by its login slug (that's the
--      entire point of the lookup — there is no tenant context yet).
--   2. PlatformTenantService managing tenants across all clinics (the one
--      deliberately cross-tenant path, per D-034's PlatformAdmin design).
-- Both were silently blocked (SELECTs returned nothing, INSERTs raised RLS
-- violations) until this policy grew a second, narrow escape hatch that only
-- these two call sites set, in the same set_config-in-a-transaction pattern
-- already used for app.tenant_id everywhere else in this codebase.

ALTER POLICY tenant_isolation ON "tenants"
  USING (
    id = current_setting('app.tenant_id', true)
    OR current_setting('app.bypass_tenant_scope', true) = 'true'
  );
