// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AllergyStrip, allergyStripText } from './AllergyStrip';

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
    expect(allergyStripText(null)).toBe('⚠ Allergy not asked');
    expect(allergyStripText(undefined)).toBe('⚠ Allergy not asked');
  });

  it('ASKED AND NONE KNOWN renders nothing at all', () => {
    expect(allergyStripText([])).toBeNull();
  });

  it('a list of blank entries is "none known", not a warning with no words', () => {
    // A strip reading "⚠ ALLERGIES:  — check before prescribing" is worse
    // than no strip: it warns and then names nothing.
    expect(allergyStripText(['', '   '])).toBeNull();
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
    const { container } = render(<AllergyStrip allergies={['NSAIDs']} />);
    const strip = container.querySelector('.kw-allergy-strip');
    // role=status, not role=alert: this is a standing condition, not
    // something that just happened, and it must not interrupt a screen
    // reader mid-sentence.
    expect(strip).toHaveAttribute('role', 'status');
    expect(strip?.className).not.toMatch(/danger|error|red/);
  });

  it('cannot be dismissed — there is no control on it at all', () => {
    const { container } = render(<AllergyStrip allergies={['NSAIDs']} />);
    const strip = container.querySelector('.kw-allergy-strip');
    expect(strip?.querySelector('button')).toBeNull();
    expect(strip?.querySelector('[aria-label="Close"]')).toBeNull();
  });

  it('blocks nothing — it renders no overlay and traps no focus', () => {
    render(
      <div>
        <AllergyStrip allergies={['NSAIDs']} />
        <button>Add medication</button>
      </div>,
    );
    // The control behind it is still reachable. A strip that gated
    // prescribing would be the popup this design rejected, wearing a
    // different shape.
    expect(screen.getByRole('button', { name: 'Add medication' })).toBeEnabled();
  });

  it('the three states are distinguishable as data, not only as pixels', () => {
    const { container, rerender } = render(<AllergyStrip allergies={['NSAIDs']} />);
    expect(container.querySelector('[data-allergy-strip]')).toHaveAttribute(
      'data-allergy-strip',
      'PRESENT',
    );
    rerender(<AllergyStrip allergies={null} />);
    expect(container.querySelector('[data-allergy-strip]')).toHaveAttribute(
      'data-allergy-strip',
      'NONE_RECORDED',
    );
    rerender(<AllergyStrip allergies={[]} />);
    expect(container.querySelector('[data-allergy-strip]')).toBeNull();
  });
});
