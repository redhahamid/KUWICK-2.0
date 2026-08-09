import { describe, expect, it } from 'vitest';
import {
  CANVAS_NOTE_MIN_WIDTH,
  CANVAS_THREE_COLUMN_MIN,
  CANVAS_TWO_COLUMN_MIN,
  canvasMode,
  canvasWidths,
} from './canvasLayout';

// ===========================================================================
// KUWICK 2.0 CANVAS — COLUMN GEOMETRY
//
// The spec draws three columns against a 1600px reference. A clinic desktop
// is 1366, 1440 or 1920, so these tests pin what happens at the widths that
// actually exist — and, above everything, that the clinical note never pays
// for the rails.
// ===========================================================================

const REAL_DESKTOPS = [1280, 1366, 1440, 1536, 1600, 1920, 2560];

describe('which layout a width gets', () => {
  it('1. three columns on a clinic desktop', () => {
    for (const width of REAL_DESKTOPS) {
      expect(canvasMode(width)).toBe('three-column');
    }
  });

  it('2. the visits rail folds first — history is reference, the note is work', () => {
    expect(canvasMode(CANVAS_THREE_COLUMN_MIN - 1)).toBe('two-column');
    expect(canvasWidths(1100).visits).toBe(0);
  });

  it('3. one column on a tablet or phone', () => {
    expect(canvasMode(CANVAS_TWO_COLUMN_MIN - 1)).toBe('stacked');
    expect(canvasMode(390)).toBe('stacked');
  });
});

describe('the note never pays for the rails', () => {
  it('4. it keeps a readable width at every real desktop size', () => {
    // The failure this prevents: a sidebar holding its pixels while the
    // consultation note wraps mid-phrase.
    for (const width of REAL_DESKTOPS) {
      expect(canvasWidths(width).middle).toBeGreaterThanOrEqual(CANVAS_NOTE_MIN_WIDTH);
    }
  });

  it('5. widening the window widens the NOTE, not the sidebars', () => {
    const at1440 = canvasWidths(1440);
    const at1920 = canvasWidths(1920);
    const gainedByNote = at1920.middle - at1440.middle;
    const gainedByRails = at1920.visits - at1440.visits + (at1920.right - at1440.right);
    expect(gainedByNote).toBeGreaterThan(gainedByRails);
  });

  it('6. the right rail is trimmed before the note drops below its floor', () => {
    const tight = canvasWidths(CANVAS_THREE_COLUMN_MIN);
    expect(tight.middle).toBeGreaterThanOrEqual(CANVAS_NOTE_MIN_WIDTH);
    expect(tight.right).toBeGreaterThanOrEqual(440);
  });
});

describe('the columns fit the space they are given', () => {
  it('7. three columns plus gutters never exceed the container', () => {
    for (const width of REAL_DESKTOPS) {
      const { visits, middle, right } = canvasWidths(width);
      // Two 14px gutters between three columns.
      expect(visits + middle + right + 28).toBeLessThanOrEqual(width);
    }
  });

  it('8. two columns plus one gutter never exceed the container', () => {
    for (const width of [900, 1000, 1100, 1279]) {
      const { middle, right } = canvasWidths(width);
      expect(middle + right + 14).toBeLessThanOrEqual(width);
    }
  });

  it('9. the rails stay inside their readable band', () => {
    // A rail that grows without limit on a 2560px monitor turns a glanceable
    // summary into a second document.
    const wide = canvasWidths(2560);
    expect(wide.visits).toBeLessThanOrEqual(288);
    expect(wide.right).toBeLessThanOrEqual(600);
  });

  it('10. stacked gives every column the full width', () => {
    const stacked = canvasWidths(390);
    expect(stacked).toMatchObject({ mode: 'stacked', visits: 390, middle: 390, right: 390 });
  });

  it('11. the proportions are close to the spec at its own reference width', () => {
    // Spec p.2: 258 / 706 / 540 at 1600.
    const { visits, middle, right } = canvasWidths(1600);
    expect(visits).toBeCloseTo(258, -1);
    expect(right).toBeCloseTo(540, -1);
    expect(middle).toBeGreaterThan(700);
  });
});
