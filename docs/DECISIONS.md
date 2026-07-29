# Kuwick 2.0 — Decisions Log

Every non-critical technical decision made without stopping to ask, per the standing CTO operating agreement: *"For non-critical decisions, choose the best industry-standard solution, document the assumption, and continue working. Only stop and ask when the decision affects patient safety, clinical workflow, billing, panel claims, security, data ownership, or major product direction."*

Format: **Decision** — what was chosen · **Alternatives considered** · **Why** · **Reversibility**.

---

## D-001 — Tenancy model: multi-tenant SaaS
**Status: CONFIRMED BY OWNER, not an assumption** (2026-07-27, via direct question — this affects data ownership and major product direction, so it was not decided unilaterally).
Kuwick 2.0 supports multiple, unrelated clinic businesses on one platform, each fully data-isolated. Recorded here because every other decision in this log builds on it.

## D-002 — Multi-tenancy implementation: shared schema + `tenant_id` + Row-Level Security
**Alternatives considered**: database-per-tenant, schema-per-tenant.
**Why**: shared-schema is the cheapest to operate at current scale and is a standard SaaS pattern; PostgreSQL RLS adds a database-enforced guarantee so a missing `WHERE tenant_id = ...` in application code can't leak data, which is the appropriate level of caution given this operationalizes a data-ownership decision rather than sets a new one.
**Reversibility**: Medium. Moving to schema/database-per-tenant later is a migration, not a rewrite, if a future enterprise customer requires stronger isolation.

## D-003 — Backend framework: NestJS (Node.js + TypeScript)
**Alternatives considered**: plain Express, Fastify, a non-Node stack (e.g. Django, Laravel).
**Why**: Nest's module system maps directly onto the product's own module list; built-in guards/interceptors/pipes give a clean place to enforce RBAC, tenant isolation, and audit logging as cross-cutting concerns instead of duplicated per-module code.
**Reversibility**: Low once modules are built out — standard risk for any backend framework choice.

## D-004 — Architecture shape: modular monolith, not microservices
**Alternatives considered**: microservices per module.
**Why**: a claim batch total must be atomically consistent with its invoices (Clinical Operations); that's one database transaction in a monolith and a distributed-transaction problem across services. No current team-size or scaling reason justifies the operational cost of microservices.
**Reversibility**: Medium — module boundaries are already enforced in code, so splitting out a single module later (e.g. Reports) remains possible without a full rewrite.

## D-005 — Frontend: React 18 + Vite + TypeScript, not Next.js
**Alternatives considered**: Next.js (SSR/SSG), Vue, Angular.
**Why**: this is an authenticated internal application with no SEO/SSR requirement; Vite gives a simpler, faster local dev loop without a server-rendering layer to maintain.
**Reversibility**: Medium-high — would require rebuilding routing/data-fetching if reversed later, but no backend coupling to undo.

## D-006 — UI component kit: Ant Design v5
**Alternatives considered**: Material UI, Chakra UI, building custom components.
**Why**: purpose-built for dense admin/business applications (tables, forms, filters) — directly matches the clinic-operations screens this product needs, and supports the drill-down dashboard requirement well.
**Reversibility**: Low-medium once screens are built against it — standard component-library lock-in.

## D-007 — API style: REST, not GraphQL
**Why**: simpler to secure per-route with RBAC guards; matches the CRUD-and-workflow shape of the product; smaller learning curve for future contributors.
**Reversibility**: Medium — would require a parallel API layer to migrate incrementally.

## D-008 — ORM: Prisma
**Alternatives considered**: TypeORM, Drizzle, raw SQL.
**Why**: type-safe queries end-to-end, strong migration tooling, schema-as-code that doubles as living documentation (`DATABASE_ARCHITECTURE.md` is written to match it).
**Reversibility**: Medium — schema knowledge transfers even if the query layer changes.

## D-009 — Primary keys: UUID v4 on every table
**Alternatives considered**: auto-incrementing integers, ULID/UUIDv7.
**Why**: non-guessable when exposed in APIs/URLs, no cross-tenant collision risk, standard for multi-tenant SaaS. UUIDv7 (time-ordered) was considered for index locality but adds complexity not yet justified at this data volume.
**Reversibility**: Low once data exists — standard PK-choice lock-in.

## D-010 — Soft-delete + no DELETE grant for the app's database role on audited entities
**Why**: `PRODUCT_REQUIREMENTS.md` §11 requires indefinite audit retention on patient records, prescriptions, invoices, stock adjustments, purchase orders, panel claims, and user/role changes — a hard delete would defeat that regardless of application-layer discipline.
**Reversibility**: Low — this is a safety-conservative default, changing it later would only ever loosen a restriction, not tighten one.

## D-011 — Monorepo tooling: npm workspaces
**Alternatives considered**: Turborepo, pnpm workspaces, Nx.
**Why**: npm is already installed and current on this machine; introducing another package manager/build-orchestration tool isn't justified until build times actually become a problem.
**Reversibility**: High — can add Turborepo on top of npm workspaces later without restructuring.

## D-012 — Background jobs (BullMQ + Redis), file storage provider, and concrete SMS/WhatsApp/email provider are all deferred, not chosen yet
**Why**: none of Phase 0 or the earliest Phase 1 sub-phases (1a Clinical, 1d Inventory) need them; picking a vendor now would be guessing ahead of a real requirement. `SYSTEM_ARCHITECTURE.md` defines the interface boundary (`NotificationProvider`) so the eventual choice is a plug-in, not a rearchitecture.
**Reversibility**: N/A — nothing has been built against a specific vendor yet.

## D-013 — Local database engine installed natively, not via Docker
**Alternatives considered**: Docker Desktop + containerized PostgreSQL.
**Why**: Docker Desktop on Windows requires enabling virtualization/WSL2 features and often a reboot — a more invasive change to the product owner's personal machine than a native installer, for no benefit yet (no team/CI to keep environments identical across). Revisit if/when a second developer or CI joins the project.
**Reversibility**: High — swapping to a containerized Postgres later doesn't affect the schema or application code at all.

## D-014 — Dedicated local database role, not the installer's default superuser
The PostgreSQL installer's default `postgres` superuser account is never used by the application. A dedicated role `kuwick_dev` owns a dedicated database `kuwick_dev`; its generated password lives only in the local, gitignored `.env` file — never in this repository, never requested from or shared with the product owner.
**Reversibility**: N/A — this is the standard-practice setup, not a decision with a meaningful alternative.

## D-015 — Fixed role enum, not a per-tenant custom role builder
**Why**: `PRODUCT_REQUIREMENTS.md` §5 defines a specific, fixed permission matrix (9 roles) with no mention of tenants needing to define their own roles. Building a custom role/permission editor now would be speculative scope beyond what's specified.
**Reversibility**: Medium — a custom-role system can be added later as its own feature if a real need for it appears.

## D-016 — Node.js/npm versions: using what's already installed on this machine (Node v26.4.0, npm 11.17.0), not pinned to a specific LTS yet
**Why**: no reason to install a different version before there's a second contributor or a CI pipeline to keep in sync. `package.json` `engines` field will pin a version once that matters.
**Reversibility**: High.

## D-017 — Interim tenant context: header-based Express middleware + Prisma tenant-scoping extension (not JWT-derived, pending real auth)
Until real authentication (JWT access/refresh tokens, `SYSTEM_ARCHITECTURE.md` §2) exists, every request beyond
Core's health check must carry an `x-tenant-id` header. `TenantContextMiddleware`
(`apps/api/src/core/tenant-context.middleware.ts`) validates the header is present and a well-formed UUID, confirms
it matches a real `Tenant` row, and runs the rest of the request inside a Node `AsyncLocalStorage.run()` call so the
tenant id is available to everything downstream. `PrismaService` is wrapped via a Prisma client extension
(`apps/api/src/core/tenant-scoped-prisma.provider.ts`, injected via the `TENANT_SCOPED_PRISMA` token) so every query
run through it first executes `SELECT set_config('app.tenant_id', $1, true)` inside the same transaction as the
query itself — Prisma's own documented RLS-integration pattern, chosen because a bare `SET LOCAL` in isolation isn't
reliable under connection pooling. Missing header → 400; header present but no matching tenant → 401.
**Implemented as middleware, not a `CanActivate` guard**: a guard was tried first and its unit test caught a real
propagation bug — `AsyncLocalStorage.enterWith()` called inside `canActivate()` does not survive the guard's own
`await` boundary back into Nest's internal pipeline, so by the time the controller handler ran, the tenant context
was already gone. Express middleware's `next()` is invoked synchronously *inside* `AsyncLocalStorage.run()`'s
callback, making the entire downstream pipeline a true descendant of that call, which propagates correctly. Applied
in `AppModule.configure()` to all routes except `health`.
**Alternatives considered**: per-endpoint query-param/body `tenant_id` (rejected — easy to forget, doesn't match
the eventual auth-derived shape); app-code-only `WHERE tenant_id = ...` filtering with no RLS wiring yet (rejected —
defeats RLS's role as a database-enforced backstop exactly when module code is newest); a `CanActivate` guard
(rejected — see propagation bug above).
**Why**: preserves the RLS-as-backstop guarantee from the first line of Appointment/HR code, without waiting for
real auth; the header source is the only thing that changes when JWT auth ships.
**Reversibility**: High — swapping the tenant-id source from header to JWT claim is a small change inside the
middleware; RLS policies and the Prisma extension are untouched.

## D-018 — RBAC guard: deferred entirely, not stubbed
No RBAC guard (stub, no-op, or otherwise) is introduced in Phase 1b. The permission matrix
(`PRODUCT_REQUIREMENTS.md` §5) is not enforced at the API layer yet; every 1b endpoint is reachable by any caller
presenting a valid `x-tenant-id` header.
**Alternatives considered**: a no-op/always-allow RBAC guard as a placeholder. Rejected — a guard that grants
everything provides zero real protection while looking, on a quick read of the module list, like access control
exists; that's a worse state than visibly having none. RBAC fundamentally needs a caller identity + role claim,
which doesn't exist until JWT auth ships, so building it against a placeholder identity now would likely be rebuilt
anyway.
**Why**: none of the Appointment acceptance criteria (`PRODUCT_REQUIREMENTS.md` §18) depend on role enforcement;
keeps 1b scoped to what's actually specified (`CODING_STANDARDS.md` §1) and avoids security theater. Tracked here
so the gap is visible, not silent.
**Reversibility**: N/A — nothing built against a placeholder RBAC shape; the real guard lands with JWT auth.

---

## Decisions requiring owner sign-off (not unilaterally decided — tracked here for visibility, detailed in `PRODUCT_REQUIREMENTS.md` §17)

These touch billing, panel claims, clinical workflow, or data ownership and are intentionally **not** resolved above:

- Front-desk visibility into panel eligibility
- Doctor incentive formula, precise worked semantics
- Holiday/after-hours surcharge interaction with panel-locked pricing
- Panel pricing override governance
- Data migration mechanism from the existing Kuwick system
- Foreign-patient (non-NRIC) identifier handling
