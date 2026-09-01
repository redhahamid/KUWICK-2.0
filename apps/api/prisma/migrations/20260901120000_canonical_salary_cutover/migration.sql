-- CANONICAL SALARY CUTOVER
--
-- `employee_profiles.basic_salary` is one mutable number. Recalculating an
-- unlocked past period applied today's pay to it; approved runs escaped only
-- because a trigger refuses to recalculate them. `employee_salaries` has held
-- the effective-dated truth since Stage 1, but the calculation never read it.
--
-- This backfills the table from the legacy column so that every employee who
-- had a salary still has one, and so the parity report has something to compare.
-- The legacy column is NOT dropped: it stays readable for a period so a
-- discrepancy can be investigated rather than guessed at. Dropping it is the
-- one destructive step, and it is deferred (delivery plan section 3).
--
-- effective_from is deliberately the employee's start date where one is known.
-- Backdating to the start date means a recalculation of any past period resolves
-- to this row rather than to nothing, which is what stops the cutover turning
-- every historical run into a wall of NO_SALARY exceptions. Where no start date
-- exists, 2000-01-01 is used: early enough to cover any period this system
-- could hold, and obviously a placeholder rather than a real date somebody
-- might mistake for a fact.

INSERT INTO employee_salaries (
  id, tenant_id, staff_id, basis, amount, effective_from, effective_to,
  reason, note, created_by_staff_id, created_at
)
SELECT
  gen_random_uuid(),
  p.tenant_id,
  p.staff_id,
  'MONTHLY',
  p.basic_salary,
  COALESCE(p.start_date, DATE '2000-01-01'),
  NULL,
  'Backfilled from the legacy basic salary column',
  'Created by the canonical salary cutover. The amount is exactly what was on the employee profile; only the effective date is inferred.',
  p.staff_id,
  now()
FROM employee_profiles p
WHERE p.basic_salary IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM employee_salaries s WHERE s.staff_id = p.staff_id);
