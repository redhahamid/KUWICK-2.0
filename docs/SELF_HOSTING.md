# Running Kuwick on your own server

For the developer moving Kuwick off Supabase (database) and Render (hosting)
onto a server we run ourselves. Written 3 November 2026 against master.

Kuwick is two pieces and one database:

| Piece | What it is | Where it lives in the repo |
|---|---|---|
| API | Node.js (NestJS) server, one process, port 3000 | `apps/api` |
| Web app | Static files (React, built with Vite) | `apps/web` |
| Database | PostgreSQL | migrations in `apps/api/prisma/migrations` |

Everything below was checked on a clean database: install from zero, health
check, first login, backup, restore, and a data-only copy of an existing
database into a new one. Where something was not tried, it says so.

---

## 1. What we use from Supabase and Render, and what replaces it

Kuwick uses very little from either. Login, file storage, statutory tables and
all business logic are Kuwick's own code.

| Area | Today | On your server |
|---|---|---|
| Database | Supabase PostgreSQL (free plan, no backups we rely on), reached through the Supabase *session pooler* | PostgreSQL 16 installed on the server (or a managed PostgreSQL with superuser access for migrations). No pooler is needed: the API keeps a small pool itself. |
| Database extensions | `btree_gist` and `pgcrypto` (created by the migrations) | Both ship with standard PostgreSQL (`postgresql-contrib` on Debian/Ubuntu). Nothing else. |
| Login / auth | **Not Supabase.** Kuwick's own email + password (bcrypt) and JWT tokens signed with `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Same, unchanged. Just set the two secrets. |
| File storage | **Not Supabase Storage.** Two kinds: (a) logos, staff files (MC, receipts, bank proof) and clock-in selfies are stored *inside the database*; (b) clinical visit attachments and order attachments go to a folder on disk (`UPLOADS_DIR`, default `apps/api/uploads`). On Render's free plan that folder is wiped on every restart, so nothing in it has survived there. | (a) moves with the database. (b) a folder on the server's disk, e.g. `/var/lib/kuwick/uploads`, backed up with the database (section 4). |
| RPC / edge functions | None | Nothing to replace. |
| Scheduled jobs (cron) | None in the app. | Only the backup job in section 4. |
| Email / SMS | None. Kuwick sends no email. | Nothing to replace. |
| API hosting | Render web service, `node dist/main`, health check `/health`, sleeps when idle on the free plan | A systemd service running `node dist/main` behind nginx (section 3). It never sleeps. |
| Web hosting | Render static site, every path rewritten to `index.html` | nginx serving `apps/web/dist` with the same rewrite (section 3). |
| Deploys | Render rebuilds automatically on every push to `master` | A deploy script you run (or a CI job that SSHes in). Section 3 gives the steps. |
| Build stamp | `RENDER_GIT_COMMIT` (shown by `/health`) | Set `KUWICK_BUILD_SHA` to the commit you deployed. |
| HTTPS certificates | Render | Let's Encrypt via certbot (section 6). |
| Maintenance jobs | GitHub Actions workflows that connect to Supabase with the `SUPABASE_DATABASE_URL` secret: *Supabase DB Init*, *Migrate only*, *Staging checks*, *HR UAT Seed*, the wipe and demo-clinic jobs | Run the same commands on the server over SSH (section 3.6). Do **not** open the database to GitHub's runners to keep these working. |

---

## 2. Software, settings and the database from zero

### 2.1 Software

| Software | Version | Notes |
|---|---|---|
| Linux | Ubuntu 24.04 LTS or Debian 12 | Anything with systemd works. |
| Node.js | **22** (22.x LTS) | `package.json` requires ≥ 22. Use the NodeSource or official binaries. npm 10 comes with it. |
| PostgreSQL | **16** | CI and all tests run on 16. Include the `contrib` package. Use the same major version for `pg_dump`/`pg_restore` as the server, or newer. |
| nginx | any current | Serves the web app, proxies `/` of the API host to Node, terminates HTTPS. |
| certbot | any current | Free HTTPS certificates. |
| git | any | To fetch the code. |

Memory: 2 GB is enough for running; the build (`npm ci` + both builds) is
happier with 4 GB, or add swap. Disk: 20 GB to start; the database holds
uploaded photos and documents, so watch it grow.

### 2.2 Settings (environment variables)

Put the API's settings in `/etc/kuwick/api.env`, readable by root and the
`kuwick` user only (`chmod 640`).

**API** (`apps/api`):

| Variable | Required | What to put |
|---|---|---|
| `DATABASE_URL` | yes | `postgresql://kuwick_app:<app password>@127.0.0.1:5432/kuwick?schema=public`. **Must be the `kuwick_app` role.** The API refuses to start as a superuser or a role that bypasses row-level security, on purpose: that is what keeps one clinic's data invisible to another. |
| `JWT_ACCESS_SECRET` | yes | A long random string (`openssl rand -base64 48`). Also signs the rotating QR codes on the attendance kiosk. |
| `JWT_REFRESH_SECRET` | yes | A *different* long random string. |
| `CORS_ORIGINS` | yes in production | The web app's address, e.g. `https://app.example.my`, no trailing slash. Comma-separate several. If unset, every website may call the API: wrong for a public server. |
| `PORT` | no | Default 3000. |
| `UPLOADS_DIR` | yes in production | e.g. `/var/lib/kuwick/uploads`. If unset, files go to `apps/api/uploads` inside the code folder and are lost on the next deploy. |
| `NODE_ENV` | recommended | `production` |
| `TZ` | recommended | `UTC`. Everything has been tested with the server clock in UTC; one report (visits by hour) reads the server's clock. Clinic time zones are handled inside the app. |
| `KUWICK_BUILD_SHA` | no | The short commit hash you deployed; `/health` shows it. |
| `MIGRATE_DATABASE_URL` | only if you use `npm run start:prod` | The owner connection, used only to run migrations before the API starts. Not needed if you run migrations as a separate step (recommended, section 2.3). |

Never set `KUWICK_ALLOW_SUPERUSER_DB` (a developer escape hatch that turns
off the row-level-security check) or any of the seed variables
(`KUWICK_STAGING_SEED`, `KUWICK_ADMIN_UAT_SEED`, `KUWICK_ALLOW_FIXTURES`) on a
real server. `NODE_OPTIONS=--dns-result-order=ipv4first` on Render was only
for Supabase's network and is not needed.

**Web app** (`apps/web`), set *when building*, not when running:

| Variable | What to put |
|---|---|
| `VITE_API_BASE_URL` | The API's public address, e.g. `https://api.example.my`, no trailing slash. It is baked into the built files, so changing it means rebuilding. Never put a secret in a `VITE_` variable: anyone can read it in the browser. |

**Scripts:** `APP_ROLE_PASSWORD` is read by `scripts/provision-app-role.mjs`
to set the `kuwick_app` password (below).

### 2.3 The database from zero (tested)

Two database roles, two jobs:

- an **owner** that creates tables and runs migrations. Here: the `postgres`
  superuser, used only from the server itself, never by the running app;
- **`kuwick_app`**, which the API uses. It cannot bypass row-level security
  and cannot change the schema.

```bash
# 1. Create the database (as the postgres superuser, on the server).
sudo -u postgres createdb kuwick

# 2. Get the code and install (once per deploy, see 3.1).
cd /opt/kuwick && npm ci --include=dev
cd apps/api && npx prisma generate && cd ../..

# The owner connection. Over the local socket or 127.0.0.1 only.
export OWNER_URL='postgresql://postgres:<postgres password>@127.0.0.1:5432/kuwick?schema=public'

# 3. Create the app role and give it its rights.
APP_ROLE_PASSWORD='<long random app password>' node scripts/provision-app-role.mjs "$OWNER_URL"

# 4. Run every migration (about 170, a few seconds).
cd apps/api && DATABASE_URL="$OWNER_URL" npx prisma migrate deploy && cd ../..

# 5. Run step 3 again. It grants kuwick_app the tables the migrations just made.
APP_ROLE_PASSWORD='<same app password>' node scripts/provision-app-role.mjs "$OWNER_URL"

# 6. Check: should say "Database schema is up to date!"
cd apps/api && DATABASE_URL="$OWNER_URL" npx prisma migrate status
```

Steps 3–5 are safe to repeat; they are what every future deploy runs too.
Always give the same `APP_ROLE_PASSWORD`: the script sets the password every
time, and a different value would lock the running API out.

**The first login.** Kuwick has no sign-up page. Create the platform admin
(the system owner, who creates clinics) once:

```bash
cd /opt/kuwick/apps/api
DATABASE_URL="$OWNER_URL" ADMIN_EMAIL=owner@example.my ADMIN_NAME="Owner Name" \
ADMIN_PASSWORD='<at least 12 characters>' npx tsx prisma/create-platform-admin.ts
```

Type the email in lower case when logging in. Then log in to the web app,
create the clinic in the platform console, and load its clinical catalogues
(diagnoses, medicines, prescription lists) once per new clinic:

```bash
cd /opt/kuwick/apps/api
DATABASE_URL="$OWNER_URL" npx tsx prisma/seed-clinic-catalogues.ts --tenant <clinic tenant id>
DATABASE_URL="$OWNER_URL" npx tsx prisma/seed-reference-catalogs.ts --tenant <clinic tenant id>
DATABASE_URL="$OWNER_URL" npx tsx prisma/seed-standard-prescriptions.ts --tenant <clinic tenant id>
```

Do **not** run `seed-staging-uat.ts`, `seed-admin-uat.ts`, `seed-hr-uat.ts`,
`seed-e2e.ts` or any wipe script on a real server: they make demo clinics or
delete data.

Statutory tables (EPF, SOCSO, EIS, PCB) are built into the code; nothing to load.

---

## 3. Build, start and check

### 3.1 Build

```bash
cd /opt/kuwick
git fetch && git checkout <commit or tag to deploy>
npm ci --include=dev                      # dev tools are needed to build
cd apps/api && npx prisma generate && npm run build && cd ../..
cd apps/web && VITE_API_BASE_URL=https://api.example.my npm run build && cd ../..
```

The API is built to `apps/api/dist`, the web app to `apps/web/dist`.

### 3.2 Start the API (systemd)

`/etc/systemd/system/kuwick-api.service`:

```ini
[Unit]
Description=Kuwick API
After=network.target postgresql.service

[Service]
User=kuwick
WorkingDirectory=/opt/kuwick/apps/api
EnvironmentFile=/etc/kuwick/api.env
ExecStart=/usr/bin/node dist/main
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/kuwick kuwick
sudo mkdir -p /var/lib/kuwick/uploads && sudo chown kuwick: /var/lib/kuwick/uploads
sudo systemctl daemon-reload && sudo systemctl enable --now kuwick-api
journalctl -u kuwick-api -f        # watch it start
```

On start it prints `[bootstrap] Phase 0 OK` and then `Listening on 0.0.0.0:3000`.
If the database cannot be reached, or `DATABASE_URL` is a superuser, it stops
with a line saying exactly why. Run **one** API process: uploaded files live on
this server's disk, so a second server would not see them.

### 3.3 nginx

```nginx
# Web app
server {
  listen 443 ssl;
  server_name app.example.my;
  root /opt/kuwick/apps/web/dist;
  location / { try_files $uri /index.html; }   # every page is index.html
}

# API
server {
  listen 443 ssl;
  server_name api.example.my;
  client_max_body_size 20m;                    # attachments are up to 15 MB
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

# Send plain http to https
server { listen 80; server_name app.example.my api.example.my; return 301 https://$host$request_uri; }
```

certbot (`sudo certbot --nginx -d app.example.my -d api.example.my`) fills in
the certificate lines and renews them automatically.

### 3.4 Health check

```bash
curl -s https://api.example.my/health
# {"status":"ok","database":"connected","build":"<sha>","catalogue":{"tablesPresent":true,...,"ok":true}}

curl -s -o /dev/null -w '%{http_code}\n' https://app.example.my/     # 200

curl -s -X POST https://api.example.my/auth/login -H 'content-type: application/json' \
  -d '{"email":"owner@example.my","password":"…"}'                    # returns an accessToken
```

Then open the web app and log in. A "CORS" error in the browser console means
`CORS_ORIGINS` does not match the web address exactly (https, no trailing slash).

`/health` needs no login, so an uptime monitor (UptimeRobot, Healthchecks.io
or your own) can call it every minute.

### 3.5 Every later deploy

1. Build (3.1) the new commit.
2. **Back up the database first** (section 4, `kuwick-backup` by hand).
3. Run migrations: steps 3–5 of section 2.3.
4. `sudo systemctl restart kuwick-api`.
5. Health check (3.4). The web app needs no restart; nginx serves the new files.

A migration never runs by itself on start. That is deliberate: it is run by a
person, after a backup.

### 3.6 The GitHub maintenance jobs, on the server

| Workflow today | On the server |
|---|---|
| Supabase DB Init / Migrate only | Section 2.3, steps 3–6 |
| Staging checks → health | `DATABASE_URL="$OWNER_URL" API_URL=https://api.example.my WEB_URL=https://app.example.my npx tsx prisma/staging-health.ts` (read-only) |
| Staging checks → staff-defaults | `DATABASE_URL="$OWNER_URL" npx tsx prisma/staff-defaults-backfill.ts` (dry run; add `BACKFILL_APPLY=true` to write) |
| Create demo clinic, HR UAT seed, wipes | Staging only. Not for a real server. |

---

## 4. Daily backup, and a restore you have tried

### 4.1 What to back up

1. The database (holds almost everything, including photos and staff files).
2. `UPLOADS_DIR` (clinical visit and order attachments).
3. `/etc/kuwick/api.env` (the secrets; keep a copy somewhere safe and separate).

### 4.2 The daily job

`/usr/local/bin/kuwick-backup` (owned by root, `chmod 700`):

```bash
#!/bin/bash
set -euo pipefail
DIR=/var/backups/kuwick
STAMP=$(date +%Y-%m-%d_%H%M)
mkdir -p "$DIR"
# The whole database, compressed, in the custom format pg_restore reads.
sudo -u postgres pg_dump -d kuwick -Fc -f "$DIR/kuwick-$STAMP.dump"
# The uploaded files.
tar -czf "$DIR/uploads-$STAMP.tar.gz" -C /var/lib/kuwick uploads
# Keep 14 days here.
find "$DIR" -type f -mtime +14 -delete
# A copy OFF this server (another machine, or object storage with rclone).
rclone copy "$DIR" offsite:kuwick-backups --max-age 25h
```

Run it every night: `sudo crontab -e` →
`30 2 * * * /usr/local/bin/kuwick-backup >> /var/log/kuwick-backup.log 2>&1`

The off-server copy is the one that matters: a backup on the same disk is lost
with the disk. Keep the off-server copies for at least 30 days, and encrypt
them (rclone `crypt`) because they hold payroll and patient data.

For "restore to 10:42 this morning" rather than "last night", add
continuous WAL archiving (pgBackRest or WAL-G). Not needed on day one.

### 4.3 Restore (tested)

Into a new, empty database, so a bad restore never damages the live one:

```bash
sudo -u postgres createdb kuwick_restore
sudo -u postgres pg_restore -d kuwick_restore --no-owner --exit-on-error /var/backups/kuwick/kuwick-<stamp>.dump
APP_ROLE_PASSWORD='<app password>' node scripts/provision-app-role.mjs \
  'postgresql://postgres:<pw>@127.0.0.1:5432/kuwick_restore?schema=public'
cd apps/api && DATABASE_URL='postgresql://postgres:<pw>@127.0.0.1:5432/kuwick_restore?schema=public' npx prisma migrate status
# "Database schema is up to date!"
```

To make it live: stop the API, rename the databases
(`ALTER DATABASE kuwick RENAME TO kuwick_old; ALTER DATABASE kuwick_restore RENAME TO kuwick;`),
unpack the matching `uploads-<stamp>.tar.gz` into `/var/lib/kuwick`, start the
API, run the health check.

**Practise it once a month**: restore last night's backup into
`kuwick_restore`, point a second API process at it on another port, log in,
open one payslip, then drop `kuwick_restore`. A backup that has never been
restored is a hope, not a backup. Write the date of each drill in this file.

---

## 5. Bringing the staging data across (optional)

Staging holds the Hijraa branch's Jan–Oct 2026 payroll (tenant "Klinik Contoh
(UAT)") and four demo clinics. It holds real staff names, IC numbers and pay,
so the new server must be treated as production from the day the data lands.

The method (tested on a copy): build a fresh database with the migrations,
then copy **only the data** from Supabase into it. This avoids Supabase's own
internal schemas and settings.

1. **Freeze staging.** Tell everybody to stop using it for the hour.
2. **Get the owner connection** for Supabase (Project settings → Database →
   connection string, session pooler, user `postgres`). It is the
   `SUPABASE_DATABASE_URL` secret. Use a `pg_dump` at least as new as
   Supabase's server (check with `SELECT version();`).
3. **Dump the data only**, from a machine that can reach Supabase:
   ```bash
   pg_dump "<supabase owner url>" --data-only --schema=public \
     --exclude-table=_prisma_migrations -Fc -f staging-data.dump
   ```
   `pg_dump` warns about "circular foreign-key constraints" on a few tables;
   that is expected and handled in step 5.
4. **Make the empty database** on the new server: section 2.3 steps 1–6, **at
   the same commit staging is on** (what staging's `/health` shows as `build`),
   so the tables match exactly.
5. **Load the data** as the superuser (needed to switch off checks while
   loading, so the order of tables does not matter):
   ```bash
   sudo -u postgres pg_restore -d kuwick --data-only --disable-triggers --exit-on-error staging-data.dump
   ```
6. **Run section 2.3 step 5 again** (grants), then start the API.
7. **Check it**: run the read-only health check against the new server
   (section 3.6, first row). It prints row counts and the latest activity;
   compare them with the same check run against staging before the freeze.
   Then log in and open the Hijraa October payroll and one payslip.
8. Uploaded clinical attachments on Render's disk do not need moving: the free
   plan wipes that disk, so there are none. Logos, staff files and selfies are
   in the database and came across in step 5.
9. Delete `staging-data.dump` from any laptop it passed through.

Not tried: moving only the Hijraa tenant without the demo clinics. It is
possible but means hand-picking rows across about 200 linked tables; moving
everything is safer, and the demo clinics are harmless.

---

## 6. Security basics

- **HTTPS only.** nginx redirects http to https (section 3.3). Never let the
  web app talk to the API over plain http.
- **The database is not on the internet.** PostgreSQL listens on `127.0.0.1`
  only (`listen_addresses = 'localhost'` in `postgresql.conf`), and the
  firewall allows only 22 (SSH), 80 and 443:
  `ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable`.
  To look at data, use an SSH tunnel, never an open port.
- **Two database roles.** The app uses `kuwick_app` (no superuser, no
  bypassing row-level security; the API checks and refuses otherwise). The
  `postgres` superuser is used only on the server, for migrations, backups and
  restores. Nobody's laptop gets the superuser password.
- **Who can get in.** SSH with keys only (`PasswordAuthentication no`), one
  named account per person, no shared logins. People who need data use the
  app with their own login, not the database.
- **Secrets.** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and the
  `kuwick_app` password live in `/etc/kuwick/api.env` (mode 640) and a
  password manager. Not in git, not in chat, not in a `VITE_` variable. Make
  them new for this server, do not reuse staging's. Changing a JWT secret logs
  everybody out and changes the kiosk QR codes; that is the way to cut off
  every session at once.
- **Updates.** `unattended-upgrades` for the operating system; keep Node 22
  and PostgreSQL 16 on their latest minor versions.
- **Backups are sensitive.** They hold payroll and patient data: encrypted
  off-server, and only the people who would restore them can read them.

---

## 7. What makes self-hosting harder than it looks

| # | Point | What to do |
|---|---|---|
| 1 | The API will not start as a database superuser, by design (row-level security keeps clinics apart). | Two roles, as in 2.3. Most "it won't start" problems are this. |
| 2 | Migrations never run on start. | Deploy script: backup, then 2.3 steps 3–5, then restart (3.5). |
| 3 | The web app's API address is baked in when building. | Rebuild the web app if the API address changes. |
| 4 | Clinical attachments are on the server's disk, not object storage. | One API server; back up `UPLOADS_DIR`. Moving to S3-compatible storage would be a small code change in `apps/api/src/core/file-storage.ts` if you ever need two servers. |
| 5 | Photos and staff documents are stored in the database. | The database grows faster than you might expect; size disk and backups for it. |
| 6 | The GitHub maintenance workflows are built around Supabase (IPv4 pinning, the `SUPABASE_DATABASE_URL` secret, runners reaching the database). | Use the server commands in 3.6. Retire or edit those workflows after the move. |
| 7 | There was no way to make the first login on an empty database. | Added `apps/api/prisma/create-platform-admin.ts` (2.3). |
| 8 | Tested only with the server clock in UTC. | Set `TZ=UTC` for the API. |
| 9 | Nothing else from Supabase is used (no Supabase auth, storage, functions, realtime or cron), and the app sends no email. | Nothing to rebuild there. |

---

## 8. How long it should take

For a developer comfortable with Linux, nginx and PostgreSQL:

| Step | Time |
|---|---|
| Server, Node, PostgreSQL, nginx, HTTPS, firewall | ½ day |
| Fresh install, first login, deploy script | ½ day |
| Daily backup, off-server copy, one restore drill | ½ day |
| Moving staging data: a practice run, then the real one, and checking | 1 day |
| Retiring the Render/Supabase workflows, monitoring, buffer for surprises | ½–1 day |
| **Total** | **about 3–4 working days** (2 without the data move) |
