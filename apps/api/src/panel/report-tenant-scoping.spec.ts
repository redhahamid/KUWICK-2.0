import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A REPORT THAT CONNECTS AS THE OWNER ROLE MUST SCOPE BY TENANT ITSELF.
 *
 * This guard exists because of a measured bug, not a theory.
 * `prisma/reports/panel-fee-treatment-impact.ts` scoped each tenant's figures
 * with `set_config('app.tenant_id', …)` and row-level security — which is
 * correct for the application role, and does nothing at all for the role the
 * report's own docstring tells you to use. `REPORT_DATABASE_URL` is the
 * migration/owner role; it is SUPERUSER and BYPASSRLS, and RLS does not bind
 * either.
 *
 * So every tenant iteration read every tenant's claims. Measured on a database
 * with 525 tenants: 525 rows, each carrying the identical 164 claims and the
 * identical RM1,952 overstatement — the whole database repeated once per
 * tenant, under 525 different clinic names. With `where: { tenantId }` added:
 * 120 rows of 1–3 claims each, summing to exactly 164.
 *
 * That is the worst failure available to this particular report, because its
 * docstring says it must be run against production before any prior panel
 * receivable figure is quoted. A group total would have been quoted at one
 * clinic as its own.
 *
 * The guard is deliberately crude — it reads the files and insists that a
 * report iterating tenants filters on `tenantId`. A subtler check would be a
 * second implementation of the thing being checked, and the failure here was
 * never subtle: it was an absent `where`.
 */
const REPORTS = join(__dirname, '..', '..', 'prisma', 'reports');

const files = readdirSync(REPORTS).filter((name) => name.endsWith('.ts'));

describe('the panel reports', () => {
  it('has reports to check, so this file means something', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s scopes its reads by tenant, not only by RLS', (file) => {
    const source = readFileSync(join(REPORTS, file), 'utf-8');

    // Only reports that loop over tenants can have this bug.
    const iteratesTenants = /for \(const tenant of tenants\)/.test(source);
    if (!iteratesTenants) return;

    // Strip comments: this very file's explanation names `set_config` and
    // `tenantId`, and so do the reports' own notes about the bug.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect({
      file,
      scopedExplicitly: /where:\s*\{\s*tenantId:\s*tenant\.id/.test(code),
    }).toEqual({ file, scopedExplicitly: true });

    // And the RLS context is still set, so the report is correct under the
    // application role too. Both, not either.
    expect(code).toContain("set_config('app.tenant_id'");
  });
});
