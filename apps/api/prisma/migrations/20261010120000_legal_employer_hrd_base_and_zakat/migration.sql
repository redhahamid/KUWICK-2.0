-- TWO EMPLOYER SETTINGS (UAT, 10 October 2026).
--
-- What the HRD levy is worked out on: basic salary only (the default the
-- account holder asked for) or basic plus fixed allowances. And whether zakat
-- is deducted through payroll, off by default.
--
-- A new enum type and two columns with defaults on an existing table: no data
-- statement and no new table. Postgres grants USAGE on a new type to PUBLIC,
-- and the application role's existing grants on legal_employers cover the
-- columns.
CREATE TYPE "HrdLevyBase" AS ENUM ('BASIC_ONLY', 'BASIC_PLUS_FIXED_ALLOWANCES');

ALTER TABLE "legal_employers"
  ADD COLUMN "hrd_levy_base" "HrdLevyBase" NOT NULL DEFAULT 'BASIC_ONLY',
  ADD COLUMN "zakat_through_payroll" BOOLEAN NOT NULL DEFAULT false;
