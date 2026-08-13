import { SERVICE_SEARCH_COLUMNS, serviceSearchClauses } from './service-search';

// ===========================================================================
// THE THIRD INSTANCE of one defect, and the one that showed why the owner's
// rule had to be hardened.
//
// This catalogue searched `name` alone on the server, so `E2E-CONSULT` — a
// service's OWN CODE — returned nothing from the Canvas procedure box. The two
// rails that filter client-side found it without trouble, because their option
// label reads "CODE — Name". So one catalogue had two surfaces broken in
// OPPOSITE directions, and a test of either would have certified the other.
// ===========================================================================

describe('the service / procedure search columns', () => {
  it('searches name, code and the clinic\'s own category', () => {
    expect([...SERVICE_SEARCH_COLUMNS]).toEqual(['name', 'code', 'category']);
  });

  it('includes code — a procedure could not be found by its own code', () => {
    expect(serviceSearchClauses('XRAYCHEST')).toEqual(
      expect.arrayContaining([{ code: { contains: 'XRAYCHEST', mode: 'insensitive' } }]),
    );
  });

  it('includes category, which is free text precisely because it is the clinic\'s own', () => {
    expect(serviceSearchClauses('Imaging')).toEqual(
      expect.arrayContaining([{ category: { contains: 'Imaging', mode: 'insensitive' } }]),
    );
  });

  it('does NOT search orderType — that is a filter, not a term anybody types', () => {
    const keys = serviceSearchClauses('TASK_ORDER').flatMap((clause) => Object.keys(clause));
    expect(keys).not.toContain('orderType');
  });

  it('every column is matched case-insensitively and by substring', () => {
    for (const clause of serviceSearchClauses('fbc')) {
      expect(Object.values(clause)[0]).toEqual({ contains: 'fbc', mode: 'insensitive' });
    }
  });

  it('one clause per column, so the caller ORs them', () => {
    expect(serviceSearchClauses('x')).toHaveLength(SERVICE_SEARCH_COLUMNS.length);
  });
});
