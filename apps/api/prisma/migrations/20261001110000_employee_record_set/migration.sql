-- THE EMPLOYEE RECORD, AS THE FIRST MONTH'S UAT FOUND IT WANTING.
--
--   job_titles              the clinic's own list of jobs, instead of a
--                           hard-coded one; a profile points at one and keeps
--                           the name in `position` for every screen that
--                           already reads it
--   work_days_per_week      5, 5.5 or 6: recorded and shown, not derived from
--                           the rest day as a fixed six-day span
--   rest_day_varies         an employee with no fixed rest day (s.59 lets the
--                           employer vary it week to week) stops being a
--                           blocked month; the run says it cannot price
--                           rest-day work by itself for them
--   passport_number         a non-citizen's passport beside, not instead of,
--                           the identity document on file
--   postcode, city, state   the address split the way a form wants it, with
--                           `address` kept as the street line
--
-- Every column is nullable or defaulted, so nothing on an existing record
-- moves until somebody types.
CREATE TABLE "job_titles" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_titles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "job_titles_tenant_id_name_key" ON "job_titles"("tenant_id", "name");
CREATE INDEX "job_titles_tenant_id_idx" ON "job_titles"("tenant_id");
ALTER TABLE "job_titles"
    ADD CONSTRAINT "job_titles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_titles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "job_titles" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "job_titles"
  USING ("tenant_id" = current_setting('app.tenant_id', true))
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true));

-- The application role reads and writes the new table the moment it exists,
-- whatever the default privileges happen to be on this database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "job_titles" TO kuwick_app;
  END IF;
END $$;

ALTER TABLE "employee_profiles"
  ADD COLUMN "job_title_id" TEXT,
  ADD COLUMN "work_days_per_week" DECIMAL(2,1),
  ADD COLUMN "passport_number" TEXT,
  ADD COLUMN "postcode" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT;
CREATE INDEX "employee_profiles_job_title_id_idx" ON "employee_profiles"("job_title_id");
ALTER TABLE "employee_profiles"
    ADD CONSTRAINT "employee_profiles_job_title_id_fkey" FOREIGN KEY ("job_title_id") REFERENCES "job_titles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_statutory_classifications"
  ADD COLUMN "rest_day_varies" BOOLEAN NOT NULL DEFAULT false;
