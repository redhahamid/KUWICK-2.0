#!/usr/bin/env node
/**
 * Prove the API can actually AUTHENTICATE before any spec runs.
 *
 * This exists because of how CI hid a total login outage for its entire
 * life: the wait step probed /health, which needs no auth, so a server whose
 * JWT secrets were misnamed answered "up" while every login 500'd — and the
 * failure surfaced as eight Playwright timeouts deep inside page objects,
 * reading as "the app is broken" rather than "nobody can log in".
 *
 * So this performs a real login with the same account and password the specs
 * use, asserts a token came back, and spends it on one authenticated,
 * tenant-scoped GET. If this fails, the job fails HERE, in one line, before
 * a browser ever starts.
 *
 *   E2E_PASSWORD=... node scripts/smoke-login.mjs http://localhost:3000
 */
const base = process.argv[2] ?? 'http://localhost:3000';
const email = process.env.SMOKE_EMAIL ?? 'frontdesk@uat.kuwick.invalid';
const password = process.env.E2E_PASSWORD;

if (!password) {
  console.error('smoke-login: E2E_PASSWORD is not set');
  process.exit(1);
}

const fail = (message) => {
  console.error(`smoke-login: ${message}`);
  process.exit(1);
};

const loginResponse = await fetch(`${base}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password }),
  signal: AbortSignal.timeout(15_000),
}).catch((error) => fail(`login request did not complete: ${error}`));

if (!loginResponse.ok) {
  fail(`POST /auth/login answered ${loginResponse.status} — the specs cannot sign in. Body: ${(await loginResponse.text()).slice(0, 300)}`);
}

const session = await loginResponse.json();
if (!session?.accessToken) {
  fail(`login answered 200 but carried no accessToken: ${JSON.stringify(session).slice(0, 300)}`);
}

// One authenticated, tenant-scoped read — proves the token VERIFIES too
// (signing and verifying use different env vars; a smoke that stops at the
// token would pass with a broken verify secret).
const authedResponse = await fetch(`${base}/clinics`, {
  headers: { authorization: `Bearer ${session.accessToken}` },
  signal: AbortSignal.timeout(15_000),
}).catch((error) => fail(`authenticated GET did not complete: ${error}`));

if (!authedResponse.ok) {
  fail(`GET /clinics with a fresh token answered ${authedResponse.status} — tokens are issued but not honoured.`);
}

console.log(`smoke-login: ${email} can sign in and read /clinics (${authedResponse.status})`);
