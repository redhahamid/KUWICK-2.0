-- b1.5 FIX 3 — an allergy and a chronic condition are not the same alert.
--
-- `PatientAlertType.MEDICAL` held both, and the header chip rendered the lot
-- as one red line: "NSAIDS, AUGMENTIN, PCM, DM, HPT, OKU". Those are two
-- different clinical instructions wearing one colour. An allergy means DO NOT
-- PRESCRIBE; diabetes and hypertension mean take into account. A doctor
-- scanning that line has to know which of six words is which, which is exactly
-- the work the chip existed to save.
--
-- WHY A NEW ENUM VALUE RATHER THAN A DISPLAY RULE.
--
-- The only other way to split them is to read the label — treat a row as an
-- allergy if its text happens to contain "allergy". That is inferring a
-- clinical meaning from a string a human typed, and this codebase refuses that
-- everywhere it matters: the order type is read from the stored column and
-- never from the service's name, the standard-prescription seed leaves a dose
-- blank rather than guess it from a drug's title. A drug allergy is not a
-- safer place to start guessing.
--
-- It is the SAME store. One value on the existing enum, no second table, no
-- duplicated rows — the Phase D rule stands untouched.
--
-- EXISTING ROWS ARE NOT BACKFILLED. A `MEDICAL` alert reading "Penicillin
-- allergy" is almost certainly an allergy, and "almost certainly" is not good
-- enough to move a row into a do-not-prescribe list on a patient's behalf.
-- They stay MEDICAL, stay visible in the alerts view, and a clinician can
-- re-record them. Nothing disappears; nothing is silently reclassified.

ALTER TYPE "PatientAlertType" ADD VALUE 'ALLERGY';

COMMENT ON COLUMN "patient_alerts"."type" IS
  'ALLERGY is do-not-prescribe and feeds the allergy chip and the prescribing banner. MEDICAL is take-into-account (chronic conditions). Rows written before ALLERGY existed stay MEDICAL and are never inferred into ALLERGY from their label text.';
