// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ALLERGY_NOT_ASKED, ALLERGY_STRIP_PREFIX, ALLERGY_STRIP_SUFFIX, AllergyStrip, allergyBannerState, allergyStripText, allergyWords } from './AllergyStrip';

// ===========================================================================
// KW2-C2 — the persistent allergy strip.
//
// The rejected alternative was a popup on every add. These tests hold the
// four properties that make a strip better than a dialog: it is always there,
// it cannot be dismissed, it is amber rather than red, and it says the
// patient's own words rather than a summary of them.
//
// And the fifth, which is the one people get wrong: a CONFIRMED NEGATIVE
// renders nothing. Papering "asked, none known" with a banner is how the two
// states that matter stop being read.
// ===========================================================================

describe('what the strip says', () => {
  it('names the allergies verbatim and puts the checking on the reader', () => {
    expect(allergyStripText(['NSAIDs', 'Penicillin'])).toBe(
      '⚠ ALLERGIES: NSAIDs, Penicillin — check before prescribing',
    );
  });

  it('never paraphrases, abbreviates or truncates a long list', () => {
    const many = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Codeine', 'Latex', 'Shellfish'];
    const text = allergyStripText(many) ?? '';
    for (const entry of many) expect(text).toContain(entry);
    expect(text).not.toContain('…');
    expect(text).not.toMatch(/\+\d+ more/);
  });

  it('NEVER ASKED is its own warning — absence of data is a finding', () => {
    expect(allergyStripText([])).toBe('⚠ Allergy not asked');
  });

  it('ASKED AND NONE KNOWN renders nothing at all', () => {
    // It takes a RECORDED negative to claim this now — an empty list is what
    // "nobody asked" looks like too, and the two must not collapse.
    expect(allergyStripText([], true)).toBeNull();
  });

  it('a list of blank entries is "none known", not a warning with no words', () => {
    // A strip reading "⚠ ALLERGIES:  — check before prescribing" is worse
    // than no strip: it warns and then names nothing.
    expect(allergyStripText(['', '   '], true)).toBeNull();
  });

  it('claims no check it does not perform', () => {
    const text = allergyStripText(['Penicillin']) ?? '';
    for (const forbidden of [/interaction/i, /contraindicat/i, /do not prescribe/i, /unsafe/i]) {
      expect(text).not.toMatch(forbidden);
    }
  });
});

describe('how the strip behaves', () => {
  it('is amber and advisory, never an assertive alarm', () => {
    const { container } = render(<AllergyStrip allergyLabels={['NSAIDs']} />);
    const strip = container.querySelector('.kw-allergy-strip');
    // role=status, not role=alert: this is a standing condition, not
    // something that just happened, and it must not interrupt a screen
    // reader mid-sentence.
    expect(strip).toHaveAttribute('role', 'status');
    expect(strip?.className).not.toMatch(/danger|error|red/);
  });

  it('cannot be dismissed — there is no control on it at all', () => {
    const { container } = render(<AllergyStrip allergyLabels={['NSAIDs']} />);
    const strip = container.querySelector('.kw-allergy-strip');
    expect(strip?.querySelector('button')).toBeNull();
    expect(strip?.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('blocks nothing — it renders no overlay and traps no focus', () => {
    render(
      <div>
        <AllergyStrip allergyLabels={['NSAIDs']} />
        <button>Add medication</button>
      </div>,
    );
    // The control behind it is still reachable. A strip that gated
    // prescribing would be the popup this design rejected, wearing a
    // different shape.
    expect(screen.getByRole('button', { name: 'Add medication' })).toBeEnabled();
  });

  it('the three states are distinguishable as data, not only as pixels', () => {
    const { container, rerender } = render(<AllergyStrip allergyLabels={['NSAIDs']} />);
    expect(container.querySelector('[data-allergy-strip]')).toHaveAttribute(
      'data-allergy-strip',
      'PRESENT',
    );
    rerender(<AllergyStrip allergyLabels={[]} />);
    expect(container.querySelector('[data-allergy-strip]')).toHaveAttribute(
      'data-allergy-strip',
      'NONE_RECORDED',
    );
    rerender(<AllergyStrip allergyLabels={[]} askedAndNoneKnown />);
    expect(container.querySelector('[data-allergy-strip]')).toBeNull();
  });
});

// ===========================================================================
// b1.5 PHASE D — THE BANNER READS BOTH PLACES AN ALLERGY CAN BE RECORDED.
//
// `patient.allergies` is the header chip's quick-record field. MEDICAL patient
// alerts are the other, and they are how a standing fact gets onto the record
// with an author and a timestamp. The strip looked only at the first, so a
// doctor who recorded "Penicillin allergy" as an alert still saw "Allergy not
// asked" on every prescribing surface — a banner permanently warning about a
// question that had in fact been answered, which is exactly how a warning
// stops being read.
// ===========================================================================

describe('the three states now come from alerts alone', () => {
  it('a recorded ALLERGY alert turns "not asked" into the patient\'s own words', () => {
    expect(allergyStripText(['Penicillin allergy'])).toContain('Penicillin allergy');
    expect(allergyStripText(['Penicillin allergy'])).not.toContain(ALLERGY_NOT_ASKED);
    expect(allergyBannerState(['Penicillin allergy'])).toBe('PRESENT');
  });

  it('a CONFIRMED negative renders nothing, and takes a record to claim', () => {
    // The distinction the whole retirement had to preserve. `allergies = []`
    // used to carry "asked, none known"; a NO_KNOWN_ALLERGY alert carries it
    // now, and WITHOUT one an empty list is "nobody asked".
    expect(allergyStripText([], true)).toBeNull();
    expect(allergyBannerState([], true)).toBe('NONE_KNOWN');
    expect(allergyStripText([], false)).toBe(ALLERGY_NOT_ASKED);
    expect(allergyBannerState([], false)).toBe('NONE_RECORDED');
  });

  it('an allergy outranks a stale negative rather than contradicting it', () => {
    // Asked-and-none in March does not survive a reaction recorded in June.
    expect(allergyBannerState(['Latex'], true)).toBe('PRESENT');
  });

  it('ignores blank labels rather than rendering an empty warning', () => {
    expect(allergyStripText(['   '])).toBe(ALLERGY_NOT_ASKED);
  });
});

// ===========================================================================
// b1.5 FIX 3 — AN ALLERGY IS NOT A CHRONIC CONDITION.
//
// The chip rendered both as one red line: "NSAIDS, AUGMENTIN, PCM, DM, HPT,
// OKU". Six words, two meanings, one colour — an allergy forbids a
// prescription, diabetes qualifies it, and a doctor scanning that line had to
// know which was which. What is asserted here is the CONSEQUENCE: the allergy
// text contains no chronic condition, and the chronic condition is still on
// screen somewhere rather than quietly dropped.
// ===========================================================================

describe('the allergy banner carries allergies ONLY', () => {
  it('a chronic condition never reaches the allergy text', () => {
    // Passed as an allergy label it would; the point is that the CALLER now
    // only ever hands it allergies. This pins the contract the caller relies on.
    const text = allergyStripText(['NSAIDS', 'AUGMENTIN']);
    expect(text).toContain('NSAIDS');
    expect(text).toContain('AUGMENTIN');
    expect(text).not.toContain('DM');
    expect(text).not.toContain('HPT');
  });

  it('the words are the ALLERGY labels, verbatim and in order', () => {
    expect(allergyWords(['NSAIDS', 'Penicillin allergy'])).toEqual(['NSAIDS', 'Penicillin allergy']);
  });

  it('still says "not asked" when only a chronic condition is on record', () => {
    // A patient with diabetes and no allergy question asked has NOT been asked
    // about allergies. Letting the chronic condition satisfy the allergy state
    // would silence the one warning that matters.
    expect(allergyBannerState([], false)).toBe('NONE_RECORDED');
    expect(allergyStripText([], false)).toBe(ALLERGY_NOT_ASKED);
  });
});

// ===========================================================================
// b1.5 FIX 2 — THE SAME ALLERGY, RECORDED TWICE, READS ONCE.
//
// Staging showed "NSAIDS, AUGMENTIN, PCM, NSAIDS": the drug was in
// `patient.allergies` AND had since been recorded as an ALLERGY alert. That
// pair of stores is now one, so THAT cause is gone — but two clinicians can
// still record the same allergy in different words on different days, and a
// repeat in the chip reads as two separate findings about the one line that
// must be exact. The dedup stays for that.
// ===========================================================================

describe('the allergy words are deduplicated for display', () => {
  it('the staging case reads once', () => {
    expect(allergyWords(['NSAIDS', 'AUGMENTIN', 'PCM', 'NSAIDS'])).toEqual([
      'NSAIDS',
      'AUGMENTIN',
      'PCM',
    ]);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(allergyWords(['NSAIDS', '  nsaids  '])).toEqual(['NSAIDS']);
    expect(allergyWords(['Penicillin', 'PENICILLIN'])).toEqual(['Penicillin']);
  });

  it('keeps the FIRST spelling — the patient\'s own words survive', () => {
    // The earliest record is closest to what the patient said. A later
    // re-entry in a different case must not overwrite how it was recorded.
    expect(allergyWords(['penicillin', 'Penicillin'])).toEqual(['penicillin']);
  });

  it('deduplicates within a single source too', () => {
    expect(allergyWords(['NSAIDS', 'nsaids'])).toEqual(['NSAIDS']);
  });

  it('keeps genuinely different drugs apart', () => {
    // Dedup must not become fuzzy matching: these are two different drugs.
    expect(allergyWords(['Penicillin', 'Penicillamine'])).toEqual(['Penicillin', 'Penicillamine']);
  });

  it('the rendered strip says it once', () => {
    expect(allergyStripText(['NSAIDS', 'PCM', 'NSAIDS'])).toBe(
      `${ALLERGY_STRIP_PREFIX} NSAIDS, PCM ${ALLERGY_STRIP_SUFFIX}`,
    );
  });
});
