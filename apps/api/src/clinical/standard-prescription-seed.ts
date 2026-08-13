/**
 * PHASE 1G — the conventional adult outpatient standard for each medicine.
 *
 * WHAT THIS IS AND IS NOT. These are the clinic's OWN data — editable in
 * Settings, never SYSTEM rows — and they decide only what the prescribing form
 * OPENS WITH. A doctor changes any field before signing, and editing a
 * medicine's defaults affects future prescriptions only; nothing already
 * prescribed or dispensed is touched.
 *
 * TWO TIERS, and the distinction is the safety property:
 *
 *   CURATED — a drug recognised by name, given the standard adult outpatient
 *   regimen it is actually prescribed on. Every entry here is a drug whose
 *   conventional adult dose is unambiguous.
 *
 *   FORM-DERIVED — everything else. From the dosage form alone (the catalogue's
 *   own "T.", "SYP.", "CR.", "EAR DROP" prefixes) we know the UNIT and the ROUTE
 *   and nothing more, so that is all that is filled. **Dose, frequency and
 *   duration stay EMPTY.**
 *
 * The rule that governs both: an unrecognised drug gets no dose. A default is a
 * convenience, and a convenience that guesses a dose for a real medicine is a
 * dosing error with a UI in front of it. Empty is a correct answer and the form
 * handles it — a medicine with no defaults opens blank, exactly as today.
 *
 * PAEDIATRIC AND WEIGHT-BASED preparations get unit, route and (where standard)
 * frequency, but NO dose amount: the dose is a function of the child's weight
 * and belongs to the calculator, not to a default.
 *
 * The whole result is written to `docs/seed-review/standard-prescriptions.csv`
 * for the owner — a doctor — to audit in one pass, because a list this long is
 * not reviewable in a database and every row here is a clinical claim.
 */

export type SeedDurationUnit = 'DAY' | 'WEEK' | 'MONTH';

export interface StandardPrescription {
  /** Null where no fixed adult dose applies — weight-based, or unrecognised. */
  doseAmount: number | null;
  /** `DosageUnit.systemNameEn`. */
  doseUnit: string | null;
  /** `PrescriptionFrequency.code`. */
  frequency: string | null;
  durationValue: number | null;
  durationUnit: SeedDurationUnit | null;
  /** Null lets the form's own auto-compute decide. */
  quantity: number | null;
  /** `ConsumptionMethodRef.methodBilingual`. */
  consumptionMethod: string | null;
  /** CURATED or FORM — reported in the review CSV so the owner can sort by it. */
  basis: 'CURATED' | 'FORM' | 'NONE';
  /** Why a field was left empty, for the reviewer. */
  note: string | null;
}

const ORAL = 'ORAL (MAKAN/MINUM)';
const TOPICAL = 'TOPICAL (SAPU LUARAN)';
const EYE = 'EYE DROP (TITIS MATA)';
const EAR = 'EAR DROP (TITIS TELINGA)';
const NASAL_SPRAY = 'NASAL SPRAY (SEMBUR HIDUNG)';
const NASAL_DROP = 'NASAL DROP (TITIS HIDUNG)';
const INHALE = 'INHALE (SEDUT)';
const IM = 'INTRAMUSCULAR–IM (SUNTIK OTOT)';
const IV = 'INTRAVENOUS–IV (SUNTIK VENA)';
const SC = 'SUBCUTANEOUS–SC (SUNTIK BAWAH KULIT)';
const RECTAL = 'PER RECTAL (MELALUI DUBUR)';
const VAGINAL = 'PER VAGINAL (MELALUI VAGINA)';
const GARGLE = 'GARGLE (KUMUR)';
const BUCCAL = 'BUCCAL (DALAM MULUT)';
const SUBLINGUAL = 'SUBLINGUAL (BAWAH LIDAH)';
const ORAL_SPRAY = 'ORAL TOPICAL (SPRAY TEKAK)';
const ORAL_PASTE = 'ORAL TOPICAL (UBAT DALAM MULUT)';
const PATCH = 'PATCH/TRANSDERMAL (TAMPAL)';

interface CuratedEntry {
  /** Matched case-insensitively against the medicine's name. */
  match: RegExp;
  dose: number | null;
  unit: string;
  frequency: string;
  durationValue: number | null;
  durationUnit: SeedDurationUnit | null;
  method: string;
  note?: string;
}

/**
 * The drugs this clinic's own catalogue carries whose adult outpatient regimen
 * is conventional and unambiguous.
 *
 * Ordered most-specific first: a combination product must match before either
 * of its components. `T. TRADOL (TRAMADOL HCI 37.5MG / PCM 325MG)` has to be
 * caught before the plain paracetamol rule, or it inherits the wrong dose.
 */
export const CURATED_PRESCRIPTIONS: CuratedEntry[] = [
  // --- Plainly-named rows from the staging seed ---------------------------
  //
  // The clinic's import prefixes its dosage forms ("T.", "SYP."); the staging
  // and E2E seeds do not, so these matched nothing at all until the review CSV
  // showed it — including `Paracetamol 500mg`, which is the golden path's own
  // medicine and the owner's worked example.
  { match: /^Paracetamol 500mg$/i, dose: 2, unit: 'Tablet', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /^Amoxicillin 500mg$/i, dose: 1, unit: 'Capsule', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /^Cetirizine 10mg$/i, dose: 1, unit: 'Tablet', frequency: 'ON', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /^Ibuprofen 400mg$/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /^Omeprazole 20mg$/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 14, durationUnit: 'DAY', method: ORAL },

  // --- Analgesia / antipyretic -------------------------------------------
  { match: /TRADOL|TRAMADOL HCI 37\.5MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /PCM 450MG\+ORPHENADRINE|ANAREX/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. PCM 500MG/i, dose: 2, unit: 'Tablet', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /MEFENAMIC ACID 500MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. DICLOFENAC 50MG/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /NAPROXEN 550MG/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /CELECOXIB 200MG/i, dose: 1, unit: 'Capsule', frequency: 'OD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /C\. TRAMADOL 50MG/i, dose: 1, unit: 'Capsule', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },

  // --- Antibiotics -------------------------------------------------------
  { match: /T\. AUGMENTIN.*625MG|CO-AMOXICLAV.*625MG/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /SULTAMICILLIN 375MG|UNASYN/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /CEPHALEXIN 250MG/i, dose: 1, unit: 'Capsule', frequency: 'QID', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /CLOXACILIN 250MG|CLOXACILLIN 250MG/i, dose: 1, unit: 'Capsule', frequency: 'QID', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /CEFUROXIME 250MG|ZINNAT 250MG|XYLID/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /AZITHROMYCIN \(AXCEL\) 500MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /CLARITHROMYCIN 250MG/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /CIPROFLOXACIN.*500MG|CIPRICIN/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /DOXYCYCLINE 100MG/i, dose: 1, unit: 'Capsule', frequency: 'BD', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /METRONIDAZOLE 400MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },

  // --- Antihistamines / respiratory --------------------------------------
  { match: /T\. CETIRIZINE 10MG/i, dose: 1, unit: 'Tablet', frequency: 'ON', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /T\. CHLORPHENIRAMINE 4MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /BILAXTEN 20MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /BILAXTEN ODT 10MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /T\. MONTELUKAST 10MG|SINGULAIR 10MG/i, dose: 1, unit: 'Tablet', frequency: 'ON', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /CLOPERASTINE HCL 10MG|COPASTIN/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. MUCOCLEAR 30MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },

  // --- Gastro -------------------------------------------------------------
  { match: /T\. PANTOPRAZOLE 40MG|CONPANZOLE/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 14, durationUnit: 'DAY', method: ORAL },
  { match: /T\. HYOSCINE 10MG|FUCON/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. METOCLOPRAMIDE 10MG/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /ITOPRIDE 50MG|GANATON/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /LOPERAMIDE 2MG|LORAMIDE/i, dose: 1, unit: 'Capsule', frequency: 'PRN', durationValue: 3, durationUnit: 'DAY', method: ORAL, note: 'PRN — auto-compute deliberately skipped' },
  { match: /DULCOLAX 5MG|BISACODYL/i, dose: 1, unit: 'Tablet', frequency: 'ON', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. CHARCOAL/i, dose: 2, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },

  // --- Chronic disease (repeat supply: one month) -------------------------
  { match: /AMLODIPINE.*10MG|ANLODIN/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /PERINDOPRIL 4MG|PROVINACE|COVERSYL/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /ATORVASTATIN 20MG|LIPITOR|ROSUVASTATIN 20MG|CRESTOR/i, dose: 1, unit: 'Tablet', frequency: 'ON', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /T\. METFORMIN 500MG/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /ALLOPURINOL 100MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /COLCHICINE 0\.6MG|GOUTNOR/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /CARBIMAZOLE 5MG|CAMAZOL/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 1, durationUnit: 'MONTH', method: ORAL },

  // --- Steroids, vitamins, other orals ------------------------------------
  { match: /T\. PREDNISOLONE 5MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 5, durationUnit: 'DAY', method: ORAL, note: 'Review for tapering where indicated' },
  { match: /DEXAMETHASONE 0\.75MG|DECAN/i, dose: 1, unit: 'Tablet', frequency: 'BD', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /T\. FOLIC ACID 5MG/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /NEUROBINE|BIONERV/i, dose: 1, unit: 'Tablet', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },
  { match: /TRANEXAMIC 250MG|TRANSAMIN/i, dose: 2, unit: 'Tablet', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: ORAL },
  { match: /NORETHISTERONE 5MG|NORCOLUT/i, dose: 1, unit: 'Tablet', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /ALBENDAZOLE.*200MG|ZENTEL/i, dose: 2, unit: 'Tablet', frequency: 'STAT', durationValue: 1, durationUnit: 'DAY', method: ORAL, note: 'STAT — auto-compute deliberately skipped' },
  { match: /VIRLESS.*800MG|ACYCLOVIR.*800MG/i, dose: 1, unit: 'Tablet', frequency: 'QID', durationValue: 7, durationUnit: 'DAY', method: ORAL },
  { match: /OSELTAMIVIR 75MG|FLUHALT/i, dose: 1, unit: 'Capsule', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: ORAL },
  { match: /FUKOLE 150MG|FLUCONAZOLE/i, dose: 1, unit: 'Capsule', frequency: 'STAT', durationValue: 1, durationUnit: 'DAY', method: ORAL, note: 'STAT — auto-compute deliberately skipped' },
  { match: /ZINCOFER|HAEMATINIC/i, dose: 1, unit: 'Capsule', frequency: 'OD', durationValue: 1, durationUnit: 'MONTH', method: ORAL },

  // --- Sublingual / emergency ---------------------------------------------
  { match: /NITROGLYCERIN SL|GTN/i, dose: 1, unit: 'Tablet', frequency: 'PRN', durationValue: null, durationUnit: null, method: SUBLINGUAL, note: 'Emergency use — PRN, no course length' },
  { match: /ASPIRIN 300MG/i, dose: 1, unit: 'Tablet', frequency: 'STAT', durationValue: 1, durationUnit: 'DAY', method: ORAL, note: 'STAT — auto-compute deliberately skipped' },

  // --- Lozenges and gargles -----------------------------------------------
  { match: /LOZENGES/i, dose: 1, unit: 'Lozenge', frequency: 'PRN', durationValue: 3, durationUnit: 'DAY', method: BUCCAL },
  { match: /GARGLE|ORAFLAM/i, dose: 10, unit: 'Millilitre', frequency: 'TDS', durationValue: 5, durationUnit: 'DAY', method: GARGLE },

  // --- Suppositories --------------------------------------------------------
  { match: /SUPP.*PCM 250MG/i, dose: 1, unit: 'Suppository', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: RECTAL },
  { match: /SUPP.*PCM 125MG/i, dose: 1, unit: 'Suppository', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: RECTAL },
  { match: /SUPP.*DIMENHYDRINATE|GRAVOL/i, dose: 1, unit: 'Suppository', frequency: 'TDS', durationValue: 3, durationUnit: 'DAY', method: RECTAL },
  { match: /SUPP.*DOPROCT|HYDROCORT\+ BENZOCAINE/i, dose: 1, unit: 'Suppository', frequency: 'BD', durationValue: 5, durationUnit: 'DAY', method: RECTAL },
  { match: /CLOTRIMAZOLE PESSARY/i, dose: 1, unit: 'Suppository', frequency: 'ON', durationValue: 6, durationUnit: 'DAY', method: VAGINAL },

  // --- Inhalers -------------------------------------------------------------
  { match: /INHALER SALBUTAMOL|SALTAMOL/i, dose: 2, unit: 'Puff', frequency: 'PRN', durationValue: null, durationUnit: null, method: INHALE, note: 'Reliever — PRN, no course length' },
  { match: /INHALER FLUTICASONE|FLOHALE/i, dose: 2, unit: 'Puff', frequency: 'BD', durationValue: 1, durationUnit: 'MONTH', method: INHALE },
  { match: /SYMBICORT|SERETIDE|FOSTER/i, dose: 2, unit: 'Puff', frequency: 'BD', durationValue: 1, durationUnit: 'MONTH', method: INHALE },
];

/**
 * The dosage form, read from the catalogue's own naming conventions.
 *
 * These prefixes are the clinic's, not ours: "T.", "C.", "SYP.", "CR.", "IM.",
 * "SUPP", "EAR DROP". Reading them is how a route can be filled for a medicine
 * nobody has curated — and route is the field most worth having, because it is
 * the one a patient label cannot omit.
 */
export function formDefaults(name: string): { unit: string | null; method: string | null; note: string | null } {
  // `[PREORDER] T. COZAAR 50MG` is a tablet. The marker is a stock-availability
  // note the clinic puts in front of the name, and it defeated every anchored
  // form rule below — 12 medicines got no route at all until the review CSV
  // showed them sitting together in the "no defaults" list.
  const n = name.toUpperCase().replace(/^\s*\[PREORDER\]\s*/, '');

  // Not medicines at all. A dressing, a soap or a tumbler must never acquire a
  // dose, a route or a frequency.
  if (/ARM SLING|TUMBLER|SPACER CHAMBER|SINUS RINSE BOTTLE|RINSE SACHET PACKET|SOAP |FREE GIFT/.test(n)) {
    return { unit: null, method: null, note: 'Not a medicine — no prescription defaults' };
  }

  if (/^EYE DROP|EYE DROP/.test(n)) return { unit: 'Drop', method: EYE, note: null };
  if (/EYE OINT|OINT.*EYE/.test(n)) return { unit: 'Application', method: EYE, note: null };
  if (/^EAR DROP|EAR DROP|EAR WAX/.test(n)) return { unit: 'Drop', method: EAR, note: null };
  if (/NASAL SPRAY|RYALTRIS/.test(n)) return { unit: 'Puff', method: NASAL_SPRAY, note: null };
  if (/ILIADIN DROP/.test(n)) return { unit: 'Drop', method: NASAL_DROP, note: null };
  if (/THROAT SPRAY|ALOCLAIR/.test(n)) return { unit: 'Puff', method: ORAL_SPRAY, note: null };
  if (/ORAL PASTE|DEXALTIN/.test(n)) return { unit: 'Application', method: ORAL_PASTE, note: null };
  if (/INHALER/.test(n)) return { unit: 'Puff', method: INHALE, note: null };
  if (/PATCH|PLASTER/.test(n)) return { unit: 'Application', method: PATCH, note: null };
  if (/^CR\.|^LOTION|^GEL|DICLOFENAC GEL|CALAMINE|MOISTURISING LOTION|VANICREAM/.test(n)) {
    return { unit: 'Application', method: TOPICAL, note: null };
  }
  if (/^OINT\./.test(n)) return { unit: 'Application', method: TOPICAL, note: null };
  if (/^SUPP/.test(n)) return { unit: 'Suppository', method: RECTAL, note: null };
  if (/PESSARY/.test(n)) return { unit: 'Suppository', method: VAGINAL, note: null };
  if (/ENEMA/.test(n)) return { unit: 'Millilitre', method: RECTAL, note: null };
  if (/^S\/C|SUBCUTANEOUS|MOUNJARO/.test(n)) return { unit: 'Millilitre', method: SC, note: null };
  if (/^IV\.|^IV\//.test(n)) return { unit: 'Millilitre', method: IV, note: null };
  if (/^IM\.|VACCINE/.test(n)) return { unit: 'Millilitre', method: IM, note: null };
  if (/^SYP\.|SUSPENSION|^SACH\.|SACHET|^ORS|LINCTUS|SOLUBLE|ORAL ROTAVIRUS/.test(n)) {
    return { unit: 'Millilitre', method: ORAL, note: null };
  }
  if (/^T\.|^STAT\. TAB|TABLET/.test(n)) return { unit: 'Tablet', method: ORAL, note: null };
  if (/^C\./.test(n)) return { unit: 'Capsule', method: ORAL, note: null };
  if (/LOZENGES/.test(n)) return { unit: 'Lozenge', method: BUCCAL, note: null };

  return { unit: null, method: null, note: 'Dosage form not recognised from the name' };
}

/** True where the preparation is dosed by a child's weight rather than fixed. */
export function isWeightBased(name: string): boolean {
  const n = name.toUpperCase().replace(/^\s*\[PREORDER\]\s*/, '');
  // Syrups and paediatric drops in this catalogue are children's preparations:
  // the dose comes from the calculator and mg/kg, never from a default.
  return /^SYP\.|SUSPENSION|INFANT|CHILDREN|KIDS|PAEDICOF|RACETASH/.test(n);
}

/**
 * The default for one medicine. Curated where the drug is recognised, otherwise
 * form-derived, otherwise nothing.
 */
export function standardPrescriptionFor(name: string): StandardPrescription {
  const curated = CURATED_PRESCRIPTIONS.find((entry) => entry.match.test(name));
  if (curated) {
    return {
      doseAmount: curated.dose,
      doseUnit: curated.unit,
      frequency: curated.frequency,
      durationValue: curated.durationValue,
      durationUnit: curated.durationUnit,
      quantity: null,
      consumptionMethod: curated.method,
      basis: 'CURATED',
      note: curated.note ?? null,
    };
  }

  const form = formDefaults(name);
  if (!form.unit && !form.method) {
    return {
      doseAmount: null,
      doseUnit: null,
      frequency: null,
      durationValue: null,
      durationUnit: null,
      quantity: null,
      consumptionMethod: null,
      basis: 'NONE',
      note: form.note,
    };
  }

  return {
    doseAmount: null,
    doseUnit: form.unit,
    frequency: null,
    durationValue: null,
    durationUnit: null,
    quantity: null,
    consumptionMethod: form.method,
    basis: 'FORM',
    note: isWeightBased(name)
      ? 'Weight-based paediatric preparation — dose comes from the calculator, never a default'
      : (form.note ?? 'Route and unit only — no conventional fixed adult dose was assumed'),
  };
}
