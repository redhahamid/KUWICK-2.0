/**
 * Is this deployment's clinical catalogue actually usable?
 *
 * WHY THIS EXISTS. Staging ran for weeks with ONE diagnosis in it — the
 * single code the golden path seeds for itself — and nobody knew until a
 * doctor typed "urti" into the diagnosis box and got nothing back. Every
 * suite was green the whole time, because the guardrail only ever searched
 * the code it had planted.
 *
 * An empty clinical catalogue is a BROKEN CLINIC: no diagnosis can be
 * recorded and nothing can be prescribed. It must announce itself, not wait
 * to be discovered by the person least able to fix it.
 *
 * The floors are deliberately low. This is not a completeness check — a
 * clinic may legitimately run a short list — it is a check for the state
 * "nothing was ever loaded here".
 *
 * PHASE 0 — THE SCOPE OF THE ANSWER, which the wording used to get wrong.
 *
 * At BOOT there is no tenant, so the counts are across the whole DATABASE and
 * the only honest question is "was anything ever loaded into this deployment?".
 * The warning said "this CLINIC holds only …", which is a per-clinic claim made
 * from a cross-tenant count: on a multi-clinic database it could be reassuring
 * and wrong in both directions — one well-stocked clinic hides an empty one, and
 * a small deployment-wide total slanders a clinic that is fine.
 *
 * The per-clinic question is real and still needs answering; it belongs on the
 * tenant's own request path, where the tenant is known. See
 * `catalogueHealthForTenant` on the authenticated session.
 */
export const CATALOGUE_FLOOR = { diagnoses: 10, medications: 10 } as const;

export interface CatalogueHealth {
  diagnoses: number;
  medications: number;
  ok: boolean;
  /** Human-readable, and deliberately blunt. Null when healthy. */
  warning: string | null;
}

export function assessCatalogue(counts: { diagnoses: number; medications: number }): CatalogueHealth {
  const shortfalls: string[] = [];
  if (counts.diagnoses < CATALOGUE_FLOOR.diagnoses) {
    shortfalls.push(`${counts.diagnoses} diagnoses`);
  }
  if (counts.medications < CATALOGUE_FLOOR.medications) {
    shortfalls.push(`${counts.medications} medications`);
  }

  return {
    diagnoses: counts.diagnoses,
    medications: counts.medications,
    ok: shortfalls.length === 0,
    warning: shortfalls.length
      ? `CLINICAL CATALOGUE NOT SEEDED — this DATABASE holds only ${shortfalls.join(' and ')} ` +
        'across all clinics. Doctors cannot record a diagnosis or prescribe. Run: ' +
        'npm run seed:catalogues --workspace=apps/api (see docs/STAGING_DEPLOYMENT.md).'
      : null,
  };
}

// ---------------------------------------------------------------------------
// PHASE 0 — WHAT BOOT MAY ASK, once RLS is actually enforced
// ---------------------------------------------------------------------------

/**
 * The deployment-level question, and the ONLY one available at boot.
 *
 * Counting rows was the obvious check and it is now wrong, for a reason worth
 * keeping: `diagnosis_catalog` and `items` are tenant-scoped under row-level
 * security, so a count taken without `app.tenant_id` returns ZERO — not an
 * error, a confident zero. While the application connected as a superuser that
 * count worked, because RLS did not apply to it. The moment the app role became
 * a real non-superuser, the boot check began reporting
 * "0 diagnoses and 0 medications" on a database holding 162 and 236.
 *
 * That is the failure mode the whole Phase 0 decision was about: a boot check
 * reaching for a request-scoped answer gets one that LOOKS fine. So boot asks
 * something RLS cannot filter — do the catalogue tables exist at all — and the
 * per-clinic question moves to the request path where a tenant exists.
 *
 * A missing TABLE means migrations never ran, which is a different and more
 * total failure than an unseeded catalogue, and worth its own words.
 */
export interface CatalogueTablesHealth {
  tablesPresent: boolean;
  missing: string[];
  ok: boolean;
  warning: string | null;
}

export const CATALOGUE_TABLES = ['diagnosis_catalog', 'items'] as const;

export function assessCatalogueTables(present: readonly string[]): CatalogueTablesHealth {
  const missing = CATALOGUE_TABLES.filter((table) => !present.includes(table));
  return {
    tablesPresent: missing.length === 0,
    missing,
    ok: missing.length === 0,
    warning: missing.length
      ? `CLINICAL SCHEMA INCOMPLETE — ${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} missing. ` +
        'Migrations have not been applied to this database. Run: npx prisma migrate deploy.'
      : null,
  };
}
