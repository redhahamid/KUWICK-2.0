import { isSyntheticTenantName } from './synthetic-tenant';

/**
 * The half that matters is the REFUSALS. A guard that recognises the two names
 * this repository writes is easy; a guard that also declines to recognise a
 * real clinic whose name merely contains the same letters is the one that
 * keeps a maintenance script off a live database.
 */
describe('isSyntheticTenantName', () => {
  it.each([
    'Kuwick UAT Staging (Synthetic)',
    'Klinik UAT Staging (Synthetic)',
    'Klinik Contoh (UAT)',
    'klinik contoh (uat)',
    'Some Tenant (Synthetic)',
  ])('recognises the seeds’ own tenants: %s', (name) => {
    expect(isSyntheticTenantName(name)).toBe(true);
  });

  it.each([
    // "Suatu" contains u-a-t. A substring test passed this, which is exactly
    // how a guard ends up authorising a write to a real clinic's database.
    'Klinik Suatu Sdn Bhd',
    'Klinik Kesihatan Situasi',
    'Evaluation Medical Centre',
    'Hijraa Family Clinic',
    'Poliklinik Sejahtera',
    '',
  ])('refuses anything that is not marked: %s', (name) => {
    expect(isSyntheticTenantName(name)).toBe(false);
  });
});
