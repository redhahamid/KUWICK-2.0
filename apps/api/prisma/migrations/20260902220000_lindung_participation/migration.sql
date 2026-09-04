-- STAGE 3 — LINDUNG 24 JAM (SKBBK) PARTICIPATION
--
-- D6, the Act 4 rate table, prints the Non-Employment Injury Scheme as a COLUMN
-- beside employment injury and invalidity. Kuwick read it as part of Act 4 and
-- added it to every employee's SOCSO deduction, in every period,
-- unconditionally.
--
-- Current PERKESO guidance says it is a separate scheme:
--
--   * in force from 1 JUNE 2026 — nothing is due for an earlier period
--   * borne by the EMPLOYEE, with NO employer share; the employer remits it on
--     the employee's behalf, which is not the same as paying it
--   * VOLUNTARY for local employees
--   * MANDATORY for foreign workers
--   * phased at 0.75%, then 1.00% and 1.25%
--
-- The table and the guidance agree on the MONEY — D6's column converges on
-- 0.744% of the band ceiling, which is 0.75% expressed as bands — and the
-- guidance supplies what D6 did not: when it starts, who bears it, and who may
-- decline. Charging the column without those over-deducted RM44.65 a month
-- from a RM6,000 local who never joined, and from everybody for every period
-- before June 2026.
--
-- NULL, WITH NO BACKFILL AND NO INFERENCE. Foreign-worker status is a PERKESO
-- classification; it is not EPF membership, not tax residence, and not a
-- nationality typed into a text box. Deriving it from any of those is how a
-- local gets charged for a scheme they declined. An employee with nothing
-- recorded raises a blocking exception, because "not recorded" and "declined"
-- are different answers and only one of them is a fact.
--
-- NOTHING HERE ESTABLISHES A STATUTORY RULE. The dates, phases and eligibility
-- live in src/statutory/lindung-24-jam.ts.

CREATE TYPE "LindungParticipation" AS ENUM (
  'MANDATORY_FOREIGN_WORKER',
  'VOLUNTARY_OPTED_IN',
  'NOT_PARTICIPATING'
);

ALTER TABLE "employee_profiles"
  ADD COLUMN "lindung_participation" "LindungParticipation";

COMMENT ON COLUMN "employee_profiles"."lindung_participation" IS
  'LINDUNG 24 JAM (SKBBK) participation. NULL blocks the contribution; it is never inferred from EPF membership, residence or nationality.';
