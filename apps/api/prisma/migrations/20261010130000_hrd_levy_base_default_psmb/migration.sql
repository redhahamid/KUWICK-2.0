-- THE HRD LEVY BASE GOES BACK TO THE PSMB ACT'S DEFINITION BY DEFAULT.
--
-- 20261010120000 added the column with BASIC_ONLY as its default. The account
-- holder asked for the Act's definition, basic plus allowances marked HRD, as
-- the default instead, with basic only kept as a choice.
--
-- Every employer moves to the new default, which is the point: none had
-- chosen basic only, it was only the column's default, for about an hour on
-- staging. Done by dropping and re-adding the column inside one transaction
-- rather than by an UPDATE, because every table is FORCE ROW LEVEL SECURITY
-- and an UPDATE run by the migration role without a tenant context could
-- silently match no rows. DDL is not filtered by row security, and the
-- transaction means no request ever sees the table without the column.
BEGIN;
ALTER TABLE "legal_employers" DROP COLUMN "hrd_levy_base";
ALTER TABLE "legal_employers"
  ADD COLUMN "hrd_levy_base" "HrdLevyBase" NOT NULL DEFAULT 'BASIC_PLUS_FIXED_ALLOWANCES';
COMMIT;
