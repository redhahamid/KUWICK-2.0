import { ITEM_SEARCH_COLUMNS, itemSearchClauses } from './item-search';

// ===========================================================================
// b1 — WHAT THE MEDICINE BOX SEARCHES.
//
// This exists because of the diagnosis outage: 162 rows reached staging, the
// row count said "seeded", and a doctor typing "urti" matched nothing, because
// the column the seed wrote was not the column the surface queried. The
// medicine catalogue has exactly the same shape — 229 imported rows carrying a
// Malay `groupTag` the old search did not look at — so the columns are pinned
// here rather than left to be re-derived in a Prisma `where`.
// ===========================================================================

describe('the medicine search columns', () => {
  it('searches name, code, the clinic Malay group, and the exported name', () => {
    expect([...ITEM_SEARCH_COLUMNS]).toEqual(['name', 'code', 'groupTag', 'sourceName']);
  });

  it('includes groupTag — the column the previous search did not look at', () => {
    // "batuk" is what a Malaysian clinic types for a cough medicine. The
    // imported catalogue tags 229 medicines this way and the old search
    // matched name and code only, so typing it found nothing at all.
    const clauses = itemSearchClauses('batuk');
    expect(clauses).toEqual(
      expect.arrayContaining([{ groupTag: { contains: 'batuk', mode: 'insensitive' } }]),
    );
  });

  it('every column is matched case-insensitively and by substring', () => {
    for (const clause of itemSearchClauses('Amox')) {
      const [condition] = Object.values(clause);
      expect(condition).toEqual({ contains: 'Amox', mode: 'insensitive' });
    }
  });

  it('does NOT search the sentence columns', () => {
    // A remark reading "for cough and cold" would put an antihistamine under
    // every cough search, and a prescriber picking from a list they did not
    // mean to see is how the wrong medicine gets dispensed.
    const keys = itemSearchClauses('cough').flatMap((clause) => Object.keys(clause));
    expect(keys).not.toContain('remark');
    expect(keys).not.toContain('instruction');
    expect(keys).not.toContain('indication');
  });

  it('one clause per column, so the caller ORs them', () => {
    expect(itemSearchClauses('x')).toHaveLength(ITEM_SEARCH_COLUMNS.length);
    for (const clause of itemSearchClauses('x')) {
      expect(Object.keys(clause)).toHaveLength(1);
    }
  });
});
