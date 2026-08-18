/**
 * b1 PHASE 1 — THE PLATFORM'S PRESCRIPTION VOCABULARY.
 *
 * Data, not code. The rule the owner set is that no clinical value is hardcoded
 * in application logic — a frequency's daily count, a unit's Malay label and a
 * route's patient instruction are all facts about medicine, and they belong in
 * rows a clinic can read, extend and correct.
 *
 * Every row here is seeded as `SYSTEM`. The clinic cannot edit or delete these
 * through the API; it adds `CUSTOM` rows alongside. `sortOrder` is the order the
 * owner listed them in, which is clinical frequency-of-use rather than
 * alphabetical — the medicine a doctor reaches for should not be the one they
 * scroll to.
 */

export interface SeedFrequency {
  code: string;
  doctorDisplay: string;
  patientLabelBm: string;
  timesPerDay: number | null;
}

/**
 * 1A. `timesPerDay` is what quantity auto-compute multiplies by, and NULL means
 * "cannot be counted" rather than "one".
 *
 * PRN and STAT are the two that matter: a when-required painkiller has no daily
 * count, so computing "1 × 5 days = 5" for it would put a quantity on a
 * prescription that nobody decided. Auto-compute SKIPS them.
 *
 * `doctorDisplay` holds the standard expansion of each abbreviation, so the
 * prescriber's list reads as words and not only as initials. These are the
 * conventional meanings of the abbreviations, not clinical judgements: OD is
 * once daily wherever medicine is practised.
 */
export const SEED_FREQUENCIES: SeedFrequency[] = [
  { code: 'OD', doctorDisplay: 'Once daily', patientLabelBm: 'Sekali sehari', timesPerDay: 1 },
  { code: 'BD', doctorDisplay: 'Twice daily', patientLabelBm: 'Dua kali sehari', timesPerDay: 2 },
  { code: 'TDS', doctorDisplay: 'Three times a day', patientLabelBm: 'Tiga kali sehari', timesPerDay: 3 },
  { code: 'QID', doctorDisplay: 'Four times a day', patientLabelBm: 'Empat kali sehari', timesPerDay: 4 },
  { code: 'ON', doctorDisplay: 'At night', patientLabelBm: 'Sekali pada waktu malam', timesPerDay: 1 },
  { code: 'PRN', doctorDisplay: 'When required', patientLabelBm: 'Bila perlu', timesPerDay: null },
  { code: 'STAT', doctorDisplay: 'Immediately, single dose', patientLabelBm: 'Serta-merta (satu dos)', timesPerDay: null },
];

export interface SeedDosageUnit {
  systemNameEn: string;
  patientLabelBm: string;
  useCase: string | null;
}

/**
 * 1B. The doctor sees the English name; the label prints the Malay one.
 *
 * Four different English units share the Malay label BIJI, which is the point:
 * a patient counts pieces, and "biji" is what a piece is called regardless of
 * whether the clinic's system calls it a tablet, a capsule, a lozenge or a
 * suppository.
 */
export const SEED_DOSAGE_UNITS: SeedDosageUnit[] = [
  { systemNameEn: 'Tablet', patientLabelBm: 'BIJI', useCase: 'tablets' },
  { systemNameEn: 'Capsule', patientLabelBm: 'BIJI', useCase: 'capsules' },
  { systemNameEn: 'Lozenge', patientLabelBm: 'BIJI', useCase: 'lozenges' },
  { systemNameEn: 'Suppository', patientLabelBm: 'BIJI', useCase: 'rectal/vaginal' },
  { systemNameEn: 'Gram', patientLabelBm: 'g', useCase: 'injection/tab' },
  { systemNameEn: 'Millilitre', patientLabelBm: 'mL', useCase: 'syrup/liquid' },
  { systemNameEn: 'Drop', patientLabelBm: 'TITIS', useCase: 'eye/ear/nasal' },
  { systemNameEn: 'Milligram', patientLabelBm: 'mg', useCase: 'clinical dose, doctor view' },
  { systemNameEn: 'International Unit', patientLabelBm: 'IU', useCase: 'insulin' },
  { systemNameEn: 'Puff', patientLabelBm: 'SEDUTAN', useCase: 'inhalers/nasal sprays' },
  { systemNameEn: 'Unit', patientLabelBm: 'UNIT', useCase: 'insulin/pen injectors' },
  { systemNameEn: 'Application', patientLabelBm: 'SAPU', useCase: 'cream/ointment' },
];

export interface SeedConsumptionMethod {
  methodBilingual: string;
  patientInstructionBm: string;
}

/** 1C. The instruction is the row's reason for existing — it prints on the label. */
export const SEED_CONSUMPTION_METHODS: SeedConsumptionMethod[] = [
  { methodBilingual: 'ORAL (MAKAN/MINUM)', patientInstructionBm: 'Ambil melalui mulut' },
  { methodBilingual: 'SUBLINGUAL (BAWAH LIDAH)', patientInstructionBm: 'Letak di bawah lidah, biarkan larut' },
  { methodBilingual: 'BUCCAL (DALAM MULUT)', patientInstructionBm: 'Kemam / Biarkan larut' },
  { methodBilingual: 'TOPICAL (SAPU LUARAN)', patientInstructionBm: 'Sapu nipis pada kawasan terlibat' },
  { methodBilingual: 'PATCH/TRANSDERMAL (TAMPAL)', patientInstructionBm: 'Tampal pada kulit yang bersih dan kering' },
  { methodBilingual: 'EYE DROP (TITIS MATA)', patientInstructionBm: 'Titiskan ke dalam mata' },
  { methodBilingual: 'EAR DROP (TITIS TELINGA)', patientInstructionBm: 'Titiskan ke dalam telinga' },
  { methodBilingual: 'NASAL DROP (TITIS HIDUNG)', patientInstructionBm: 'Titiskan ke dalam hidung' },
  { methodBilingual: 'NASAL SPRAY (SEMBUR HIDUNG)', patientInstructionBm: 'Sembur ke dalam hidung' },
  { methodBilingual: 'INHALE (SEDUT)', patientInstructionBm: 'Sedut melalui mulut' },
  { methodBilingual: 'INTRAMUSCULAR–IM (SUNTIK OTOT)', patientInstructionBm: 'Suntikan ke dalam otot' },
  { methodBilingual: 'INTRAVENOUS–IV (SUNTIK VENA)', patientInstructionBm: 'Suntikan ke dalam salur darah' },
  { methodBilingual: 'SUBCUTANEOUS–SC (SUNTIK BAWAH KULIT)', patientInstructionBm: 'Suntikan di bawah kulit' },
  { methodBilingual: 'INTRADERMAL–ID (SUNTIK DALAM KULIT)', patientInstructionBm: 'Suntikan ke lapisan kulit' },
  { methodBilingual: 'PER RECTAL (MELALUI DUBUR)', patientInstructionBm: 'Digunakan melalui dubur' },
  { methodBilingual: 'PER VAGINAL (MELALUI VAGINA)', patientInstructionBm: 'Digunakan melalui faraj' },
  { methodBilingual: 'GARGLE (KUMUR)', patientInstructionBm: 'Kumur dan ludahkan' },
  { methodBilingual: 'ORAL TOPICAL (SPRAY TEKAK)', patientInstructionBm: 'Sembur ke arah tekak' },
  { methodBilingual: 'ORAL TOPICAL (UBAT DALAM MULUT)', patientInstructionBm: 'Sapu pada kawasan dalam mulut' },
];

export interface SeedIndication {
  labelEn: string;
  labelBm: string;
}

/**
 * 1D. Searchable in EITHER language, and selection stores both — the doctor
 * types in whichever language comes to mind and the label still prints Malay.
 */
export const SEED_INDICATIONS: SeedIndication[] = [
  { labelEn: 'Fever', labelBm: 'Demam' },
  { labelEn: 'Pain/Ache', labelBm: 'Sakit' },
  { labelEn: 'Headache/Migraine', labelBm: 'Sakit kepala/Migrain' },
  { labelEn: 'Dizziness/Vertigo', labelBm: 'Pening/Vertigo' },
  { labelEn: 'Nausea/Vomiting', labelBm: 'Loya/Muntah' },
  { labelEn: 'Diarrhea', labelBm: 'Cirit-birit' },
  { labelEn: 'Constipation', labelBm: 'Sembelit' },
  { labelEn: 'Cough', labelBm: 'Batuk' },
  { labelEn: 'Productive cough', labelBm: 'Batuk berkahak' },
  { labelEn: 'Dry cough', labelBm: 'Batuk tidak berkahak' },
  { labelEn: 'Common cold', labelBm: 'Selsema' },
  { labelEn: 'Allergic rhinitis', labelBm: 'Alahan hidung' },
  { labelEn: 'URTI', labelBm: 'Jangkitan salur pernafasan atas' },
  { labelEn: 'Blocked nose/Sinusitis', labelBm: 'Resdung/Sinus' },
  { labelEn: 'Sore throat/Tonsillitis', labelBm: 'Sakit tekak/Tonsil' },
  { labelEn: 'Pharyngitis', labelBm: 'Radang tekak' },
  { labelEn: 'Bronchitis', labelBm: 'Bronkitis' },
  { labelEn: 'Asthma/Wheezing', labelBm: 'Asma/Lelah' },
  { labelEn: 'Otitis externa', labelBm: 'Jangkitan telinga luar' },
  { labelEn: 'Otitis media', labelBm: 'Jangkitan telinga tengah' },
  { labelEn: 'Ear infection', labelBm: 'Jangkitan telinga' },
  { labelEn: 'Gastritis/Dyspepsia', labelBm: 'Gastrik' },
  { labelEn: 'Acid reflux/GERD', labelBm: 'Refluks asid' },
  { labelEn: 'Abdominal pain', labelBm: 'Sakit perut' },
  { labelEn: 'Bloating/Flatulence', labelBm: 'Kembung perut' },
  { labelEn: 'Indigestion', labelBm: 'Senak perut' },
  { labelEn: 'Loss of appetite', labelBm: 'Hilang selera makan' },
  { labelEn: 'Food poisoning', labelBm: 'Keracunan makanan' },
  { labelEn: 'Skin infection', labelBm: 'Jangkitan kulit' },
  { labelEn: 'Fungal infection', labelBm: 'Jangkitan kulat' },
  { labelEn: 'Eczema/Dermatitis', labelBm: 'Ekzema' },
  { labelEn: 'Contact dermatitis', labelBm: 'Dermatitis sentuhan' },
  { labelEn: 'Scabies', labelBm: 'Kudis buta' },
  { labelEn: 'Acne vulgaris', labelBm: 'Jerawat' },
  { labelEn: 'Warts', labelBm: 'Ketuat' },
  { labelEn: 'Itching/Rash', labelBm: 'Gatal/Ruam' },
  { labelEn: 'Urticaria', labelBm: 'Gatal-gatal (urtikaria)' },
  { labelEn: 'Insect bite', labelBm: 'Gigitan serangga' },
  { labelEn: 'Burn/Skin injury', labelBm: 'Luka bakar/Kecederaan kulit' },
  { labelEn: 'Muscle pain', labelBm: 'Sakit otot' },
  { labelEn: 'Joint pain/Swelling', labelBm: 'Sakit sendi/Bengkak' },
  { labelEn: 'Inflammation', labelBm: 'Radang' },
  { labelEn: 'Gout', labelBm: 'Gout' },
  { labelEn: 'Hypertension', labelBm: 'Darah tinggi' },
  { labelEn: 'Diabetes mellitus', labelBm: 'Kencing manis' },
  { labelEn: 'High cholesterol', labelBm: 'Kolesterol tinggi' },
  { labelEn: 'Anaemia', labelBm: 'Kurang darah' },
];

/**
 * 1E. How stock is COUNTED. The clinic does not add to this list: the number
 * beside it on each medicine is what deduction arithmetic depends on, and a
 * clinic-invented packaging word with no agreed meaning is a deduction nobody
 * can check.
 */
export const SEED_STOCK_UNITS: string[] = [
  'TABLET PER STRIP',
  'TABLET PER BOTTLE',
  'BOTTLE',
  'TAB PER PACK',
  'SHEETS PER PACK',
  'SACHET PER PACK',
  'AMPULE PER PACK',
  'AMPULE',
  'BOX',
  'PATCH PER BOX',
  'SACHET PER BOX',
  'TABLET PER BOX',
  'VIAL',
];

/**
 * INVENTORY PIECE 1 — the Malay half of each stock unit.
 *
 * Kuwick 1.0 prints a stock balance as "99 Strip / Papan", and the staff who
 * physically count the shelf read the second half. The English name stays the
 * identifier — it is what `@@unique([tenantId, name])` is on and what every
 * existing row points at — so the translation is a column beside it, seeded
 * here, rather than a rename that would orphan 13 references.
 *
 * A SEPARATE map rather than a field on `SEED_STOCK_UNITS`, because that array
 * is a plain `string[]` that four call sites and two specs already treat as
 * one; the drift a separate map risks is closed by the spec that asserts every
 * seeded unit appears here and nothing else does.
 *
 * `PAPAN` for strip, `BIJI` for a loose piece, `KEPING` for a sheet: the
 * clinic's own import data uses these words (the source pack strings include
 * "10 BIJI / STRIP"), so they are the shelf's vocabulary and not a dictionary's.
 */
export const SEED_STOCK_UNIT_MALAY: Record<string, string> = {
  'TABLET PER STRIP': 'TABLET PER PAPAN',
  'TABLET PER BOTTLE': 'TABLET PER BOTOL',
  BOTTLE: 'BOTOL',
  'TAB PER PACK': 'TAB PER PEKET',
  'SHEETS PER PACK': 'KEPING PER PEKET',
  'SACHET PER PACK': 'SASET PER PEKET',
  'AMPULE PER PACK': 'AMPUL PER PEKET',
  AMPULE: 'AMPUL',
  BOX: 'KOTAK',
  'PATCH PER BOX': 'TAMPAL PER KOTAK',
  'SACHET PER BOX': 'SASET PER KOTAK',
  'TABLET PER BOX': 'TABLET PER KOTAK',
  VIAL: 'VIAL',
};
