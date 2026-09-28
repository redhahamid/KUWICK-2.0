#!/usr/bin/env node
/**
 * Remove the rule sets the browser gate left on a shared database.
 *
 * Until the admin-hr spec cleaned up after itself, every run pointed at
 * staging saved two payroll rule sets with a timestamp in the name. This
 * lists the candidates — names the spec made, not the default, pricing
 * nobody — and deletes them only with --apply, through the same route the
 * Settings page's Delete button uses, so nothing touches the database
 * directly and every deletion leaves an audit row.
 *
 *   E2E_PASSWORD=... node scripts/cleanup-e2e-rule-sets.mjs https://<api-host>          # list
 *   E2E_PASSWORD=... node scripts/cleanup-e2e-rule-sets.mjs https://<api-host> --apply  # delete
 */
const base = process.argv[2] ?? 'http://localhost:3000';
const apply = process.argv.includes('--apply');
const email = process.env.SMOKE_EMAIL ?? 'owner@admin-uat.kuwick.invalid';
const password = process.env.E2E_PASSWORD;
const JUNK = /^(E2E rule set|Paid below|Overtime at two|Below the Act|Phone width check)\b/;

if (!password) {
  console.error('cleanup-e2e-rule-sets: E2E_PASSWORD is not set');
  process.exit(1);
}
const fail = (message) => {
  console.error(`cleanup-e2e-rule-sets: ${message}`);
  process.exit(1);
};

const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(15_000),
}).catch((error) => fail(`login request did not complete: ${error}`));
if (!login.ok) fail(`POST /auth/login answered ${login.status}`);
const headers = { Authorization: `Bearer ${(await login.json()).accessToken}`, 'content-type': 'application/json' };

const list = await fetch(`${base}/workforce/payroll-policies`, { headers, signal: AbortSignal.timeout(15_000) });
if (!list.ok) fail(`GET /workforce/payroll-policies answered ${list.status}`);
const { policies } = await list.json();
const junk = policies.filter((row) => JUNK.test(row.name) && !row.isDefault && row.employeeCount === 0);

console.log(`${policies.length} rule sets on ${base}; ${junk.length} left by the browser gate:`);
for (const row of junk) console.log(`  ${row.removable ? 'removable' : `blocked: ${row.removalBlockedBy}`}  ${row.name}`);
if (!apply) {
  console.log(junk.length > 0 ? 'Run again with --apply to delete them.' : 'Nothing to do.');
  process.exit(0);
}
for (const row of junk) {
  const res = await fetch(`${base}/workforce/payroll-policies/${row.id}`, {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ reason: 'Left behind by the browser gate' }),
    signal: AbortSignal.timeout(15_000),
  });
  console.log(`  ${res.ok ? 'deleted' : `refused ${res.status}`}  ${row.name}${res.ok ? '' : `: ${(await res.text()).slice(0, 160)}`}`);
}
