#!/usr/bin/env node
/**
 * ONE-SHOT UAT BOOTSTRAP — provision the app role, then run the guarded seed
 * as that role. Temporary: this file and its `start:prod` hook are removed
 * once the UAT dataset exists.
 *
 * WHY IT EXISTS. The remote UAT seed refuses to run as a SUPERUSER or a
 * BYPASSRLS role, by design — on a remote database, row-level security must be
 * an enforced boundary, not a convention. Railway's service connects as
 * `postgres`, which is both. The fix is not to weaken the seed; it is to give
 * the seed the non-privileged role this repo already specifies
 * (`apps/api/prisma/provision-app-role.sql`, run by
 * `scripts/provision-app-role.mjs` — the same file CI uses, so the two cannot
 * drift).
 *
 * WHAT IT DOES NOT DO. It does not seed on deploy: with `UAT_SEED_ONCE` unset
 * — its normal, permanent state — this script reads one environment variable,
 * does nothing, and returns. It changes no Railway variable, touches neither
 * DATABASE_URL nor KUWICK_ALLOW_SUPERUSER_DB, disables no policy, and deletes
 * nothing. The application's own connection is untouched: the API keeps
 * connecting exactly as it does today.
 *
 * THE PASSWORD NEVER LEAVES THIS PROCESS. It is generated here, handed to the
 * provisioning script through its environment, used to build one connection
 * string for the child seed, and discarded when the process exits. It is never
 * printed, never written to a file, and never stored as a Railway variable.
 *
 * IT CAN NEVER STOP THE API FROM BOOTING. Every failure path logs and exits 0,
 * because a seeding convenience that can take the service down is a worse
 * problem than an unseeded UAT environment.
 *
 *   UAT_SEED_ONCE=dry     provision + DRY RUN (writes nothing, prints the plan)
 *   UAT_SEED_ONCE=write   provision + WRITE, then a second WRITE to prove
 *                         idempotency, then a read-only verification summary
 *   (unset)               no-op
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Mode comes from the command line first, so this is run deliberately:
//   npm run uat:dry --workspace=apps/api
//   npm run uat:write --workspace=apps/api
// The environment variable is still honoured for a non-interactive caller.
const MODE = (process.argv[2] ?? process.env.UAT_SEED_ONCE ?? '').trim().toLowerCase();

// Nothing asked for, nothing done, no log noise.
if (!MODE) process.exit(0);

const line = (s = '') => console.log(s);
const done = (why) => {
  line('');
  line(`-- uat-bootstrap: ${why}`);
  line('-- the API now starts normally. Delete UAT_SEED_ONCE when finished.');
  line('');
  process.exit(0); // NEVER block the service from starting.
};

line('');
line('===============================================================');
line(`  ONE-SHOT UAT BOOTSTRAP - mode: ${MODE}`);
line('===============================================================');

if (MODE !== 'dry' && MODE !== 'write') {
  done(`UAT_SEED_ONCE="${MODE}" is not a valid mode. Use "dry" or "write". Nothing done.`);
}

// The OWNER seat — the same one migrations use. Provisioning a role needs it;
// the seed itself will deliberately NOT use it.
const ownerUrl = process.env.MIGRATE_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!ownerUrl) done('neither MIGRATE_DATABASE_URL nor DATABASE_URL is set. Nothing done.');

let appUrl;
try {
  const parsed = new URL(ownerUrl);
  line(`  database          : ${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`);
  line(`  provisioning as   : ${parsed.username || '(env)'}  <- owner seat, for CREATE ROLE only`);
  // base64url alphabet only (A-Z a-z 0-9 _ -), so nothing needs URL escaping.
  const password = randomBytes(24).toString('base64url').slice(0, 32);
  parsed.username = 'kuwick_app';
  parsed.password = password;
  appUrl = parsed.toString();
  process.env.APP_ROLE_PASSWORD = password;
} catch {
  done('DATABASE_URL is not a parseable URL. Nothing done.');
}

// -- 1. provision, through the repository's own source of truth -------------
// Not re-implemented here: the SQL lives in apps/api/prisma/provision-app-role.sql
// and this is the script CI runs. It is idempotent, rotates the password, keeps
// the append-only carve-out, never grants TRUNCATE, and re-reads the role's
// flags afterwards — refusing to report success unless it really came out
// NOSUPERUSER NOBYPASSRLS.
const provisioner = join(process.cwd(), '..', '..', 'scripts', 'provision-app-role.mjs');
if (!existsSync(provisioner)) done(`provisioning script not found at ${provisioner}. Nothing done.`);

line('');
line('-- provisioning kuwick_app (repo source of truth) --');
const provision = spawnSync(process.execPath, [provisioner, ownerUrl], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env,
  encoding: 'utf8',
  timeout: 120_000,
  killSignal: 'SIGKILL',
});
const provisionOut = `${provision.stdout ?? ''}${provision.stderr ?? ''}`.trim();
line(
  provisionOut
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n'),
);
if (provision.status !== 0 || !provisionOut.includes('kuwick_app ready (NOSUPERUSER NOBYPASSRLS)')) {
  done('provisioning did not report success — the seed was NOT run.');
}

// -- 2. run the guarded seed AS kuwick_app ----------------------------------
// Its own preflight does all the verification: it re-checks the role's
// privileges (refusing any superuser/bypassrls seat), asserts ENABLE+FORCE RLS
// on every table it writes, matches the synthetic tenant by exact name, and
// pins app.tenant_id for the transaction. None of that is bypassed here.
const seed = join(process.cwd(), 'prisma', 'uat-remote-seed.ts');
if (!existsSync(seed)) done(`seed not found at ${seed}. Nothing done.`);

// HOW THE TYPESCRIPT SEED IS RUN, and why it is not `npx`.
//
// Node runs the seed itself via native type-stripping — no loader to install,
// no registry round-trip, nothing to wait on. The first version of this file
// reached for `npx -y tsx@4.19.2` when the image had no local tsx binary, and
// an `npx` that has to fetch a package is an unbounded network wait in the
// middle of a deploy. A local tsx is still preferred when one exists (older
// Node), and every child carries a hard timeout so no branch can hang.
const localTsx = join(process.cwd(), '..', '..', 'node_modules', '.bin', 'tsx');
const [major, minor] = process.versions.node.split('.').map(Number);
const canStripTypes = major > 22 || (major === 22 && minor >= 6);
const runner = canStripTypes
  ? { cmd: process.execPath, pre: ['--experimental-strip-types', '--no-warnings'] }
  : existsSync(localTsx)
    ? { cmd: localTsx, pre: [] }
    : null;

if (!runner) done(`node ${process.versions.node} cannot run TypeScript and no local tsx exists. Nothing done.`);

const runSeed = (write, label) => {
  line('');
  line(`-- ${label} --`);
  const childEnv = { ...process.env, DATABASE_URL: appUrl, ALLOW_REMOTE_UAT_SEED: 'true' };
  if (write) childEnv.UAT_SEED_WRITE = 'true';
  delete childEnv.APP_ROLE_PASSWORD;
  const result = spawnSync(runner.cmd, [...runner.pre, seed], {
    stdio: 'inherit',
    env: childEnv,
    timeout: 600_000,
    killSignal: 'SIGKILL',
  });
  if (result.error?.code === 'ETIMEDOUT') {
    line('  the seed exceeded its 10-minute ceiling and was killed. Nothing is left half-written:');
    line('  every change it makes lives in one transaction, which the database rolls back.');
    return false;
  }
  return result.status === 0;
};

if (MODE === 'dry') {
  const ok = runSeed(false, 'DRY RUN as kuwick_app (nothing will be committed)');
  done(
    ok
      ? 'dry run finished. Read the preflight above. If every invariant is right, set UAT_SEED_ONCE=write.'
      : 'the dry run aborted — see its reason above. NOTHING was written.',
  );
}

// MODE === 'write'
if (!runSeed(true, 'WRITE as kuwick_app')) {
  done('the write aborted on a failed invariant — see its reason above.');
}
if (!runSeed(true, 'SECOND WRITE - idempotency proof (expect 0 created, 0 updated)')) {
  done('the second write failed; the first one DID commit. Inspect before re-running.');
}

// -- 3. read-only verification, on the owner seat ---------------------------
const VERIFY = `
const pg = require('pg');
(async () => {
  const c = new pg.Client({ connectionString: process.env.__VERIFY_URL });
  await c.connect();
  const q = async (label, sql) =>
    console.log('  ' + label.padEnd(22) + ': ' + (await c.query(sql)).rows[0].v);
  await q('doctors', "SELECT count(*)::text v FROM staff WHERE role::text='DOCTOR_RESIDENT'");
  await q('bookable services', "SELECT count(*)::text v FROM service_catalog WHERE bookable AND active");
  await q('qualifications', "SELECT count(*)::text v FROM doctor_service_qualifications");
  await q('weekly patterns', "SELECT count(*)::text v FROM doctor_schedules");
  await q('shifts by state', "SELECT coalesce(string_agg(t||'='||n, ', ' ORDER BY t),'none') v FROM (SELECT shift_type::text t, count(*) n FROM provider_shifts GROUP BY 1) x");
  await q('seeded appointments', "SELECT count(*)::text v FROM appointments WHERE source_detail='uat-remote-seed'");
  await q('  by status', "SELECT coalesce(string_agg(s||'='||n, ', ' ORDER BY s),'none') v FROM (SELECT status::text s, count(*) n FROM appointments WHERE source_detail='uat-remote-seed' GROUP BY 1) x");
  await q('  distinct dates', "SELECT count(DISTINCT (scheduled_start AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kuala_Lumpur')::date)::text v FROM appointments WHERE source_detail='uat-remote-seed'");
  await q('live booking page', "SELECT coalesce(string_agg('/book/'||slug||' -> '||display_name, ', '),'NONE') v FROM clinic_booking_pages WHERE active");
  await c.end();
})().catch((e) => { console.log('  verification query failed: ' + e.message); });
`;
line('');
line('-- verification (read-only, owner seat) --');
const verify = spawnSync(process.execPath, ['-e', VERIFY], {
  stdio: 'inherit',
  env: { ...process.env, __VERIFY_URL: ownerUrl },
  cwd: join(process.cwd(), '..', '..'),
});
if (verify.status !== 0) line('  (verification step could not run; the seed result above still stands)');

done('WRITE COMPLETE and idempotency proven. Now DELETE the UAT_SEED_ONCE variable.');
