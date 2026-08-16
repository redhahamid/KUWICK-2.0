-- "NO KNOWN ALLERGY" IS AN ANSWER, AND ALERTS COULD NOT EXPRESS IT.
--
-- `patient.allergies = []` carried a real clinical fact: somebody ASKED, and
-- the patient said none. Absence of an ALLERGY alert cannot say that — it means
-- "nobody has recorded one", which is the same shape as "nobody asked". The
-- difference is the whole reason the banner has three states rather than two,
-- and retiring `patient.allergies` without this value would quietly collapse
-- "asked, none known" into "not asked" for every patient who had been asked.
--
-- Its own migration because PostgreSQL will not let a new enum value be USED in
-- the transaction that adds it, and the next migration backfills with it.

ALTER TYPE "PatientAlertType" ADD VALUE 'NO_KNOWN_ALLERGY';

COMMENT ON TYPE "PatientAlertType" IS
  'ALLERGY forbids a prescription. NO_KNOWN_ALLERGY is the confirmed negative — '
  'somebody asked and the answer was none, which is different from nobody asking. '
  'MEDICAL qualifies rather than forbids. The rest are non-clinical standing facts.';
