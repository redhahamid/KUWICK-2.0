-- A PUBLIC PAGE HAS TO BE FINDABLE BEFORE ANYBODY KNOWS WHOSE IT IS.
--
-- Every table in this database is behind `tenant_isolation`:
--     USING (tenant_id = current_setting('app.tenant_id', true))
-- and that is right for all of them but one. A patient opening
-- /hijraa-bangi has no session, no token and no tenant — the whole point of a
-- public booking link is that they do not — so `app.tenant_id` is unset, the
-- policy evaluates to NULL, and the lookup that would tell the server WHICH
-- tenant to scope to returns nothing. The bootstrap cannot bootstrap.
--
-- Three ways to solve it, and only one is safe:
--
--   1. Read it on a connection outside RLS. Refused: `system-db.ts` exists
--      precisely so that connection may never read a tenant's rows, and this
--      would be the first exception — after which it would not be the last.
--   2. Give the application role BYPASSRLS. Refused: that is the superuser
--      problem the append-only migration was written to close.
--   3. Say out loud, in a policy, that ACTIVE PUBLIC BOOKING PAGES ARE PUBLIC.
--
-- This is (3), and it is narrow on purpose:
--
--   - `clinic_booking_pages` ONLY. Nothing else gains a second policy.
--   - ACTIVE rows only. A page a clinic has not published stays invisible.
--   - The columns are the ones already printed on a public link: the slug, the
--     clinic's display name, its logo and its intro text. There is no patient
--     data in this table and there never will be — that is why it is a
--     separate table from the appointments it leads to.
--
-- Once the slug resolves, the server sets `app.tenant_id` to the tenant it
-- found and every subsequent read — services, providers, availability, the
-- booking itself — goes through ordinary row-level security. The public path
-- is unauthenticated; it is not unscoped.

CREATE POLICY public_page_lookup ON "clinic_booking_pages"
  FOR SELECT
  USING ("active" = true);

COMMENT ON TABLE "clinic_booking_pages" IS
  'One public booking page per branch. Readable without tenant context WHEN ACTIVE (policy public_page_lookup), because a patient opening the link has no tenant to be scoped to. Holds no patient data — that is why it is a separate table from the appointments it leads to.';
