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

## D-019 — Inventory GRN modeled with a `GoodsReceivedNoteLine` child table, not a flat `GoodsReceivedNote`
**Alternatives considered**: a single `GoodsReceivedNote` row per receiving event (as literally listed in `DATABASE_ARCHITECTURE.md` §6), with quantity/batch/expiry fields on the header itself.
**Why**: a real goods-received event routinely covers multiple items/PO lines in one delivery, and the Phase-One acceptance criterion ("a goods-received entry against a partial delivery must correctly reduce the outstanding PO quantity," `PRODUCT_REQUIREMENTS.md` §18) requires per-line quantity and per-line batch/expiry capture — a flat header can't express "3 of these, 10 of those, different expiry dates" in one receiving event. `GoodsReceivedNoteLine` (goods_received_note_id, purchase_order_line_id, item_id, quantity_received, batch_number, expiry_date, unit_cost) is the header/line split every other multi-item document in this schema already uses (`PurchaseOrder`/`PurchaseOrderLine`, `ClaimBatch`/`ClaimBatchLine`).
**Reversibility**: High — purely additive relative to the documented design; nothing else depends on the flatter shape since it was never built.

## D-020 — Stock CAN go negative — not blocked at the point of dispensing/invoicing
**Status: CONFIRMED BY OWNER, not an assumption** (2026-07-30, via direct instruction — this touches inventory integrity and clinical/billing workflow, so it was not decided unilaterally).
Reverses the original 1d design (`stock_levels_quantity_on_hand_check`, a DB `CHECK (quantity_on_hand >= 0)` constraint added in the `add_inventory_module` migration and dropped here in `allow_negative_stock`).
**Why**: front-line staff must be able to dispense/invoice immediately even when system stock hasn't caught up with physically-received goods (e.g., stock arrived at the branch but hasn't been logged as received yet) — a hard block would stop a legitimate, everyday operation rather than a genuine error. The owner's current CMS (Avixo) works the same way. Negative stock is now a monitored condition admin finds and reconciles afterward (`GET /stock/negative-stock`, `StockService.listNegativeStock`, surfaced on a dedicated Negative Stock page and flagged inline on Stock Levels), not a prevented one.
**Alternatives considered**: keeping the hard `CHECK` constraint (original 1d design, rejected — blocks a real operational path); allowing negative stock silently with no reporting surface (rejected — the owner explicitly asked for it to stay "visibly flagged/monitored," not merely unblocked).
**Reversibility**: Medium — the constraint can be reinstated as a new migration if this proves wrong operationally, but any negative rows accumulated in the meantime would need a reconciliation pass first.
**Supersedes**: `PRODUCT_REQUIREMENTS.md` §8's original "stock cannot go negative" wording (updated to match) and resolves Open Question #9 in `PROPOSED_ADDENDUM_2026-07-30_finance-and-audit-gaps.md`.

## D-021 — Calendar view time-grid: `react-big-calendar`, not hand-rolled
**Alternatives considered**: a custom-built time-grid component (hour rows + absolutely-positioned, overlap-aware appointment blocks).
**Why**: Ant Design (D-006) covers tables/forms/drill-down but has no time-grid calendar — only a month-panel `Calendar`. `react-big-calendar` is the industry-standard React library for exactly this shape (Day/Week/Month + a `resources` prop that maps directly onto "Provider" as a per-column view), takes a dayjs localizer (dayjs is already a dependency, D-005), and avoids reimplementing overlap-layout math that's easy to get subtly wrong. `PRODUCT_REQUIREMENTS.md` §3B's "Calendar (Day/Week/Month/Provider/List)" only specifies the views, not the implementation — this is a non-critical technical choice under the standing CTO delegation.
**Types**: the library ships no bundled TypeScript definitions; `@types/react-big-calendar` (community, DefinitelyTyped) is added as a devDependency.
**Reversibility**: Medium — confined to the calendar view's rendering layer; the data hooks/queries underneath (`useAppointments`, `useDoctorSchedules`, `useScheduleExceptions`) are library-agnostic and would carry over to any replacement.

## D-022 — Patient ID Type: explicit NRIC/Passport selector, resolving Open Question #6
**Status: CONFIRMED BY OWNER, not an assumption** (2026-07-30, via direct instruction — this touches the patient record, so it was not decided unilaterally).
Resolves the open question in `PRODUCT_REQUIREMENTS.md` §17.6 ("foreign-patient, non-NRIC identifier handling"): kuwick.com's own live Add Patient form already answers it with an ID Type selector (NRIC or Passport), so Kuwick 2.0 matches that rather than inventing a different shape. `Patient.identifierType` (`NRIC`/`PASSPORT` enum, already in the schema) is now driven by that selector in both the create and edit forms; `identifierValue` is validated as a 12-digit string when `identifierType = NRIC` and left as free text for `PASSPORT`.
**Alternatives considered**: a single free-text identifier field with no type distinction (rejected — can't express the NRIC-format validation the audited kuwick.com form applies, and conflates two genuinely different identifier shapes).
**Reversibility**: High — purely an application-layer validation rule on an existing enum column; no schema change.
**Supersedes**: strikes item 6 in `DEVELOPMENT_ROADMAP.md`'s gating-decisions list and marks OQ#6 RESOLVED in `PRODUCT_REQUIREMENTS.md` §17.

## D-023 — Dispensary & Payment / Completed queue tabs: match kuwick.com's own thin implementation, keep the state machine fully real
**Status: CONFIRMED BY OWNER** (2026-07-30, via direct instruction answering a flagged decision — "choose A").
The audited kuwick.com Queue module's Dispensary & Payment and Completed tabs are themselves thin in the live reference system — no itemized payment recording, just a list and a status. Kuwick 2.0's UI matches that exactly rather than building ahead of the reference. Underneath, `QueueTicketStatus` still transitions through real `DISPENSARY_PAYMENT` → `COMPLETED` states via minimal `moveToDispensary`/`complete` actions not shown in the audit, because Invoice/payment recording (Phase 5) needs a real state to close out against — it can't attach to a UI-only label.
**Alternatives considered** (the other flagged option): building out full itemized payment recording now, ahead of the reference system and ahead of Phase 5's actual scope. Rejected by the owner in favor of matching the reference and deferring payment detail to Phase 5.
**Reversibility**: High — the thin tabs are a UI-layer choice; the state machine underneath doesn't need to change when Phase 5 adds real payment recording on top of it.

## D-024 — "Arrived" queue action: WAITING → IN_CONSULTATION
**Status: CONFIRMED BY OWNER** (2026-07-30, direct confirmation of the flagged mapping).
The audited kuwick.com Queue module's "Arrived" action (Call/Arrived/Cancel) moves a ticket out of Waiting into Consultation — confirmed to mean `QueueTicketStatus.WAITING` → `QueueTicketStatus.IN_CONSULTATION`, distinct from "Call" (`QueueTicket.calledAt`, an announce/highlight action on the monitor display with no status change).
**Reversibility**: High — an enum transition rule in `QueueTicketService#arrived`, isolated from the rest of the state machine.

## D-025 — Clinical Notes dictation: browser Web Speech API only, no paid STT service
**Status: CONFIRMED BY OWNER** (2026-07-30, direct instruction — "Yes browser web speech API. No paid").
The audited Clinical Notes tab's dictation feature is implemented against the browser-native `SpeechRecognition`/`SpeechSynthesisUtterance` Web Speech API, not a paid speech-to-text vendor (e.g. Google Cloud Speech, AWS Transcribe, Deepgram). Deferred to the Documents/Clinical Notes phase (Phase 4) when it's actually built — logged now so the constraint isn't lost.
**Why**: avoids introducing a paid, per-request-billed external dependency for a feature the reference system itself likely runs client-side; Web Speech API is supported in the target browsers (Chrome/Edge) without additional cost.
**Reversibility**: Medium — swapping to a paid STT vendor later is an isolated change behind the same dictation-input interface, not a rearchitecture.

## D-026 — Documents/Templates rich-text and drag-drop: Tiptap + `@dnd-kit`, deferred to Phase 4
**Status: CONFIRMED BY OWNER** (2026-07-30, direct instruction — "Ok" to both proposed libraries).
The audited Documents/Templates merge-engine (placeholder tokens, header/footer branding designer) needs a rich-text editor and a drag-and-drop layout surface. Tiptap (headless, ProseMirror-based) and `@dnd-kit` (accessible, React-native drag-and-drop) are approved as the libraries for that work, ahead of building it — flagged here so the choice doesn't need to be re-litigated when Phase 4 starts.
**Alternatives considered**: not raised as alternatives — these were proposed as the standard-industry choice for each need (rich text: Tiptap vs. Slate vs. Quill; drag-drop: `@dnd-kit` vs. `react-beautiful-dnd`, the latter unmaintained) and approved directly.
**Reversibility**: Medium — confined to the Documents phase's editor/layout components once built; nothing else in Phase 1a depends on either library.
**Superseded in part by D-027** — Tiptap's introduction moved up to Clinical Notes (Phase 2a) once live kuwick.com screenshots showed the Notes field already uses a full rich-text editor there, not a plain textarea. `@dnd-kit` stays deferred to Phase 4 as originally decided.

## D-027 — Clinical Notes fidelity correction from live kuwick.com screenshots: Tiptap pulled forward, Patient Dashboard restructured to 3-column layout, Diagnosis Custom/Summarize/Full corrected
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction after reviewing live kuwick.com screenshots — "Pull Tiptap forward now", "Redo 2a + 2b now, then finish 2c to match").
Live screenshots of kuwick.com surfaced after Phase 2a/2b/2c were built revealed the text-only audit undersold three things:
1. **Clinical Notes uses Tiptap**, not a plain textarea — pulled forward from D-026's Phase 4 timing (see D-026's superseded-in-part note above).
2. **The Patient Dashboard is a persistent 3-column layout** (Visits History | numbered Record View nav | active tab content), not a full-width visit list above a horizontal tab bar — `PatientDashboardPage.tsx` rebuilt to match.
3. **Diagnosis's "Custom/Summarize/Full" toggle was misread** (D-022's era judgment call #5): these are not display-density modes for the already-added diagnosis list. They are catalog **source categories** — `Custom` (clinic-created entries via the Diagnoses Directory admin screen), `Summarize` (a curated ~157-entry global subset), `Full` (the complete ICD-10 standard catalog, ~5,064 entries) — and the toggle filters which category the visit's diagnosis search runs against. `DiagnosisCatalog` gains a `category` enum and `icd10Code` field; the real Summarize/Full datasets are owner-supplied (tracked separately, not fabricated).
**Why this happened**: the original Clinical 2 plan was built from the user's text-description audit alone (no visual reference at the time) — text audits described function ("rich-text clinical notes", "Custom/Summarize/Full view toggles") without enough detail to infer exact mechanics or visual structure. Live screenshots are the authoritative reference going forward for any phase where they exist.
**Alternatives considered**: leaving 2a/2b as originally built and only fixing 2c going forward — rejected by the owner ("Redo 2a + 2b now"), since shipping known-wrong Diagnosis semantics (real catalog filtering vs. cosmetic display toggle) would need a data-model change later regardless.
**Reversibility**: Low to redo now while Diagnosis has no production data; would become progressively more expensive to correct once real visits have `Diagnosis` rows keyed against the wrong catalog shape.

---

## Decisions requiring owner sign-off (not unilaterally decided — tracked here for visibility, detailed in `PRODUCT_REQUIREMENTS.md` §17)

These touch billing, panel claims, clinical workflow, or data ownership and are intentionally **not** resolved above:

- Front-desk visibility into panel eligibility
- Doctor incentive formula, precise worked semantics
- Holiday/after-hours surcharge interaction with panel-locked pricing
- Panel pricing override governance
- Data migration mechanism from the existing Kuwick system
