-- A ONE-OFF DATA CORRECTION IS STILL AN EVENT, AND IT HAS TO BE RE-RUN-SAFE.
--
-- Piece 1 changed how appointment instants are stored: a 09:00 clinic slot was
-- being written as 09:00Z (5pm in Kuala Lumpur) and is now written as the
-- instant that really is 09:00 there. Rows booked before that change are eight
-- hours out and the owner has asked for them to be corrected.
--
-- The correction shifts real rows by a real amount. Running it twice would
-- shift them twice, and there is nothing in an appointment row that says
-- whether it has already been shifted — an appointment at 01:00Z is
-- indistinguishable from one that was 09:00Z yesterday. So the fact that it
-- ran is recorded HERE, and the script refuses to run again while the record
-- stands.
--
-- Deliberately general rather than a single boolean for this one job. This is
-- the second one-off correction this project has considered in a fortnight
-- (the other, historical stock balances, was correctly refused), and the next
-- one should not have to invent its own guard.

CREATE TABLE "data_corrections" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    -- The correction's name, e.g. 'appointment-instants-to-clinic-zone'.
    -- UNIQUE per tenant: that uniqueness IS the run-once guard.
    "name" TEXT NOT NULL,
    "rows_affected" INTEGER NOT NULL,
    -- What was done and why, in words, for whoever finds this in a year.
    "note" TEXT,
    "applied_by" TEXT,
    "applied_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_corrections_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "data_corrections_tenant_id_name_key"
  ON "data_corrections"("tenant_id", "name");

ALTER TABLE "data_corrections" ADD CONSTRAINT "data_corrections_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- APPEND-ONLY. A correction record that can be deleted is a run-once guard
-- that can be switched off by accident, which is the same as not having one.
-- (Same shape as the other append-only tables — see the PHASE 0 migration.)
ALTER TABLE "data_corrections" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_corrections" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "data_corrections"
  USING (tenant_id = current_setting('app.tenant_id', true));

CREATE OR REPLACE FUNCTION refuse_data_correction_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'data_corrections is append-only: a correction that ran cannot be un-recorded';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER data_corrections_no_delete
  BEFORE DELETE ON "data_corrections"
  FOR EACH ROW EXECUTE FUNCTION refuse_data_correction_delete();

CREATE TRIGGER data_corrections_no_truncate
  BEFORE TRUNCATE ON "data_corrections"
  FOR EACH STATEMENT EXECUTE FUNCTION refuse_data_correction_delete();
