# Kuwick 2.0 — System Architecture

**Status:** CTO-decided technical architecture. Non-critical choices below (language, framework, hosting, messaging provider, etc.) are made per the standing delegation to "choose the best industry-standard solution and document the assumption." Every decision here has a matching entry in `DECISIONS.md`. Nothing here touches patient safety, clinical workflow, billing, panel claims, security policy, data ownership, or major product direction beyond what the product owner already confirmed in `PRODUCT_REQUIREMENTS.md` §2 (multi-tenant SaaS).

## 1. Shape of the system

A **modular monolith**, not microservices. One backend application, internally split into modules that mirror the product's own module boundaries (Core, Clinical, Appointment, HR, Inventory, Panel Claims, Reports). Reasoning: at this team size, microservices add deployment/operational overhead (service discovery, distributed transactions, network failure handling) without a corresponding benefit — a claim batch must still atomically reference invoices from Clinical Operations, which is far simpler inside one database transaction than across service boundaries. The module boundaries are still enforced in code (each module owns its own service/repository layer and exposes a narrow interface to others), so splitting into separate services later remains possible if a specific module (e.g., Reports/Analytics) needs to scale independently.

```
┌─────────────────────────────────────────────┐
│                  apps/web                     │
│   React + TypeScript SPA (role-based UI)      │
└───────────────────┬───────────────────────────┘
                    │ HTTPS / REST (JSON)
┌───────────────────▼───────────────────────────┐
│                  apps/api                     │
│  NestJS modular monolith                      │
│  ┌────────┬───────────┬────┬───────────┬────┐│
│  │ Core   │Appointment│ HR │ Inventory │Panel││
│  │(tenant,│           │    │           │Claims│
│  │patient,│           │    │           │      │
│  │auth,   │           │    │           │      │
│  │audit)  │           │    │           │      │
│  ├────────┴───────────┴────┴───────────┴────┤│
│  │            Clinical Operations             ││
│  ├─────────────────────────────────────────────┤│
│  │            Reports & Analytics             ││
│  └─────────────────────────────────────────────┘│
└───────────────────┬───────────────────────────┘
                    │ Prisma (typed SQL)
┌───────────────────▼───────────────────────────┐
│           PostgreSQL 16 (single cluster)       │
│   shared schema, tenant_id + Row-Level Security│
└─────────────────────────────────────────────────┘
```

## 2. Technology stack

| Layer | Choice | Rationale |
|---|---|---|
| Language (both ends) | TypeScript | One language across frontend/backend/shared types; strong typing catches business-rule mistakes (e.g. wrong enum) at compile time |
| Frontend framework | React 18 + Vite | Industry standard, huge hiring pool, Vite gives fast local dev; no SSR/SEO need since this is an authenticated internal app (patient portal is the one public-facing piece and is simple enough not to need SSR) |
| UI component kit | Ant Design v5 | Purpose-built for data-dense admin/business apps (tables, forms, filters, drill-down) — matches the executive dashboard and CRUD-heavy screens directly |
| Frontend server-state | TanStack Query (React Query) | De facto standard for server-state caching/sync in React; pairs cleanly with a REST API |
| Frontend client-state | Zustand | Minimal boilerplate for the small amount of pure UI state (selected branch, active theme, etc.) |
| Backend framework | NestJS | Opinionated module/dependency-injection structure that maps 1:1 to the product's own module list; first-class support for guards (RBAC + tenant isolation), interceptors (audit logging), and pipes (validation) |
| API style | REST (JSON) | Simpler to secure per-route with guards, easier for a small team to reason about than GraphQL's single-endpoint model; matches the CRUD-and-workflow shape of this product |
| ORM | Prisma | Type-safe queries, first-class migration tooling, straightforward schema-as-code that becomes `DATABASE_ARCHITECTURE.md`'s implementation |
| Database | PostgreSQL 16 | Enforces business rules as real constraints (no negative stock, claim totals, tenant isolation) rather than trusting application code alone |
| Multi-tenancy | Shared database, shared schema, `tenant_id` discriminator + PostgreSQL Row-Level Security on every tenant-scoped table | Cheapest to operate at this stage; RLS gives a database-enforced backstop so a missed `WHERE tenant_id = ...` in application code cannot leak another clinic's data — appropriate given tenancy directly affects data ownership |
| Background jobs | BullMQ + Redis | Needed for scheduled work that doesn't belong in a request/response cycle: appointment reminders, month-end incentive calculation, low-stock digest emails. Introduced when Phase 1 needs it — not installed during initialization since nothing schedules jobs yet |
| Auth | JWT access token (short-lived) + refresh token (rotating), tenant ID and role embedded as claims | Stateless, standard, scales horizontally; every request's tenant/role claims are what the RLS session variable and RBAC guards key off |
| File storage | Local disk in development; S3-compatible object storage in production (provider TBD) | Documents/attachments need blob storage; no need to pick a cloud provider before Phase 1 needs uploads |
| Notifications | Abstracted `NotificationProvider` interface in Core module; concrete SMS/WhatsApp/email providers plugged in per Phase 1 needs | Vendor choice (Twilio vs. local Malaysian aggregator vs. Meta WhatsApp Business API direct) is a non-critical, swappable decision — see `DECISIONS.md` |
| Testing | Vitest (frontend), Jest (backend, Nest default), Playwright (e2e, introduced once there's a UI worth testing end-to-end) | Standard pairing for this stack |
| Lint/format | ESLint + Prettier, TypeScript strict mode | Enforced in CI once CI exists (Phase 1) |
| Monorepo tooling | npm workspaces | Node/npm already present on this machine; avoids introducing another tool (Turborepo/pnpm) before the project is big enough to need faster incremental builds |

## 3. Module boundaries (backend)

Each NestJS module owns its own data (per `PRODUCT_REQUIREMENTS.md` §9 Data Ownership table) and exposes a service interface for other modules to call — no module reaches into another's database tables directly.

- **Core** — Tenant, Clinic/Branch, User, Role, Patient Master, Global Settings, Notification Center, Audit Log. Every other module depends on Core; Core depends on nothing else.
- **Clinical** — owns Visit, Invoice, Clinical Notes, Diagnoses, Prescriptions, Documents, Queue. Reads Patient (Core), Item (Inventory), Staff (HR).
- **Appointment** — owns Appointment, Doctor Schedule/Roster, Slot/Capacity config. Reads Patient (Core), Staff (HR), Service Catalog (Clinical).
- **HR** — owns Staff, Attendance, Leave, Incentive rules/results. Reads Visit totals (Clinical) for incentive calculation.
- **Inventory** — owns Item, Stock, Batch, Purchase Order, Supplier. Read by Clinical (orders/medications).
- **Panel Claims** — owns Panel, Eligibility, Claim, Payment. Reads Visit/Invoice (Clinical).
- **Reports** — read-only across all modules; never owns data, only aggregates it.

## 4. Cross-cutting concerns (apply to every module, not a separate phase)

- **Audit logging**: a NestJS interceptor captures create/update/delete on the entities named in `PRODUCT_REQUIREMENTS.md` §11, writing actor, timestamp, before/after diff, and affected record to the Audit Log table. Applied via decorator on the relevant controllers, not bolted on per-module ad hoc.
- **Tenant isolation**: a guard resolves `tenant_id` from the authenticated user's JWT on every request and sets it as a Postgres session variable (`SET LOCAL app.tenant_id`) for that request's transaction, which every table's RLS policy checks against.
- **RBAC**: a guard checks the caller's role against the permission matrix in `PRODUCT_REQUIREMENTS.md` §5, expressed as a declarative policy table rather than scattered `if (role === ...)` checks, so the matrix stays the single source of truth.
- **Notifications**: modules publish domain events (`AppointmentConfirmed`, `LowStockDetected`, `PanelClaimRejected`, etc.); the Notification Center subscribes and dispatches through the configured channel — modules never call a specific SMS/email provider directly.

## 5. Environments

- **Local development** (this machine, now): PostgreSQL 16 running as a Windows service, dedicated non-superuser role/database, no Docker required.
- **Test**: an isolated database created per test run (or per CI job once CI exists), always synthetic data — never a copy of production, per standing rule.
- **Production**: not provisioned. No hosting decision has been made and none is needed until Phase 1 nears a deployable state — deliberately deferred rather than guessed at.

## 6. What is explicitly deferred (not built during initialization)

- Redis / BullMQ (installed when the first background job is needed)
- Any concrete SMS/WhatsApp/email provider integration (interface only, per §2 above)
- File/object storage provider selection
- CI/CD pipeline
- Hosting/deployment target
- Clinical, Appointment, HR, Inventory, Panel Claims, Reports **feature code** — this document describes their shape, Phase 1 builds them
