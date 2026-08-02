import { HASH_SCHEMA_VERSION, hashNoteContent, hashObservationContent } from './canonical-content-hash';

// C0 (D-051) — a signed note's hash must be reproducible years later, so the
// canonicalisation has to be immune to the incidental differences that
// naturally occur between two reads of the same clinical content.
describe('canonical content hash', () => {
  it('is independent of JavaScript object key order', () => {
    const a = hashNoteContent({ notes: 'URTI', noteLanguage: 'EN', status: 'SIGNED', noteType: 'DOCTOR_NARRATIVE' });
    const b = hashNoteContent({ noteType: 'DOCTOR_NARRATIVE', status: 'SIGNED', noteLanguage: 'EN', notes: 'URTI' });

    expect(a.contentHash).toBe(b.contentHash);
  });

  it('treats 36.5 and 36.50 as the same clinical value', () => {
    const a = hashObservationContent({ temperature: 36.5 });
    const b = hashObservationContent({ temperature: '36.50' });

    expect(a.contentHash).toBe(b.contentHash);
  });

  it('distinguishes a cleared field from a different value', () => {
    const cleared = hashObservationContent({ pulse: null });
    const set = hashObservationContent({ pulse: 80 });

    expect(cleared.contentHash).not.toBe(set.contentHash);
  });

  it('detects any change to the narrative', () => {
    const before = hashNoteContent({ notes: 'BP 140/90' });
    const after = hashNoteContent({ notes: 'BP 120/80' });

    expect(before.contentHash).not.toBe(after.contentHash);
  });

  it('normalises Unicode so visually identical text hashes identically', () => {
    // "é" as a single codepoint vs. "e" + combining acute.
    const composed = hashNoteContent({ notes: 'Rappél' });
    const decomposed = hashNoteContent({ notes: 'Rappél' });

    expect(composed.contentHash).toBe(decomposed.contentHash);
  });

  it('records the schema version alongside every hash', () => {
    expect(hashNoteContent({ notes: 'x' }).hashSchemaVersion).toBe(HASH_SCHEMA_VERSION);
    expect(hashObservationContent({ pulse: 1 }).hashSchemaVersion).toBe(HASH_SCHEMA_VERSION);
  });

  it('ignores fields outside the defined clinical content set', () => {
    // updatedAt/version churn must not change what was signed.
    const a = hashNoteContent({ notes: 'x', version: 1, updatedAt: new Date('2026-01-01') });
    const b = hashNoteContent({ notes: 'x', version: 9, updatedAt: new Date('2027-06-06') });

    expect(a.contentHash).toBe(b.contentHash);
  });
});
