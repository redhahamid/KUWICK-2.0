# Kuwick 2.0

Unified clinic operating system for Malaysian outpatient clinics — clinical care, appointments, staffing, inventory, panel billing, and management analytics in one platform.

## Start here

Read `docs/` in this order before touching code:

1. `docs/PRODUCT_REQUIREMENTS.md` — what we're building and why
2. `docs/SYSTEM_ARCHITECTURE.md` — how the system is shaped
3. `docs/DATABASE_ARCHITECTURE.md` — data model
4. `docs/UI_DESIGN_SYSTEM.md` — visual/interaction rules
5. `docs/CODING_STANDARDS.md` — how we write code here
6. `docs/DEVELOPMENT_ROADMAP.md` — build order
7. `docs/DECISIONS.md` — every assumption made and why

## Project layout

```
apps/web       React + TypeScript frontend (Vite, Ant Design)
apps/api       NestJS + TypeScript backend (Prisma, PostgreSQL)
packages/shared  Types/enums shared by both
docs/          Product & engineering documentation
```

## Local setup

Requires Node.js (already installed) and PostgreSQL 16 (already installed as a local Windows service, database `kuwick_dev`).

```
npm install
npm run dev:api   # http://localhost:3000
npm run dev:web   # http://localhost:5173
```

Copy `apps/api/.env.example` to `apps/api/.env` and fill in your local database credentials before running the API.
