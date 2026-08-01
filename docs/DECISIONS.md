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

## D-028 — Prescriptions deduct stock at dispense time, not at prescribe time
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction — "At dispense time").
Writing a `Prescription` (Clinical 3a) only creates the record — it does not touch `StockMovement`/`StockLevel`. Stock deducts only when the prescription is explicitly marked `DISPENSED`, mirroring the physical handoff and the Queue's own "Dispensary & Payment" stage. `StockMovementType` gains a `DISPENSED` value for this ledger entry, reusing `GoodsReceivingService`'s write pattern (movement row + `StockLevel` update in one service-level transaction) in the negative direction.
**Why**: this touches both clinical workflow and stock/billing integrity (same critical category as D-020's negative-stock decision) — a prescription that's written but later cancelled, or never actually picked up, must not have already moved stock.
**Alternatives considered**: deducting at prescribe time (rejected — would deduct stock for medications that get cancelled or never dispensed, and doesn't match the STATUS column visible on the audited kuwick.com Medications tab, which implies a PRESCRIBED → DISPENSED transition).
**Reversibility**: Medium — the deduction call site is isolated to `PrescriptionService#dispense`; moving it to `#create` later is a small change, but any prescriptions already written under this rule would need a reconciliation pass.

## D-029 — Front-desk panel visibility: read-only reference (limit + exclusions), not eligibility verification, resolving OQ#1
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction).
Eligibility verification itself (active membership, coverage amount, per-visit limit, exclusions) stays an **external, manual process** — staff ask the patient which panel, then check the panel's own website/portal before registration, exactly as today. Kuwick 2.0's role is narrower: surface what it already knows (the panel's `limitAmount` and `PanelExclusion` list, both built in Phase A8) at the registration/Add-to-Queue step, so staff have a quick on-screen reference while they do that external check — not to replace it. "Limit exhausted" tracking (a patient's cumulative usage against a period allocation, distinct from the existing per-visit `limitAmount`) is **not** built now — it depends on the claims-history data Phase 1e is about to add, and no period-based allocation field exists yet. Revisit once 1e's claim batches give real utilization data to check exhaustion against.
**Alternatives considered**: building live eligibility-API integration per panel (rejected — no panel API exists per the owner's description; verification is manual/portal-based for every panel mentioned); full silence on panel data at registration (rejected — staff already need the limit/exclusions info in front of them while they do the external check).
**Reversibility**: High — purely additive UI on the existing Add-to-Queue drawer.

## D-030 — Holiday/after-hours surcharge vs. panel pricing: per-panel override, deferred until the base surcharge feature exists, resolving OQ#3
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction — "Depends on the panel (per-panel rule)").
Confirms surcharge behavior varies per panel (e.g. a panel-specific "night consultation" rate) rather than a single clinic-wide rule always winning or always losing against panel-locked pricing. **Not implemented yet**: no holiday/after-hours surcharge feature exists at all in Kuwick 2.0 today, for cash or panel visits — this decision fixes the *interaction rule* (per-panel override, layered on `PanelPriceOverride`) so it isn't re-litigated later, but the surcharge engine itself is a separate, unbuilt feature (Appointment/HR-adjacent) and stays out of Phase 1e's scope.
**Alternatives considered**: surcharge always applies on top of panel price (rejected — contradicts §8's "pricing locked to contracted tier" default for panels without their own rule); surcharge never applies to panel visits (rejected — some panels do define their own time-based rate per the Klinik Hijraa AIA sub-module audit).
**Reversibility**: High — nothing built against this yet; the rule is recorded ahead of the feature.

## D-031 — Claim submission: one flexible workflow, per-panel variance captured as data (submission method + free batching cadence), resolving OQ#10
**Status: CONFIRMED BY OWNER, interpretation per standing delegation** (2026-07-31; owner confirmed per-panel variance is real — AIA: aggregate within 24h then a second submit step; other panels: their own portal; MARA: manual courier — the concrete workflow shape below is the industry-standard way to satisfy that without forking code per panel).
No panel in the owner's description has a real API Kuwick could submit to — every path (portal, courier, "own portal") ends in a human manually acting outside Kuwick. So `ClaimBatch` supports **one** status lifecycle (`PRODUCT_REQUIREMENTS.md` §7: Invoice Generated → Batched → Submitted → Accepted/Rejected/Deducted → Paid → Reconciled → Aging) with two things that vary by data, not by code path: (1) batch creation has **no fixed period** — staff can create a batch from any subset of unclaimed panel-settled invoices at any time, so AIA's near-daily 24h aggregation and another panel's monthly cycle are just different staff habits against the same feature; (2) marking a batch Submitted records a **submission method** (Portal / Courier / Email / Other, free-text reference) rather than triggering a per-panel code branch.
**Alternatives considered**: a hardcoded per-panel workflow fork (e.g. `if panel === AIA`) — rejected, brittle and doesn't scale to new panels without a code change; a rigid fixed-period (e.g. monthly-only) batch cycle — rejected, doesn't fit AIA's near-daily cadence.
**Reversibility**: High — a true panel-side API integration later would slot in underneath the same status lifecycle without changing it.

## D-034 — Real authentication: JWT login replaces the interim x-tenant-id header (D-017's planned swap)
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction — "Build real log in. Create system owner to manage clinic as well... its cms SAAS, multi tenant").
Implements the swap D-017 always anticipated: `TenantContextMiddleware` now verifies a JWT (`Authorization: Bearer`) instead of trusting a raw `x-tenant-id` header, extracting `tenantId`/`staffId`/`role` as claims. `.env`'s `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` (reserved since Phase 0 initialization) are used as-is. Login requires a `Tenant.slug` (new field) + email + password, since `User.email` is only unique *per tenant* (`@@unique([tenantId, email])`) — the same email can legitimately exist at two different clinics, so tenant identity can't be inferred from email alone. A separate `PlatformAdmin` model (no `tenantId`, deliberately outside RLS) handles the platform-operator login for managing tenants themselves — this is the one deliberate cross-tenant path this system needs, already anticipated by OQ#7's "a commission report needs a deliberate platform-admin path across that boundary, not an incidental one."
**Explicitly out of scope for this phase**: per-endpoint RBAC enforcement against the full `PRODUCT_REQUIREMENTS.md` §5 permission matrix (D-018 deferred this pending real auth; real auth now exists, but wiring role checks into every one of ~100+ existing endpoints is its own follow-up phase, not bundled into "make login work"). Patient-portal login (Role `PATIENT_PORTAL`) is also out of scope — no patient portal UI exists yet to log into.
**Alternatives considered**: inferring tenant from email alone (rejected — breaks for the same email at two clinics, a real scenario in a multi-tenant SaaS); session cookies instead of JWT (rejected — SYSTEM_ARCHITECTURE.md §2 already specified JWT access+refresh tokens before this phase, no new information changes that choice).
**Reversibility**: Medium — the tenant-scoped Prisma extension and RLS policies are completely unchanged (D-017 already isolated this swap to the middleware); the frontend's token-storage/refresh mechanics would need rework if the token strategy changed later.

## D-035 — Password hashing: `bcryptjs`, not native `bcrypt`
**Alternatives considered**: `bcrypt` (native binding, faster), `argon2`.
**Why**: `bcrypt`'s native binding requires a compiled postinstall step, which this project's dependency-approval flow (`npm-allow-scripts`, already flagging `@prisma/engines`/`prisma`'s own install scripts as pending review) treats as a gate, not a rubber stamp. `bcryptjs` is a pure-JS, byte-compatible implementation of the same algorithm — no native compilation, same security properties, negligible performance difference at this application's request volume.
**Reversibility**: High — bcrypt hash format is identical between the two libraries; switching later needs no data migration.

## D-033 — Reports charting library: `@ant-design/plots`, not a hand-rolled or non-AntD library
**Alternatives considered**: Recharts, Chart.js, Victory, D3 directly.
**Why**: `PRODUCT_REQUIREMENTS.md` §12 asks for "interactive, filterable, drill-down" Power-BI-style charts; `@ant-design/plots` is antd's own charting library (built on G2), matching D-006's original rationale for choosing Ant Design in the first place — visual/theming consistency with every other screen for free, no second design language to maintain. Peer dependency range (`react >=16.8.4`) is broad enough to support React 19/antd v6 already in use.
**Reversibility**: Medium — confined to the Reports module's chart components; the aggregation queries underneath are chart-library-agnostic.

## D-032 — E-Invoice (LHDN MyInvois): moved from "deferred/conceptual" to in-scope, pending kuwick.com reference screenshots
**Status: CONFIRMED BY OWNER** (2026-07-31, direct instruction — "In kuwick also done the e invoice... please go through it").
Reverses the earlier working assumption (this session, prior to today) that SST/e-Invoice stays conceptual/not-ready. The owner states the existing live kuwick.com already has e-Invoice built, and LHDN MyInvois exposes its own API with separate sandbox/production environments — this is a real, government-mandated integration, not a hypothetical. Since kuwick.com's own screens are the correct fidelity reference (`PRODUCT_REQUIREMENTS.md` §1, §19 — only Yezza/management-reference UI must not be reproduced; kuwick's own UI should be preserved/refined), building this requires the owner's kuwick.com e-Invoice/Finance-settings screenshots, the same pattern already used for the MC template and Result Form Builder. LHDN's public MyInvois API/SDK documentation is fair game for backend integration research (government developer docs, not competitor IP). **Not started yet** — this decision only re-opens the scope; screenshots requested, work not yet begun.
**Alternatives considered**: building against the Klinik Hijraa audit's Finance-module description alone (`PROPOSED_ADDENDUM_2026-07-30_finance-and-audit-gaps.md` Part 1) without kuwick.com screenshots — rejected, since kuwick.com already has a real, working implementation to match rather than a description to interpret.
**Reversibility**: N/A — nothing built yet.

## D-036 — Tenant-table RLS needed a bootstrap-bypass GUC for login and platform-admin tenant management
The `tenants` table's `tenant_isolation` policy (migration `20260730100000`) requires `id = current_setting('app.tenant_id')` for every command — correct for every *other* tenant-scoped table, but self-defeating for `tenants` itself in two legitimate call sites that cannot know a tenant's id in advance: `AuthService.login` resolving a tenant *from* its login slug (that is the entire point of the lookup), and `PlatformTenantService` managing tenants across all clinics (the one deliberately cross-tenant path from D-034). Both silently failed end-to-end even though every unit test passed — the specs mock Prisma entirely, so they never exercised the real RLS policy; only a live browser login surfaced it (`AuthService`'s plain-`PrismaService` tenant/user lookups always returned nothing/threw a policy violation). Migration `20260731280000` adds one narrow escape hatch to the existing policy: `OR current_setting('app.bypass_tenant_scope', true) = 'true'`. Only `AuthService.login` (tenant-by-slug bootstrap) and `PlatformTenantService` (every method) set this GUC, each inside its own transaction, the same `set_config`-in-a-transaction pattern already used everywhere else for `app.tenant_id`. Once `AuthService.login` knows the tenant's id, the subsequent user lookup and `refresh()`'s user-by-id lookup instead set the ordinary `app.tenant_id` GUC — no bypass needed there, since a tenant id is already known and trusted (JWT-signature-verified in `refresh()`'s case).
**Alternatives considered**: granting the `kuwick_dev` role `BYPASSRLS` — rejected, that would silently disable RLS enforcement for every table on every connection, not just this one bootstrap case, defeating the entire point of `FORCE ROW LEVEL SECURITY`; a `SECURITY DEFINER` Postgres function — rejected as unnecessary machinery when a session GUC scoped to a single transaction achieves the same narrow bypass with far less surface area.
**Reversibility**: High — confined to one policy clause and the two call sites that set the new GUC; every other tenant-scoped table and query is untouched.

## D-037 — Platform/System Owner console: subscription billing, Login-As, global default catalogs, system settings
**Status: CONFIRMED BY OWNER** (2026-07-31, reference screenshots of the real system-owner console supplied directly — same URL as the clinic app, separate login).
Built to match the owner's reference screens: **SubscriptionPlan** (price RM/duration days/user-patient-storage limits, ∞ = null) and **TenantSubscription** (TRIAL/ACTIVE/EXPIRED/CANCELLED lifecycle; manual activate assigns a plan, extend adds days and revives a cancelled row, cancel stamps cancelledAt) — no payment-gateway integration, matching the owner's own manual-activation workflow. **Login As**: `POST /platform/tenants/:id/login-as` finds the tenant's most-senior active login (OWNER_ADMIN first, else any active staff with a User) and issues ordinary tenant tokens — from then on the session is indistinguishable from that staff member logging in, and the platform-admin session in its separate store is untouched. **Global default catalogs** (`DefaultPanelClinic`, `DefaultProcedure`, no RLS): curated once by the owner, copied into each new tenant's own `PanelClinic`/`ServiceCatalog` rows at tenant-creation time (procedures land as TASK_ORDERs with a nominal 15-min duration the clinic can adjust); existing tenants are deliberately NOT retro-synced when a default changes — "initial default list deployed to each clinic", per the reference screen's own wording. **PlatformSetting** key/value singleton store for General/Billing/Notification config; the reference's LHDN MyInvois fallback-credentials section is deliberately deferred to the e-Invoice phase (D-032) since API secrets need encrypted-at-rest handling, not plain JSON settings. Tenant creation also gained address/phone/email (creates the tenant's first Clinic), SSM/MEPCSA `registrationNo`, and a Start-as-Trial checkbox (14-day TRIAL subscription). `tenant_subscriptions` carries the ordinary tenant_isolation RLS policy plus the D-036 bypass GUC clause; per-tenant stats on the clinics list are read in each tenant's own scope (N+1 by design — tens of tenants, and widening the bypass GUC into every table's policy would weaken the isolation model). Diagnoses and Document Templates global catalogs from the reference are NOT built yet — Documents awaits the template-builder phase, Diagnoses-global awaits reconciliation with the existing per-tenant DiagnosisCatalog+ICD-10 seed flow.
**Alternatives considered**: retro-syncing default-catalog edits into existing tenants — rejected, clinics customize their copies and a silent overwrite would destroy that; storing platform settings as one JSON blob row — rejected in favour of key-per-row upserts (partial saves, no lost-update races on unrelated keys).
**Reversibility**: Medium — new tables are additive; Login-As and the seeding copy-step are isolated in PlatformTenantService/AuthService.

## D-038 — Queue overhaul: A/C/W/E 4-stream numbering, rooms/stations, public monitor with video + configurable voice
**Status: CONFIRMED BY OWNER** (2026-07-31, direct requirements — "4 types of queue system number — A for appointment, C for OTC patient, W-walk in patient, E for emergency... Room location (consultation1, 2, treatments room 1,2, dispensary counter)... queue screen, video running-able to paste youtube video... queue calling voice selection, voice pitch/volume").
Each `QueueType` stream numbers independently per clinic per day (count-based, same accepted race gap as Visit.visitNumber); `displayNumber` ("W001") is snapshotted at creation so numbering-rule changes never rewrite history. Appointment arrivals auto-join the A stream via `AppointmentService.arrived`; the front-desk drawer picks W/C/E/A explicitly (walk-in default). A queue-number slip auto-prints on add (browser print popup — thermal-printer friendly; the front desk picks their printer once). `Room` is per-clinic staff-maintained data (Management > Operation), chosen at **call time**, not at ticket creation — the same ticket can be re-called to a different room. `QueueDisplayConfig` (one per clinic) holds the YouTube URL, scrolling text, and SpeechSynthesis voice name/rate/pitch/volume (D-025's no-paid-TTS stance unchanged; the voice list is the display machine's own browser voices). **The waiting-room monitor became a real public endpoint** (`GET /public/queue/:clinicId`, excluded from TenantContextMiddleware) — the old monitor silently broke when real auth (D-034) landed, since a TV can't hold a JWT. It bootstraps the clinic→tenantId resolution under `app.bypass_tenant_scope` (the clinics policy gained the same narrow escape-hatch clause as tenants, D-036) then runs everything under ordinary `app.tenant_id` RLS, and its payload deliberately contains **no patient PII** — display numbers and room names only, since anyone with the URL can read it (the clinic id being an unguessable UUID is a mitigation, not authorization).
**Alternatives considered**: keeping patient names on the monitor (the pre-auth version showed them) — rejected on the public endpoint, names now appear only on the authenticated Queue Management screen; a signed monitor token instead of a public endpoint — rejected as operational friction (TVs get power-cycled, tokens expire) for data that is deliberately non-sensitive.
**Reversibility**: Medium — displayNumber is additive; the public endpoint is one controller; legacy tickets keep their old integer numbers (`displayNumber` null → "#n" fallback in every consumer).

## D-039 — Report suite built to the owner's own Power BI file (CLINIC_REPORT.pbix)
**Status: CONFIRMED BY OWNER** (2026-07-31 — the owner supplied their clinic's real Power BI report as the reference; page structure, chart titles, and metrics extracted in `PROPOSED_ADDENDUM_2026-07-31_powerbi-report-reference.md`).
Six new report endpoints/pages under Management > Reports, all read-only aggregation (same §9 data-ownership rule as Phase 1f): **Day-End Closing** (total sales, cash-collected by payment method, panel billings by panel with patient counts, unpaid-invoice warning), **Sales Analysis** (panel vs non-panel, revenue by category, % by doctor / by panel company, avg charge per patient / panel / non-panel, daily trend), **Patient Analysis** (new vs existing, gender, age group, % by panel, attendance by hour / day-of-week), **Procedure Analysis** (revenue+count by charge description / group / doctor), **Doctor Performance detailed** (per-doctor patients / sales / Consultation-Drugs-Services-Others split / avg charge), **Invoice Listing** (with UNPAID filter = the outstanding-invoices report). All pages share a 7D/30D/90D/This-Month/This-Year/custom range bar and client-side CSV export. **Revenue category is a provenance heuristic**: line sourced from a Prescription → Drugs, from an OrderService → Services, description containing "consult" → Consultation, else Others — no new schema field; if the owner later wants an explicit category the heuristic swaps out in one function. **"New patient"** = the Patient record itself was created inside the selected range (a first-ever registration), not merely first visit of the period. **The reference's per-doctor SCORE and the P&L / SST-e-Invoice / credit-debit-note / drug fast-slow-mover reports are deliberately NOT built**: SCORE's DAX formula is not recoverable from the .pbix layout (same ask-the-owner treatment as OQ#2); P&L needs expense data no module captures yet; SST/e-Invoice reports belong to the e-Invoice phase (D-032); credit/debit notes need those document types to exist first; drug fast/slow-mover needs a sales-quantity-by-item view that should land with the Inventory-reporting pass. Also added `prisma/seed-demo-data.ts` (dev-only, idempotent, deterministic PRNG) seeding 28 patients / ~216 visits+invoices over 60 days so every chart renders meaningfully — per the owner's "maybe you need to add few patients, so can generate all data".
**Alternatives considered**: computing category from ServiceCatalog.category for all lines — rejected, drug lines have no ServiceCatalog; a stored category column on InvoiceLine — deferred, snapshot-at-write is attractive but the heuristic is reversible without a migration.
**Reversibility**: High — additive endpoints/pages; no schema change.

## D-040 — Document template builder (global defaults + per-clinic customisation) and drug-label printing
**Status: CONFIRMED BY OWNER** (owner requirement #8 "Documents — everything, and can custom own documents as well as template. Mc, referral, quarantine, memo, time slip etc" + the System Owner console's "Default Document Templates" reference screenshot; #10 drug label; #11 print documents).
`DefaultDocumentTemplate` (platform catalog, no RLS) is curated in the System Owner console and copied into each new tenant's `CustomDocumentTemplate` table at creation (`sourceDefaultId` kept for provenance; no retro-sync, per D-037's rule). Clinics manage their copy plus their own templates under Management > Operation > Document Templates; every **active** template appears alongside the four built-in types (MC/Referral/Memo/Quarantine) in the Documents tab's type picker. Templates are **plain text with `{{merge.field}}` placeholders** resolved client-side at generate time (17-field vocabulary: clinic.\*, patient.\*, doctor.\*, date, visit.\*, diagnosis, vitals, notes — `mergeFields.ts` is the single source shared by both editors' insert-picker and the resolver, so vocabulary can't drift). Unknown placeholders stay visible in the output rather than vanishing — a typo'd field is meant to be seen. Generated documents save as `DocumentType.CUSTOM` with `Document.title` = the template's name; the four built-in builders (Phase A4) are unchanged underneath. Every document row gained a **Print** action (monospace pre-wrap print window preserving the template's own line layout), and the Medications tab gained **drug-label printing** (clinic letterhead, patient, drug, dose/frequency/duration/indication/quantity — label-printer-sized window).
**Alternatives considered**: rich-HTML (Tiptap) template bodies — rejected this phase; documents print as plain letters today and the existing four builders are plain text, so HTML would fork the print path; revisit if the owner's kuwick.com reference shows styled documents. Server-side placeholder resolution — rejected, generation is a *starting point* the doctor edits before saving, matching the existing client-side "Generate Template" flow.
**Reversibility**: High — additive models/enum value; built-in types untouched.

## D-041 — Panel module upgraded to the owner's real claim-tracking workbook; excess/rejected register explicitly declined
**Status: CONFIRMED BY OWNER** (2026-08-01 — the owner supplied their actual panel-claim workbook as the reference, structure documented in `PROPOSED_ADDENDUM_2026-08-01_panel-claim-listing-reference.md`; mid-build the owner then said the excess register was **not** wanted: "the excess i think no need to put. Because this is SaaS, multitenant").
**Built**: `PanelClinic.paymentTermDays` (per-panel payment term; overdue is judged per panel, not fixed buckets — surfaced in Claim Listing due-days and Outstanding Aging); **per-panel claim-fee configuration** *(owner corrections 2026-08-01: first "AIA no fee", then "the user can set the fee, either in RM or % per claim — different panel have different percent or RM fee")* — `PanelClinic.claimFeeType (PERCENT|AMOUNT) + claimFeeValue`, set on the Panel Clinics screen and **applied automatically per line at batch creation** (`ClaimBatchLine.feeAmount`; % of the claimed amount or flat RM per claim; panels with no fee configured, like AIA, get 0 — there is no manual per-batch fee entry); `ClaimBatchLine.remarks`; receivable = claimed + fee − paid; **the Claim Listing is a full auto-tracker** *(owner refinement 2026-08-01: "panel patient's invoice auto listed in the panel tracking... once submitted changed to submitted, once panel paid changed to paid, so can reconcile directly")* — every settled panel invoice appears automatically as UNCLAIMED, becomes BATCHED/SUBMITTED through the claim workflow (a PENDING line displays its batch's state), then PAID/REJECTED/DEDUCTED as the panel settles, one list to reconcile from; **Claim Listing tab** mirroring the workbook's per-panel sheet (service date / month filter / patient / invoice+batch no. / claimed / fee / to-receive / paid / receivable / due-days-vs-term / status / remarks, CSV export); **Yearly Summary tab** mirroring the SUMMARY PANEL CLAIMS sheet (per-panel claims / claimed / fee / receivable / paid / outstanding + TOTAL row, year picker, CSV). `claim_batch_lines.invoiceId` uniqueness was relaxed to a plain index with a service-level one-ACTIVE-line-per-invoice guard (migration `20260801100000` — kept even after the excess decision below, since it makes legitimate re-claiming *possible* without forcing any workflow).
**Explicitly NOT built (owner decision)**: the Excess/Rejected register and its resubmit-as-new-claim action. It was implemented and live-verified, then removed at the owner's instruction — the excess-chasing workflow (check panel report → call patient → re-claim with add-on fee) is their clinic's own internal practice, too operator-specific to bake into a multi-tenant product. Rejected/deducted/short-paid lines remain fully visible in the Claim Listing with status tags, remarks, and receivable amounts — staff can still track and manually re-claim (the eligibility rules allow it); there is just no dedicated register/one-click resubmit.
**Reversibility**: High for the removal — the register/resubmit code exists in git history (commit prior to this one) and the schema still supports it, so restoring it later is a UI/controller re-add, not a migration.

## D-042 — Drug fast/slow-mover report and waiting-time analysis
Two more owner Finance/Operation requirements ("drug revenue — fast moving vs slow moving"; "waiting-consultation-dispensary time"), both built purely from existing data with no schema change. **Drug Movement** (Management > Reports): dispensed-drug sales aggregated from PAID invoice lines sourced from Prescriptions (quantity / prescriptions / revenue per Item), with never-sold items included so dead stock surfaces; classification is a simple tertile rule (top third of sold items by quantity = FAST, bottom third + never-sold = SLOW, rest MEDIUM) — deliberately explainable at a glance rather than a statistical model. **Waiting Times**: computed from timestamps the system already records — queue-ticket creation → calledAt (waiting), calledAt → visit check-out (consultation + dispensary combined), check-in → check-out (total visit) — with a sanity cap (8h) so forgotten check-outs don't skew averages, distribution buckets (0-15/15-30/30-60/60+ min) and a per-day average trend. A finer consultation-vs-dispensary split would need a timestamp at the move-to-dispensary transition; QueueTicket only stores its latest `updatedAt`, so that split is deferred rather than approximated. Also confirmed this session: **dictation** (Clinical Notes' Dictate button, browser SpeechRecognition) and the **weight-based dosage calculator** (D-028) already existed from earlier phases — the owner's list items #6 (dictation) and #7 (calculator) were already satisfied, not gaps.
**Reversibility**: High — read-only endpoints/pages.

---

## D-043 — Inventory: near-expiry, stock take, one-click reorder
Owner asked whether Inventory already covered near-expiry tracking, reordering, and stock take — it didn't; all three were built this phase, none needed a schema change since the underlying fields (`StockBatch.expiryDate`, `StockMovementType.ADJUSTMENT`, `StockLevel.minThreshold`, `ProcurementRequest`) already existed from earlier phases. **Near-Expiry Stock** (Management > Stock): batches with `quantity > 0` and `expiryDate` within a configurable window (30/60/90/180 days), sorted soonest-first, with a `daysToExpiry` badge (red once past due). **Stock Take**: staff enter a physical count per item for a clinic; only entries that differ from `StockLevel.quantityOnHand` write anything — each variance becomes an `ADJUSTMENT` `StockMovement` (`referenceType: 'StockTake'`) and the level is set to the counted value, so the movement ledger stays the single source of truth for every quantity change, same rule as every other stock flow (goods-received, quick-add). Matched items are recorded in the result summary but touch nothing. **One-click Reorder**: a Reorder button on the Low Stock report raises a `ProcurementRequest` pre-filled with the shortfall quantity (`minThreshold - quantityOnHand`, floored at 1) against the existing procurement flow — no new approval/PO logic, it only accelerates request creation; the button switches to a disabled "Request pending" state once an open request exists for that item/clinic, so it can't be double-fired.
**Reversibility**: High — near-expiry is read-only; stock take writes through the existing movement ledger with no new mutation path; reorder just pre-fills the existing procurement-request creation endpoint.

---

## D-044 — Queue/Patient/Medical Record fix batch
A large owner punch list across three modules, all fixed this phase with no backward-compatibility shims — each item below is a real behavior change, not a cosmetic one.

**Queue**: `AddQueuePatientDrawer` puts a header "Add to Queue" button on the Queue page itself (previously only reachable from Patients list), with an existing-patient search step (`usePatientSearch`) or an inline quick-register step, before handing off to the existing `AddToQueueDrawer`. Every queue row's patient name is now a `Link` into `/patients/:id?visitId=<id>`, plus a small hover "open visit record" icon doing the same — `PatientDashboardPage` reads `visitId` off the URL on load and auto-selects that visit. The Call modal (already had room selection, contrary to the owner's read of the old build) now also carries an "Attending Doctor" select, defaulting to the currently logged-in staff member if their `role` is `DOCTOR_RESIDENT`/`DOCTOR_LOCUM` (auto-assign self), otherwise to the visit's existing doctor — confirming Call updates `Visit.staffId` via `QueueTicketService.call(id, roomId?, staffId?)`. `Visit.staffId` itself stays required (not made nullable) — reassignment happens at call time instead, avoiding a schema change that would have rippled into reports/invoices/prescriptions, which all read that relation.

**Patient**: `PatientDashboardPage` gained a "+ New Visit" button (header, and a duplicate in the Canvas-layout sidebar) wired to a new standalone `POST /visits` endpoint (`VisitService.create()` already existed, just wasn't exposed by `VisitController`) — a Visit can exist with no QueueTicket, so this doesn't touch the queue flow. `PatientsPage` gained a debounced search box wired to the `search` query param `PatientService.findAll()` already supported but the frontend never called. Patient delete is a soft delete (`Patient.deletedAt`, already on the schema, just never read/written) — `findAll`/`findById` now filter `deletedAt: null`; visits/invoices/documents keep referencing the record untouched. `AddToQueueDrawer`'s panel-limit display gained an inline Edit control (`PATCH /panel-clinics/:id`) so staff don't have to leave the queue-add flow to bump a renegotiated limit.

**Medical Record** (`ClinicalNotesTab.tsx`, the biggest piece): `ClinicalNote` went from one-per-visit to many-per-visit — `visitId` unique constraint dropped (migration `20260801140000_clinical_notes_many_per_visit`), `ClinicalNoteService` rewritten as list/create/update instead of find/upsert, frontend gained a note-selector strip (newest first, "+ New Note") so a visit can carry a triage note and a separate reassessment note (e.g. post-nebuliser) each with their own vitals snapshot. "Vitals & Measurements" renamed to "Vital Signs and Anthropometry" (compact layout) / split card titles "Vital Signs" + "Anthropometry" + "Point of Care" (flow layout, previously "Point-of-Care / Others") — Glucose lives under Point of Care in both layouts now, with a labeled divider in compact mode. Dictation no longer sets `recognition.lang` from the Notes-language toggle — removed entirely so the browser's speech engine isn't locked to EN/MS. New `VisitAttachment` model + `VisitAttachmentService`/`Controller` (migration `20260801150000_add_visit_attachments`, same local-disk storage convention as the existing order/procedure `Attachment`) backs a new `VisitAttachmentsPanel` rendered above the vitals card, for images/PDFs/results that aren't tied to a specific order.
**Reversibility**: Medium — the ClinicalNote schema change (dropping a unique constraint) is safe/backward-compatible (existing single-note visits just become one-row lists); the new `VisitAttachment` table and `POST /visits` endpoint are additive. `Visit.staffId` reassignment at call time is a real behavior change to clinical data (who's recorded as the attending doctor) but is staff-initiated and auditable via the existing `updatedAt`.

---

## Decisions requiring owner sign-off (not unilaterally decided — tracked here for visibility, detailed in `PRODUCT_REQUIREMENTS.md` §17)

These touch billing, panel claims, clinical workflow, or data ownership and are intentionally **not** resolved above:

- Doctor incentive formula, precise worked semantics (OQ#2, blocks 1c only)
- Booking-commission attribution mechanism (OQ#7, blocks the Online Booking Portal only)
- Yezza-audit drafts: multi-session packages (OQ#16), front-desk booking-rule override (OQ#17), payment-at-booking (OQ#18)
- Klinik Hijraa audit drafts not yet addressed: staff price tier (OQ#11), inter-branch billing (OQ#12), patient-app scope (OQ#13), clinical program generalization (OQ#14), WhatsApp delivery risk (OQ#15)
- Data migration mechanism from the existing Kuwick system
