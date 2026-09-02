-- STAGE 3 — WHICH PART OF THE EPF THIRD SCHEDULE AN EMPLOYEE FALLS UNDER
--
-- The Third Schedule is not one table. Part A covers citizens, permanent
-- residents and pre-1998 electors together while they are under 60; from 60
-- they split — citizens to Part E (employer 4%, employee nil), everybody else
-- to Part C (6% and 5.5%). Part F covers other non-citizens at a flat 2% each
-- side at every wage.
--
-- Kuwick had no way to say which. It held a free-text `nationality` and an
-- `identifier_type` of IC or passport, and neither settles it: a permanent
-- resident holds an IC, and "Malaysia" in a text box does not distinguish a
-- citizen from a PR. The engine that reads this column therefore refuses to
-- compute EPF when it is NULL rather than assuming Part A, because assuming is
-- how a 61-year-old permanent resident silently under-contributes for a year.
--
-- ADDITIVE AND NULLABLE, WITH NO BACKFILL, ON PURPOSE. A backfill would have to
-- guess exactly the thing the column exists to stop being guessed. Existing
-- employees therefore raise a blocking payroll exception naming the missing
-- field until somebody records it — which is the intended behaviour and the
-- reason the column is not defaulted.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. The rates live in
-- src/statutory/epf-third-schedule.ts, transcribed from the Schedule itself.

CREATE TYPE "EpfMembership" AS ENUM (
  'MALAYSIAN_CITIZEN',
  'PERMANENT_RESIDENT',
  'NON_CITIZEN_ELECTED_PRE_1998',
  'NON_CITIZEN'
);

ALTER TABLE "employee_profiles" ADD COLUMN "epf_membership" "EpfMembership";

COMMENT ON COLUMN "employee_profiles"."epf_membership" IS
  'Which limb of the EPF Third Schedule applies. NULL blocks the EPF calculation rather than defaulting to Part A.';
