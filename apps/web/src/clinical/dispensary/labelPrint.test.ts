import { describe, expect, it, vi } from 'vitest';
import {
  LABEL_PRESET,
  MAX_LABEL_COPIES,
  PRINTING_CLASS,
  buildLabelLayout,
  directionsText,
  medicationText,
  printLabelSheet,
} from './labelPrint';
import { canViewDispensary } from './dispensaryAccess';
import type { LabelPayload } from '../hooks/useDispensary';

// ===========================================================================
// G4.5d5b-3 — THE LABEL
//
// A medication label is the only thing in this product that leaves the clinic
// attached to something a patient will swallow. These tests are mostly about
// what does NOT appear on it: the owner's rule is that nothing may be
// fabricated, and the failure mode is a plausible default nobody notices.
// ===========================================================================

const PAYLOAD: LabelPayload = {
  prescriptionId: 'rx-1',
  clinic: { name: 'Klinik Hijraa', branch: null },
  patient: { name: 'Siti Nurhaliza binti Ahmad', identifier: '900101-14-5566' },
  medication: {
    name: 'Amoxicillin',
    strength: '500mg',
    doseAmount: '2',
    doseUnit: 'capsule',
    frequency: 'three times daily',
    durationDays: 5,
    quantity: 30,
    indication: null,
    remark: null,
    // Written before the snapshot existed — the honest state for every
    // prescription already in the database, and for any surface that does not
    // use the catalogue dropdowns.
    doseUnitBm: null,
    frequencyBm: null,
    consumptionInstructionBm: null,
    indicationBm: null,
    durationValue: null,
    durationUnit: null,
  },
  prescriber: 'Dr Amira Rahman',
  processedBy: 'Siti Front Desk',
  dispensedBy: null,
  visitReference: 'V-2026-0042',
  printedAt: '2026-08-06T02:15:00.000Z',
  copies: 1,
  labelFormat: 'KUWICK_STD_70x40',
  printSequence: 1,
  isReprint: false,
};

const withMedication = (over: Partial<LabelPayload['medication']>): LabelPayload => ({
  ...PAYLOAD,
  medication: { ...PAYLOAD.medication, ...over },
});

describe('the directions', () => {
  it('1. read as a sentence a patient can follow', () => {
    expect(directionsText(PAYLOAD.medication)).toBe('Take 2 capsule three times daily for 5 days');
  });

  it('2. omit the unit where the prescription has none', () => {
    // "Take 2 tablets" when the record does not say tablets is a guess about
    // a physical object in somebody's hand.
    expect(directionsText({ ...PAYLOAD.medication, doseUnit: null })).toBe(
      'Take 2 three times daily for 5 days',
    );
  });

  it('3. use the singular for a one-day course', () => {
    expect(directionsText({ ...PAYLOAD.medication, durationDays: 1 })).toMatch(/for 1 day$/);
  });

  it('4. omit the duration entirely where there is none', () => {
    // Not "for 0 days", which reads as an instruction not to take it.
    const text = directionsText({ ...PAYLOAD.medication, durationDays: 0 });
    expect(text).toBe('Take 2 capsule three times daily');
    expect(text).not.toMatch(/0 days/);
  });

  it('5. never expand the frequency into times of day', () => {
    // Turning "three times daily" into 8am/2pm/8pm would be this module
    // making a clinical decision the prescriber did not.
    expect(directionsText(PAYLOAD.medication)).not.toMatch(/\d{1,2}\s?(am|pm|:)/i);
  });

  it('6. never turn the duration into a stop date', () => {
    expect(directionsText(PAYLOAD.medication)).not.toMatch(/until|\d{1,2}\/\d{1,2}/);
  });
});

describe('the medicine name', () => {
  it('7. carries the strength where the item stores one', () => {
    expect(medicationText(PAYLOAD.medication)).toBe('Amoxicillin 500mg');
  });

  it('8. stands alone where it does not', () => {
    expect(medicationText({ ...PAYLOAD.medication, strength: null })).toBe('Amoxicillin');
  });
});

describe('what the label refuses to invent', () => {
  const layout = buildLabelLayout(PAYLOAD);
  const flat = JSON.stringify(layout).toLowerCase();

  it('9. no generic name, dosage form or route', () => {
    // The schema carries none of these. A route printed wrongly on a label is
    // a patient-safety defect, not a cosmetic gap.
    expect(flat).not.toMatch(/generic|oral|topical|intramuscular|subcutaneous|dosage form/);
  });

  it('10. no structured warning block', () => {
    expect(flat).not.toMatch(/drowsi|do not drive|keep out of reach|complete the course/);
  });

  it('11. no translation of the directions', () => {
    // Bahasa Malaysia instructions would need approved clinical wording and a
    // language field; the product has neither.
    expect(flat).not.toMatch(/ambil|sehari|kali sehari|ubat/);
  });

  it('12. no barcode or QR payload', () => {
    expect(flat).not.toMatch(/barcode|qrcode|qr code/);
  });

  it('13. an absent optional field is absent, not a labelled blank', () => {
    // "For: —" reads as a decision somebody made.
    expect(layout.extras).toEqual([]);
    expect(flat).not.toMatch(/"value":"—"/);
  });

  it('14. a present optional field is carried through verbatim', () => {
    const withExtras = buildLabelLayout(
      withMedication({ indication: 'Chest infection', remark: 'Take after food' }),
    );
    expect(withExtras.extras).toEqual([
      { label: 'For', value: 'Chest infection' },
      { label: 'Note', value: 'Take after food' },
    ]);
  });
});

describe('the label as a whole', () => {
  it('15. names the clinic, and adds the branch only when there is one', () => {
    expect(buildLabelLayout(PAYLOAD).header).toBe('Klinik Hijraa');
    expect(
      buildLabelLayout({ ...PAYLOAD, clinic: { name: 'Klinik Hijraa', branch: 'Bangi' } }).header,
    ).toBe('Klinik Hijraa — Bangi');
  });

  it('16. carries the patient and their identifier', () => {
    const layout = buildLabelLayout(PAYLOAD);
    expect(layout.patient).toBe('Siti Nurhaliza binti Ahmad');
    expect(layout.patientIdentifier).toBe('900101-14-5566');
  });

  it('17. states the quantity with its word, not a bare number', () => {
    expect(buildLabelLayout(PAYLOAD).quantity).toBe('Quantity: 30');
  });

  it('18. attributes the prescription, the print and the visit', () => {
    const labels = buildLabelLayout(PAYLOAD).footer.map((line) => line.label);
    expect(labels).toContain('Prescribed by');
    expect(labels).toContain('Printed');
    expect(labels).toContain('Visit');
  });

  it('19. names the dispenser only once the medicine has been handed over', () => {
    // A label is not evidence of dispensing. Before the hand-over the line is
    // absent rather than empty.
    expect(buildLabelLayout(PAYLOAD).footer.map((l) => l.label)).not.toContain('Dispensed by');
    const dispensed = buildLabelLayout({ ...PAYLOAD, dispensedBy: 'Siti Front Desk' });
    expect(dispensed.footer).toContainEqual({ label: 'Dispensed by', value: 'Siti Front Desk' });
  });

  it('20. marks a reprint on the label itself', () => {
    // Two identical labels in one bag, one of them a duplicate, is exactly
    // the situation this line exists for.
    expect(buildLabelLayout(PAYLOAD).reprintNotice).toBeNull();
    expect(buildLabelLayout({ ...PAYLOAD, isReprint: true, printSequence: 2 }).reprintNotice).toBe(
      'Reprint #2',
    );
  });

  it('21. survives an unusable print timestamp without printing NaN', () => {
    const layout = buildLabelLayout({ ...PAYLOAD, printedAt: 'not a date' });
    expect(layout.footer.find((line) => line.label === 'Printed')?.value).toBe('—');
  });
});

describe('the print preset', () => {
  it('22. is a documented, changeable pair of numbers', () => {
    expect(LABEL_PRESET).toMatchObject({ format: 'KUWICK_STD_70x40', widthMm: 70, heightMm: 40 });
  });

  it('23. bounds copies exactly as the server does', () => {
    expect(MAX_LABEL_COPIES).toBe(3);
  });
});

describe('printing', () => {
  /** Just enough <body> to observe the class going on and coming off. */
  function fakeWindow(print: () => void) {
    const classes = new Set<string>();
    const body = {
      classList: {
        add: (name: string) => classes.add(name),
        remove: (name: string) => classes.delete(name),
      },
    };
    return { win: { document: { body }, print } as unknown as Window, classes };
  }

  it('24. goes through the browser dialog, with the print class applied around it', () => {
    // No silent printer integration and no printer SDK: the user sees the
    // standard dialog and can cancel.
    const seen: boolean[] = [];
    const { win, classes } = fakeWindow(() => seen.push(classes.has(PRINTING_CLASS)));
    printLabelSheet(win);
    expect(seen).toEqual([true]);
    expect(classes.has(PRINTING_CLASS)).toBe(false);
  });

  it('25. removes the print class even when the dialog throws', () => {
    // A stuck print class hides the whole application behind a blank page.
    const { win, classes } = fakeWindow(() => {
      throw new Error('no printer');
    });
    expect(() => printLabelSheet(win)).toThrow('no printer');
    expect(classes.has(PRINTING_CLASS)).toBe(false);
  });
});

describe('who is offered the dispensary', () => {
  it('26. the counter roles and the doctors', () => {
    for (const role of ['OWNER_ADMIN', 'FRONT_DESK_CLINICAL_STAFF', 'DOCTOR_RESIDENT', 'DOCTOR_LOCUM']) {
      expect(canViewDispensary(role)).toBe(true);
    }
  });

  it('27. stock staff, who may look but not hand over', () => {
    expect(canViewDispensary('STOCK_STAFF')).toBe(true);
  });

  it('28. not finance, and not an absent role', () => {
    expect(canViewDispensary('FINANCE_STAFF')).toBe(false);
    expect(canViewDispensary(null)).toBe(false);
    expect(canViewDispensary(undefined)).toBe(false);
    expect(canViewDispensary('')).toBe(false);
  });

  it('29. no DISPENSARY_STAFF role was introduced', () => {
    // The owner's v1 decision, pinned: a small Malaysian clinic has no
    // dedicated dispenser, and a new role is a migration plus a permission
    // surface everywhere else in the product.
    expect(canViewDispensary('DISPENSARY_STAFF')).toBe(false);
  });
});

// ===========================================================================
// b1 PHASE A — THE PATIENT'S LANGUAGE ON THE LABEL.
//
// The person holding the bottle reads Malay. What matters here is that both
// halves print together when the record has them, and that a record without
// them prints ONE half rather than an empty bracket — a prescription written
// before the snapshot existed must still produce a usable sticker.
// ===========================================================================

const BILINGUAL: LabelPayload = {
  ...PAYLOAD,
  medication: {
    ...PAYLOAD.medication,
    doseAmount: '2',
    doseUnit: 'Tablet',
    doseUnitBm: 'BIJI',
    frequency: 'TDS',
    frequencyBm: 'Tiga kali sehari',
    consumptionInstructionBm: 'Ambil melalui mulut',
    indication: 'Fever',
    indicationBm: 'Demam',
    durationValue: 5,
    durationUnit: 'DAY',
  },
};

describe('the directions print in both languages', () => {
  it('carries the Malay beside the dose unit and the frequency code', () => {
    expect(directionsText(BILINGUAL.medication)).toBe(
      'Take 2 Tablet (BIJI) TDS (Tiga kali sehari) for 5 days',
    );
  });

  it('prints ONE half rather than an empty bracket when there is no Malay', () => {
    // Every prescription already in the database is in this state, and so is
    // anything written through a surface that does not use the dropdowns.
    // "TDS ()" on a 40mm label reads as a missing value, not an absent one.
    expect(directionsText(PAYLOAD.medication)).toBe('Take 2 capsule three times daily for 5 days');
  });

  it('does not invent a Malay label for one half from the other', () => {
    const halfKnown = { ...BILINGUAL.medication, frequencyBm: null };
    const text = directionsText(halfKnown);
    expect(text).toContain('Tablet (BIJI)');
    expect(text).toContain('TDS ');
    expect(text).not.toContain('TDS (');
  });
});

describe('how to take it is on the label, in the patient\'s language', () => {
  it('prints the consumption instruction, and puts it FIRST', () => {
    // Ahead of the indication and the doctor's note: this is the line that
    // stops an oral suspension being used as ear drops.
    const layout = buildLabelLayout(BILINGUAL);
    expect(layout.extras[0]).toEqual({ value: 'Ambil melalui mulut' });
  });

  it('omits it entirely when the prescription has none', () => {
    // No labelled blank. An empty "How to take:" line reads as "no special
    // instructions", which is a claim nobody made.
    const layout = buildLabelLayout(PAYLOAD);
    expect(layout.extras.every((line) => line.value !== '')).toBe(true);
    expect(JSON.stringify(layout.extras)).not.toContain('melalui');
  });

  it('shows the indication in both languages where it came from the catalogue', () => {
    const layout = buildLabelLayout(BILINGUAL);
    expect(layout.extras).toContainEqual({ label: 'For', value: 'Fever (Demam)' });
  });

  it('leaves typed free text untranslated', () => {
    // A doctor may type any indication. Inventing a Malay rendering of it
    // would be this module making a clinical claim in a language it cannot
    // check.
    const typed = { ...BILINGUAL, medication: { ...BILINGUAL.medication, indication: 'Post-op review', indicationBm: null } };
    expect(buildLabelLayout(typed).extras).toContainEqual({ label: 'For', value: 'Post-op review' });
  });
});
