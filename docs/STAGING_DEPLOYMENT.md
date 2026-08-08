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

Both services watch `clinical-workspace-c2-canvas-ux`. A push to that branch
redeploys staging. No service is attached to `master`, so nothing here can
promote to production.

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
