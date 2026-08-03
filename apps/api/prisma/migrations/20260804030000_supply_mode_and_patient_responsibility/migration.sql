-- G4.5d3c-1b (D-084) — the two inputs a server-derived consultation
-- destination needs, and neither of which the model held.
--
-- SCHEMA ONLY. No completion service, no destination rule, no UI. What this
-- adds is the ability to ASK the two questions honestly:
--
--   "does this patient need the dispensary?"  -> prescriptions.supply_mode
--   "does this patient need the counter?"     -> invoices.patient_responsibility_amount
--
-- Both are nullable, neither is backfilled, and neither has a database
-- DEFAULT. That last point is deliberate: a default would make every row
-- written during the compatibility period indistinguishable from one where a
-- human actually chose, and the whole purpose of these columns is to stop the
-- system guessing. NULL means "not captured" and a destination rule must
-- report UNDETERMINED rather than assume.
--
-- ROLLBACK LIMITATION: as in D-080, PostgreSQL cannot DROP a value from an
-- enum type, and cannot drop a type still referenced by a column. Dropping
-- the two COLUMNS is clean at any time; dropping "PrescriptionSupplyMode"
-- requires dropping prescriptions.supply_mode first.

-- ---------------------------------------------------------------------------
-- 1. Where the medicine comes from.
-- ---------------------------------------------------------------------------
CREATE TYPE "PrescriptionSupplyMode" AS ENUM (
  'ONSITE_DISPENSE',
  'EXTERNAL_PRESCRIPTION',
  'PATIENT_OWN_SUPPLY',
  'DEFERRED',
  'NO_SUPPLY_REQUIRED'
);

ALTER TABLE "prescriptions"
  ADD COLUMN "supply_mode" "PrescriptionSupplyMode";

-- "Which active prescriptions still need dispensing" is the query the
-- dispensary workflow will live on, and it is answered by very few rows.
CREATE INDEX "prescriptions_tenant_supply_mode_status_idx"
  ON "prescriptions" ("tenant_id", "supply_mode", "status")
  WHERE "supply_mode" IS NOT NULL AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- 2. What the patient owes, as opposed to what has been received.
--
-- `patient_paid_amount` already exists and means money COLLECTED; it is
-- computed at pay time. It is neither renamed nor reinterpreted here.
-- ---------------------------------------------------------------------------
ALTER TABLE "invoices"
  ADD COLUMN "patient_responsibility_amount" DECIMAL(10,2);

-- Deliberately NOT a CHECK constraint on
--   panel_covered_amount + patient_responsibility_amount = total_amount
--
-- The invariant holds for invoices calculated by the FUTURE billing rule, and
-- existing rows are all NULL here, so a constraint would either be vacuous now
-- or reject legitimate historical data later if a rounding rule changes. It is
-- enforced where the amounts are computed, and asserted by tests, rather than
-- frozen into the table before the rule that maintains it exists.

CREATE INDEX "invoices_tenant_patient_responsibility_idx"
  ON "invoices" ("tenant_id", "status")
  WHERE "patient_responsibility_amount" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. What is NOT done here.
--
--   * No PAID invoice is touched.
--   * No CANCELLED invoice is touched.
--   * No historical prescription receives a supply mode.
--   * No historical invoice receives a responsibility amount.
--   * InvoiceStatus is unchanged — DRAFT/ISSUED/SUBMITTED lifecycle belongs to
--     G4.5d6, and overloading the financial status with an issue/submission
--     lifecycle is exactly the conflation that audit warned about.
-- ---------------------------------------------------------------------------
