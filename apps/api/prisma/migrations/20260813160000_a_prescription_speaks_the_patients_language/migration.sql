-- b1 PHASE A — the prescription carries what the LABEL has to say.
--
-- A printed label reads "2 BIJI, TDS (Tiga kali sehari), Ambil melalui mulut".
-- None of those Malay strings existed on the record: `frequency` held "TDS",
-- `unit` held "Tablet", and the patient-facing halves lived only in the
-- reference catalogues.
--
-- THESE ARE SNAPSHOTS, NOT FOREIGN KEYS, and that is the whole point.
--
--   A prescription is a statement about what a named person was told to take
--   on a named day. If it pointed at `prescription_frequencies` and somebody
--   later corrected that row's Malay label, every prescription ever written
--   would silently change — including ones already printed, already dispensed,
--   and already in a patient's hand. A reprint would then disagree with the
--   sticker on the bottle, with nothing in the record to explain it.
--
--   So the values are COPIED at the moment of prescribing. The catalogues
--   decide what a NEW prescription opens with; they have no authority over one
--   already written. This is the same rule as `Item.defaultDose*` — editing a
--   medicine's defaults affects future prescriptions only — stated once more
--   at the layer where it is actually enforced.
--
-- Every column is NULLABLE, and stays that way. Rows written before this
-- migration have no Malay label because none was captured, and inventing one
-- now would be this migration making a clinical claim about a prescription it
-- never saw. The label renderer omits what is absent.

ALTER TABLE "prescriptions"
  -- The patient's half of the dose: "BIJI" beside `unit`'s "Tablet".
  ADD COLUMN "dose_unit_bm" TEXT,
  -- The patient's half of the frequency: "Tiga kali sehari" beside `frequency`'s
  -- "TDS". The label prints both, because the code is what the clinic says to
  -- each other and the Malay is what the person taking the medicine reads.
  ADD COLUMN "frequency_bm" TEXT,
  -- What the doctor actually entered — "2 WEEK" rather than "14 days".
  -- `duration_days` remains the canonical computed figure and every existing
  -- reader keeps working; these two exist so the label and any later edit can
  -- show the course the way it was prescribed.
  ADD COLUMN "duration_value" INTEGER,
  ADD COLUMN "duration_unit" "DurationUnit",
  -- The route, bilingual and as one string: "ORAL (MAKAN/MINUM)".
  ADD COLUMN "consumption_method" TEXT,
  -- The sentence that PRINTS: "Ambil melalui mulut". A route with no
  -- instruction leaves the patient to guess, which is why 1C carries both.
  ADD COLUMN "consumption_instruction_bm" TEXT,
  -- The Malay indication. `indication` keeps whatever the doctor chose or
  -- typed; free text stays allowed, and free text has no translation.
  ADD COLUMN "indication_bm" TEXT;

COMMENT ON COLUMN "prescriptions"."frequency_bm" IS
  'Snapshot of the frequency''s patient label AT PRESCRIBING TIME. Deliberately not a foreign key: correcting a catalogue row must never rewrite a prescription already printed or dispensed.';

COMMENT ON COLUMN "prescriptions"."duration_days" IS
  'The canonical course length in days, computed server-side from duration_value and duration_unit (WEEK x7, MONTH x30). Every existing reader uses this; the pair above records how it was written.';
