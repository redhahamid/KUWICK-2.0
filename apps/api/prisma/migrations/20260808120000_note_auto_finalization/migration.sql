-- G4.5d6 — clinical notes are FINALIZED when the visit closes, not signed by hand.
--
-- The old model asked a doctor to press "Sign" before a visit could be
-- completed. In a clinic running 100–200 patients a day that button is pressed
-- at the end of a session, in a batch, from memory — or it holds a patient at
-- the counter while somebody goes to find the doctor. Neither is good
-- documentation practice and the second is a queue defect.
--
-- The replacement keeps every medicolegal property and drops the ceremony: the
-- note stays editable while the visit is open, autosaves, and is finalized
-- automatically and immutably when the visit is completed.
--
-- WHY THESE COLUMNS. `signed_at` / `signed_by_staff_id` already exist and are
-- reused, because amendments key off SIGNED and a second lifecycle would be a
-- competing note model. But "signed" and "finalized on completion" are not the
-- same clinical act, and a record that cannot tell them apart is a record that
-- overstates what the clinician did. These three columns are what make the
-- difference legible years later.
ALTER TABLE "clinical_notes" ADD COLUMN "finalized_at" TIMESTAMP(3);
ALTER TABLE "clinical_notes" ADD COLUMN "finalized_by_staff_id" TEXT;
ALTER TABLE "clinical_notes" ADD COLUMN "finalization_mode" TEXT;

-- The staff member whose action closed the visit. NOT the clinical author —
-- authorship stays in author_staff_id and is never overwritten.
ALTER TABLE "clinical_notes"
  ADD CONSTRAINT "clinical_notes_finalized_by_staff_id_fkey"
  FOREIGN KEY ("finalized_by_staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Only two ways a note becomes immutable, and every finalized row must say
-- which. A row finalized by neither route is a row nobody can account for.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_finalization_mode_check" CHECK (
  "finalization_mode" IS NULL
  OR "finalization_mode" IN ('MANUAL_SIGN', 'AUTO_ON_VISIT_COMPLETION')
);

-- All-or-nothing, exactly like the existing signature-state check: a finalized
-- note carries its timestamp AND its mode, so a half-finalized row cannot
-- exist to be read as either.
ALTER TABLE "clinical_notes" ADD CONSTRAINT "clinical_notes_finalization_state_check" CHECK (
  ("finalized_at" IS NULL AND "finalization_mode" IS NULL)
  OR ("finalized_at" IS NOT NULL AND "finalization_mode" IS NOT NULL)
);

CREATE INDEX "clinical_notes_finalized_at_idx" ON "clinical_notes"("tenant_id", "finalized_at");

-- HISTORIC ROWS ARE NOT REWRITTEN. Notes signed by hand before this change
-- keep signed_at/signed_by_staff_id and get no finalization columns: they were
-- signed, and back-filling a mode would invent a fact about how that happened.
-- `finalization_mode IS NULL AND status = 'SIGNED'` is precisely "signed under
-- the old manual workflow", and it stays readable as that.
