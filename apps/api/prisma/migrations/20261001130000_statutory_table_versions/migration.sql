-- A LATER EDITION OF A STATUTORY TABLE, added by the platform as data.
--
-- The tables Kuwick ships (EPF Third Schedule, Act 4, Act 800, the MTD
-- specification, LINDUNG 24 JAM, the HRD levy rates) are transcribed in code
-- and verified against the authorities' own worked examples. When a later
-- edition is gazetted, the platform owner — never a clinic — records it here
-- with its source document, the year and the date it is in force from. A
-- payroll period resolves to whichever edition was in force on its last day,
-- so a month already paid is never re-priced, and nothing changes until a
-- row with an in-force date exists.
--
-- A platform table: no tenant column and no row policy, like platform_admins.
-- Clinics read it through the statutory rates endpoint; only platform routes
-- write it.
CREATE TABLE "statutory_table_versions" (
    "id" TEXT NOT NULL,
    "scheme" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "in_force_from" DATE NOT NULL,
    "source_document" TEXT NOT NULL,
    "source_url" TEXT,
    "note" TEXT,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_by_platform_admin_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statutory_table_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "statutory_table_versions_scheme_in_force_from_key" ON "statutory_table_versions"("scheme", "in_force_from");
ALTER TABLE "statutory_table_versions"
    ADD CONSTRAINT "statutory_table_versions_created_by_platform_admin_id_fkey" FOREIGN KEY ("created_by_platform_admin_id") REFERENCES "platform_admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The application role reads and writes the new table the moment it exists,
-- whatever the default privileges happen to be on this database.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kuwick_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "statutory_table_versions" TO kuwick_app;
  END IF;
END $$;
