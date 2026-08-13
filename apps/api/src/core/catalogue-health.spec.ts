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
