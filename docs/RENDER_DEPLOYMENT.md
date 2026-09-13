# Deploying KUWICK on Render + Supabase

The deployment guide `render.yaml` refers to. Two Render services against one
Supabase database.

**Railway is gone.** `docs/STAGING_DEPLOYMENT.md` is the old Railway runbook and
is kept only as history — nothing in it applies to a current deploy.

## What is in the blueprint, and what is not

`render.yaml` at the repository root is a Render Blueprint. It declares:

| Service | Kind | Build | Start |
|---|---|---|---|
| `kuwick-api` | Node web service, Singapore, `autoDeploy` on `master` | `npm ci --include=dev`, `prisma generate`, `nest build` | `node dist/main` |
| `kuwick-web` | Static site, `autoDeploy` on `master` | `npm ci --include=dev`, `vite build` | served from `apps/web/dist` |

**The blueprint never migrates the database.** The API's start command is
`node dist/main`, deliberately not `start:prod` (which would run
`prisma migrate deploy` first). Migrations belong to the GitHub Actions
workflow `Supabase DB Init (manual)` and are run on purpose, by a person, as
the database owner.

**The API refuses to boot as a superuser.** `DATABASE_URL` must be the
Supabase *session pooler* URL using the `kuwick_app` role. Row-level security
is `ENABLE` + `FORCE` on every tenant table, and a superuser connection would
bypass it silently — so the application checks and stops instead.

## The values you type into the dashboard

Everything marked `sync: false` is deliberately not in git.

On **kuwick-api**:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Supabase session-pooler URL, `kuwick_app` role, not `postgres` |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different long random strings |
| `CORS_ORIGINS` | The web service's HTTPS origin, no trailing slash. Unset means *every* origin, which is wrong for a public API. |

On **kuwick-web**:

| Variable | What it is |
|---|---|
| `VITE_API_BASE_URL` | The API service's HTTPS URL, no trailing slash |

`VITE_*` values are baked into the bundle at BUILD time, so changing one needs
a redeploy rather than a restart — and a secret in a `VITE_*` variable is a
public secret.

## Order of operations for a first deploy

1. Create the blueprint. Both services build; `kuwick-web` will not talk to the
   API yet, because `VITE_API_BASE_URL` is unset.
2. Run the **Supabase DB Init (manual)** workflow to apply migrations as the
   database owner. Nothing on Render does this.
3. Set `kuwick-api`'s variables. It restarts and `/health` should answer.
4. Set `kuwick-web`'s `VITE_API_BASE_URL` to the API's URL and redeploy it.
5. Set `kuwick-api`'s `CORS_ORIGINS` to the web URL and restart it.
6. Run the **HR UAT Seed (manual)** workflow to put the HR/payroll test world
   on the database. It needs the API from step 3 to be answering, because the
   seed runs three payroll months through the engine over HTTP.

## Keeping staging seeded: HR UAT Seed (manual)

`.github/workflows/hr-uat-seed.yml` does from the Actions tab what nobody can
do from a laptop without the database password:

    provision kuwick_app -> prisma migrate deploy -> RE-provision -> seed

The second provision is not a belt-and-braces repeat. `ALTER DEFAULT
PRIVILEGES` covers tables a *future* migration creates, not the ones the
migrations that just ran created — so without it the API connects fine and then
answers `permission denied for table leave_request_attachments` on the first
read of anything Piece 3g added.

It uses `SUPABASE_APP_ROLE_PASSWORD` for both passes, which is the point: that
secret must hold the password `kuwick_app` **already** has — the one inside
`kuwick-api`'s `DATABASE_URL` — because `provision-app-role.mjs` always issues
`ALTER ROLE kuwick_app WITH PASSWORD`. A different value there would rotate the
password out from under the live service and every request would die with
`28P01 password authentication failed`. Same value in, same password out, which
is also what makes the workflow safe to re-run.

Two inputs: the API URL (default `https://kuwick-api.onrender.com`) and
**Rebuild the demo tenant**, which is ticked by default and rebuilds
`Klinik Contoh (UAT)` from scratch. Untick it during testing to keep what you
have typed and only top the HR layer up.

The run summary prints the migrations the run applied, the tenants in the
database, and the five UAT accounts with their password. One thing it will tell
you and is worth knowing beforehand: once `Klinik Contoh (UAT)` sits beside the
staging seed's own tenant, `seed-staging-uat.ts` refuses to run ("database
already holds N other tenant(s)"), so **Supabase DB Init (manual)** will stop at
its staging-seed step from then on. That guard is doing its job. Refresh the HR
world by re-running the HR workflow instead.

## Verifying a deploy — the only thing that counts as verified

A green Render build is not a working deploy. Check all three:

```bash
curl -sS https://<api-host>/health                 # 200, and names the schema state
curl -sS -o /dev/null -w '%{http_code}\n' https://<web-host>/   # 200
curl -sS -X POST https://<api-host>/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<a real account>","password":"<its password>"}'  # 201 with tokens
```

Then open the web host and sign in. If the browser console shows a CORS error,
`CORS_ORIGINS` does not match the web origin exactly (scheme, host, no trailing
slash).

## Free-plan limits worth knowing before UAT

- **Cold starts.** A free web service sleeps. The first request after idle can
  take tens of seconds, which reads as "the app is broken" to somebody being
  shown it. Move `kuwick-api` to a paid instance before a demo.
- **Clinical attachments do not persist.** The API writes uploads to local
  disk, and a free instance's disk is wiped on every deploy and restart. The
  blueprint carries the commented-out disk block and the `UPLOADS_DIR` variable
  that fix it; both need a paid plan.
