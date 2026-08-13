import {
  CURATED_PRESCRIPTIONS,
  formDefaults,
  isWeightBased,
  standardPrescriptionFor,
} from './standard-prescription-seed';
import {
  SEED_CONSUMPTION_METHODS,
  SEED_DOSAGE_UNITS,
  SEED_FREQUENCIES,
} from './prescription-reference-seed';

// ===========================================================================
// PHASE 1G — WHAT A MEDICINE'S FORM OPENS WITH.
//
// These decide the starting point of a real prescription, so the tests that
// matter are the ones about RESTRAINT: that an unrecognised drug gets no dose,
// that a child's syrup gets no adult dose, and that a wrist splint gets nothing
// at all. A default that guesses is a dosing error with a UI in front of it.
// ===========================================================================

describe('every curated entry points at vocabulary that actually exists', () => {
  // A default referencing a frequency code or unit name the catalogue does not
  // hold silently becomes NULL on the item — the form opens blank and nobody
  // knows why. Cheap to check, and invisible without checking.
  const unitNames = new Set(SEED_DOSAGE_UNITS.map((u) => u.systemNameEn));
  const codes = new Set(SEED_FREQUENCIES.map((f) => f.code));
  const methods = new Set(SEED_CONSUMPTION_METHODS.map((m) => m.methodBilingual));

  it.each(CURATED_PRESCRIPTIONS.map((entry) => [String(entry.match), entry] as const))(
    '%s uses a real unit, frequency and route',
    (_label, entry) => {
      expect(unitNames.has(entry.unit)).toBe(true);
      expect(codes.has(entry.frequency)).toBe(true);
      expect(methods.has(entry.method)).toBe(true);
    },
  );
});

describe('the owner\'s worked examples', () => {
  it('PCM 500mg opens as 2 Tablet TDS for 5 days, orally', () => {
    const plan = standardPrescriptionFor('T. PCM 500MG (AXCEL)');
    expect(plan).toMatchObject({
      doseAmount: 2,
      doseUnit: 'Tablet',
      frequency: 'TDS',
      durationValue: 5,
      durationUnit: 'DAY',
      consumptionMethod: 'ORAL (MAKAN/MINUM)',
      basis: 'CURATED',
    });
  });

  it('Augmentin 625mg opens as 1 Tablet BD for 7 days', () => {
    expect(standardPrescriptionFor('T. AUGMENTIN (CO-AMOXICLAV) 625MG')).toMatchObject({
      doseAmount: 1,
      doseUnit: 'Tablet',
      frequency: 'BD',
      durationValue: 7,
      durationUnit: 'DAY',
    });
  });

  it('the golden path\'s own medicine is covered, under its plain staging name', () => {
    // The clinic's import prefixes forms ("T.", "SYP."); the staging seed does
    // not. `Paracetamol 500mg` matched nothing at all until the review CSV put
    // it in the "no defaults" list — which is what the CSV is for.
    expect(standardPrescriptionFor('Paracetamol 500mg')).toMatchObject({
      doseAmount: 2,
      frequency: 'TDS',
      basis: 'CURATED',
    });
  });
});

describe('restraint — what is deliberately NOT filled', () => {
  it('an unrecognised tablet gets a route and a unit, and NO dose', () => {
    const plan = standardPrescriptionFor('T. SOMETHING NOBODY CURATED 10MG');
    expect(plan.basis).toBe('FORM');
    expect(plan.doseUnit).toBe('Tablet');
    expect(plan.consumptionMethod).toBe('ORAL (MAKAN/MINUM)');
    // The three that would be a clinical claim.
    expect(plan.doseAmount).toBeNull();
    expect(plan.frequency).toBeNull();
    expect(plan.durationValue).toBeNull();
  });

  it('a child\'s syrup gets no dose amount — that belongs to the calculator', () => {
    const plan = standardPrescriptionFor('SYP. BROMHEXINE 4MG/5ML (AXCEL) 60ML');
    expect(plan.doseAmount).toBeNull();
    expect(plan.doseUnit).toBe('Millilitre');
    expect(plan.note).toMatch(/[Ww]eight-based/);
    expect(isWeightBased('SYP. BROMHEXINE 4MG/5ML (AXCEL) 60ML')).toBe(true);
  });

  it('a paediatric SUSPENSION counts as weight-based even without the SYP. prefix', () => {
    expect(isWeightBased('Paracetamol 125mg/5ml Suspension')).toBe(true);
    expect(standardPrescriptionFor('Paracetamol 125mg/5ml Suspension').doseAmount).toBeNull();
  });

  it.each([
    'ARM SLING ADULT',
    'SOAP BIOSULPHUR',
    'SPACER CHAMBER FOR INHALER CHILDREN (MEDIHANDS)',
    'FREE GIFT TUMBLER FOR GOOGLE REVIEW',
    'NEILMED SINUS RINSE BOTTLE WITH SACHET',
  ])('%s is not a medicine and gets nothing at all', (name) => {
    const plan = standardPrescriptionFor(name);
    expect(plan.basis).toBe('NONE');
    expect(plan.doseUnit).toBeNull();
    expect(plan.consumptionMethod).toBeNull();
    expect(plan.note).toMatch(/Not a medicine|not recognised/);
  });
});

describe('routes are read from the clinic\'s own naming conventions', () => {
  it.each([
    ['EYE DROP CIPROFLOXACIN (CIPMAX)', 'Drop', 'EYE DROP (TITIS MATA)'],
    ['EAR DROP OFLOXACIN 0.3% (EFFEXIN) 5ML', 'Drop', 'EAR DROP (TITIS TELINGA)'],
    ['CR. HYDROCORTISONE 1% (XEPACORT) 15G', 'Application', 'TOPICAL (SAPU LUARAN)'],
    ['IM. INFLUENZA VACCINE (INFLUVAC) 0.5ML', 'Millilitre', 'INTRAMUSCULAR–IM (SUNTIK OTOT)'],
    ['NASAL SPRAY MOMATE (60 DOSES)', 'Puff', 'NASAL SPRAY (SEMBUR HIDUNG)'],
    ['SUPP HYDROCORT+ BENZOCAINE+ZINC (DOPROCT)', 'Suppository', 'PER RECTAL (MELALUI DUBUR)'],
    ['CLOTRIMAZOLE PESSARY (USP)', 'Suppository', 'PER VAGINAL (MELALUI FARAJ)'.replace('FARAJ', 'VAGINA')],
    ['KETOPROFEN PLASTER 30MG (KETOTOP)', 'Application', 'PATCH/TRANSDERMAL (TAMPAL)'],
  ])('%s → %s, %s', (name, unit, method) => {
    const form = formDefaults(name);
    expect(form.unit).toBe(unit);
    expect(form.method).toBe(method);
  });

  it('a [PREORDER] marker does not hide the dosage form', () => {
    // 12 medicines got no route at all because every anchored rule was defeated
    // by the stock-availability marker the clinic puts in front of the name.
    // Found by reading the review CSV, not by the summary counts.
    expect(formDefaults('[PREORDER] T. COZAAR 50MG (LOSARTAN)')).toMatchObject({
      unit: 'Tablet',
      method: 'ORAL (MAKAN/MINUM)',
    });
  });
});

describe('combination products match before their components', () => {
  it('Tradol is not given paracetamol\'s dose', () => {
    // `T. TRADOL (TRAMADOL HCI 37.5MG / PCM 325MG)` contains "PCM". Matched in
    // the wrong order it would inherit 2 tablets TDS, which is a different and
    // wrong prescription.
    const plan = standardPrescriptionFor('T. TRADOL (TRAMADOL HCI 37.5MG / PCM 325MG)');
    expect(plan.doseAmount).toBe(1);
    expect(plan.frequency).toBe('TDS');
  });
});

describe('PRN and STAT are marked so auto-compute skips them', () => {
  it.each([
    ['LOZENGES STREPSILS SOOTHING (HONEY LEMON)', 'PRN'],
    ['STAT. TAB. ASPIRIN 300MG', 'STAT'],
    ['INHALER SALBUTAMOL (SALTAMOL)', 'PRN'],
  ])('%s defaults to %s', (name, code) => {
    expect(standardPrescriptionFor(name).frequency).toBe(code);
  });
});
