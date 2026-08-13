#!/usr/bin/env node
/**
 * Fail the build if this environment's clinical catalogue was never loaded.
 *
 * Staging ran for weeks holding ONE diagnosis — the code the E2E seed plants
 * for itself — while every suite stayed green, because the guardrail only ever
 * searched that one code. A doctor found it by typing "urti" into a box that
 * answered nothing. An empty catalogue is a clinic where no diagnosis can be
 * recorded and nothing can be prescribed; it should never reach a person before
 * it reaches a build log.
 *
 * PHASE 0 — IT SIGNS IN NOW, and that is the point rather than an inconvenience.
 * The counts used to come from `/health`, which is unauthenticated and therefore
 * has no tenant. That worked only while the application connected as a
 * SUPERUSER, because row-level security did not apply to it; the moment the app
 * role became a real non-superuser the same query returned a confident ZERO on a
 * database holding 162 diagnoses. "Does THIS clinic have a usable catalogue" is
 * a per-tenant question, so it is asked on the authenticated session — the first
 * moment a tenant exists.
 *
 * It still checks `/health` first, for the deployment-level fact that the
 * catalogue TABLES exist at all: a missing table means migrations never ran,
 * which is a more total failure and deserves its own message.
 *
 *   E2E_PASSWORD=… node scripts/smoke-catalogue.mjs http://localhost:3000
 */
const base = process.argv[2] ?? 'http://localhost:3000';
const email = process.env.SMOKE_EMAIL ?? 'frontdesk@uat.kuwick.invalid';
const password = process.env.E2E_PASSWORD;

const fail = (message) => {
  console.error(`smoke-catalogue: ${message}`);
  process.exit(1);
};

// 1. Deployment level: is the schema even there?
const health = await fetch(`${base}/health`, { signal: AbortSignal.timeout(15_000) }).catch((error) =>
  fail(`/health did not answer: ${error}`),
);
if (!health.ok) fail(`/health answered ${health.status}`);

const { catalogue: schema } = await health.json();
if (!schema) {
  fail('/health carries no catalogue field — is this build older than the check?');
}
if (!schema.ok) fail(schema.warning);

// 2. Clinic level: does this tenant actually hold a catalogue?
if (!password) {
  fail('E2E_PASSWORD is not set, so the per-clinic catalogue cannot be checked. Set it.');
}

const login = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(15_000),
}).catch((error) => fail(`/auth/login did not answer: ${error}`));

if (!login.ok) fail(`/auth/login answered ${login.status} for ${email}`);

const session = await login.json();
const catalogue = session.catalogue;

// `null` is "not determined" — the lookup is deliberately failure-tolerant so it
// can never block a sign-in — and it must NOT be read as "loaded".
if (catalogue === undefined) {
  fail('the session carries no catalogue field — is this build older than the check?');
}
if (catalogue === null) {
  fail('the per-clinic catalogue health could not be determined. Check the API logs.');
}
if (!catalogue.ok) fail(catalogue.warning);

console.log(
  `smoke-catalogue: schema present; this clinic holds ${catalogue.diagnoses} diagnoses and ` +
    `${catalogue.medications} medications — usable.`,
);
