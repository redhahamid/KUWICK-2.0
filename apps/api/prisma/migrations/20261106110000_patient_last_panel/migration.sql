-- THE PANEL A PATIENT CAME IN ON LAST (N-5).
--
-- Kuwick 1.0 remembered this and 2.0 did not — a regression nobody logged. A
-- panel patient's card number, employer and relationship were re-typed at every
-- visit, at the busiest moment of the day, from a card the patient has to find
-- in their wallet again.
--
-- A SUGGESTION, NEVER A COMMITMENT. These columns pre-fill the counter and do
-- nothing else. The visit still stores PENDING_VERIFICATION, staff still press
-- Verify, and the benefit terms are still snapshotted onto the visit (D-092).
-- A remembered panel that has since lapsed is caught by the same verification
-- step that catches one typed wrongly by hand.
--
-- NOT A HISTORY. "The last one" is the whole question the counter asks, and a
-- table of every panel a patient ever used would be read for its last row and
-- nothing else.
ALTER TABLE "patients" ADD COLUMN "last_panel_clinic_id" TEXT;
ALTER TABLE "patients" ADD COLUMN "last_panel_employer_id" TEXT;
ALTER TABLE "patients" ADD COLUMN "last_panel_member_reference" TEXT;
ALTER TABLE "patients" ADD COLUMN "last_panel_relationship" "PanelRelationship";

-- ON DELETE SET NULL on both: a panel or employer row going away must not take
-- a patient record with it, and losing a pre-fill is not worth a failed delete.
ALTER TABLE "patients"
    ADD CONSTRAINT "patients_last_panel_clinic_id_fkey"
        FOREIGN KEY ("last_panel_clinic_id") REFERENCES "panel_clinics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "patients"
    ADD CONSTRAINT "patients_last_panel_employer_id_fkey"
        FOREIGN KEY ("last_panel_employer_id") REFERENCES "panel_employers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- No index: these are read for ONE patient already fetched by id, never
-- searched across patients. An index here would be write cost for no read.
