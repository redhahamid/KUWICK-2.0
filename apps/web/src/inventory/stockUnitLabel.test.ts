import { describe, expect, it } from 'vitest';
import { containerNoun, stockBalanceLabel, stockUnitLabel } from './stockUnitLabel';

describe('the container is what a balance is counted in', () => {
  it('takes the word after PER — a balance is strips, not tablets-per-strip', () => {
    expect(containerNoun('TABLET PER STRIP')).toBe('Strip');
    expect(containerNoun('SACHET PER BOX')).toBe('Box');
  });

  it('leaves a unit that is already a container alone', () => {
    expect(containerNoun('BOTTLE')).toBe('Bottle');
    expect(containerNoun('VIAL')).toBe('Vial');
  });

  it('applies the same rule to the Malay name', () => {
    expect(containerNoun('TABLET PER PAPAN')).toBe('Papan');
    expect(containerNoun('KOTAK')).toBe('Kotak');
  });
});

describe('both languages, or the one that exists', () => {
  it('pairs them with a slash, the way 1.0 prints it', () => {
    expect(stockUnitLabel({ name: 'TABLET PER STRIP', nameMs: 'TABLET PER PAPAN' })).toBe('Strip / Papan');
  });

  it('shows the English alone when a clinic-added unit has no translation', () => {
    // "Strip / " with nothing after the slash is worse than "Strip".
    expect(stockUnitLabel({ name: 'PUNNET', nameMs: null })).toBe('Punnet');
  });

  it('does not print the same word twice when the two languages agree', () => {
    expect(stockUnitLabel({ name: 'VIAL', nameMs: 'VIAL' })).toBe('Vial');
  });

  it('has nothing to say about an item with no stock unit', () => {
    expect(stockUnitLabel(null)).toBeNull();
  });
});

describe('the balance cell', () => {
  it('reads the way the shelf is counted', () => {
    expect(stockBalanceLabel(99, { name: 'TABLET PER STRIP', nameMs: 'TABLET PER PAPAN' })).toBe('99 Strip / Papan');
  });

  it('prints the bare number rather than inventing a unit nobody chose', () => {
    expect(stockBalanceLabel(12, null)).toBe('12');
  });

  it('shows a negative balance as it is — D-020 lets stock go under', () => {
    expect(stockBalanceLabel(-3, { name: 'BOTTLE', nameMs: 'BOTOL' })).toBe('-3 Bottle / Botol');
  });
});
