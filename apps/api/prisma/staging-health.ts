/**
 * READ-ONLY: IS STAGING UP, AND IF NOT, WHY? (owner's report, 31 October 2026:
 * no login at kuwick-web, Render "Exited with status 1" at 13:27.)
 *
 * Asks, from outside Render, the questions the API's own start-up depends on,
 * in the order it asks them, and says which one fails:
 *   1. Does the database answer at all? (the API's first act is to connect)
 *   2. Is the app role able to log in, and not superuser/BYPASSRLS? (the API
 *      refuses to start otherwise)
 *   3. Is every migration in the repo applied, and none half-applied?
 * Then two questions for the owner: is the data still there (row counts and
 * the latest activity), and would the "Klinik Demo Baru 2" owner's login be
 * accepted (account, clinic and staff record active; password hash printed
 * only as its salt and a SHA-256 of the hash, never the hash itself). Last:
 * do the API and web site answer, and which build is live?
 *
 * Writes nothing. Prints no patient or staff data.
 *
 * Environment: DATABASE_URL (admin connection), API_URL, WEB_URL, DEMO_EMAIL.
 */
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

const APP_ROLE = 'kuwick_app';

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 90_000) {
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
    const text = await res.text();
    return { status: res.status, seconds: (Date.now() - started) / 1000, text };
  } catch (error) {
    return { status: 0, seconds: (Date.now() - started) / 1000, text: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
}

async function main() {
  const api = (process.env.API_URL ?? 'https://kuwick-api.onrender.com').replace(/\/$/, '');
  const web = (process.env.WEB_URL ?? 'https://kuwick-web.onrender.com').replace(/\/$/, '');
  const demoEmail = process.env.DEMO_EMAIL ?? 'pemilik@demobaru2.kuwick.test';
  const problems: string[] = [];

  console.log('== 1. Database');
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20_000 });
  let db = false;
  try {
    await client.connect();
    db = true;
  } catch (error) {
    const e = error as { code?: string; message?: string };
    console.log(`  Does NOT answer: ${e.code ?? ''} ${e.message ?? String(error)}`);
    problems.push('The database does not answer. The API cannot start without it.');
  }

  if (db) {
    const one = async <T>(sql: string, values: unknown[] = []) => (await client.query(sql, values)).rows as T[];
    const [info] = await one<{ now: Date; started: Date; version: string; size: string; max: string }>(
      `SELECT now() AS now, pg_postmaster_start_time() AS started, split_part(version(), ' ', 2) AS version,
              pg_size_pretty(pg_database_size(current_database())) AS size, current_setting('max_connections') AS max`,
    );
    console.log(`  Answers. Postgres ${info.version}; running since ${info.started.toISOString()}; size ${info.size}.`);
    const conns = await one<{ usename: string | null; state: string | null; n: number }>(
      `SELECT usename, state, count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() GROUP BY 1, 2 ORDER BY 3 DESC`,
    );
    console.log(`  Connections (max ${info.max}): ${conns.map((c) => `${c.usename ?? '-'}/${c.state ?? '-'} ${c.n}`).join(', ')}`);

    console.log('\n== 2. App role');
    const [role] = await one<{ rolcanlogin: boolean; rolsuper: boolean; rolbypassrls: boolean; rolvaliduntil: Date | null; rolconnlimit: number }>(
      `SELECT rolcanlogin, rolsuper, rolbypassrls, rolvaliduntil, rolconnlimit FROM pg_roles WHERE rolname = $1`,
      [APP_ROLE],
    );
    if (!role) {
      console.log(`  ${APP_ROLE} does not exist.`);
      problems.push(`The app role ${APP_ROLE} is missing.`);
    } else {
      const expired = role.rolvaliduntil && role.rolvaliduntil.getTime() < Date.now();
      console.log(
        `  ${APP_ROLE}: can log in ${role.rolcanlogin}; superuser ${role.rolsuper}; bypass RLS ${role.rolbypassrls}; password valid until ${role.rolvaliduntil?.toISOString() ?? 'no limit'}; connection limit ${role.rolconnlimit}`,
      );
      if (!role.rolcanlogin) problems.push(`${APP_ROLE} cannot log in.`);
      if (role.rolsuper || role.rolbypassrls) problems.push(`${APP_ROLE} is superuser or bypasses RLS: the API refuses to start.`);
      if (expired) problems.push(`${APP_ROLE}'s password has expired.`);
    }

    console.log('\n== 3. Migrations');
    const applied = await one<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>(
      `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name`,
    );
    const inRepo = readdirSync(join(__dirname, 'migrations'), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    const done = new Set(applied.filter((m) => m.finished_at && !m.rolled_back_at).map((m) => m.migration_name));
    const broken = applied.filter((m) => !m.finished_at && !m.rolled_back_at);
    const missing = inRepo.filter((name) => !done.has(name));
    console.log(`  Repo ${inRepo.length}; applied ${done.size}; latest applied ${[...done].sort().at(-1) ?? 'none'}.`);
    if (missing.length) {
      console.log(`  Not applied: ${missing.join(', ')}`);
      problems.push(`${missing.length} migration(s) in the repo are not applied on staging.`);
    }
    if (broken.length) {
      console.log(`  Started but never finished: ${broken.map((m) => m.migration_name).join(', ')}`);
      problems.push('A migration is half-applied.');
    }

    console.log('\n== 4. Data still there');
    const tables = ['tenants', 'clinics', 'users', 'staff', 'patients', 'appointments', 'visits', 'invoices', 'employee_profiles', 'payroll_runs', 'payroll_lines', 'audit_logs'];
    const counts: string[] = [];
    for (const table of tables) {
      const [row] = await one<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      counts.push(`${table} ${row.n}`);
    }
    console.log(`  ${counts.join('; ')}`);
    const [latest] = await one<{ audit: Date | null; appt: Date | null; login: Date | null }>(
      `SELECT (SELECT max(created_at) FROM audit_logs) AS audit, (SELECT max(created_at) FROM appointments) AS appt,
              (SELECT max(last_login_at) FROM users) AS login`,
    );
    console.log(
      `  Latest audit row ${latest.audit?.toISOString() ?? '-'}; latest appointment created ${latest.appt?.toISOString() ?? '-'}; latest clinic login ${latest.login?.toISOString() ?? '-'}`,
    );

    console.log('\n== 5. Klinik Demo Baru 2 owner login');
    const users = await one<{ status: string; tenant: string; tenant_status: string; slug: string | null; staff_active: boolean | null; role: string | null; last_login: Date | null; hash: string; access: number }>(
      `SELECT u.status, t.name AS tenant, t.status AS tenant_status, t.slug, s.active AS staff_active, s.role::text AS role,
              u.last_login_at AS last_login, u.password_hash AS hash,
              (SELECT count(*)::int FROM user_clinic_access a WHERE a.user_id = u.id) AS access
         FROM users u JOIN tenants t ON t.id = u.tenant_id LEFT JOIN staff s ON s.user_id = u.id
        WHERE lower(u.email) = lower($1)`,
      [demoEmail],
    );
    if (users.length === 0) {
      console.log(`  No account with that email.`);
      problems.push('The Klinik Demo Baru 2 owner account is missing.');
    }
    for (const u of users) {
      console.log(
        `  ${u.tenant} (${u.slug ?? 'no slug'}, ${u.tenant_status}): account ${u.status}; staff record ${u.staff_active === null ? 'MISSING' : u.staff_active ? 'active' : 'inactive'} (${u.role ?? '-'}); branch access ${u.access}; last login ${u.last_login?.toISOString() ?? 'never'}`,
      );
      // The salt and a digest of the hash let the password be checked offline
      // by whoever holds it; neither lets anyone log in.
      console.log(`  Password check: salt ${u.hash.slice(0, 29)}; sha256 of hash ${createHash('sha256').update(u.hash).digest('hex')}`);
      if (u.status !== 'active' || u.tenant_status !== 'active' || !u.staff_active) problems.push('The demo owner account would be refused (inactive account, clinic or staff record).');
    }
    await client.end();
  }

  console.log('\n== 6. API and web site');
  // A free Render service sleeps; the first call wakes it, so give it up to three tries.
  let health = await fetchWithTimeout(`${api}/health`);
  for (let attempt = 2; attempt <= 3 && health.status !== 200; attempt += 1) {
    console.log(`  /health try ${attempt - 1}: ${health.status} after ${health.seconds}s: ${health.text.slice(0, 200)}`);
    await new Promise((r) => setTimeout(r, 20_000));
    health = await fetchWithTimeout(`${api}/health`);
  }
  console.log(`  API /health: ${health.status} after ${health.seconds}s: ${health.text.slice(0, 300)}`);
  if (health.status !== 200) problems.push('The API does not answer /health.');
  // A made-up account: 401 means the login path and the database behind it work.
  const login = await fetchWithTimeout(`${api}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nobody@health-check.kuwick.test', password: 'not-a-real-password' }),
  });
  console.log(`  API login with a made-up account: ${login.status} (401 expected) after ${login.seconds}s`);
  if (login.status !== 401) problems.push('The login endpoint does not answer as expected.');
  const page = await fetchWithTimeout(web);
  console.log(`  Web site: ${page.status} after ${page.seconds}s`);
  if (page.status !== 200) problems.push('The web site does not answer.');

  console.log(`\nRESULT: ${problems.length ? problems.join(' ') : 'everything answered.'}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
