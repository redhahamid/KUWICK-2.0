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
      ? `CLINICAL CATALOGUE NOT SEEDED — this clinic holds only ${shortfalls.join(' and ')}. ` +
        'Doctors cannot record a diagnosis or prescribe. Run: npm run seed:catalogues --workspace=apps/api ' +
        '(see docs/STAGING_DEPLOYMENT.md).'
      : null,
  };
}
