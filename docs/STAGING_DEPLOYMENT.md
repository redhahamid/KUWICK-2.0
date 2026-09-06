# Staging / UAT deployment (Railway)

Everything needed to bring a private owner-UAT environment up on Railway from
branch `clinical-workspace-c2-canvas-ux`. Introduced by **G4.5-STAGING**.

Nothing here changes clinical behaviour. The only application change in that
commit is CORS becoming configurable, and it is a no-op when unconfigured.

---

## Architecture: two services, not one

| Service | What it is | Build | Start |
|---|---|---|---|
| `kuwick-api` | NestJS API | `railway.api.json` | `npm run start:prod --workspace=apps/api` |
| `kuwick-web` | Vite SPA, served static | `railway.web.json` | `npm run start --workspace=apps/web` |
| Postgres | Railway plugin | — | — |
| Volume | mounted on `kuwick-api` | — | — |

### The build command must never install (G4.5-STAGING-1)

Railpack runs its own **install phase** and mounts a build cache at
`/app/node_modules/.cache`. `npm ci` deletes `node_modules` wholesale before
reinstalling, so a `npm ci` inside `buildCommand` tries to `rmdir` an active
mount point and the build dies with:

```
npm ERR! code EBUSY
npm ERR! syscall rmdir
npm ERR! path /app/node_modules/.cache
```

Both `buildCommand`s therefore **build only** — they never install. Railpack's
install phase is the single install. If you ever need to pin that install
explicitly, do it as a service variable rather than in the build command:

```
RAILPACK_INSTALL_CMD=npm ci --cache /tmp/npm-cache --prefer-offline
```

Keeping the npm cache at `/tmp/npm-cache` keeps it clear of `node_modules`
entirely. This is deliberately **not** committed as a repo-level `.npmrc`: that
would force the same absolute path on every developer machine, and `/tmp` does
not exist on Windows.

### Why not serve the SPA from the API

It was evaluated and rejected on evidence, not preference. Three API controller
prefixes collide head-on with SPA routes of the same name:

| Path | API controller | SPA route |
|---|---|---|
| `/patients` | yes | yes |
| `/platform` | yes | yes |
| `/dispensary` | yes | yes |

Collapsing to one service needs a global `/api` prefix, which rewrites every
client URL and every verification script immediately before a UAT window. Two
services is the smaller, safer change.

---

## One-time setup

### 1. Project and database

1. Railway → **New Project** → **Deploy from GitHub repo** → this repository.
2. **Add** → **Database** → **PostgreSQL**.

### 2. API service

- **Settings → Source**: branch **`clinical-workspace-c2-canvas-ux`**. Never `master`.
- **Settings → Config as code**: `railway.api.json`
- **Settings → Networking**: Generate Domain.
- **Variables**: copy `apps/api/staging.env.example`. In particular:
  - `DATABASE_URL` → `${{Postgres.DATABASE_URL}}` (a reference, not a literal)
  - `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` → generate fresh, never reuse a dev value:
    ```
    node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
    ```
  - `CORS_ORIGINS` → the web service's HTTPS origin, no trailing slash
  - `UPLOADS_DIR` → `/data/uploads`
  - `NODE_ENV` → `production`
- **Settings → Volumes**: add a volume mounted at **`/data`**. See *Attachments*.

### 3. Web service

- **Settings → Source**: same repo, same branch, **Config as code** `railway.web.json`.
- **Settings → Networking**: Generate Domain.
- **Variables**: `VITE_API_BASE_URL` → the API service's HTTPS URL, no trailing slash.

> `VITE_*` is read at **build** time and baked into the bundle. Changing it needs
> a **redeploy**, not a restart. Never put a secret in a `VITE_*` variable — the
> bundle is public.

Set `CORS_ORIGINS` on the API only after the web domain exists; the two
reference each other, so the second deploy of each is the one that sticks.

### 4. Migrate and seed

Migrations run automatically: `start:prod` is `prisma migrate deploy && node dist/main`.

`prisma` is a **runtime** dependency of `apps/api` for exactly this reason — it
is executed at container start, not only at build time, so it must survive any
production dependency pruning. Likewise `tsx` is a root devDependency because
`seed:staging` invokes it by name.

Seed once, from your machine, never from the service environment:

```bash
railway link                     # pick the project, then the API service
railway run --service kuwick-api \
  bash -c 'KUWICK_STAGING_SEED=yes STAGING_SEED_API=$RAILWAY_PUBLIC_DOMAIN \
           npm run seed:staging --workspace=apps/api'
```

`STAGING_SEED_API` is optional; without it the payment-stage visits arrive
unbilled, which is still a legitimate starting state. With it, invoices are
generated **through the API**, so the pricing engine — not the seed — decides
responsibility splits.

To choose the password rather than have one generated, add
`STAGING_SEED_PASSWORD=...` to that command. It is printed once either way.

The five accounts are `owner@`, `frontdesk@`, `finance@`, `doctor@` and `stock@`
at `uat.kuwick.invalid`, and **one password covers all five** — so if any of them
signs in, the owner's does too. `owner@uat.kuwick.invalid` is the only one that
can open Management (Operation, Stock, Panel, HR, Payroll, Finance); `doctor@`
is correctly refused every one of them, which reads as a broken deployment if
you are signed in as the doctor without realising it.

#### Lost the password? Reset the OWNER only — never re-run the seed

Re-running `seed:staging` resets all five passwords, but it also rebuilds
patients, visits, invoices and stock positions on the way past. Doing that
mid-UAT erases the findings the round exists to produce.

```bash
railway run --service kuwick-api \
  bash -c 'KUWICK_UAT_OWNER_RESET=yes UAT_OWNER_PASSWORD="<choose one>" \
           npm run reset:uat-owner --workspace=apps/api'
```

`prisma/reset-uat-owner.ts` writes exactly two rows — the owner's `users` row and
the `staff` row behind it — inside one transaction, creating the account if it is
missing and otherwise only resetting its password, its `active` flag and its
`OWNER_ADMIN` role. It deletes nothing, reads no patient, and leaves every other
account's password alone. It refuses to run unless `KUWICK_UAT_OWNER_RESET=yes`,
refuses any address outside the reserved `.invalid` TLD, and refuses outright if
the database holds a tenant that is not marked synthetic. Omit
`UAT_OWNER_PASSWORD` and it generates one and prints it once; the hash is never
printed.

#### The clinical catalogues — SEPARATE, and not optional

`seed:staging` builds the clinic, its staff and a handful of demo medicines.
It does **not** load the clinic's real catalogues. Run this second:

```bash
railway run --service kuwick-api \
  bash -c 'npm run seed:catalogues --workspace=apps/api'
```

162 diagnoses and 229 medications (with group, price, stock and unit), from
`apps/api/prisma/seed-data/*.csv`. **Idempotent** — a second run updates and
inserts nothing, never duplicates, and never deletes a medicine a past
prescription references. Safe to re-run after every schema change, and it
must be re-run whenever the database is rebuilt.

**Who can run it:** anyone with Railway access to the `kuwick-api` service —
today the owner and the collaborator account holding the project. It needs no
application login and no OWNER role, because it runs *as* the service.

**Why this has its own heading.** Staging ran for weeks holding exactly ONE
diagnosis — the single code the E2E seed plants for itself — and every suite
stayed green throughout, because the guardrail only ever searched that one
code. The failure surfaced when a doctor typed "urti" into the diagnosis box
and got nothing. Two defences now exist: the API logs
`CLINICAL CATALOGUE NOT SEEDED` loudly at boot, and `GET /health` reports
`catalogue: {diagnoses, medications, ok, warning}` — so the state is one curl
away rather than a discovery made mid-consultation.

Check it any time:

```bash
curl -s https://<api>.up.railway.app/health
# {"status":"ok","database":"connected","build":"<sha>",
#  "catalogue":{"diagnoses":162,"medications":229,"ok":true,"warning":null}}
```

### 5. Verify the real URL

```bash
npx tsx apps/api/prisma/staging-verify.ts \
  https://<web>.up.railway.app https://<api>.up.railway.app '<password>'
```

28 checks: every role logs in, a wrong password is refused, unauthenticated
reads are refused, finance is refused the dispensary, attachment magic-byte
validation still bites, the queue and dispensary boards answer, every stock
state is present, the label preview comes from the record, five routes render
in a real browser, the Canvas shows diagnosis/medications/vitals, and mobile has
no horizontal overflow.

---

## Attachments

`apps/api/src/core/file-storage.ts` writes to `UPLOADS_DIR`, defaulting to
`<cwd>/uploads`. That is **local disk**, and a container filesystem on Railway
is ephemeral: without a volume, every uploaded clinical file disappears on the
next deploy or restart.

**Chosen approach: a Railway volume mounted at `/data`, with `UPLOADS_DIR=/data/uploads`.**
Zero code change — the existing implementation already reads that variable.

Object storage (S3/R2) was deliberately **not** introduced. It would be a
storage-layer rewrite, and the brief was explicit that this task must not
redesign attachment storage.

Files are namespaced `<tenantId>/<ownerId>/<uuid>-<sanitised name>`, so the
volume can be inspected safely and nothing collides.

---

## Safety properties preserved

- Authentication is required; a wrong password returns 401.
- Tenant/branch RLS and the dispensary RBAC matrix are untouched — finance still
  gets 403 on `/dispensary/board`.
- Attachment MIME + extension + magic-byte validation is untouched.
- `CORS_ORIGINS` restricts the API to one browser origin. Unset means "allow
  all", which is fine locally and **wrong** for a public URL — set it.
- **No fixture endpoint is exposed over HTTP.** Seeding is a CLI script only.
  `KUWICK_STAGING_SEED` and `KUWICK_ALLOW_FIXTURES` are deliberately absent from
  the service environment templates.
- The staging seed refuses to run if the database already contains any tenant
  that is not the staging tenant — pointed at a real clinic database, it stops.
- Every seeded identity is synthetic: `.invalid` emails (RFC 2606), reserved
  `000000-00-xxxx` identifiers, and "(Synthetic)" in every display name.

---

## Auto-deploy

**Both services watch `master`** (owner decision 2026-08-12; they were
originally created against `clinical-workspace-c2-canvas-ux`, which is now
retired). A push to `master` redeploys staging.

BOTH services have to be repointed, not one. `kuwick-web` on the old branch
with `kuwick-api` on the new one produces the exact symptom that cost an
owner review: the API behaves as expected while the screen shows an old
build. `GET /health` names the API's commit and the avatar menu names the
web bundle's — if the two disagree, the older one is the service to fix.

To pause it: service → **Settings → Source → Disable automatic deploys**.

---

## Things to expect

- **Cold start.** On a free/hobby plan a sleeping service takes roughly 10–30s
  on the first request. The web service wakes fast; the API has to reconnect to
  Postgres. If the first login looks like it hangs, that is what it is.
- **Migrations run on every boot.** `migrate deploy` is idempotent, but it does
  add a second or two to each start.
- **The SPA bundle is ~4 MB (about 1.2 MB gzipped)** and is not code-split.
  First load on 4G is noticeably slow; subsequent loads are cached.
- **Volume backups are your responsibility.** Railway volumes are not snapshotted
  on the hobby plan.
- **`prisma migrate deploy` will not roll back.** If a migration fails on boot the
  service crash-loops; check the deploy log before assuming the app is broken.

---

## What this repository could not bootstrap before

Worth recording, because it is the reason this file exists. Every seed in
`apps/api/prisma/` assumed the tenant, clinic, item catalogue and staff already
existed — they were created by hand on the original dev machine and never
committed. A freshly migrated database therefore had **zero** tenants, clinics,
items and users, and nothing in the repository could bring one up.

`seed-staging-uat.ts` closes that: it builds a complete working environment from
an empty database, and it is the only seed that can.


## The application's database role (Phase 0, owner decision 2026-08-13)

**The application must NOT connect as a superuser or as a role with BYPASSRLS.**
Row-level security is not applied to either, so every tenant-isolation policy in
this schema — and every append-only guarantee resting on one — is unenforced when
it does. This was the real state of every environment until it was measured: a
plain `DELETE` succeeded on `patient_alerts` and `label_prints`, both of which
carried comments claiming PostgreSQL refused exactly that.

**The API now refuses to boot as such a role** (`assertNotSuperuser`, called from
`main.ts` before Nest starts, on its own short-lived connection). A warning would
mean one clinic's patient data is reachable from another with nobody finding out.

### Provisioning

One file, the same one CI runs — do not retype the SQL:

```bash
DATABASE_URL='postgresql://<owner>:<pw>@<host>:<port>/<db>' \
  APP_ROLE_PASSWORD='<secret>' \
  node scripts/provision-app-role.mjs
```

Run through **node + `pg`, not `psql`** — deliberately. This step turned CI red
twice before it was right: first an inline heredoc whose terminator was indented
inside a YAML block scalar (which never terminates a `<<'SQL'`), then `psql -f`,
which the runner has no reliable binary for. Node and `pg` are already present
because the project depends on them. The script also **verifies the flags after
writing them** and refuses to report success if the role came out SUPERUSER or
BYPASSRLS.

It is idempotent, rotates the password on each run, and **re-asserts
NOSUPERUSER NOBYPASSRLS every time** — a role granted either flag by hand for one
migration and left that way is how this guarantee gets lost silently, because
everything keeps working.

**TRUNCATE is never granted.** It is a separate privilege that RLS does not
filter, and withholding it from a non-superuser is itself one of the append-only
guarantees.

### Then point the SERVICE at it

`DATABASE_URL` on `kuwick-api` becomes
`postgresql://kuwick_app:<secret>@<host>:<port>/<db>?schema=public`.

**Migrations keep running as the OWNER**, because they create and alter objects
the app role has no business creating. Two roles, two jobs: `prisma migrate
deploy` as the owner, the running service as `kuwick_app`. Re-run the
provisioning file after any migration that adds tables — `ALTER DEFAULT
PRIVILEGES` covers future migrations, not the one that just ran in the same
session.

`KUWICK_ALLOW_SUPERUSER_DB=yes` skips the boot refusal. It exists for a developer
who has not provisioned the role yet and is not testing isolation, and it logs
that isolation is unenforced on every start. **It must never be set on a deployed
service.**

### What boot may and may not ask

Once RLS is real, a boot-time check cannot read tenant-scoped rows: with no
`app.tenant_id` a count returns a confident **zero**. The catalogue check used to
count rows at boot and, on the first boot as `kuwick_app`, reported
"0 diagnoses and 0 medications" against a database holding 162 and 236.

So boot asks only what RLS cannot filter — do the catalogue **tables** exist —
and the per-clinic question ("does THIS clinic hold a usable catalogue?") is
answered on the authenticated session, where a tenant exists. `/health` stays
unauthenticated and deployment-level; `scripts/smoke-catalogue.mjs` signs in.

**Boot-time checks must never use request-scoped infrastructure.** The
tenant-scoped Prisma client throwing "Tenant context not set" outside a request
is correct behaviour; anything at boot uses `withSystemConnection` instead.


---

# STAGING SWITCH RUNBOOK — turning on tenant isolation

## READ THIS FIRST — the ordering trap that took staging down

**2026-08-13: this runbook's first version broke staging, and would have broken
production the same way.** It is recorded here rather than quietly fixed,
because the mistake is in the ORDER, and the order is the whole content.

The original step 1 said: open the service's **Console** and run
`provision-app-role.mjs` there. That instruction can only be followed by a
service that is RUNNING. But the release that shipped the boot assertion
refuses to start while `DATABASE_URL` is the superuser's — which it is, right
up until the role exists. So:

> the code that requires the role shipped before the role existed, and the only
> documented way to create the role needed the code to be running.

A closed loop. Migrations applied fine, the app refused to boot, and there was
no Console to recover from. **Nothing was wrong with the assertion** — it did
exactly its job. What was wrong was deploying it before provisioning, and
documenting a recovery path that assumes the thing that is down.

**The correct order, and the only order this runbook now describes:**

1. **Provision the role** — from outside the container, over the database's
   PUBLIC url. Needs no running service.
2. **Set the variables** — `MIGRATE_DATABASE_URL` and `DATABASE_URL`.
3. **Then deploy the code containing the assertion.**

If the assertion is already deployed and the service is down, you are recovering
rather than switching: start at step 1 anyway. It works from a laptop with no
running instance, which is the whole point.

---

**Everything below is CLI. No dashboard steps.** `railway login` and
`railway link` once, then work in the linked project.

---

## 0 · Confirm WHAT you are about to change

Never skip this. Railway names a service's default domain after the
ENVIRONMENT, and Railway's default environment is called `production` even in a
project that is only ever used for staging. So a domain reading
`kuwick-api-production.up.railway.app` tells you the environment is named
`production` — it does **not** tell you whether real patients are in it.

```
railway status
railway environment
railway service
```

Then confirm the database is not shared with anything live:

```
railway variables --service kuwick-api | grep -i 'DATABASE_URL'
```

**Compare the host and database name against your real production project.** If
they match, or you are unsure, STOP. Everything below writes to whatever that
URL points at.

---

## 1 · Save the rollback line BEFORE touching anything

```
railway variables --service kuwick-api --kv | grep '^DATABASE_URL=' \
  > docs/ROLLBACK-$(date +%Y-%m-%d).txt
cat docs/ROLLBACK-$(date +%Y-%m-%d).txt
```

`docs/ROLLBACK-*.txt` is gitignored — it holds a live database password and must
never be committed. Keep the file until the switch is verified, then delete it
and rotate the superuser password if it has been on disk for long.

---

## 2 · Provision the role — no running container needed

This is the step that used to require the Console. It does not.

Railway exposes a **public** connection string for the Postgres service, on a
`*.proxy.rlwy.net` host, reachable from your laptop:

```
railway variables --service Postgres --kv | grep '^DATABASE_PUBLIC_URL='
```

Generate a long random password, keep it in the rollback file, and run the
provisioning script from a clone of this repo:

```
NEWPW="$(openssl rand -base64 30 | tr -d '/+=' | cut -c1-32)"
echo "kuwick_app password: $NEWPW" >> docs/ROLLBACK-$(date +%Y-%m-%d).txt

APP_ROLE_PASSWORD="$NEWPW" node scripts/provision-app-role.mjs \
  'postgresql://postgres:PW@HOST.proxy.rlwy.net:PORT/railway'
```

You want **exactly** this line back:

```
provision-app-role: kuwick_app ready (NOSUPERUSER NOBYPASSRLS), privileges granted.
```

Anything else: **stop**. The script re-reads the role's flags from `pg_roles`
and refuses to claim success unless the role really came out non-superuser and
non-bypassrls. Nothing has changed yet if it failed.

> **If it fails on TLS** — `the server does not support SSL` or a self-signed
> certificate error — append `?sslmode=no-verify` to the public URL. Railway's
> proxy terminates with a certificate your machine has no reason to trust, and
> `pg` reads `sslmode` straight from the connection string.

---

## 3 · Set the two variables

```
OLD="$(grep '^DATABASE_URL=' docs/ROLLBACK-$(date +%Y-%m-%d).txt | cut -d= -f2-)"

railway variables --service kuwick-api \
  --set "MIGRATE_DATABASE_URL=$OLD" \
  --set "DATABASE_URL=$(echo "$OLD" | sed -E "s|//postgres:[^@]*@|//kuwick_app:$NEWPW@|")"
```

Then **read them back** rather than trusting the substitution — everything after
the `@` must be byte-identical to the old line:

```
railway variables --service kuwick-api --kv | grep -E '^(DATABASE_URL|MIGRATE_DATABASE_URL)='
```

**Why two.** Migrations create tables; `kuwick_app` deliberately cannot.
`MIGRATE_DATABASE_URL` runs `prisma migrate deploy` as the owner,
`DATABASE_URL` runs the application under row-level security. Miss the first and
the service will not start on the next release — `permission denied for schema
public`, measured, not assumed.

**kuwick-web needs nothing.** It talks to the API over HTTPS and never touches
the database.

---

## 4 · Deploy, and watch the boot

```
railway up --service kuwick-api --detach
railway logs --service kuwick-api
```

---

## 5 · Verify from outside — report actual output, assume nothing

```
curl -s https://<api-domain>/health
```

Want: `"status":"ok"`, and `"catalogue":{"tablesPresent":true,"missing":[],"ok":true,...}`.

Then two things `/health` cannot tell you:

- **The build is the one you think.** Sign in, open the avatar menu; it shows
  `build <sha>`. Compare with `git rev-parse --short HEAD`. If they differ the
  browser is on an older bundle — hard-refresh before concluding anything.
- **RLS is on AND the clinic can still read its own data.** Open any patient
  record and type `urti` in the diagnosis box. Results coming back is the test.
  An empty result here is the "confident zero" signature: isolation on, tenant
  context not reaching the query. That is a failure, not a pass.

---

## 6 · If it still will not boot

Read the log before changing anything:

```
railway logs --service kuwick-api | tail -50
```

> `The application is connected as "postgres", which is a SUPERUSER…`

**That is the safety net working, not a broken deploy.** `DATABASE_URL` is still
the owner's — the substitution in step 3 did not take. Fix the variable.

If it is anything else, **roll back rather than leaving staging down**:

```
railway variables --service kuwick-api \
  --set "DATABASE_URL=$(grep '^DATABASE_URL=' docs/ROLLBACK-$(date +%Y-%m-%d).txt | cut -d= -f2-)"
```

Staging returns to exactly what it was. `MIGRATE_DATABASE_URL` can stay; it is
harmless. Rolling back costs nothing but the isolation guarantee, and **no data
is affected either way.**

---

## 7 · The emergency escape hatch — and why it is a last resort

`KUWICK_ALLOW_SUPERUSER_DB=yes` downgrades the boot refusal to a logged warning
and lets the service start as a superuser (`apps/api/src/core/prisma.service.ts`).

**It brings a downed service straight back up in one variable.** It is also the
one setting that turns every row-level-security policy in the database back into
decoration: the app runs, serves traffic, and silently has no tenant isolation
at all, with nothing on any screen to say so.

Use it only when service must be restored NOW and provisioning cannot wait —
and treat it as an open incident until it is removed, not as a configuration.
**Prefer the rollback in step 6**, which is equally fast, equally safe, and
honest about what it is: back to before, rather than forward with the guarantee
switched off.

Never set it in CI beyond the one place it already lives, and never in
production.

---

## 8 · Your data is untouched

- **Nothing is moved, copied or re-owned.** This adds a login role and grants it
  permission on tables that already exist. Every row stays where it is.
- **Do NOT run `seed:catalogues`.** The 162 diagnoses, 236 medicines and the
  prescription vocabulary are LIVE. None of this touches them, and re-running
  the seed against live data is not part of any recovery.
- **Patients, visits, invoices and prints are untouched.**

The one thing that genuinely changes: every query the application makes is
filtered by the clinic it belongs to, by PostgreSQL itself, instead of by the
application asking nicely.
