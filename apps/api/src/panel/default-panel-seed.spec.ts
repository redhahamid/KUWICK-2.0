import { PanelType } from '@prisma/client';
import { DEMO_PANELS, SEED_DEFAULT_PANELS } from './default-panel-seed';

/**
 * GUARDS ON THE STARTER LIST (N-1).
 *
 * This list is copied into every tenant Kuwick provisions from here on, which
 * makes a mistake in it expensive and silent: it arrives already looking like
 * a decision somebody made. Each test below is one of the four rules in
 * `default-panel-seed.ts`, held by a check rather than by a comment.
 */
describe('the default panel list', () => {
  it('is a real list, not a placeholder', () => {
    expect(SEED_DEFAULT_PANELS.length).toBeGreaterThan(15);
  });

  it('has no duplicate names, because the name is this list\u2019s only natural key', () => {
    const keys = SEED_DEFAULT_PANELS.map((row) => row.name.trim().toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('classifies every row — an unclassified default would ship the gap it exists to close', () => {
    expect(SEED_DEFAULT_PANELS.filter((row) => !row.panelType)).toEqual([]);
  });

  /**
   * Rule 4. A corporate panel is one employer billed directly, and every
   * clinic's are its own — there is no national list to seed, so a CORPORATE
   * row here would be a company asserted onto clinics that have never heard
   * of it.
   */
  it('carries no corporate panels', () => {
    expect(SEED_DEFAULT_PANELS.filter((row) => row.panelType === PanelType.CORPORATE)).toEqual([]);
  });

  it('covers the three kinds a national list can know about', () => {
    const kinds = new Set(SEED_DEFAULT_PANELS.map((row) => row.panelType));
    expect(kinds).toEqual(new Set([PanelType.TPA, PanelType.INSURER, PanelType.GOVERNMENT]));
  });

  /**
   * Rules 2 and 3. The row shape itself is the guard: there is nowhere to put a
   * portal URL, a payment term, a fee or a limit, so no future edit can seed a
   * guess as though it were a contract fact.
   */
  it('cannot carry a URL, a term, a fee or a limit', () => {
    for (const row of SEED_DEFAULT_PANELS) {
      expect(Object.keys(row).sort()).toEqual(['name', 'panelType']);
    }
  });

  it('never uses the product name as data', () => {
    for (const row of [...SEED_DEFAULT_PANELS, ...DEMO_PANELS]) {
      expect(row.name.toLowerCase()).not.toContain('kuwick');
    }
  });
});

describe('the demo panel list', () => {
  /**
   * Demo claims and remittances are fabricated money. A real company's name on
   * fabricated money is how a screenshot becomes a statement about that
   * company, so these labels cannot be mistaken for anybody — and they must
   * not overlap the real starter list.
   */
  it('is neutral and overlaps the real list nowhere', () => {
    const real = new Set(SEED_DEFAULT_PANELS.map((row) => row.name.trim().toLowerCase()));
    for (const row of DEMO_PANELS) {
      expect(row.name.toLowerCase()).toMatch(/^demo /);
      expect(real.has(row.name.trim().toLowerCase())).toBe(false);
    }
  });

  it('includes a corporate panel, which the real list deliberately cannot', () => {
    expect(DEMO_PANELS.some((row) => row.panelType === PanelType.CORPORATE)).toBe(true);
  });
});
