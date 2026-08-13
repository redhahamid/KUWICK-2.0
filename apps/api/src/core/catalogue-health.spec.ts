import { assessCatalogue, CATALOGUE_FLOOR } from './catalogue-health';

// ===========================================================================
// The state this exists to catch, held as a test.
//
// Staging ran for weeks holding exactly ONE diagnosis — the code the golden
// path seeds for itself — while every suite stayed green, because the
// guardrail only ever searched that one code. A doctor found it by typing
// "urti" into a box that answered nothing.
// ===========================================================================

describe('catalogue health', () => {
  it('the real staging state — one seeded diagnosis — is NOT ok, and says why', () => {
    const health = assessCatalogue({ diagnoses: 1, medications: 7 });
    expect(health.ok).toBe(false);
    expect(health.warning).toMatch(/NOT SEEDED/);
    // The message has to carry the fix, not just the complaint: whoever reads
    // a boot log at 8am should not have to go looking for the command.
    expect(health.warning).toMatch(/seed:catalogues/);
    expect(health.warning).toMatch(/1 diagnoses/);
  });

  it('a fully seeded clinic is ok and warns about nothing', () => {
    const health = assessCatalogue({ diagnoses: 162, medications: 229 });
    expect(health.ok).toBe(true);
    expect(health.warning).toBeNull();
  });

  it('a short but real list is fine — this checks for "never loaded", not completeness', () => {
    const health = assessCatalogue({
      diagnoses: CATALOGUE_FLOOR.diagnoses,
      medications: CATALOGUE_FLOOR.medications,
    });
    expect(health.ok).toBe(true);
  });

  it('either catalogue alone being empty is enough to fail — both are load-bearing', () => {
    expect(assessCatalogue({ diagnoses: 162, medications: 0 }).ok).toBe(false);
    expect(assessCatalogue({ diagnoses: 0, medications: 229 }).ok).toBe(false);
  });
});

// ===========================================================================
// The second half of the same outage.
//
// Rows existing is not the same as rows being FINDABLE. Staging held 162
// diagnoses that no search surface could see, because the seed tagged them
// with a category the UI filtered out. `assessCatalogue` counts rows, so it
// reported ok while the clinic was unusable — a health check that can be
// green during the outage it exists to catch is worth saying out loud.
//
// The durable guard is in the seed (it now writes and repairs SUMMARIZE) and
// in diagnosisSearchField.test.tsx (a search with no category asks for the
// whole catalogue). This test records the limit of what a row count proves,
// so nobody later reads a green /health as "the doctor can search".
// ===========================================================================
describe('what a row count does NOT prove', () => {
  it('counts alone reported "ok" while every row was filtered out of the UI', () => {
    // Exactly staging's state on the day the owner reported it.
    const health = assessCatalogue({ diagnoses: 162, medications: 229 });
    expect(health.ok).toBe(true);
    // Which was TRUE about the database and USELESS to the doctor. Findability
    // is asserted where it can be — the seed's category, and the search
    // field's request — never inferred from this number.
  });
});
