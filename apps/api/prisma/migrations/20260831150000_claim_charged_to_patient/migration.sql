-- G-5: a rejected claim charged to the patient instead.
--
-- One of the four routes out of a rejection in the clinic's own excess register
-- ("SELF PAY", then a payment method and date typed into other columns weeks
-- later). It is NOT a write-off: the money is still coming, from somebody else.
-- The receivable itself moves onto the invoice's patient/panel split, where
-- every other patient balance lives; these columns record that it happened,
-- who did it, and for how much.
ALTER TABLE "claim_batch_lines"
  ADD COLUMN "charged_to_patient_amount" DECIMAL(10,2),
  ADD COLUMN "charged_to_patient_at" TIMESTAMP(3),
  ADD COLUMN "charged_to_patient_by_staff_id" TEXT;

ALTER TABLE "claim_batch_lines"
  ADD CONSTRAINT "claim_batch_lines_charged_to_patient_by_staff_id_fkey"
  FOREIGN KEY ("charged_to_patient_by_staff_id") REFERENCES "staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
