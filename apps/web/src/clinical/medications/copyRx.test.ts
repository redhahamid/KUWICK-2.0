import { describe, expect, it } from 'vitest';
import {
  allergyRecordState,
  copyButtonLabel,
  decorateCandidates,
  matchingAllergyTerms,
} from './copyRx';

// ===========================================================================
// KW2-C2 — COPY RX, AND WHAT IT MAY CLAIM ABOUT ALLERGIES
//
// The rule these tests exist to hold: the modal compares strings and says so.
// It has no drug dictionary, no ingredient mapping and no cross-reactivity
// table, and every word it shows has to be true of a string comparison.
// ===========================================================================

describe('three allergy states, not two', () => {
  it('1. never asked is its own state', () => {
    // An empty allergy field on a new patient is a question nobody put, not a
    // negative answer somebody gave.
    expect(allergyRecordState(null)).toBe('NONE_RECORDED');
    expect(allergyRecordState(undefined)).toBe('NONE_RECORDED');
  });

  it('2. asked, none known — and it takes a RECORDED answer to say so', () => {
    // The second argument is a NO_KNOWN_ALLERGY alert on the patient. An empty
    // list on its own is indistinguishable from nobody asking, which is why
    // retiring `patient.allergies` needed the confirmed negative to exist.
    expect(allergyRecordState([], true)).toBe('NONE_KNOWN');
    expect(allergyRecordState([], false)).toBe('NONE_RECORDED');
  });

  it('3. blank strings are not an allergy record', () => {
    // A row of empty strings is a data artefact, not a clinical answer.
    expect(allergyRecordState(['', '   '], true)).toBe('NONE_KNOWN');
  });

  it('4. something recorded', () => {
    expect(allergyRecordState(['Penicillin'])).toBe('PRESENT');
  });
});

describe('what counts as a match', () => {
  it('5. finds the allergy inside a full medication name', () => {
    // The case this exists for: "Penicillin" against "Tab Penicillin V 250mg"
    // at the end of a session.
    expect(matchingAllergyTerms('Tab Penicillin V 250mg', ['Penicillin'])).toEqual(['Penicillin']);
  });

  it('6. case-insensitive', () => {
    expect(matchingAllergyTerms('TAB PENICILLIN V', ['penicillin'])).toEqual(['penicillin']);
  });

  it('7. names every term that matched, so the flag can be acted on', () => {
    expect(matchingAllergyTerms('Co-amoxiclav (amoxicillin + clavulanate)', ['amoxicillin', 'aspirin']))
      .toEqual(['amoxicillin']);
  });

  it('8. fragments under three characters are IGNORED', () => {
    // "K" or "PC" would match half the formulary and teach people to ignore
    // the flag — worse than not flagging at all.
    expect(matchingAllergyTerms('Tab Paracetamol', ['PC'])).toEqual([]);
    expect(matchingAllergyTerms('Syr Ketoprofen', ['K'])).toEqual([]);
  });

  it('9. no allergies, no medication, or no match all yield nothing', () => {
    expect(matchingAllergyTerms('Tab Paracetamol', [])).toEqual([]);
    expect(matchingAllergyTerms('Tab Paracetamol', null)).toEqual([]);
    expect(matchingAllergyTerms(null, ['Penicillin'])).toEqual([]);
    expect(matchingAllergyTerms('Tab Paracetamol', ['Penicillin'])).toEqual([]);
  });

  it('10. it does NOT pretend to know ingredients', () => {
    // Augmentin contains amoxicillin. A string comparison cannot know that,
    // and this test pins that it does not claim to — the honest ceiling of
    // free-text allergies is exactly what the doctor is told to check.
    expect(matchingAllergyTerms('Syr Augmentin 457', ['amoxicillin'])).toEqual([]);
  });
});

describe('how a row is decorated', () => {
  const candidates = [
    { id: 'rx-1', name: 'Tab Penicillin V 250mg', detail: '1 tab TDS ×5d' },
    { id: 'rx-2', name: 'Tab Paracetamol 500mg', detail: '2 tab QID ×3d' },
  ];

  it('11. flags only the row that matched, and carries the terms with it', () => {
    const rows = decorateCandidates(candidates, ['Penicillin']);
    expect(rows[0]).toMatchObject({ flagged: true, matchedAllergies: ['Penicillin'] });
    expect(rows[1]).toMatchObject({ flagged: false, matchedAllergies: [] });
  });

  it('12. flags nothing when no allergy is recorded — silence, not a false all-clear', () => {
    const rows = decorateCandidates(candidates, null);
    expect(rows.every((row) => !row.flagged)).toBe(true);
  });

  it('13. a flag is advisory — nothing about the row becomes unselectable', () => {
    // The rule the presentation must honour: amber, never blocking.
    const rows = decorateCandidates(candidates, ['Penicillin']);
    expect(rows[0]).not.toHaveProperty('disabled');
    expect(rows[0]).not.toHaveProperty('blocked');
  });
});

describe('the confirm button', () => {
  it('14. counts what is selected', () => {
    expect(copyButtonLabel(2)).toBe('Add 2 selected');
    expect(copyButtonLabel(1)).toBe('Add 1 selected');
  });

  it('15. an empty selection says what to do, not just "0"', () => {
    expect(copyButtonLabel(0)).toBe('Select medications to copy');
  });
});
