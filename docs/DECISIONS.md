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

## D-045 — Clinic selection removed from screens where it isn't real ambiguity
Owner: *"why there is the need to select clinic ... once log in supposed to under that clinic. Its saas cms system, many clinics use it."* Root cause, confirmed by reading the schema: `Staff` had no field recording which clinic a staff member belongs to, so ~19 screens (Queue, Appointments, Rooms, Reports, Stock lists, Purchase Orders, Procurement, Doctor Schedules, Slot Capacity, Add-to-Queue/New-Visit forms) each asked independently every time, with no way to know the answer was already implied by who was logged in.

Fix: `Staff.clinicId` (nullable, migration `20260801160000_add_staff_home_clinic`) — a staff member's home branch. **Null** means they legitimately work across every clinic in the tenant (owner/finance/HR-type roles) and keep a picker; **set** means every clinic-scoped screen resolves to that clinic automatically and the picker never renders. Independently, **any tenant with exactly one clinic** (the common case — most SaaS customers here are a single-location clinic, not a multi-branch chain) auto-resolves the same way regardless of `Staff.clinicId`, since there's nothing real to choose between. `AuthService.login`/`loginAsTenant` now return `staff.clinicId`/`clinicName`; a shared frontend hook (`useClinicFilter` for list/filter screens, `useDefaultClinicId` for create-form Clinic fields) implements the resolution once and every screen consumes it — filter Selects hide entirely when resolved, form Clinic fields pre-fill via `initialValues` (every such form already uses `destroyOnHidden`, so a fresh default applies each time it opens). `StaffPage` gained a "Home Clinic" field on create/edit (only rendered when the tenant actually has 2+ clinics — moot otherwise) and its first-ever edit capability (`PATCH /staff/:id` already existed server-side, just had no frontend consumer). `UserClinicAccess` (an unused many-to-many staff↔clinic model already in the schema) was left alone rather than wired up — a single home-clinic field matches how staff actually work here and is simpler; the many-to-many table can be revisited if a real multi-clinic-per-staff need shows up.
**Reversibility**: High — additive nullable column; every affected screen still supports manual clinic selection for staff without a home clinic in a genuinely multi-branch tenant, nothing was removed, only defaulted.

---

## D-046 — Phase 2: per-procedure + clinic-wide chat, notification bell, and a real result-viewer bug found along the way
Owner scope (task #94): "Orders popup+chat, task bell notifications, result viewer fix, internal clinic chat." One `ChatMessage` model backs both surfaces (`orderServiceId` set = per-procedure thread, null = the clinic-wide channel — `clinicId` is the channel key) — see the schema comment above `model ChatMessage` in `schema.prisma`, migration `20260801170000_add_chat_messages`. `ChatService`/`ChatController` (`apps/api/src/clinical/`) expose `GET/POST /clinics/:clinicId/chat-messages` and `GET/POST /order-services/:orderServiceId/chat-messages`; the per-procedure `create` derives `clinicId` from the order server-side rather than trusting the client. Polling every 10s (`useChat.ts`), matching the Procedure Queue's existing convention — no WebSocket infrastructure in this environment.

Frontend: a shared `ChatPanel` (WhatsApp/Telegram-style — grouped consecutive bubbles with a flattened "tail" corner on the last message per cluster, centered date-change pills, per-message timestamp trailing inside the bubble, a faint medical-cross wallpaper (original motif, not a lift of any messaging app's actual pattern)) is used in two places: inside `CompleteOrderModal` (a "Chat about this procedure" panel next to the result/attachments, plus a new fullscreen-expand toggle that switches the modal to a 95vw two-column layout — result/attachments left, chat right, per the owner's "Orders popup+chat" ask), and in `ClinicChatWidget`, a floating button mounted once in `AppLayout` (reachable from every screen) opening a `Drawer`. `NotificationBell` (header, next to the user menu) combines two live counts: pending tasks (the Procedure Queue's own `PENDING` count — nothing new invented, just surfaced) and unread clinic chat, tracked via a per-clinic "last seen" timestamp in `localStorage` (no server read-receipts table; a client-side marker matches the no-realtime-infra approach already used for polling) and cleared when the chat drawer opens.

**The "result viewer" complaint turned out to be a real bug, not a phantom one** — found by testing `CompleteOrderModal` against real seeded orders rather than assuming the original report was stale: `result` state was initialized to `''` and never synced from `order.result` when opening an already-completed order (only `formData` had a sync effect), so any free-text result was invisible in the viewer — confirmed against a real seeded order (`FBC`, id `7aa107c4…`) whose saved result ("Hb: 13.5 g/dL, WBC: 7.2 x10^9/L…") rendered as a blank textarea before the fix. A second, related gap surfaced while verifying the fix: a form template is looked up by the order's **service**, not by the order instance, so a legacy order completed *before* its service had a template (free-text `result`, no `formData`) now renders the template's empty fields instead of its real historical text — the dynamic-form branch only shows the form when the order actually has form values (or is still editable); otherwise it falls back to the plain `result` text, so the old data isn't silently hidden. Both fixes verified live against real seed data (not just added and assumed correct).
**Reversibility**: High — `ChatMessage` is additive (new table, RLS-scoped like every other tenant table); the two `CompleteOrderModal` fixes are read-path corrections with no schema or API change — no prior behavior that depended on the bug is lost.

---

## D-047 — Executive Dashboard redesign: hand-rolled interactive charts against real data, modeled on Klinik Hijraa's Operation dashboard
Owner: reports/analytics looked "old school", asked for a Klinik Hijraa CMS review (`https://klinik-hijraa.onrender.com`, owner-authorized live login) as design reference, explicitly required every number stay real ("the data can be used as meeting") not dummy, and to tour Klinik Hijraa's other Admin tabs (Stock/Panel/HR/Finance) before locking in a KUWICK design. Full review captured in `docs/PROPOSED_ADDENDUM_2026-08-01_klinik-hijraa-admin-reference.md`: only Klinik Hijraa's **Operation** tab is a real interactive dashboard (date-range pills, KPI tiles, a segmented filter that re-scopes multiple charts at once, a doctor leaderboard, a donut with values in the legend) — Stock/Panel/Finance there are tabular, same as KUWICK's equivalents already are, so the redesign scope is the Executive Dashboard specifically, not the whole report suite.

Built a small hand-rolled SVG chart library (`apps/web/src/reports/charts/`: `TrendChart`, `DonutChart`, `Leaderboard`, `KpiTile`) replacing `@ant-design/plots` Column/Pie on `ReportsPage.tsx`, following the dataviz skill's mark spec (2px lines, 4px rounded bar caps, 2px surface gaps/rings, thin recessive gridlines) and its validated 8-hue categorical palette — chosen over pulling in a bigger charting dependency since the interactions needed (crosshair+tooltip, click-to-highlight donut segment, click-to-expand leaderboard row) are each a few dozen lines of SVG/state, and `@ant-design/plots` (AntV G2) doesn't expose a click-driven cross-chart-filter primitive without dropping to its lower-level API anyway. Every figure is real: KPI deltas compare against a same-length prior period fetched via a second `/reports/*` call (`previousRange()` in `ReportRangeBar.tsx`), sparklines read real per-day series (`SalesSummary.byDay`, `SalesAnalysis.byDay.patients`, `WaitTimesSummary.byDay`) — omitted, not faked, for the two KPIs (Completed Rate, Panel Outstanding) with no comparable backend series. `getWaitTimes` (`reports.service.ts`) was extended to also aggregate `averageServiceMinutes` per day (same visit timestamps already used for the single-day average, just grouped), giving a real 2-series wait-time trend (waiting vs. consultation+dispensary) instead of Klinik Hijraa's un-copyable 3-series version (KUWICK has no separate dispensary timestamp, per D-042).

The "segmented filter scopes multiple charts" pattern from Klinik Hijraa was **not** copied literally: their filter re-renders a whole panel of charts because their backend evidently has category-by-day data; KUWICK's `SalesAnalysis.byCategory` is a single-range total with no daily breakdown, so faking a category-filtered trend chart would mean fabricating numbers. Instead, clicking a revenue-by-category donut segment highlights that segment (donut + legend) and surfaces its real share as text — honest given what the backend actually returns, rather than replicating the interaction and lying about the data behind it.

Incidentally captured the complete Doctor Incentive Engine formula (resident sales-commission threshold/flat/percent + per-procedure resident/locum rate table + locum OT) while touring Klinik Hijraa's HR tab — written up in the same reference doc but explicitly out of scope here; still blocks 1c pending owner prioritization (see OQ#2 below, now unblocked on spec but not yet built).
**Reversibility**: High — additive frontend components + one backend field addition (`WaitTimesSummary.byDay[].averageServiceMinutes`); no schema change, no data migration, other Reports pages (Day-End, Sales/Patient/Procedure Analysis, Invoice Listing, Drug Movement, Waiting Times) untouched.

---

## D-048 — Named team channels alongside the single "General" clinic chat
Owner, asked after D-046 shipped: "any option group chat" beyond the one general thread — e.g. a "Doctors" or "Front Desk" channel, on top of the existing single clinic-wide chat. New `ChatChannel` model (`tenantId`, `clinicId`, `name`, `isGeneral`, unique on `[clinicId, name]`) — every clinic has exactly one `isGeneral` channel (auto-created lazily by `ChatChannelService.listByClinic` the first time a clinic's channels are listed, not backfilled for clinics with no chat history), plus any number of named channels any staff member can create (no RBAC enforcement anywhere in this app yet, so channel creation isn't gated either). `ChatMessage.orderServiceId null` is no longer the "general channel" signal — replaced by a proper `channelId` FK; `GET/POST /clinics/:clinicId/chat-channels` and `GET/POST /chat-channels/:channelId/messages` replace the old `/clinics/:clinicId/chat-messages` pair (migration `20260801180000_add_chat_channels`). `ClinicChatWidget` gained a pill row of channels above the thread (General first, then alphabetical) with a "+" to create one and a red dot on any channel with unread activity from someone else; `NotificationBell`'s chat count is now "N channels with new messages" rather than a single-channel message count, computed from each channel's `latestMessageAt`/`latestMessageStaffId` (returned by the channel-list endpoint) against a per-channel `localStorage` "last seen" marker — avoids fetching every channel's full history just to badge the bell.

**Migration bug found and fixed before shipping**: the first version of the migration's backfill (giving every clinic with existing chat history a real "General" `ChatChannel` row and repointing its messages at it) silently inserted/updated **zero** rows — `prisma migrate deploy` reported success, but a follow-up query showed 0 channels created. Root cause: the migration connection has no `app.tenant_id` set, and `chat_messages` already had `FORCE ROW LEVEL SECURITY` from D-046, which (unlike a plain `ENABLE`) blocks even the table owner — the backfill's `SELECT` was silently filtered to zero rows by the `tenant_isolation` policy rather than erroring, so the `INSERT ... SELECT` had nothing to insert and the `UPDATE` touched nothing. Confirmed by direct query before assuming the fix worked, not just re-reading the migration and asserting it was correct. Fixed per Postgres's own guidance (surfaced when reproducing the failure with `row_security = off`, which turns silent RLS filtering into an explicit error instead of bypassing it): `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY` around the backfill, `FORCE` restored immediately after. `chat_channels` itself is deliberately created with `ENABLE` only (not `FORCE`) until after its own backfill insert, since a table owner is exempt from RLS by default without `FORCE` — no bracketing needed there. The already-applied migration on the dev DB was repaired by hand with the same bracketing (verified after: the pre-existing 2 clinic-wide messages correctly landed in a real "General" channel), and the migration file itself was corrected so a fresh deploy gets it right the first time.
**Reversibility**: High — additive table + column, no data loss; the two REST endpoints being replaced (`/clinics/:clinicId/chat-messages`) had shipped only in the same working session and had no other consumers.

---

## D-049 — Unified email-only login: one form for platform owner and clinic staff, clinic code only on real ambiguity
Owner: *"remove the clinic id column? just by username and password will do"* and *"current kuwick used same website link... there we can log in as kuwick (system owner, developer) and clinics (any clinic), username and password"* — i.e. kuwick.com today has a single login for everything. `POST /auth/login` now takes just email + password (`slug` optional) and returns a discriminated `kind: 'platform' | 'tenant'`: platform admins (globally-unique email) are checked first, then clinic staff resolved by a single cross-tenant users read — the `users`/`staff` RLS policies gained the same `app.bypass_tenant_scope` escape hatch already used for `tenants` (login-by-slug, D-036) and `clinics` (public queue monitor), migration `20260801190000`. The password itself disambiguates: among all active accounts with that email, whichever one bcrypt-validates wins. If the same email **and** password validate at two clinics, the API answers 409 and only then does the login form reveal a Clinic field (safe to disclose — the caller has already proven they hold the password; every other failure stays a flat "Invalid credentials"). `LoginPage` routes by `kind` (platform → `/platform/dashboard` via the platform auth store, tenant → `/appointments`); `PlatformLoginPage` (`/platform/login`) and its endpoint still work but are no longer the required entry point — and no flow sends anyone there anymore: platform logout, the unauthenticated-console guard, and the console API's 401 handler all land on the unified `/login` (owner: "why not the general log in site (1 log in site) for everyone"). `User.email` stays unique per-tenant (no schema change) — global uniqueness wasn't forced onto existing data; the 409 fallback handles the collision case instead.
**Reversibility**: High — `slug` is still accepted and takes the original scoped path when provided; the RLS policy change is the established escape-hatch pattern, GUC settable only by trusted backend code.

**Console follow-ups shipped in the same batch** (owner questions while testing: "what does clinic slug means?", "how do we create one username and password to give to clinic owner", "no edit button for clinic once created"): (1) the Create Clinic form no longer asks for a slug — auto-derived from the clinic name ("Klinik Alpha (Kajang)" → `klinik-alpha-kajang`, `-2`/`-3` on collision); (2) Create Clinic gained a required **Owner Admin Login** section (name/email/password) creating the tenant's first `OWNER_ADMIN` staff+user, closing a real bootstrap gap — a new tenant previously had *no* login at all and even platform Login-As fails with zero staff; the owner then creates their own staff logins under Management > HR > Staff; (3) an **Edit** action per clinic row — tenant fields (name/registrationNo) on Tenant, contact fields (address/phone/email) written through to the tenant's first Clinic row, and a tenant rename renames that clinic too (single-location tenants are the same real-world thing; multi-branch tenants rename branches in their own Management screen); (4) the Create form resets on open — a previously abandoned attempt's values persist in the antd form instance even with `destroyOnHidden`, which had leaked stale contact details into a subsequently created clinic during live testing. Subscription management (assign plan + custom duration, extend by days, cancel, change plan by re-activating) already existed on the console's Subscriptions page — nothing new needed there.

Owner-login **editing** followed in the same batch (owner: "no function to edit the clinic owner details, name, username, password"): `PATCH /platform/tenants/:id/owner` updates the OWNER_ADMIN's name/email and rehashes the password only when one is provided (blank = unchanged, stated in the UI); for a tenant with no owner login at all — any clinic created before owner-at-creation existed — the same endpoint creates it, requiring all three fields. The clinic list now shows each tenant's owner (name + email) inline, with a red "No owner login yet — use Edit to create one" flag on tenants that predate the feature, and the Edit modal carries the Owner Admin section pre-filled. Duplicate-email collisions surface as 409, mirroring StaffService's own convention.

---

## D-050 — Management/Settings split into a horizontal-tabs shell; Stock Health merges four stock views into one page (M1/M2)

Two large code-verified audits preceded this (published as artifacts, no code changed during either, per explicit owner instruction): a broad Platform/Clinic-Portal UX audit, then a Management-and-HR-focused audit that recommended a permanent left accordion sidebar (Option A) for Management, since it already has a working left `Sider` and the audit weighed navigation depth over horizontal space. Owner reviewed both and **revised that specific call**: *"I prefer the horizontal Management navigation option because Management contains many charts, reports and wide tables. The permanent left sidebar uses too much horizontal space... Do not retain a permanent left accordion sidebar on desktop."* — approved instead: horizontal main-category tabs with a contextual secondary submenu, full-width content, explicitly scoped to just M1 (shell + Settings extraction + renames + redirects) and M2 (Stock Health merge), with an explicit list of what not to build yet (incentive engine, attendance subsystem, extended leave, biometric, multi-branch staff access, new roles, mini-dashboards, unbuilt finance pages, branch comparison) and an instruction to stop after M1/M2 for review.

**M1** — `ManagementLayout`'s left `Sider` (the one built in the original Management pass) is replaced by a shared `HubShell` component (`apps/web/src/design-system/components/HubShell.tsx`): a header row (title + "Viewing: {clinic}" scope label, sourced from the existing `useClinicFilter()` — no new scope concept invented), a row of main-category `Tabs` (Executive Dashboard / Finance & Sales / Clinic Operations / HR & Incentives / Inventory / Panel & Claims), and — only when the active category has more than one item — a secondary-nav row: `Tabs` on desktop (`Grid.useBreakpoint().md`), an antd `Select` dropdown on mobile/tablet (owner's stated mobile preference, "Option 2"), both driven by the same category config so there's one source of truth for the menu structure. Content renders full-width below with no sidebar, `<Outlet/>` unchanged. `SettingsLayout.tsx` reuses the identical `HubShell` for a second, parallel hub (Organisation & Branches / Scheduling / Queue & Visit Workflow / Clinical / Documents & Templates / HR & Attendance) — this is the extraction the owner's spec called "CMS Settings": set-once configuration screens (Branches, Doctor-Service Mapping, Slot Capacity, Rooms, Queue Display, Services, Diagnoses, Document Templates, Public Holidays) moved out from under `/management/operation/*` and `/management/hr/public-holidays` to their own `/settings/*` tree, reached via the header user-menu ("Clinic Settings" ↔ "Management" cross-link in `AppLayout.tsx`, which now also tracks `inHub`/`inManagement`/`inSettings` to switch the header title and content padding). Every relocated or merged URL keeps an explicit `<Route element={<Navigate replace/>}/>` redirect in `App.tsx` — nothing is a dead bookmark.

**M2** — the four separate stock screens (Stock Levels, Low Stock, Near Expiry, Negative Stock) become one `StockHealthPage.tsx` under `/management/stock/health`, using antd `Tabs` synced to a `?tab=` query param (`all`/`low`/`near-expiry`/`negative`, `all` omits the param) so the four existing page components (`StockLevelsPage`, `LowStockPage`, `NearExpiryPage`, `NegativeStockPage`) render unmodified inside each tab — no shared state or prop-drilling needed since each already fetches its own data. The four old routes redirect: `/management/stock/levels` → `/management/stock/health`, `/low-stock` → `?tab=low`, `/near-expiry` → `?tab=near-expiry`, `/negative-stock` → `?tab=negative`.

**Three page-heading bugs found and fixed during live verification** — the approved nav-label mapping renamed things in the menu config, but three page components still rendered their own old `<Typography.Title>` text, so the nav said one thing and the page said another: `PanelClinicsPage.tsx` ("Panel Clinics" → "Panel Companies", matching the owner-approved menu label and Klinik Hijraa's own naming), `ClinicsPage.tsx` ("Clinics" → "Branches", since "Clinics" was ambiguous against the tenant-level "Clinic" already used elsewhere), `DoctorServiceQualificationsPage.tsx` ("Doctor Service Qualifications" → "Doctor-Service Mapping", matching the shorter secondary-nav label). Caught by clicking through every category live rather than assuming the route rename was sufficient.

Verified live at desktop (1280×800 — full horizontal tabs, no truncation), mobile (375×812 — main tabs scroll with an overflow "…", secondary nav is a `Select` dropdown for multi-item categories, confirmed no page-level horizontal scroll via `document.body.scrollWidth ≤ window.innerWidth`), and the Stock Health `?tab=` sync (each tab renders genuinely different columns/data, confirmed via direct URL navigation). Backend suite unaffected (202/202 passing — this batch is frontend routing/layout only, no schema or API change) and `tsc --noEmit` clean.

**Reversibility**: High — no schema or backend change; `HubShell`/`SettingsLayout`/`StockHealthPage` are new additive components, `ManagementLayout` is a like-for-like rewrite of an existing component, and every relocated/merged URL keeps a redirect so no bookmark breaks. Reverting means restoring `ManagementLayout`'s previous `Sider` JSX and deleting the redirect block — the four stock page components and all Management/Settings leaf pages are untouched and still work standalone.

---

## D-051 — C0 Clinical Record Integrity: real authorship, electronic signing, amendments, and vitals split out of the narrative

Owner, overruling a recommendation of mine to defer authorship: *"For medicolegal traceability, every clinical-note entry must record the actual person who made the entry, together with date and time... Do not infer the note author from attending doctor / assigned doctor / visit doctor / current branch."* I had proposed shipping the Canvas layout first and adding authorship later; that was wrong — attributing a clinical entry to the wrong person is a worse failure than a late layout, and the owner was right to block on it. Scope became a controlled frontend + backend + schema change (checkpoint C0), with the Canvas UX work (C2) explicitly deferred behind it.

**The flaw the owner caught mid-design.** My first model kept vitals and the doctor's narrative on one `ClinicalNote` row with field-level permissions. The owner produced the breaking scenario: clinic staff enters vitals → that creates the row with the assistant as `authorStaffId` → the doctor later writes the narrative into the same row → *the permanent author of the doctor's narrative is the assistant*. Field-level 403s don't fix that, because the attribution is on the row, not the field. Vitals therefore moved to their own attributed record: **`VisitObservation`** (recorder + snapshots + `recordedAt`, many per visit — a repeat BP is a NEW row, a mistyped value is a `correct()` that writes an immutable revision preserving the previous reading). `ClinicalNote` is now narrative-only. Verified by a test that replays the owner's exact four steps: the note's author is the doctor, the observation's recorder is the assistant, and recording vitals creates no note at all.

**Authorship and signing.** `currentStaffId()` (already populated from the cryptographically-verified JWT by `TenantContextMiddleware`) is the only source of identity — never a request body. Author/signer/editor each store an immutable **identity snapshot** (`*NameSnapshot`, `*RoleSnapshot` as plain strings, not the `Role` enum, so a later enum rename can't rewrite history) alongside the staff id for traceability. Signing eligibility is derived from **professional identity, never the administrative role**: `professionalType === MEDICAL_DOCTOR && professionalActive && medicalRegistrationNo && professionalVerifiedAt && professionalVerifiedByStaffId && canSignClinicalNotes && clinicalSigningEnabledAt && clinicalSigningEnabledByStaffId`. Every clause defaults to the non-signing state, so a fresh deploy has **zero** eligible signers until a Clinic Group explicitly configures each doctor — an `OWNER_ADMIN` who is a registered practitioner can sign; one who isn't, cannot. The verification/signing-enable timestamps are stamped server-side by `StaffService` when the flags flip and cleared when they're turned off, so a stale "verified" marker can't linger behind a disabled flag. The Staff screen labels three genuinely distinct states (profile completed / verification recorded / signing enabled) and states plainly that **Kuwick performs no MMC registry lookup** — the clinic is recording its own verification.

**Immutability.** A signed note is never rewritten: `status` is only `DRAFT | SIGNED` (no `AMENDED`), and an amendment is a **new linked row** (`entryType=AMENDMENT`, `supersedesNoteId`, mandatory reason, its own author/signer/revisions). "Amended" is derived from the existence of that link. `ClinicalNoteRevision`/`VisitObservationRevision` are append-only with full JSON content snapshots — no update or delete route exists for them anywhere in the API. Signed revisions carry a `contentHash` plus `hashSchemaVersion`, so the canonicalisation rules can evolve without invalidating historical hashes. Optimistic concurrency (`expectedVersion` → 409) on every mutation; create/update/sign/amend each run in one interactive transaction, so a partially-signed state cannot exist.

**Three bugs found by building it, each fixed after being reproduced rather than assumed:**
1. **The migration's backfill silently matched zero rows** — a deeper instance of D-048. I bracketed `clinical_notes` with `NO FORCE`/`FORCE`, but the backfill *joins* `visits`, which is also `FORCE`d; the join returned nothing, `clinic_id` stayed NULL, and `SET NOT NULL` failed with 23502. The lesson generalises: **every table a backfill READS must be lifted, not just the one being written.** The migration now brackets both and ends with a `DO $$` guard that raises if any row still lacks a branch, so this fails loudly next time instead of silently.
2. **My own preflight was lied to by RLS.** An early probe reported `clinical_notes: 0 rows`; the table actually held 7. `clinical_notes`' `tenant_isolation` policy has no `app.bypass_tenant_scope` clause (unlike tenants/users/staff/clinics), so the probe was silently filtered. Re-checked with `row_security = off`, which turned the silent filter into an explicit 42501 and exposed the truth.
3. **The canonical hash treated `'36.50'` and `36.5` as different values** — caught by its own spec. Prisma returns `Decimal` columns as a string on some paths and a Decimal object on others, and the string branch ran before decimal normalisation. Scale normalisation now runs first.

**Migration verification (run, not assumed):** 7 legacy notes → all 7 branch-backfilled from the visit (factual), all 7 flagged `legacyAuthorUnknown`, **0 given a fabricated author**; 4 notes carried vitals → exactly 4 observations created, all `legacyRecorderUnknown`, 0 with an invented recorder. Legacy entries render as *"Author not recorded — legacy note"* / *"Recorder not recorded — legacy entry"* rather than guessing. 11 CHECK constraints verified to reject bad data at the DB level (author identity, signature all-or-nothing, staff-remark-cannot-be-signed, amendment reason, late-entry reason, self-supersede); RLS policies on all three new tables carry both `USING` and `WITH CHECK`, and cross-tenant read *and* write denial were confirmed by direct query.

**Front-desk documentation gap, raised by the owner mid-build** (*"sometime staff able to enter notes — ie any remarks: patient reject medications, how?"*): locking non-doctors out of the narrative left them nowhere to record real events. Added `ClinicalNoteType { DOCTOR_NARRATIVE | STAFF_REMARK }` on the same table so remarks inherit the full audit trail, with a DB CHECK making a `STAFF_REMARK` **structurally impossible to sign** and a distinct badge so it never reads as a doctor's note. Front-desk staff can record vitals, attachments and remarks; `DOCTOR_NARRATIVE` returns 403 for them, and a scribe/countersign workflow for dictated narrative stays a separately approved future feature.

**Branch access fails closed**, replacing my earlier `staff.clinicId === null → all branches` proposal, which the owner rejected: access now requires a genuinely single-branch tenant, a matching home branch, or an explicit `UserClinicAccess` row — a null home branch in a multi-branch tenant is denied. The mandated preflight found exactly one affected account (DR ALI, `clinicId` null in the 2-branch "Frontend Verify Tenant"); reported rather than silently widened.

**Attachment attribution corrected** in the same batch: `uploadedByStaffId` used to be posted by the browser, making uploader identity client-controlled. It now comes from the session, and the DTO rejects any client-supplied value.

**Spoofing is rejected, not silently stripped.** The global `ValidationPipe` runs with `whitelist: true`, which strips unknown properties *before* a controller-scoped `forbidNonWhitelisted` can object — so a posted `authorStaffId` returned 201 (safely ignored, but silently). Identity fields are now declared on the DTOs and rejected by a `MustNotBeProvided` validator, so a client learns immediately with a 400 instead of believing it set authorship. Verified live for author, signer, name-snapshot and observation-recorder spoofs.

**Deliberately NOT done in C0:** the wider RBAC gap (no role enforcement exists anywhere else in the API) is documented for a dedicated permission phase; `UserClinicAccess` stays unwired beyond the explicit-grant check; the legacy vitals columns on `ClinicalNote` are frozen and retained (dropping them is a separate approved cleanup); and **no hard unique index on `medicalRegistrationNo`** — per the owner's instruction to defer if any ambiguity exists, since a tenant could be using duplicate Staff rows as a multi-branch workaround and production data could not be preflighted from here. Normalisation + an index for duplicate *detection* ship now; the constraint waits for the multi-branch phase.

**Reversibility**: Moderate. All schema changes are additive (new columns, four new tables) and no clinical content is deleted or altered — reverting means dropping them and restoring the vitals fields to `UpsertClinicalNoteDto`, since the legacy vitals columns were never removed. The one-way door is that revision history only exists from deployment forward; history before C0 cannot be reconstructed, which is unavoidable and is why legacy rows are marked unknown rather than backfilled.

### C0 closure items (owner-required before push)

**Legacy notes are permanently read-only.** A `legacyAuthorUnknown` note now rejects `PATCH` with a 409: editing it would silently attribute someone else's historical text to whoever is logged in today. The UI disables the editor and Save, badges it *"Author not recorded — legacy note · Read-only"*, and offers **Add Amendment** instead — so a correction becomes a new, fully attributed entry linked to the original while the original stays byte-identical. `amend()` was widened to accept a legacy note for exactly this reason (signed and legacy are both "locked", and locked notes are corrected the same way). Tested: direct edit rejected, content byte-identical afterwards, and an attributed amendment created without touching the original.

**Professional identity and signing permission are permission-gated and audited.** Before this, *any* authenticated account could `PATCH /staff/:id` and grant itself signing — which would have made the whole eligibility check decorative. Now only an active `OWNER_ADMIN` may change `professionalType`, `medicalRegistrationNo`, `professionalActive` or `canSignClinicalNotes` (403 otherwise), and every change writes append-only `StaffProfessionalAudit` rows — one per changed field, including the server-derived verification/enable timestamps and actors — carrying previous value, new value, who changed it (with name/role snapshots), when, an optional reason, and the tenant/branch context. Readable at `GET /staff/:id/professional-audit`; there is no write, update or delete route. The gate is deliberately narrow: the rest of the staff record keeps its existing unrestricted behaviour, consistent with the app's wider RBAC gap, which stays a separate phase.

**DR ALI resolved by investigation, not assumption.** The preflight's one flagged account turned out to have **no user row at all** (so it cannot log in), a null `lastLoginAt`, and a tenant holding 0 visits and 0 clinical notes — created during frontend verification work in a tenant literally named "Frontend Verify Tenant" with a null slug. Determination: seed/test data, not a practitioner; it cannot lose access it never had. **No branch was assigned and no row was modified** — inventing a branch for a fabricated doctor is precisely the silent unrecorded change C0 exists to prevent. Recorded in `docs/C0_DEPLOYMENT_CHECKLIST.md`, and `prisma/clinical-access-preflight.ts` ships as a reusable, read-only pre-deployment report (exit 1 when anyone would lose access).

**Signing rollout verified.** Because signing defaults to disabled everywhere, the concern was whether unsigned drafts break anything. Confirmed by search across `apps/api/src` and `apps/web/src`: **no code outside the clinical-note module reads note `status` or the signature fields**, so Queue, visit completion, medications, procedures, documents, invoices and payments are unaffected by a draft. Doctors can create and save drafts with signing unconfigured; nobody gets signing from their role alone. Per-doctor setup checklist in `docs/C0_DEPLOYMENT_CHECKLIST.md`, which states plainly that Kuwick performs no MMC registry lookup — the clinic records its own verification.

**Confirmations verified against the live database**, not asserted: RLS enabled+FORCED on all six affected tables after migration and backfill; all four new tables carry policies with both `USING` and `WITH CHECK`; the late-entry, amendment, signature-state and observation-recorder CHECK constraints exist and reject bad data; every `SIGNED` revision carries `contentHash` + `hashSchemaVersion`; no note's `createdAt` predates its visit (never backdated); superseded originals remain `SIGNED`; and revision/audit routes are `GET`-only.

**Review screenshots** are captured as real PNGs by `prisma/c0-review-screenshots.ts` (drives locally-installed Chrome via `playwright-core`, downloads no browser), which authenticates through the real login endpoint and seeds a clearly-labelled `ZZ C0 Review Patient …` — safe test data only, never a real record. Output in `docs/c0-screenshots/`.

---

## D-053 — C2: the Canvas clinical workspace, rebuilt around the note the doctor is actually writing

Owner: the Canvas layout buried the doctor's main task. Measured before touching anything (`prisma/c2-canvas-measure.ts`, so "too small" is a number rather than an impression): the typing area was **22px tall at both 1920×1080 and 1366×768**, inside a card that itself scrolled, with 3–4 independent scroll containers on desktop and a sidebar taking a third of the width.

**Why it was 22px.** Two separate causes, and fixing only the obvious one changed nothing. The layout used an antd `16/8` grid with the notes card's body set to `overflowY: auto` and the lower panels pinned to `flex: 0 0 118px` — so the editor got whatever was left, which was almost nothing. But after switching to a flex shell and giving the editor `flex: 1 1 auto`, it *still* measured 22px: Tiptap renders the real `contenteditable` as a `.ProseMirror` div **inside** `EditorContent`, so styling the wrapper grows the wrapper and leaves the text area content-sized. The fix needs CSS on the inner element (`.kw-editor-fill .ProseMirror`), which is why this is in `index.css` rather than inline styles. Result: **324px at 1920×1080, 220px at 1366×768, 260px on tablet and mobile** — and the same inner-element bug was silently affecting tablet/mobile/Flow too, where the editor had been one line high regardless of the wrapper's `minHeight: 240`.

**Layout.** The Canvas is now a flex row: a growing main column and a sidebar bounded to `clamp(280px, 22vw, 360px)` instead of a third of the viewport. Vitals collapse to a single attributed line (`BP 122/78 · Pulse 84 · … · Recorded by Dr X`) with Record/Expand, and the expanded form is unchanged — no observation field or attribution was removed, and vitals stayed on `VisitObservation`. Attachments collapse to `Attachments (0) [Upload]` instead of rendering a full card around an empty-list placeholder. The lower four panels are content-sized rather than crushed into 118px. Below the desktop breakpoint the summary moves into a right-hand Drawer, with the allergy alert staying in the always-visible header so nothing clinically urgent hides behind it.

**Scrolling** went from 3–4 nested containers to **0 on desktop**; tablet/mobile keep exactly one, the page itself. I briefly capped the summary-card bodies at 132px to claw back height for the editor, measured it, found it bought **zero** extra editor height while reintroducing a nested scrollbar, and reverted it — the panels are content-sized instead.

**C0/C1 are untouched.** No schema, authorship, signing, amendment, revision, RLS, concurrency, draft-keying, dirty-state or conflict logic changed; this is layout only. The C1 note-selector gate was re-run after the layout change and still passes end to end.

**On the way in, the real Ant Design note selector finally got verified.** C1 shipped with that path unverified because the in-app browser could not open the antd dropdown with synthetic events. Playwright drives it correctly, so `prisma/c1-note-selector-check.ts` now exercises the actual control: dirty → switch → warning → Continue editing keeps the selection, text and dirty state → switch again → Discard loads the requested note, scoped. Its first run reported a failure on "unrelated visit draft was not cleared", which turned out to be the test's own fault — it changed visits with `page.goto`, a full page load, and the draft store is deliberately memory-only, so every draft dies with the page by design. Corrected rather than explained away.

**Editor height is 324px at 1080p, against an aim of 350–500px.** The remaining ~26px sits in the header, the compact vitals/attachments rows, the note toolbar, the provenance line and the four lower panels. Reaching 350 would mean shrinking the panels to the point of hiding their content, which trades one usability problem for another; flagged rather than forced.
**Reversibility**: High — presentation only. Reverting restores the previous grid; no clinical data, API or business logic is involved.

---

## D-054 — G0a: the editor's height is declared, not left over; and a visit with no notes opens ready to type

Part of Part G (the full Medical Record Workspace review). Owner accepted the audit and authorised these two defects to be fixed ahead of the wider restructure.

**Correction to D-053 first.** C2 reported 324px and "0 nested scrollers". Those numbers were measured on a record with **zero** diagnoses, orders, medications, documents, invoices and attachments — every recent visit in the dev database is empty (verified by direct query). The editor fix in D-053 was real, but its headline numbers described an empty record and should not have been reported without that caveat.

**Why that mattered.** C2 gave the editor `flex: 1 1 auto` inside a viewport-height shell whose lower sections were `flex: 0 0 auto`. With `flex-basis: auto` the lower row takes its *content* height and the note absorbs the remainder — so every diagnosis or medication added subtracted directly from the doctor's typing area, and past the old 220px floor the shell overflowed instead. The layout was population-dependent by construction.

**The fix is to stop deriving the height.** The viewport-height shell is gone; the page scrolls naturally (the app shell's `Content` already provides exactly one scroller) and `.kw-editor-fill .ProseMirror` declares `height: min(58vh, 520px); min-height: 320px`. Lower sections may now continue below the fold — which is what the owner asked for — because they no longer compete with the note. Measured in real Chrome on a record carrying 4 diagnoses, 3 orders and 5 medications: **520px at 1920×1080, 446px at 1366×768, 300px on tablet and mobile, identical to the same viewports on an empty record.**

**Zero-note visits.** A visit with no notes rendered an editor bound to nothing, behind a selector reading "No notes yet"; the doctor had to find "Add Note" before typing. It now opens one local draft immediately. **No database row is created** — the row and its authorship still appear only on first successful save (C0 unchanged), and `content === baseline === ''` so it starts clean and cannot raise a false unsaved-changes prompt. Auto-open is limited to staff who may write the narrative; `FRONT_DESK_CLINICAL_STAFF` is still not handed the doctor's editor and still uses "Add Staff Remark" deliberately (C0 unchanged).

**A pre-existing medicolegal defect found by the new test.** `RichTextEditor` never received an editable flag: `readOnly` only swallowed `onChange`, leaving `.ProseMirror` `contenteditable="true"` on **signed and legacy notes**. A doctor could type into a sealed note and the text would sit there on screen, unsaved, looking accepted. Now `editable={!readOnly}` reaches Tiptap, with a `setEditable` effect so switching from a draft to a signed note re-locks it. This was not introduced by C2 or G0a — it was simply never tested until `prisma/g0a-editor-check.ts` asserted it.

**Verification** (`prisma/g0a-editor-check.ts`, 33/33 in real Chrome at four viewports): zero-note, draft, signed and legacy states; empty vs populated height equality; no horizontal overflow; one scroller; and a direct DB assertion that opening the editor created no `clinical_notes` row. The harness asserts it is *in* Canvas and in the expected height mode first — an earlier run reported 22/22 while silently measuring **Flow**, where the lower sections are not rendered at all and "population-independent" was trivially true. `prisma/c1-note-selector-check.ts` no longer needs `C1_SHOT_PASSWORD`; both scripts mint a token with the server's own secret, so a regression check is actually runnable by whoever needs to run it.

**Reversibility**: High — presentation only, plus one editable flag. No schema, authorship, signing, amendment, RLS, concurrency, draft-store or conflict behaviour was touched.

---

## D-055 — G0b: clinical images are looked at inside the record, not downloaded out of it

Second of the two Part G defects the owner authorised ahead of the wider restructure. Otoscope, wound, dermatology and endoscopy photos are the reason a visit carries attachments at all, and the only way to see one was to download the file and open it outside Kuwick — during a consultation, with the patient present.

**Why it could not just be an `<img src>`.** The download endpoint requires an `Authorization` header, and a plain `<img>` cannot send one. The bytes are fetched and handed back as object URLs (`useAttachmentBlobUrls`), the same approach `PrintOrderResultPage` already used for order attachments — this reuses existing plumbing rather than adding a public image route, which would have meant clinical images reachable without a token.

**Memory is handled deliberately.** Object URLs pin their blob until revoked, and a clinic gets through a lot of records in a day, so every URL is revoked when the attachment set changes or the component unmounts. Nothing is cached across records: a stale image showing under the wrong patient is a far worse failure than a refetch.

**Presentation.** Compact (Canvas) shows a thumbnail strip beside the count with the Upload action; the full card shows a 48px thumbnail per row. Clicking any thumbnail opens antd's lightbox with zoom, rotate, flip and prev/next across the whole image set. Non-image attachments (PDFs, lab results) stay as named file rows with a download action — and an image whose bytes fail to load falls back to the same file row rather than rendering a blank square, because an empty box in a clinical record invites the reader to assume there is nothing there.

**Attribution is unchanged and still server-side.** `uploadedByStaffId` comes from the authenticated session (C0, D-051); the UI only displays it, now on the thumbnail title and the list row alike. No permission, upload, delete or storage behaviour changed.

**Two wrong turns worth recording.** Wrapping each `Image` in an antd `Tooltip` broke `PreviewGroup`'s context registration — the lightbox opened on a single image with no gallery — so attribution moved to the native `title` attribute. Separately, the verification script first looked for `.ant-image-preview-switch-right`; antd v6 names them `-switch-prev`/`-switch-next`, so a working gallery was reported as failing. The test was wrong, not the code, and it was fixed rather than the result explained away.

**Verification** (`prisma/g0b-attachment-preview-check.ts`, 10/10 in real Chrome): three generated clinical images plus a PDF uploaded to a live visit; thumbnails render from `blob:` sources; no broken placeholders; the PDF is listed as a file; the lightbox opens, pages between all three images with the preview `src` actually changing, and closes back into the record. G0a's 33/33 and the C1 note-selector gate both re-run clean afterwards.

**Reversibility**: High — presentation only, plus one new read-only hook. No schema, endpoint, permission or storage change.

---

## D-056 — G0 closure: attribution, the two vitals consumers, the real height rule, and fixtures that clean up after themselves

Owner's G0 closure items, done as one commit after G0a/G0b were provisionally approved.

**Client-supplied uploader identity is gone.** C0 (D-051) moved attachment uploader identity to the authenticated session and the controller stopped reading `uploadedByStaffId` from the request — but the browser kept sending it. The server ignored it, so nothing was broken; what was wrong is that the code read as though the client still chose who a clinical image is attributed to. `buildAttachmentFormData` now puts the file and nothing else on the wire, and `attachment-upload.test.ts` asserts that, including a regex sweep for any staff/user/tenant-ish key, so it cannot quietly return.

**Both C0 vitals consumers verified end to end, on both paths** (`prisma/g0-clinical-consumers-check.ts`, 13/13 in real Chrome). Documents: a referral generated from a visit with a real `VisitObservation` carries BP 128/82, pulse 76, temp 37.4, SpO₂ 97%, resp 18/min; the same generation on a pre-split visit with only the FROZEN note columns carries 141/93 and 36.2, and does not leak the other visit's values. Dosage calculator: the weight box seeds 12.6 kg from the observation, 9.8 kg from the legacy columns, with no cross-visit contamination; `calcMethod` and the calculation itself were not touched.

**One honest gap:** `formatVitals()` has never included **weight, height or glucose** — a generated document shows BP/pulse/temp/SpO₂/resp only. That is existing document-content design, not a fault introduced by the vitals split, and what a referral letter says is a clinical-content decision rather than a G0 one. Reported, not silently changed.

**The height rule was reported imprecisely and is now stated exactly.** G0a claimed "a 320px floor" without saying which rule it belongs to, which did not match the 300px measured on tablet and mobile. There are two separate rules and they must not be conflated. Computed values, read from the live page:

| Layout | Rule | Computed height | min-height |
|---|---|---|---|
| Desktop Canvas 1920×1080 | `.kw-editor-fill .ProseMirror` | 519.99px | 320px |
| Desktop Canvas 1366×768 | `.kw-editor-fill .ProseMirror` | 445.54px | 320px |
| Tablet 900 | `.kw-editor-min .ProseMirror` | 300px | 300px |
| Mobile 375 | `.kw-editor-min .ProseMirror` | 300px | 300px |

The 320px floor is real but belongs only to `.kw-editor-fill`, and only binds below roughly a 552px viewport height — at 1080p and 768p the `min(58vh, 520px)` height wins. Tablet and mobile never touch that rule: they use `.kw-editor-min`, whose 300px is deliberate, not a failed floor. Desktop heights are unchanged. The check now prints the computed values and asserts each rule declares what it should, so this cannot be described loosely again.

**Fixtures no longer accumulate, and cannot run anywhere real.** `fixture-support.ts` adds a fail-closed guard requiring all of: `NODE_ENV` not production, a `DATABASE_URL` whose host is localhost/127.0.0.1, and an explicit `KUWICK_ALLOW_FIXTURES=yes` — deliberately not satisfiable by one stray environment variable, because these scripts delete clinical records. Everything created is tagged `KUWICK-FIXTURE` (visit complaint, patient name, uploaded filenames), tracked in a ledger, and removed in a `finally` block so a failed run cleans up as thoroughly as a passing one. Attachments are deleted through the API so their files leave disk too. A sweep at the start of each run removes anything an interrupted earlier run left behind. Verified afterwards: 0 fixture visits, 0 fixture patients, 0 `visit_attachments` rows.

**On deleting files I did not create:** the uploads directory held 21 orphans. 16 were mine and were removed; 5 have real clinical-looking names (`X-Rays-NORHAYATI…`, `FBC_MUMS_CLINIC…`, screenshots) and were left untouched. An orphaned row is not permission to delete somebody else's upload.

**Token minting stays test-only.** It exists solely in `prisma/*-check.ts` so a regression check is runnable without holding a staff password. It is not application code, is not exported from `src/`, and the guard above means it will not run against a non-local database.

**Thumbnails sized against real clinical images:** 48px in the compact strip (beside the note, must not push it around), 96px in the expanded panel (where a wound or lesion is actually judged), full resolution one click away in the lightbox. Measured in Chrome, not assumed.

**A test that lied, caught:** the expanded-panel measurement first reported 48px. `context.addInitScript` re-sets the layout to Canvas on *every* navigation, so switching to Flow via localStorage plus a reload never left Canvas — it measured the compact strip while claiming to measure the expanded panel. Fixed by switching through the real Layout control.

**Reversibility**: High — one field removed from a request body, two thumbnail constants, and test tooling. No schema, endpoint, permission, calculation or storage behaviour changed.

---

## D-057 — Document vitals: the generic summary stays; weight becomes a structured merge field in G3

Owner's decision on the gap G0 reported (D-056): `formatVitals()` renders BP, pulse, temperature, SpO₂ and respiratory rate, and has never included weight, height or glucose.

**Accepted as-is.** The observation behaviour verified in G0 is correct, and `formatVitals()` is **not** to be modified during G1.

For the **G3 Documents** phase:

- BP, pulse, temperature, SpO₂ and respiratory rate remain the standard general-vitals summary.
- **Weight** becomes a structured merge field, used by the templates that need it — paediatric documents especially.
- Height, BMI and glucose become **optional, template-specific** merge fields.
- Nothing is auto-inserted: every recorded observation must not be dumped into every referral, MC or memo. A template asks for what it needs.

The distinction that matters: a *general vitals summary* and a *specific measurement a document depends on* are different things, and a paediatric dosage letter needing weight is not a reason to put weight on every memo.

---

## D-058 — G1: one clinical-section structure instead of four dashboard cards

The Canvas workspace ended C2 with four equal-height summary cards (Diagnosis, Orders, Medications, and a combined "Documents & Invoice") sitting in a 4-up grid under the note. That grid was the reason the record read as a dashboard rather than a consultation: every section got the same weight regardless of what it held, at 375px they became two-up cards ~170px wide, and the combined card meant Documents and Invoice — two unrelated workflows — shared one box.

**The shell.** `ClinicalSection` is one component every section renders through: title, count, collapsed summary, optional status, a text-labelled primary action, an optional secondary menu, expand/collapse, and explicit loading, error, empty and permission-disabled states. Actions carry words, never an icon alone. Because every section shares it, "consistent" is structural rather than a thing five components each have to remember.

**Layout.** Five full-width sections stacked in clinical order — Diagnosis, Orders/Procedures, Medications, Documents, Invoice — below the editor row, on the page's own scroll. **Documents and Invoice are separate sections from G1**, even though their internals are G3.

**Editor height is unaffected by construction.** G0a already replaced the viewport-height shell with a declared editor height, so sections growing below cannot take space from the note. G1 keeps that property and re-measures it with a populated record rather than assuming it held.

**Expanded content reuses the existing tabs** (`DiagnosisTab`, `OrdersServicesTab`, `MedicationsTab`, `DocumentsTab`, `InvoiceTab`) unchanged. No business logic was duplicated or rewritten: the detailed redesigns are G2 and G3.

**On the Invoice section specifically:** G1's parity rule (preserve every current action) and D-056's financial-permissions decision (no new Pay/Cancel/Refund inside the clinical workspace) pull in opposite directions here. G1 wins for now — the expanded Invoice section renders the *existing* `InvoiceTab`, so nothing is added and nothing is removed relative to what the modal already exposed. Making it a read-only summary is G3's job, and the underlying gap is still that no server-side RBAC exists.

**Order status labels** are humanised in the collapsed summary only (`PENDING` → "Ordered", `IN_PROGRESS` → "In Progress"). The enum, the API and the expanded tab are untouched.

**Rollback.** The four `*SummaryCard` components are kept in the tree, unreferenced, until G1 is accepted — one public version at a time, but the old one still recoverable. They are deleted in a later cleanup commit once parity is confirmed.

**Reversibility**: High — presentation only. No schema, endpoint, permission, calculation or clinical-workflow change.

---

## D-059 — G2a: a diagnosis becomes an attributed clinical record with a clinical priority

Owner-approved additive change. A visit diagnosis previously carried only `icd10Code`, `name` and `createdAt`: no priority, and no record of who entered it.

**Priority is nullable on purpose.** `NULL` means **"priority not recorded"**, which is the honest state for every one of the 8 rows that existed before this migration. Nothing was backfilled to PRIMARY or SECONDARY — a historical diagnosis has no recorded priority, and inventing one would be a clinical claim the record does not support. `SECONDARY` was rejected as a migration default for exactly that reason: it reads as a decision a clinician made.

**One primary per visit is enforced by the database, not by hope.** A partial unique index, `diagnoses_one_primary_per_visit ON diagnoses(visit_id) WHERE priority = 'PRIMARY'`, is the only thing that can settle two requests racing to promote different diagnoses; an application-level read-then-write cannot. The service demotes the incumbent and promotes the new one inside **one** interactive transaction, and a `P2002` on that index surfaces as **409** rather than a silently duplicated primary. Rows with `NULL` priority are outside the index, so any number of "not recorded" diagnoses stay valid. The previous primary is demoted to `SECONDARY`, not to `NULL` — it was deliberately prioritised, and dropping it to "not recorded" would discard information the doctor entered.

**Attribution is server-derived, like C0 authorship.** `addedByStaffId` plus frozen name/role snapshots come from the authenticated session. The DTO *declares* the identity fields and rejects them with `MustNotBeProvided`, because the global `whitelist: true` pipe would otherwise strip them silently and let a client believe it had set the author — the exact failure C0 found with `authorStaffId`. Verified live: posting `addedByStaffId` returns **400**.

**Legacy rows say so.** `legacyAttributionUnknown` is set for every pre-existing row, mirroring `ClinicalNote.legacyAuthorUnknown`, so "nobody recorded this" is explicit rather than an ambiguous null. Attribution was **not** inferred from the attending doctor, the note author, the visit creator, or whoever ran the migration.

**Migration result:** 8 rows before → **8 after**; 8 with priority not recorded; **0** given a fabricated priority; **0** given an invented author; 8 with `added_at = created_at`. The backfill is bracketed by `NO FORCE`/`FORCE ROW LEVEL SECURITY` with a `DO $$` guard that raises if it touched nothing, because a FORCE'd table silently filters an UPDATE to zero rows and reports success (D-048).

**Removal is unchanged, and that is a recorded gap.** `remove()` still hard-deletes: no soft-delete column, no audit row, no revision history. G2a did **not** widen this, because turning deletion into a governed clinical-record action is the owner's decision, not a side effect of a UX phase. What G2a did add is that removal now passes the same authenticated-actor and branch-access checks as everything else, so the new UI cannot reach around server rules. **Open governance item: a deleted diagnosis leaves no trace. This needs an explicit decision before production clinical use.**

**Deleting the primary does not auto-promote another diagnosis.** Zero primaries is a valid state; picking a replacement would be inventing a clinical judgement.

**Verification.** 28 unit tests (mocked Prisma — intent) plus `prisma/g2a-diagnosis-integrity-check.ts`, 20/20 against the real database and real HTTP API — the parts only the database can settle. Two honest notes on that run: the concurrent promotion returned **200/200**, i.e. the two transactions serialised and one primary remained, so the invariant held but the 409 path was not exercised live (the unit test covers the translation); and cross-tenant isolation had to be tested with a token scoped to a different tenant, because every active doctor with a login in this dataset belongs to one tenant — that token saw **0 rows** and got **403** on write.

**Reversibility**: Medium. The columns and index are additive and dropping them loses only G2a data, but the enum and index would need a down-migration.

---

## D-060 — G2b: Diagnosis, Orders and Medications as clinical lists rather than tables

The three sections now share one row pattern (`.kw-dx-row`), so they read as one system: details on the left, only the valid next actions on the right, wrapping instead of scrolling sideways.

**Diagnosis** shows what G2a made real — ICD-10 code, name, Primary / Secondary / **"Priority not recorded"**, and either "Added by <name> (role)" or **"Added by not recorded — legacy entry"**. Search matches the ICD-10 code as well as the name (a GP who knows `J06.9` should be able to type it), Enter adds, and the whole add flow is keyboard-only with no modal. Only actions the API supports are offered: set/clear primary, and remove. **There is no edit**, because no update endpoint exists for a diagnosis's name or code — inventing one in the UI would be a lie about what the record can do.

**Orders** use plain words for the real statuses (`PENDING` → "Ordered") and render **only** the actions the current status permits: Ordered → Start/Cancel, In Progress → Complete/Cancel, Completed → View result. No approval states were invented. The attachments indicator and "On invoice" tag are backed by real counts added to the list endpoint (`_count.attachments`, `_count.invoiceLines`) rather than inferred. `CompleteOrderModal` — form templates, attachments, per-order chat — is reused untouched.

**Medications** replace a 6-column table that needed horizontal scrolling below laptop width and buried indication, remark and prescriber in one cramped cell. Each row now carries dose, frequency, duration, quantity, instructions, prescriber, dispensing state, stock on hand, and the `calcMethod` audit trail. Strength is read from the Item and **labelled "Item strength"** — it is a property of the product, not a per-prescription field. Route is not shown at all because it is not modelled. The allergy banner names the recorded allergies with an icon and words, and says plainly that **Kuwick does not automatically check prescriptions against them** — a banner implying a check nobody implemented would be worse than none.

**Three mobile defects found by the check, not by eye.** At 375px the page scrolled sideways; the check reports the offending element rather than leaving it to guesswork. In order: the section search controls used `minWidth` wider than the 281px section; the medication form's fixed `span={6}` columns could not shrink below antd's InputNumber minimum; and finally antd's `Card.extra` slot, holding the note's language + Dictate + Smart Abbreviation toolbar, measured **384px against 329px available** and does not shrink on its own. All three are fixed; the last needed both `wrap` and a scoped CSS rule.

**Two of my own test bugs, recorded rather than quietly fixed:** the weight-based fixture first picked an item with no Conc. Vol/Strength and the server **correctly rejected it** (existing dosage validation working — the fixture was wrong, not the rule); and the "no invalid actions" assertion counted "Cancel" across every section, sweeping up medication buttons and reporting the app wrong.

**Verification:** `prisma/g2b-clinical-ux-check.ts`, **75/75** in real Chrome at four viewports against 4 diagnoses (one Primary, one Secondary, one legacy-attribution), 3 orders in three different statuses, and 5 medications including a weight-based and a dispensed one. Editor height held at the accepted G0/G1 values with every section expanded.

**Reversibility**: High — presentation, plus two read-only `include` additions and an ICD-code search clause.

---

## D-061 — G2 closure: a saved diagnosis is corrected, never deleted

Closes the governance gap D-059 recorded. The old `DELETE /diagnoses/:id` removed a clinical record outright, leaving no trace that it had existed or who removed it.

**Removal is now a clinical correction.** `recordStatus` moves `ACTIVE` → `REMOVED_IN_ERROR`; the row, its name, ICD-10 code, priority, original attribution and `addedAt` are all left untouched, and the event records `removedAt`, `removedByStaffId`, frozen name/role snapshots, and a **mandatory** reason. There is **no application path that deletes a saved diagnosis** — the DELETE route is gone, and the live check confirms it 404s.

**The one-primary rule is now scoped to ACTIVE rows.** The old index would have kept a removed primary occupying the slot forever, so the doctor could never designate a new one. The removed row keeps its historical priority for audit; it just stops counting. Removing the primary leaves the visit with **no** primary until a doctor deliberately chooses one — nothing is auto-promoted, because picking a replacement would be inventing a clinical judgement.

**Permissions are enforced server-side, and OWNER_ADMIN does not qualify on its own.** `canModifyDiagnosis` allows doctors, or a staff member whose *professional* identity is an active `MEDICAL_DOCTOR` — the same distinction C0 draws for signing. A practice owner who is not a clinician has every administrative right and no clinical one. `FRONT_DESK_CLINICAL_STAFF` may record observations and staff remarks but may not add, re-prioritise or remove a diagnosis. The guard is applied to **all three** write paths, not just removal.

This is a **narrow, diagnosis-specific** clinical-authorisation guard. The wider gap is unchanged and still open: `currentRole()` is used nowhere else, and the invoice, order, medication and document controllers still have no role enforcement at all.

**Legacy diagnoses** remain removable through the same audited flow. The unknown original author is never fabricated; the removal event itself carries reliable current attribution.

**Concurrency.** `version` plus an optional `expectedVersion` — a stale client gets 409 rather than removing a diagnosis that changed underneath it. Re-removing an already-removed row is also 409.

**Migration:** 5 rows, all `ACTIVE`, **0** removed, **0** carrying fabricated removal attribution, all at `version = 1`. Backfill bracketed `NO FORCE`/`FORCE` with a `DO $$` guard that raises if any row came out non-ACTIVE or with invented removal data (D-048). Index `diagnoses_one_primary_per_visit` dropped and replaced by `diagnoses_one_active_primary_per_visit`.

*(The count is 5 here where D-059 reported 8: the three rows created purely to give that migration real data lived on a fixture visit, which the fixture sweep has since removed. No production-shaped row was lost.)*

**UI.** "Remove from visit" — a named action, not a bare trash icon. The confirmation shows the diagnosis, ICD-10 code, current priority, who added it and when, demands a reason, and states plainly that *"This diagnosis will be removed from the active visit record, but the original entry and audit history will remain preserved."* Removed entries vanish from the active list and count, and appear under "Show removed diagnoses" as **"Removed from visit — entered in error"** with actor, time and reason. Flow layout's `DiagnosisTab` was pointed at the same audited modal so there is only ever one removal path, and the unreferenced rollback card's unaudited delete was stripped out rather than left as a landmine.

**Verification:** 44 unit tests plus `prisma/g2a-diagnosis-integrity-check.ts` at **34/34** against the real database and HTTP API.

**Reversibility**: Medium — additive columns and an index swap; reverting would restore an unaudited delete, which is the thing this fixes.

---

## D-062 — G3a: clinical documents, images and results are voided, never destroyed

Closes the three unsafe permanent-delete workflows D-061 listed as still open. `DELETE /documents/:id`, `DELETE /visits/:visitId/attachments/:id` and `DELETE /order-services/:id/attachments/:attachmentId` all erased a clinical record outright, and the two attachment routes also **unlinked the file from disk** — an otoscope image or a lab report was gone for good, with nothing to say it had ever existed.

**All three routes are gone.** They are replaced by `PATCH /documents/:id/void`, `PATCH /visits/:visitId/attachments/:attachmentId/removal` and `PATCH /order-services/:id/attachments/:attachmentId/removal`, each with a **mandatory** reason, plus read-only `GET …/history` companions. No route edits or deletes the void/removal audit itself. There is no un-void workflow — deliberately out of scope for G3.

**Two enums, one shape.** `DocumentRecordStatus { ACTIVE, VOIDED }` for documents; `AttachmentRecordStatus { ACTIVE, REMOVED_IN_ERROR }` for both attachment tables — a document that should not have been issued is *voided*, a file attached to the wrong record was *put there in error*, and the words follow the clinical meaning rather than being unified for tidiness. Each table gains the actor/time/reason trio with frozen name and role snapshots, and a `version` for optimistic concurrency.

**Nothing about the original record is touched.** Voiding a document leaves `content`, `issuedByStaffId`, `signedAt` and `signedByStaffId` exactly as they were, so the clinic can still answer "what did we actually give this patient?". Removing an attachment leaves `fileName`, `filePath`, `mimeType`, `uploadedByStaffId` and `createdAt` intact. Removing an order result does **not** touch the order's status, `completedAt` or result text — a procedure does not become un-completed because a file was attached to the wrong one.

**Storage: the file stays on disk.** `deleteUploadedFile` is no longer imported by any clinical service. Files live under `uploads/<tenantId>/<ownerId>/<uuid>-<name>` (`apps/api/src/core/file-storage.ts`); an audited removal changes database state only. The existing `…/download` routes read by id and are not status-filtered, so an authorised history request retrieves the original bytes unchanged — verified byte-for-byte in the live check. Active views cannot show it: `findByVisitId`/`listByVisitId`/`listAttachments` all filter to `ACTIVE` unless explicitly asked for history. **No orphan cleanup was run**, and the five previously identified unknown files remain untouched.

**Fixture cleanup had to change with it.** `FixtureLedger` used to delete its uploads *through the DELETE endpoint* precisely because that endpoint unlinked the file. With that endpoint gone it would have silently leaked a file per run, so the ledger now unlinks its own files directly — scoped strictly to attachments hanging off visits the run itself created, never a listing or sweep of the uploads directory.

**Permissions.** `canVoidClinicalRecord` — a doctor role, or a staff member whose professional identity is an active `MEDICAL_DOCTOR`. `FRONT_DESK_CLINICAL_STAFF` and a non-clinical `OWNER_ADMIN` are both refused with 403, verified live against real staff rows, not mocks. Actor identity comes only from the session: `voidedByStaffId`/`removedByStaffId` and the snapshots are declared `MustNotBeProvided`, so a browser that sends one gets **400**, not a silent strip. The wider API RBAC gap (D-056) is unchanged and still open.

**Migration:** 6 documents, 4 visit attachments, 1 order attachment — **all** migrated `ACTIVE`, none lost, **0** carrying fabricated void/removal attribution. Bracketed `NO FORCE`/`FORCE` on all three tables with a `DO $$` guard that raises on any non-ACTIVE row or invented attribution (D-048).

**D-048 trap, hit again and worth recording:** `app.bypass_tenant_scope` does **not** cover `documents`, `visit_attachments` or `attachments`. The first run of the integrity check read all three under the bypass alone and reported `0/0 ACTIVE` — zero rows, no error, over real data. Only `app.tenant_id`, set per tenant on the same connection, makes these tables answer honestly. The check now sums per tenant and refuses to run if the tenant list itself comes back empty.

**Verification:** 299 backend unit tests, and `prisma/g3a-document-attachment-integrity-check.ts` at **45/45** against the real database, the real HTTP API and the real uploads directory — covering all 24 required G3a checks including "the file is still on disk after removal" and "the original bytes still download".

**Reversibility**: Medium — additive columns and enums; reverting would restore three unaudited deletes that destroy files, which is exactly what this fixes.

---

## D-063 — G3b: the Documents workspace, and what "signed" actually meant

Documents was a permanently-open "New Document" form sitting on top of a list whose every row printed the document's **entire body text** with three unlabelled icon buttons beside it. That is a text-file manager. A GP issuing an MC wants to see *what was issued, to cover which dates, by whom, and whether it has been signed* — none of which that list said.

**The workspace.** Each active document now states its type, the fields that matter *for that type* (an MC's rest period and inclusive day count, a referral's recipient, a memo's title), who created it and when, and whether it is signed. Actions carry words — Preview, Print, Download, Sign, Void. Creating moved into a drawer, so the section is the visit's paperwork rather than a form with paperwork underneath it. Below 768px the secondary actions collapse into a labelled "Actions" menu; nothing becomes a bare icon and no row scrolls sideways.

**Type presentation reads only stored fields.** Where the schema has nothing — a referral with no recorded recipient, a legacy memo with no dates — the line is **omitted**, not rendered as an empty label. A blank "Days:" reads as missing data; no line reads as data we never collect. **Time Slip** is supported the way it already exists, as a clinic-configured `CUSTOM` template. A first-class time slip with an actual time-of-day range would need new columns; that is a schema decision and is **not** taken here.

**One implementation.** Canvas, the Flow tab and the patient dashboard all render `DocumentsWorkspace`; `DocumentsTab` is now a four-line wrapper. Same rule the G2 closure applied to diagnosis removal — a second copy is how one surface quietly keeps the old, unsafe action after the other is fixed. The unreferenced `DocumentsInvoiceSummaryCard` (a leftover of the pre-G1 "Documents & Invoice" pairing, imported by nothing) was deleted rather than left carrying a stale copy of the old form.

### What "signed" was, and the smallest safe correction

The instruction said not to invent signing semantics from a UI badge, so the lifecycle was read rather than assumed. `Document.signedAt` is the dispensary **"prep, sign MC" workflow sign-off** — the schema comment says so outright: *"a lightweight sign-off checkbox, not a cryptographic signature"*. It is **not** the C0 medicolegal signature that `canSignClinicalNotes` guards behind a verified professional identity and an explicitly enabled signing right.

Three things were wrong, and all three are fixed without touching the schema:

1. **The signer came from the request body** — and the browser sent the *visit's attending doctor* regardless of who actually clicked. A document could be attributed to a doctor who never saw it. The signer is now the authenticated session; a supplied `staffId` is a **400**, not a silent strip.
2. **Anyone reaching the route could sign.** It now requires a clinical role and branch access to the visit.
3. **Re-signing silently overwrote `signedAt`/`signedByStaffId`**, so a signed document could be re-attributed with no trace. That is now a **409**, and a voided document cannot be signed at all.

**Eligibility was deliberately NOT narrowed.** `canSignDocument` is the clinical-role test, not `canSignClinicalNotes`. Front desk signing off a printed MC is the existing dispensary workflow; narrowing it on the strength of a shared English word would have broken a real workflow and called it a security fix. Verified live: a `FRONT_DESK_CLINICAL_STAFF` can still sign, and the server — not a hidden button — is what decides.

**Immutability of the rest of the document was already sound**, and this is why no schema decision was needed: there is **no route that edits a document's content**, stored text is captured at creation and never regenerated, and a template edited later cannot alter a document already issued. Upgrading document sign-off to true signature semantics (immutability lock, verified signer, content hash as C0 does for notes) remains an open policy decision, **not** taken in G3b.

### Merge fields (§6)

`{{vitals}}` keeps the accepted standard summary — BP, pulse, temperature, SpO2, respiratory rate — unchanged in content and wording. One real bug fixed on the way: `buildMergeValues` read vitals from the **clinical note**, so a custom template printed "Not recorded" for every visit recorded after the C0 observation split. It now reads the attributed observation, with the legacy note as fallback.

Four optional fields added, **opt-in only** — a template gets them only if its author writes the placeholder, so no existing template's output changes: `observation.weight`, `observation.height`, `observation.bmi`, `observation.glucose`. Weight is the one that matters clinically (a paediatric referral quotes a weight); the rest stay template-specific.

**BMI is derived, not stored**: `weight (kg) / (height (cm) / 100)²`, one decimal. It returns empty rather than a figure when either measurement is missing — a fabricated BMI on a referral letter is worse than no BMI. This is the **only** derived field and is not the start of a calculation engine.

**Template audit (§6, exact):** the tenant has **one** configured template, "Time Slip", which uses `clinic.name`, `clinic.address`, `clinic.phone`, `date`, `patient.name`, `patient.nric`, `visit.date`, `diagnosis`, `doctor.name`, `doctor.role`. **No** configured template uses `{{vitals}}`, and none uses weight, height, BMI or glucose — those placeholders exist in zero templates today. The only current consumer of the vitals summary is the built-in **Referral** builder, which passes it as `vitalsSummary`. There are **0** rows in `default_document_templates`.

### Void (§8, §9)

Uses the G3a endpoint unchanged. The confirmation names the document, its type-specific fields, its creator, creation time and signed state, demands a reason, and says plainly that the record is preserved. Voided documents are **not** in the active list at all — they live in their own drawer with creator, signer, voider, time and reason, offering only Preview and Download. No edit, no restore, no delete.

A voided document can never circulate looking valid: the preview carries a red banner, **print** carries the banner *and* a diagonal VOID watermark with `print-color-adjust: exact` so it survives onto paper, and **download** puts a void notice at the top of the file and `- VOIDED` in the filename. Download builds from the **stored** text, never a re-run of the template, so a document retrieved a year later reads as it did when it was handed over.

**Verification:** 306 backend unit tests, 75 frontend tests, and `prisma/g3b-documents-workspace-check.ts` — 111 checks against a populated record (active MC, referral, memo, a signed document, a legacy document, a voided one, plus two G3a attachments) across 1920×1080, 1366×768, tablet 900 and mobile 375 in real Chrome.

**One real defect, found by the check and not by eye:** every mobile action button was **24px** tall against the 44px minimum. antd's `size="small"` is correct for a mouse and far too small for a thumb, and nothing about it looks wrong on a desktop screen. Size is now chosen per breakpoint with an explicit 44px floor — even antd's "large" is 40px.

The rest of that run was harness, and worth recording because it cost several cycles: antd v6 renamed `.ant-modal-content` → `.ant-modal-container` (the check now targets `-body`, whose name has not changed); `getByRole('button', {name:'Void'})` matches substrings case-insensitively, so it hit the **"1 voided"** button, and `exact:'Void'` matches nothing because an antd icon button's accessible name is "stop Void"; and the clinical-section header is a `div role="button"` whose accessible name now contains the "1 voided" tag, so a role-based query hit the header and collapsed the section. Each overlay is now opened from a fresh page load and every trigger is located as a real `button.ant-btn`.

**Reversibility**: High for the UI; Medium for signing, where reverting would restore browser-chosen signer identity and silent re-attribution.

---

## D-064 — G3b closure: a signature has to say who is responsible for what

G3b established *that* a document was signed off, by whom, and that it could not be silently re-signed. It did not establish **what the signature claims**, and it let `FRONT_DESK_CLINICAL_STAFF` sign a medical certificate — which the UI then displayed as a plain green **"Signed"**. A medical certificate is a doctor's clinical opinion, and a badge that says "Signed" on a front-desk sign-off is a claim the record cannot support.

### Classification — from type and configuration, never from text

Clinical (a doctor must authorise): **MC, Referral, Quarantine, Memo**. All four built-in types generate documents that carry a clinical opinion; MEMO exists in this system as the *clinical* memo the templates produce.

Administrative (permitted staff may issue): a `CUSTOM` document whose template is explicitly marked administrative.

`CustomDocumentTemplate.requiresClinicalAuthorisation` is the new setting, **defaulting to TRUE**. Classifying by template *name* was considered and rejected — the closure forbids inferring clinical purpose from free text, and "Time Slip" is a name a clinic chose, not a guarantee. So an unclassified template is treated as clinical until an administrator says otherwise, and the Document Templates screen is the one place that decision is made. **The existing "Time Slip" template was NOT silently reclassified**; it requires a doctor until someone marks it administrative.

The requirement is **snapshotted onto the document at creation**, so editing a template later cannot change who was allowed to authorise a document already issued. A `CUSTOM` document whose template cannot be found is treated as clinical — an unclassifiable document is the one you least want front desk authorising.

### Permission — enforced in the service, on the row

`canClinicallyAuthoriseDocument` — a doctor role, or an active `MEDICAL_DOCTOR` professional identity. Same rule as diagnosis modification and clinical-record voiding. `FRONT_DESK_CLINICAL_STAFF` is refused; a non-clinical `OWNER_ADMIN` is refused; an owner who *is* a doctor qualifies through their professional identity, not their job title.

`canIssueAdministrativeDocument` is deliberately **unchanged** from the pre-closure rule, because the closure says to preserve explicitly approved existing staff permissions. Front desk issuing a time slip still works; it simply cannot describe itself as clinically authorised.

The check reads `requiresClinicalAuthorisation` **from the stored row**, not from the template. The button is not the gate: front desk still sees "Authorise", presses it, and gets the server's refusal — hidden controls are not security.

### Terminology — no generic "Signed" anywhere

| Record state | Badge | Sentence |
|---|---|---|
| Clinical, unauthorised | **Draft — not clinically authorised** | "A doctor must authorise this document before it can be issued." |
| Clinical, authorised | **Clinically authorised** | "Clinically authorised by Dr X (Medical Doctor (MMC …)) on …" |
| Administrative, issued | **Issued** | "Issued by X on …" |
| Administrative, not yet | **Not issued** | — |
| Pre-closure row | **Legacy sign-off** | "Authorisation type not recorded · signed off … by …" |

`authorisationKind` (`CLINICAL` / `ADMINISTRATIVE` / `LEGACY_SIGN_OFF`) carries this, with frozen name/role/designation snapshots so a doctor who leaves does not turn a year-old authorisation into a blank. **`LEGACY_SIGN_OFF` is never written by new code** — only by the migration, and only for rows that already had `signed_at`.

### Existing records

The migration labels every pre-closure signed row `LEGACY_SIGN_OFF` and **fabricates nothing**: no doctor identity is derived from the visit doctor, the document creator, the note author or the current user. A `DO $$` guard raises if the backfill produces any row claiming CLINICAL/ADMINISTRATIVE, any invented authoriser, or an authorisation on an unsigned row. Live: **3 signed rows, 3 legacy, 0 claiming clinical, 0 with invented authoriser.** A legacy row is not treated as a draft either — it is history, not unfinished work — and re-authorising one is a 409, so it can never be upgraded into a doctor's authorisation.

### Draft output

A clinical document no doctor has authorised **cannot be printed or downloaded** — the closure's preferred behaviour, and the only one that stops an unauthorised "MC" circulating. The controls are disabled with an explanation, and `downloadDocument` throws independently, because a disabled button is presentation and not a rule. Preview stays open so front desk can check the wording, headed **DRAFT — NOT CLINICALLY AUTHORISED**. After authorisation, print and download both carry the responsible party — name, professional designation, timestamp — stated by the system rather than left to the template's free-text signature block. Voided behaviour from G3a/G3b is untouched.

### Technical debt, stated plainly

- **`signedAt`/`signedByStaffId` keep their names.** They now mean "when this was authorised/issued, and by whom", with `authorisationKind` carrying the meaning. Renaming the columns would be churn across the dispensary workflow without changing behaviour; the semantics are correct, the names are legacy.
- **This is still not a cryptographic signature.** No immutability lock, no verified-signer requirement (unlike C0's `canSignClinicalNotes`), no content hash. Content immutability comes from there being no edit route, not from an enforced lock.
- **Creation is still unrestricted.** Who may *create* a document carries no role enforcement — part of the wider D-056 RBAC gap. The closure asked not to broaden or narrow existing create permissions, so this is reported, not changed.
- **No "send to doctor for review" action.** A draft sits in the visit and the section reports "N awaiting clinical authorisation"; there is no notification or hand-off workflow, and inventing one was out of scope.
- **Time Slip stays a configured template.** First-class support with real time-of-day fields is a document-schema enhancement for a later phase, per §8.

**Verification:** 321 backend unit tests (39 on documents alone, including the full authority matrix), 85 frontend tests, both typechecks clean, and `prisma/g3b-closure-authorisation-check.ts` against the real database, HTTP API and Chrome.

**Reversibility**: Medium — additive columns and an enum; reverting restores a front-desk-signable medical certificate labelled "Signed".

---

## D-065 — G3c: the doctor reads the money, the biller moves it

The Clinical Workspace mounted the **full mutable `InvoiceTab`** — Create Invoice, Quick Add, add/remove line, change quantity and price, Cancel, Mark Paid. G1 mounted it under a parity rule and said outright that making it read-only was G3's job. This is that.

### The audit found something that blocks the instruction as written

There is **no dedicated billing area**. `InvoiceTab` was mounted in exactly two places, both of them the Clinical Workspace (the Canvas section and the Flow tab). `/management/reports/invoices` is a read-only listing with a CSV button; the Queue's "Dispensary & Payment" tab is still an `Empty` placeholder. Removing the controls as instructed, and nothing else, would have left the clinic **unable to bill anybody**.

So G3c also gives the existing workflow a home: `/billing/visits/:visitId`, which mounts the **unchanged** `InvoiceTab`. No billing logic, calculation or rule is touched — the component is simply reachable at its own URL, which is also what lets "Open Full Invoice" point somewhere real. Designing the billing workflow properly is a separate checkpoint.

### What the model actually supports — and what it does not

| Asked for | Reality |
|---|---|
| Invoice status | `UNPAID / PAID / CANCELLED`. **No DRAFT**, **no PARTIALLY_PAID** — `pay()` is all-or-nothing. |
| Payment records | None. A single `paidAt` + `paymentMethod` (free text) on the invoice. |
| Tax / SST | **No column anywhere.** Not displayed. |
| Discount | **No column.** Not displayed. |
| Credit / debit notes | Do not exist. |
| Copayment | `panelCoveredAmount` / `patientPaidAmount`, snapshotted **at pay time**, `0/0` while unpaid. |
| Panel | Lives on the **VISIT**, not the invoice. |
| One invoice per visit? | **No.** No unique constraint on `visitId` — a visit can carry several. |

So "Partially Paid" is not offered: deriving it from `patientPaidAmount < totalAmount` would be wrong, because on a panel invoice the patient legitimately pays only the copay and the invoice is fully PAID. The panel/patient split is shown **only once the pay step has recorded it** — "Panel covered RM 0.00" on an unpaid panel invoice reads as "the panel pays nothing", which is false. And where a visit carries more than one invoice the collapsed line says "+N more on this visit" rather than quietly reporting the newest.

**Payment status and panel-claim status are never merged.** `ClaimBatchLine.status` is its own lifecycle — an invoice can be PAID (patient settled the copay) while the claim is still PENDING with the panel — so it gets its own badge, with words as well as colour.

### Read-only means read-only

`InvoiceSummary` imports `useInvoices` and nothing else. There is no `useCreateInvoice`, `useAddInvoiceLine`, `useRemoveInvoiceLine`, `useCancelInvoice` or `usePayInvoice` in it or in `InvoiceSection`, and no `InvoiceTab`. A test asserts this **against the source with comments stripped** — the files' own prose names those hooks to explain their absence, and a naive scan would have passed or failed for the wrong reason. Both the Canvas section and the Flow tab render the same component, so a control cannot survive on one surface.

**Line sources come only from the stored relationship** — `sourcePrescriptionId` → Medication, `sourceOrderService.orderType` → Procedure or Service. A freehand line shows no source tag. "Panadol" in a description does not make a line a medication.

The backend's `totalAmount` is the only total; the frontend never re-sums the lines into a second figure.

### Read security — the correction this needed

`GET /invoices?visitId=` ran on the tenant-scoped client, so **tenant isolation held via RLS**, but **nothing checked the branch**: a staff member authorised only for Branch A could read Branch B's money for any visit id they could name. Every clinical read added since C0 goes through `assertMayTouchVisit`; the money did not. It does now, fail-closed, before exposing the data in the workspace.

**Still open, and not fixed here:** every invoice MUTATION route — `POST /invoices`, `POST /invoices/:id/lines`, `DELETE /invoices/:id/lines/:lineId`, `PATCH /invoices/:id/cancel`, `PATCH /invoices/:id/pay` — has **no role enforcement and no branch enforcement**. Any authenticated user of the tenant can still create, line, cancel or mark-paid an invoice by calling the API directly. Removing the buttons from the Clinical Workspace is a UX correction, **not** a security one, and this decision does not pretend otherwise. Recommended as a dedicated **financial-RBAC checkpoint** covering those five routes plus claim submission and the panel workflow.

**Verification:** 324 backend unit tests, 109 frontend tests, both typechecks clean, and `prisma/g3c-invoice-summary-check.ts` against the real database, HTTP API and Chrome across four viewports, with ten populated scenarios.

**Reversibility**: High for the UI; the read-security correction should not be reverted.

*(The "still open" paragraph above is closed by **D-066**.)*

---

## D-066 — G3c closure: who is allowed to move money

D-065 removed the financial controls from the Clinical Workspace and said plainly that this was a UX correction, not a security one: all five invoice mutation routes were still open to any authenticated user of the tenant. This closes that.

### The role model, audited first

The instruction was to stop and report if the schema could not distinguish authorised billing users safely. It can. `Role` is a real enum on `staff` with nine members, and three of them are already financial or administrative in name and use: `OWNER_ADMIN`, `FINANCE_STAFF`, `PANEL_STAFF`. No new role was invented.

There is a second, separate axis — `professionalType` (`DOCTOR` / `NURSE` / …) with `professionalActive`, `verifiedAt` and `signingEnabledAt`. G3b's closure (D-064) uses that axis for clinical authorisation, deliberately, because a *clinical* signature is a professional act and not a job title. Billing is the mirror image: it is a **job function, not a professional one**, so the billing matrix reads `Role` **only**. `professionalType` is never consulted here. A doctor is not a cashier by virtue of being a doctor.

### One matrix, four actions, on the server

`BILLING_MATRIX` lives beside the clinical rules in `clinical-authorization.ts`, and every one of the five routes goes through the same `authoriseBilling()` helper — the guard cannot be applied to four routes and forgotten on the fifth.

| | OWNER_ADMIN | FINANCE_STAFF | FRONT_DESK | DOCTOR (res/locum) | HR / STOCK / PANEL / PORTAL |
|---|---|---|---|---|---|
| Create invoice | ✅ | ✅ | ✅ | ✅ | ❌ |
| Add / remove lines | ✅ | ✅ | ✅ | ✅ | ❌ |
| Mark paid | ✅ | ✅ | ✅ | ❌ | ❌ |
| Cancel invoice | ✅ | ✅ | ❌ | ❌ | ❌ |

The two interesting rows are the deliberate ones. A **doctor may raise and itemise** the charges arising from their own consultation — that is clinical work — but may **not take payment and may not cancel**, which are cash-handling and write-off decisions. **Front desk takes payment** (that is the job) but **cannot cancel an issued invoice**, because voiding a bill is the control that matters and it stays with the owner and finance. `PANEL_STAFF` administers claims, which is a different lifecycle, and is not given invoice mutation here.

**Branch is resolved from stored relationships, never from the browser.** For `create` the visit comes from the DTO and is then verified with `assertMayTouchVisit`; for the other four the visit is looked up **from the invoice itself** (`invoiceVisitId`), so a `visitId` in the request body cannot redirect a mutation to another visit's bill. An unknown invoice 404s before any authorisation decision leaks that it exists.

### The page, and the honest part

`/billing/visits/:visitId` refuses unauthorised users with an explained Access Denied — it names what is restricted and where the person can still see the charges — rather than a silent redirect that reads as a broken link. The check runs **before** the data hooks, so an unauthorised browser never even requests the money; the live check asserts zero `/invoices` requests on that page.

`apps/web/src/core/billing-access.ts` mirrors the matrix for rendering, and is labelled in its own source as presentation only. A frontend test asserts the full expected table so a drift from the server fails a test instead of silently over-showing. **Hiding a button is not the rule; the 403 is.** Every denial in the verification below was measured by calling the API directly with a valid token, not by looking at the UI.

### What this closure is not

It is not a permission engine. There is no per-user override, no delegation, no policy store — one table, four actions, read at the point of use. Invoice calculations, panel rules and the billing UI are untouched: the totals check asserts the invoice still equals the sum of its own lines, and the panel/patient split still snapshots at pay time.

Claim submission and the panel workflow remain outside this closure, as instructed.

**Verification:** 54 invoice unit tests (the full 9-role × 4-action matrix, plus inactive staff, branch-from-stored-visit and unknown-invoice), 336 backend tests, 149 frontend tests, both typechecks clean, and `prisma/g3c-closure-billing-rbac-check.ts` — 25 checks against the real database, HTTP API and Chrome, including all five routes denied to a role with no billing rights, the doctor and front-desk boundaries on real accounts, a cross-tenant token, and the three UI states.

**Reversibility**: Low, and intentionally so. Removing this guard re-opens the money.

---

## D-067 — G4: a previous visit is read, not opened

Clicking a previous visit **replaced the current visit** in the workspace. Mid-consultation that could swap the record under an open editor, raise an unsaved-note prompt, interrupt prescribing, and leave the doctor unsure which visit they were documenting against. Reviewing history and working on a visit are different acts, and they now use different surfaces.

### What the audit found

| | Before |
|---|---|
| Canvas sidebar "Recent Visits" | click → `requestVisitChange` — guarded by the C1 prompt, but still destructive |
| Flow layout "Visits History" | click → `setSelectedVisitId` **directly — no guard at all**, so one click silently abandoned unsaved text |
| Data | `GET /visits?patientId=` — every visit, unpaginated, joining only `staff` and `queueTicket` |
| Summary content | none. No diagnoses, medications or documents to summarise a card from |
| Authorisation | tenant isolation via RLS only. **Neither `findAll` nor `findById` checked branch access or the patient/visit relationship** — any visit id in the tenant was readable by anyone who knew it |

So this needed both a new read path and a real guard, not a UI change.

### The read-only API

`/patients/:patientId/history` (paginated summaries) and `/patients/:patientId/history/:visitId` (one full visit). `VisitHistoryService` **has no create, update or delete method**, and a test asserts its method list — the read-only promise is enforced by there being nothing to call, not by hiding buttons.

Three checks, all fail-closed: the actor comes from the session; the visit's stored `patientId` must equal the one in the URL (mismatch → **404**, so probing another chart learns nothing); branch is checked against the visit's **own stored clinic**. On the list, branch becomes a Prisma filter rather than a post-filter, so unreadable visits are never loaded, never counted and never paged over — and a staff member with no branch in a multi-branch tenant matches nothing.

**Search is server-side** and reaches diagnoses, ICD-10 codes, medications, documents, doctor and complaint. A filter that returns nothing therefore means the clinic has no such record — not "not on this page". The count line says `10 shown of 14 matching` so the difference is never hidden.

### The current consultation is untouchable from here

Opening, expanding, filtering or closing history cannot change the current visit id, the patient context, the note, or any C1 draft key. History caches are keyed `['visit-history', …]`, disjoint from `['visits'|'clinical-notes'|'diagnoses', …]`, so a historical read can neither populate nor invalidate what the open consultation is reading. Measured live: the unsaved note is **byte-for-byte identical** after opening history, expanding several visits, viewing a clinical image, opening a full visit in another tab and closing the drawer — and **no database row is created or mutated** by any of it.

Several visits stay open at once, deliberately. Comparing two antibiotic courses, repeated MCs or a referral progression is the reason a doctor opens history, so this is not an accordion.

**Open Full Visit** targets `/history/patients/:patientId/visits/:visitId` in a new tab. A separate route rather than a read-only *mode* on `/patients/:id`: a flag can be lost, defaulted wrongly or forgotten by a future caller, and a different URL cannot become accidentally editable.

### Honest presentation

Every summary field returns null when the underlying value was never recorded, and the card renders nothing for a null — a blank "MC:" label would read as "we checked and there wasn't one". A diagnosis with no recorded priority says **"Priority not recorded"**, never "Secondary". Removed diagnoses and voided documents appear in their own blocks, never mixed into the live list with only a colour to tell them apart. MC and referral are shown as words, not colour alone.

### Not fixed here, found here

`VisitService.nextVisitNumber()` is `count(*) + 1`. Once **any** visit has been deleted the count falls behind the highest number in use and every subsequent `POST /visits` fails with a 500 on `visits_tenant_id_visit_number_key`. Reproduced in this cycle. G4 must not change current-visit workflows, so it is reported rather than patched — see the sign-off list below.

**Verification:** 23 new backend tests (386 total), 38 new frontend tests (187 total), both typechecks clean, and `prisma/g4-visit-history-check.ts` — 39 checks against the real database, HTTP API and Chrome at 1920/1366/900/375, on a patient with 13 previous visits, two doctors, a removed diagnosis, a weight-based paediatric course, ordered/in-progress/completed procedures with a result file, clinical images, an authorised MC, a referral, a memo, a voided MC, cash and panel invoices, and a legacy visit with no recorded attribution.

**Reversibility**: High for the UI; the history authorisation should not be reverted.

---

## D-068 — G4c1: a visit number is allocated, not counted

`VisitService.nextVisitNumber()` was `count(*) + 1`. It derived the next number from **how many rows exist** rather than **which numbers have been used**, which fails two ways:

- **Delete any visit** and the count falls behind the highest number in use, so the next create collides with a live row on `visits_tenant_id_visit_number_key` and surfaces as a raw 500. Reproduced during G4, where it forced the populated-history fixture to insert visits directly instead of through the API.
- **Two concurrent registrations** read the same count and produce the same number; the unique index rejects one of them.

### Scope, taken from the constraint rather than the method name

The only uniqueness the database enforces is `@@unique([tenantId, visitNumber])`, so the counter is keyed by **tenant** — not clinic, not global. A clinic-scoped counter would immediately produce duplicates inside one tenant. There is no year reset, and the visible format (`V-` + six zero-padded digits) is unchanged.

### The allocator

`visit_number_counters`, one row per tenant, incremented by a single statement:

```sql
INSERT INTO visit_number_counters (tenant_id, next_value, updated_at)
VALUES ($1, 1, now())
ON CONFLICT (tenant_id) DO UPDATE
  SET next_value = visit_number_counters.next_value + 1, updated_at = now()
RETURNING next_value
```

One statement matters: it takes a row lock and increments atomically, so concurrent registrations serialise on that row instead of racing a read-then-write. It runs **inside the visit-creation transaction**, so a failed insert rolls the increment back with it — no number is burned by a visit that never existed, and none is reissued because a visit was later deleted.

All three creation paths funnel through `VisitService.create()` — `POST /visits`, the front desk's `QueueTicketService.addToQueue()`, and `AppointmentService.arrived()` → `addToQueue()` — so there is one allocator and no second place to forget it.

A P2002 is translated into a `ConflictException`, never a raw 500, and triggers a bounded repair: the counter is advanced to the highest number actually in use, in its own transaction, and the create is retried. That path exists because numbers *can* be written outside the allocator — G4's fixture had to do exactly that — and it is exercised in the live check by planting a colliding row.

**Detection is measured, not assumed:** under the pg driver adapter Prisma raises P2002 with `meta.target` reported as "(not available)", so the first version of the guard never matched and the collision still surfaced as a 500. The check reads the constraint name where it exists and otherwise treats a P2002 from the visit insert as the visit-number conflict — `visits` carries exactly two unique constraints and the other is a server-generated uuid primary key.

### The migration bug this caught

The first version of the backfill **seeded nothing at all** and still looked correct. `tenants` and `visits` are `FORCE ROW LEVEL SECURITY` with policies keyed on `current_setting('app.tenant_id')`; a migration runs with that GUC unset, and FORCE means even the table owner is filtered. Every `SELECT` in the backfill returned zero rows. It was caught only because a tenant with 250 visits ended up with no counter row. The migration now lifts `NO FORCE` around the seeding step and restores `FORCE` afterwards — the same pattern the G3b-closure migration uses — and re-running can only raise a counter, never lower one.

Malformed legacy numbers (`DEMO-00001`, `LEGACY/2019/0042`) are ignored for seeding and **never rewritten**. A well-formed number too large for `INTEGER` aborts the migration rather than being silently skipped, because skipping it would let the counter reissue a number already in use.

**Verification:** 12 unit tests and 395 backend tests, 187 frontend tests, both typechecks clean, and `prisma/g4c1-visit-number-check.ts` — 21 checks against the real database and HTTP API with real concurrency: 20 simultaneous creations → 20 unique numbers, 50 → no duplicate, create-after-delete succeeds, a deleted number is never reissued, reads allocate nothing, the queue path advances the same counter, each tenant advances only its own, a planted out-of-band number is survived without a raw error, and a tenant with 250 visits (216 of them malformed) seeded to its true highest, 270.

**Reversibility**: Low. Reverting restores a numbering scheme that breaks after any deletion.

### Hardened after review (same checkpoint)

Three points were tightened once the allocator was reviewed against its own brief:

- **The six-digit ceiling is now enforced.** `V-999999` is the last number the format can hold; the next allocation is refused with a named error rather than silently widening every printed number to seven digits. The transaction rolls back, so the counter stops AT the ceiling and a clinic can be migrated to a wider format deliberately.
- **Retry is bounded to exactly one repair.** A collision can only mean the counter is behind a number written outside the allocator; the repair advances it past everything in use, so a second failure is something this code cannot reason about and surfaces as a controlled error instead of looping.
- **Conflict classification is now specific.** It matches `visits_tenant_id_visit_number_key` by name — read from the nested driver error, where the pg adapter actually keeps it — instead of treating any unidentifiable P2002 as a numbering problem. An unrelated unique violation is never silently retried.

**Still count-based elsewhere, and reported rather than changed:** `InvoiceService` (`INV-`) and `ClaimBatchService` (`CLAIM-`) both derive their next number from `count(*) + 1`, and `QueueTicketService` does the same for its daily per-clinic ticket number. All three carry the same class of defect this checkpoint fixed for visits. They were out of G4c1’s scope; the allocator built here is directly reusable for the first two.

---

## D-069 — G4c1 closure: a foreign key accepting an id is not permission to use it

G4c1's own verification found it by accident: a token for one tenant created a visit using **another tenant's `patientId`**, and the API accepted it. Three such rows existed in the dev database before this closure removed them.

### Why row-level security did not stop it

RLS filters **reads**. A foreign key is enforced **below** RLS, at the storage layer, and does not care which tenant is asking — so `INSERT … patient_id = <foreign uuid>` simply succeeded. The result was a visit owned by tenant A whose patient was invisible to tenant A: unreadable in the workspace, unjoinable in history, and silently corrupting any per-patient count.

`VisitService.create()` wrote `dto.patientId`, `dto.clinicId` and `dto.staffId` straight into the row. Nothing resolved them first, and the foreign key's acceptance was doing duty as an authorisation check.

### What it does now

Inside the same tenant transaction that allocates the number, **before** anything is written:

1. `requireActor` — a visit cannot be created without an authenticated staff session.
2. `resolvePatient` — looked up on the tenant-scoped transaction; absent → **404 "Patient not found"**.
3. `resolveClinic` — same, then the project's existing `hasBranchAccess` rule → **403** when the actor is not authorised for that branch.
4. `resolveAttendingStaff` — exists in this tenant, is `active`, and is authorised for the visit's branch.
5. Panel, then number allocation, then the insert — **using the resolved rows, not the request values**.

A rejected request therefore allocates nothing: the counter is untouched across every failure path, measured live.

**The response cannot be used to probe.** "Belongs to another tenant" and "does not exist" are the same code path and the same message, because RLS makes a foreign row genuinely absent rather than forbidden. The check asserts the two responses are byte-identical.

### What is deliberately NOT enforced

The attending staff member is **not** required to hold a clinical role. D-044 established that a walk-in is registered before anyone knows which doctor will see the patient, and the Queue's call step reassigns `visit.staffId` later. Requiring a doctor here would break front-desk registration. What is enforced is what the record must be able to claim: the person exists, is active, and belongs to that branch.

`Clinic` has no `active` column in the current schema, so there is no activation state to check. Nothing was invented to fill the gap.

### The other two paths

`QueueTicketService.addToQueue()` delegates to `create()` and so inherits every rule — proven live: a cross-tenant `patientId` on `POST /queue-tickets` returns the same 404. `AppointmentService.arrived()` reads patient, clinic and doctor from the **stored appointment** and passes only the appointment id from the client, so there is no id to inject; it was still exercised end to end.

**Still open, and reported rather than fixed:** `AppointmentService.create()` has the same shape of defect — it writes `dto.patientId` and `dto.clinicId` without resolving either. Its booking validator checks doctor qualification, schedule and capacity (all tenant-scoped), but never the patient or the clinic. Fixing it is a separate checkpoint; this closure was scoped to visit creation.

**Verification:** 26 unit tests on `VisitService` (409 backend, 187 frontend, both typechecks clean) and `prisma/g4c1-closure-visit-integrity-check.ts` — 16 checks against the real database and HTTP API across two tenants: the original cross-tenant abuse now 404s, unknown and cross-tenant are indistinguishable, cross-tenant clinic and staff are refused, an inactive staff member is refused, no rejected attempt consumed a visit number, no Prisma or foreign-key text reaches the client, the queue and appointment paths both go through the same validation, no cross-tenant row survives, and creation remains safe under concurrency.

**Reversibility**: Low. Reverting re-opens cross-tenant visit creation.

---

## D-070 — S1: the same trust boundary, applied to appointment booking

The D-069 audit found `AppointmentService.create()` carrying the same defect visit creation had: it wrote `dto.patientId` and `dto.clinicId` straight into the row. The booking validator did real work — active doctor, service qualification, roster, leave exceptions, overlap, slot capacity — but never asked whether the **patient** or the **branch** belonged to the caller. A foreign key is enforced below row-level security, so an appointment could be booked against another tenant's patient.

### One copy of the rules, not two

The resolvers were extracted from `VisitService` into `clinical-references.ts` and are now used by both. Two implementations of a tenant boundary is how one of them quietly becomes the weaker one, so `VisitService` was refactored onto the shared helpers in the same change rather than left with a private copy.

Booking now resolves, inside one tenant transaction and **before** the validator runs or any row is written:

| Reference | Rule | Failure |
|---|---|---|
| Session | authenticated staff required | 403 |
| Patient | visible in this tenant | 404 |
| Clinic | visible in this tenant + actor branch access | 404 / 403 |
| Doctor / staff | visible, `active`, authorised for that branch | 404 / 400 |
| Service | visible in this tenant, still active | 404 / 400 |

The row is then written from the **resolved** entities, never the request values.

### What was deliberately left alone

Every existing booking rule still runs, unchanged and in the same order relative to each other — qualification, roster, exceptions, overlap, capacity. Reference resolution is a gate in **front** of them, not a replacement for any. The appointment UI, calendar, schedules, capacity, reminders, status lifecycle and the arrival-to-queue behaviour are untouched. Non-disclosure matches D-069: a foreign id and an unknown id return the identical 404.

**Verification:** `prisma/s1-appointment-integrity-check.ts` — 16 checks against the real database and HTTP API across two tenants. Cross-tenant patient, clinic, staff and service all refused; cross-tenant and nonexistent indistinguishable; inactive doctor refused; anonymous refused; **no appointment row and no queue ticket survives any rejected attempt** (11 → 11 tickets across 6 rejections); no Prisma or database text in any response; overlap still 409 and qualification still 422; and arrival still creates a visit through the approved allocator (`V-000335`). 411 backend tests, 187 frontend, both typechecks clean, zero fixture residue.

**Reversibility**: Low. Reverting re-opens cross-tenant appointment booking.

---

## D-071 — G4.5: the clinical work is on screen, not behind a reveal

The C2 workspace showed Diagnosis, Medications, Orders/Procedures and Direct Services as collapsed rows below the clinical note. Reading what a patient was already on took a click; so did seeing whether a lab had come back. Worse, the "+ Add Diagnosis" button on a collapsed section did not add anything:

```
primaryAction={{ label: '+ Add Diagnosis', onClick: () => !expanded && onToggle() }}
```

It expanded the section. Every clinical action therefore started with a click that revealed rather than did, and the doctor could not see the state of the visit without four of them.

### The shape

Two zones, not one column of accordions:

| Zone | Holds | Why |
|---|---|---|
| Left (`.kw-canvas-main`) | recorded vitals, this visit's images, the clinical note | what the doctor **writes** |
| Right (`.kw-canvas-rail`, 420–480px) | Diagnosis, Medications, Orders/Procedures, Direct Services | what the doctor **does** |

The rail took the width the C2 right column used for patient summary, allergies and recent visits. Those did not disappear: allergies moved into the context band, because they change what may safely be prescribed and belong where prescribing is decided; recent visits became the G4 read-only history drawer; the rest is behind one Patient Summary control.

**The rule that decides every number:** the note never shrinks to make room for the rail. The benchmarked reference CMS did the opposite — it refused to scroll, so at 1366 the note collapsed to seven lines while a free-text sidebar kept twice that height. Here the rail truncates its previews to "View all N" and the page scrolls once. Measured: the editor is **520px at 1920** and **445px at 1366**, against a 420px floor.

### Always open, and no scroller inside a scroller

`RailPanel` has no collapsed state and no toggle. Preview limits are 4 diagnoses / 5 medications / 4 orders / 3 services; beyond that, "View all N" expands **in place** and lets the page grow. There is deliberately no internal scrollbar — a scroller inside a rail beside a scrolling page is the trap G0a removed, and it hides clinical content behind a gesture nobody makes.

Verified rather than asserted: `collapsedHeadersInRail` is **0** at all four viewports, on a fully populated visit.

### Density is spacing, never information

Getting all four panels with their Add controls into a 1920×1080 first screen took ~100px. It was taken from chrome, not content:

- the Canvas/Flow switch had its own 38px row; it now rides in the context band (Flow keeps its row)
- rail line-height 1.57 → 1.32 — the 13px name and 12px detail text sizes are unchanged
- panel and row padding tightened; diagnosis attribution moved into a tooltip on the name

Attribution is server-derived and legally meaningful, so it stays reachable — but a line of it on every row across four panels was exactly the height that pushed Direct Services off the first screen.

### What was deliberately not done

Prescribing is **not** reduced to one click. The full workflow — item search, weight- and age-based calculators, copy-previous, dispensing, labels, every existing validation — is the unchanged `MedicationsTab`, opened in a Drawer. Dose, frequency, duration and quantity remain deliberate clinical decisions. What was removed is the reveal-only click in front of them. Every mutation still goes through the same hooks the section bodies used, so the one-active-PRIMARY invariant, the mandatory removal reason and the audited removal history are untouched.

Direct Services get no Start/Complete control. The backend still creates `STANDARD_SERVICE` with a `PENDING` lifecycle it does not need; showing task-style buttons on a billing line would make the UI assert something the model does not mean. Correcting the lifecycle is G4.5s, not this change.

`ClinicalSectionStack` and the four `*SummaryCard` components remain in the tree, unreferenced, as the rollback path. Only one layout is ever public.

### Smaller screens

Below 1100px the shell becomes one column in clinical reading order, every panel still open. Two real defects were found and fixed there: `align-items: flex-start` is correct in row direction (it stops the rail stretching to the note's height) but means shrink-to-content **width** once the shell is a column, which left the note 125px narrower than the rail on a 900px tablet; and the `.kw-quick-nav` base rule was declared after the mobile block at equal specificity, so source order silently won and the phone nav rendered at zero height.

On phones a sticky quick-nav (Note / Diagnosis / Medications / Orders / Services) moves the viewport between the five surfaces. It uses `scrollIntoView`, not a hash link — a hash pushes a history entry and C1's unsaved-note guard keys on navigation, so moving the viewport must never look like leaving the record. It opens and closes nothing.

**Verification:** `prisma/g45-canvas-verify.ts` against a populated visit (V-000338: 4 diagnoses, 5 medications, 3 orders in three states, 2 services, 2 images, full vitals) at 1920×1080, 1366×768, 900 and 375.

| | 1920 | 1366 | 900 | 375 |
|---|---|---|---|---|
| All 4 panels + Add controls in first screen | **yes** | no (768px tall) | n/a | n/a |
| Editor height | 520px | **445px** | 300px | 300px |
| Collapsed headers in rail | 0 | 0 | 0 | 0 |
| One column, equal widths | — | — | **yes** | **yes** |
| Horizontal overflow | none | none | none | none |
| Controls under 44px | — | — | — | **0** |
| Editable text size | — | — | — | **16px** |

All five quick-nav jumps land their target at the top of the screen (Services at the page's scroll end, which is the correct outcome for the last section). 411 backend tests, 187 frontend, both typechecks clean.

**Reversibility**: Moderate. The rollback components are still present; reverting restores the reveal-click workspace.

---

## D-072 — G4.5 closure: reachable attribution, legible clinical text, and a sticky bar that hides nothing

Three corrections to the accepted Canvas, plus a governance decision about the review fixture.

### Attribution was mouse-only

D-071 moved diagnosis attribution into a tooltip on the diagnosis name, to buy back the height that pushed Direct Services off the first screen. That was the right trade for density and the wrong one for access. A tooltip on a plain `<Text>` has no focusable trigger: unreachable by keyboard, unreliable on touch, invisible to a screen reader. Legally meaningful information was available only to someone holding a mouse.

`AttributionInfo` is a real `<button>`. It shows who added the diagnosis, when, and — for rows predating G2a — says so in those words rather than inventing an "Unknown" author. The permanent per-row attribution line is **not** restored, and nothing here sends an actor, name or role to the API; it renders the server-written snapshot only.

The whole attribution is also written into `aria-label`, so a screen reader announces it without opening anything. The popover is a visual convenience, not the only channel.

**The trigger combination took two wrong attempts.** `click` toggles, and every pointer interaction that clicks also focuses — so with `focus` in the list, focus opened the popover and the click that caused it closed it again. On a phone that reads as a dead control; with a mouse it flickers. `['hover', 'focus']` has one opening rule per input method and no toggle: mouse hovers, keyboard tabs, a tap focuses. Clicking elsewhere blurs it shut.

Measured: reached in **2 tab presses**, opens on focus alone (no activation key to guess at), 24×20px at desktop and **44×44px on a phone**, and a tap opens it.

### Nothing clinically important below 12px

Computed sizes were read from the live page rather than from the source — an inline `fontSize` can be overridden by a class, and what matters is what the screen renders.

| | Before | After |
|---|---|---|
| Panel heading | 13px | **14px** |
| Diagnosis / medication / order / service name | 13px | **14px** |
| ICD-10, priority, dispensing status, order status, billing state | 12px | 12px |
| Medication strength, dose, frequency, duration, quantity | 12px | 12px |
| Medication remark and calculation note | **11px** | **12px** |
| Order instruction and result line | **11px** | **12px** |
| Search and add controls (desktop) | 14px | 14px |
| Editable controls (phone) | editor 16px, **search 14px** | **all 16px** |

The phone search box was the one that mattered: at 14px iOS zooms the whole page on focus, landing the doctor on a shifted layout mid-search. antd v6 sets 14px on `.ant-select .ant-select-input`, which out-specifies a bare `.kw-rail-add input` — the rule had to be matched at the same depth to win.

**This costs the 1920 first screen, as the owner authorised.** Direct Services' second row now sits 57px below the fold. Every panel heading and **all four Add controls remain in the first screen**, as does every row of Diagnosis, Medications and Orders. Readability was the priority; the note height was not touched.

### The sticky quick-nav was covering its own destinations

Tapping "Medications" put the first prescription at the top of the screen with the heading and the Add control behind the strip. Fixed with `scroll-margin-top`, not a hash link — a hash pushes a history entry and C1's unsaved-note guard keys on navigation.

The reserve is **148px, not the bar's own 56px**: the app header is sticky too, so by the time a jump settles the quick-nav's bottom edge sits at ~129px. That was measured, not assumed — a 64px first attempt still left every heading partially covered and the Note card entirely behind the bar. Overshooting leaves a little whitespace; undershooting hides the heading, which is the failure this exists to prevent.

All five destinations now report heading, Add control and first row **clear**, with screenshots in `docs/g45-screenshots/g45-quicknav-*.png`.

### Three cascade and scoping bugs found in the process

1. `.kw-attribution-btn` was declared **after** the mobile block at equal specificity, so source order won and the phone target stayed 24px wide. Same class of bug as the quick-nav one in D-071; both base rules now sit above the media query with a comment saying why.
2. Removing that misplaced block left an **unterminated CSS comment** which swallowed `.kw-rail-row-actions { flex: 0 0 auto; }`. The actions column then stretched to 458px inside a 480px rail, crushing the content column to 182px and inflating rows to 81–97px. It presented as "the font increase broke the layout" and was nothing of the kind. `index.css` is now checked for comment termination and brace balance as part of verification.
3. The verification harness itself claimed the touch target was fine while `page.touchscreen.tap` was silently unusable — the browser context had no `hasTouch`. A tap test that cannot tap passes everything.

### Fixture governance

Populated visit **V-000338** is kept for Dr Redha's visual review and is **not** deleted here.

| Requirement | State |
|---|---|
| Tagged as test data | Patient name is `KUWICK-FIXTURE G45 Canvas Patient`, visible in the record header |
| Development tenant only | Present in Smoke Test Tenant only, on a local database |
| In a cleanup ledger | `prisma/g45-fixture-retire.ts`, dry-run by default |
| Excluded from production | No `prisma.seed` block, no seed script, and no reference to `g45-*` anywhere outside its own two files. Verified, not assumed |

`sweepOrphanedFixtures` matches on the presenting complaint, which cannot find this record: `g45-canvas-populate.ts` writes a real complaint ("Fever and cough for 3 days") because a reviewer has to read a realistic record. Retirement therefore keys on the **patient name** tag, and refuses any prefix that does not start with `KUWICK-FIXTURE`. It reuses the same `visitDeleteStatements` ordering as the per-run ledger and the orphan sweep, so a third deletion path cannot drift from the other two.

**Deterministic reset** is retire-then-rebuild. The rebuilt visit takes the next number, not V-000338 again: the allocator is monotonic by design (D-068), and reusing a retired number would re-introduce the bug G4c1 fixed.

The ledger also surfaced **two partial records (V-000336, V-000337)** left by earlier populate runs that failed mid-way. They are debris, not the review record; they are reported and left in place because the instruction was to delete nothing before review. `--confirm` retires all three.

**Verification:** `prisma/g45-canvas-verify.ts` at 1920×1080, 1366×768, 900 and 375. 411 backend tests, 187 frontend, both typechecks clean.

**Reversibility**: Low. Reverting returns attribution to mouse-only.

---

## D-073 — G4.5s: a direct service is not a task, and the server is what says so

`STANDARD_SERVICE` and `TASK_ORDER` share the `OrderService` model, which is right — they are both "something added to a visit that may be charged". What was wrong is that they shared a *lifecycle*. A consultation fee was created `PENDING` and offered Start and Complete, as though a member of staff were going to perform it and report a result.

G4.5c hid those controls in the Canvas. Hiding a control is not a rule, and this decision is about the rule.

### What the audit found, before any change

| | Rows | Ever charged |
|---|---|---|
| `STANDARD_SERVICE` PENDING | 4 | **0** |
| `STANDARD_SERVICE` COMPLETED | 1 | **0** |
| `TASK_ORDER` COMPLETED | 114 | 108 |

**Not one direct service in the database had ever reached an invoice.** That is not a coincidence, it is the defect's financial consequence: the Quick Add suggestion list filtered on `status: 'COMPLETED'`, a direct service was created `PENDING`, and the Canvas correctly refuses to Start or Complete it. So the only route to billing a consultation fee was to walk it through a task workflow that means nothing for it.

The audit also found **one order already charged twice, on a PAID invoice**. Client-side duplicate filtering being insufficient is not a hypothesis here.

### The corrected creation rule

`OrderServiceService.create()` now branches on the **stored** `orderType` snapshotted from the catalogue — never on the service's name, because a "General Consultation" configured as a `TASK_ORDER` is still a task:

- `TASK_ORDER` — untouched. Created `PENDING`, no completion time, full Start → Complete workflow.
- `STANDARD_SERVICE` — created `COMPLETED` with `completedAt` set. Adding it to the visit *is* the delivery event.

`COMPLETED` is a reuse of the existing enum rather than a new state, as instructed. It reads slightly oddly for a consultation fee, which is noted as an open item below.

`/start` and `/complete` now refuse a `STANDARD_SERVICE` outright — including a *legacy* one sitting at `PENDING`, which must not become startable just because its status happens to match the old rule.

### Invoice linkage: option B, not A

The existing approved mechanism (Phase A8) is the biller's Quick Add, which applies panel price overrides and exclusion checks at add time. Auto-creating a line on service-add would need an invoice to already exist, would bypass the override selection, and would have a clinical action create a charge — against G3c, where the doctor reads the money and the biller moves it.

So: **no second charge mechanism**. What changed is one filter. Billable now means *a task order that is finished, or a direct service that has not been cancelled* — which also makes the 4 legacy `PENDING` rows chargeable without rewriting them.

### Duplicate charge prevention, and why not a unique index

A `UNIQUE` index on `source_order_service_id` is the stronger tool and is deliberately **not** used: creating one would fail against the existing duplicate, and clearing that means editing a paid invoice's lines and total. That is a business decision, not a migration.

Instead `addLine` locks the source row `FOR UPDATE`, then checks for an existing line **across all invoices** (charging the same service on a second invoice is the same double-charge wearing a hat), then inserts — all in one tenant transaction. The lock is what makes it correct rather than merely likely: without it two concurrent adds both read "no line" and both insert. Verified live: four simultaneous adds produced **one** line.

Freehand lines with no source id are never blocked — two identical sundry lines are a legitimate thing for a biller to enter.

### Cancellation

The old rule refused to cancel anything `COMPLETED`. Correct for a task order — a performed procedure with a result cannot be un-performed — but it would have made every direct service *permanently uncancellable*, since they are now created `COMPLETED`. A mis-added consultation fee could never be taken off the visit. So `COMPLETED` blocks cancellation for `TASK_ORDER` only.

Money is the harder constraint and is deliberately not resolved by this route. If the service has reached an invoice, cancel is refused with a `409` **naming the invoice**. Removing a line stays the biller's existing, authorised, UNPAID-only route (D-066); a paid invoice is never mutated as a side effect of a clinical action. The row is never hard-deleted, stays visible on the visit, and is labelled `Cancelled` with its reason.

### Existing records: left alone

4 `PENDING` and 1 `COMPLETED` direct service exist. **None were rewritten.** A `PENDING` legacy row could be argued into `COMPLETED` with `completedAt = requestedAt`, but that asserts a delivery time nobody recorded, and the instruction was not to fabricate completion times. They are chargeable as they stand, they cannot be started, and the Canvas shows them correctly. New rows follow the corrected rule.

The one direct service carrying a free-text result (`"Vitals stable, no acute findings."`) is historical truth from when the task workflow was reachable. It is kept, not scrubbed.

### Reporting and queue

`procedureQueue` already filtered to `TASK_ORDER` — now covered by a test so it cannot regress. No report counts `OrderService` statuses (`getAppointmentAnalytics`'s `completedRate` is Appointments, not services), so nothing inflates a pending-procedure figure. Invoice source linkage is unchanged, so a direct service remains identifiable as the origin of its charge.

**Verification:** `prisma/g45s-direct-service-check.ts` — 40 checks against the running API across two tenants, all passing, zero fixture residue. `prisma/g45s-direct-service-audit.ts` is report-only and re-runnable. 428 backend tests (up from 411), 187 frontend, both typechecks clean.

**Reversibility**: Moderate. New `STANDARD_SERVICE` rows are created `COMPLETED`; reverting leaves them correct but resumes creating new ones `PENDING`.

---

## D-074 — S2: the last endpoint that took an id on trust

`OrderServiceService.create()` read the visit and the catalogue entry through the tenant-scoped client and wrote immediately. RLS meant a foreign tenant's visit came back empty, so cross-**tenant** creation already failed. Nothing checked the **branch**.

A staff member authorised only for Branch A could add a procedure — or a chargeable direct service — to a Branch B visit by naming its id. Same defect D-069 closed for visit creation and D-070 for appointment booking, on the third and last endpoint that had it.

### The gate

Everything resolves inside one tenant transaction, before anything is written:

| Reference | Rule | Failure |
|---|---|---|
| Session | authenticated staff required | 401 |
| Visit | visible in this tenant **and** actor authorised for its stored branch | 404 / 403 |
| ServiceCatalog | visible in this tenant | 404 |

`assertMayTouchVisit` is the project's existing central guard, not a local restatement: it loads the visit's own `clinicId` and checks it against the actor's branch context. The browser's idea of tenant, clinic or branch is never consulted — only the visit id, which is then resolved. The row is written from the resolved visit (`clinicId`, `staffId`) and the resolved catalogue entry (`code`, `name`, `orderType`).

Both order types go through the identical gate. A direct service is chargeable, so "it is only a service" is a reason for more care, not less.

`VisitService` was dropped from the constructor — creation no longer uses it, and an injected dependency that nothing calls is a misleading signal.

### What was deliberately not changed

Orders and Direct Services are not redesigned. The stored `orderType` still decides the created state (D-073), Start/Complete/Cancel are untouched, and the Procedure Queue filter is unchanged.

### Two harness mistakes worth recording, because both were real damage

**A security check must not reshape what it measures.** The first version of the live check created a second clinic when the tenant had only one, so that a cross-branch case would exist. Adding a branch flips a tenant from single- to multi-branch, and every staff member with a null home clinic and no explicit grant instantly loses access to everything — including the doctor the script was running as. The clinic was removed and the tenant restored. The check now seeds two fixture doctors into a tenant that is *already* multi-branch, which changes nobody else's access, and skips loudly if no such tenant exists.

**A cleanup that cannot see its own rows deletes nothing and says nothing.** The seeded `service_catalog` rows were removed with only `app.bypass_tenant_scope` set. That table's policies key on `app.tenant_id` (the D-048 family), so the DELETE matched no rows, raised no error, and left a fixture row behind. A residue check run the same way *also* read zero and confirmed the false result. Both now set `app.tenant_id`, and cleanup re-reads and reports what remains rather than asserting success.

**Verification:** `prisma/s2-order-branch-check.ts` — 18 checks against the running API, all passing, residue verified zero. Authorised branch succeeds for both types; unauthorised branch refused **403 for both**; foreign and nonexistent visits return an identical non-disclosing 404 with no database wording; foreign and unknown catalogue entries refused; order count unchanged across every rejection; no invoice line and no queue task from a rejected request; TASK_ORDER Start/Complete unchanged; D-073 direct-service behaviour unchanged; unauthenticated and forged-token calls refused 401.

11 new unit tests. 439 backend tests (up from 428), 187 frontend, both typechecks clean.

**Reversibility**: Low. Reverting re-opens cross-branch order and service creation.

---

## D-075 — G4.5d: the Visit Completion Bar

Documents and the invoice are how a GP consultation *ends*, and both were collapsed rows at the very bottom of the record. Writing an MC — one of the most frequent actions in general practice — meant scrolling past the whole note and expanding a section.

A compact strip now sits immediately below the patient context band: the active document count and the latest one, `+ MC`, `+ Referral`, `More Documents`; and read-only invoice number, total, status and cash/panel with `Open Invoice`.

### What it is not

A summary and entry points, not a second workspace. The Documents Workspace and the invoice do **not** move into the clinical rail — that stays Diagnosis, Medications, Orders, Direct Services — and the bar carries **no money-mutating control**: no Pay, no Cancel, no Quick Add, no line editing. Those stay on the billing surface behind the billing RBAC (D-066). A payment button in the clinical band is exactly the confusion G3c removed.

### One creation path

Both quick actions open the **same** `CreateDocumentDrawer` the workspace opens, via a new optional `initialType`. Same templates, same validation, same G3b authorisation. The drawer's existing reset-on-open now resets the type too, so a quick action always lands where it says it will.

`SecondarySections` became optionally controlled so the bar can expand and scroll to the full surface. `scrollIntoView`, not a hash — a hash pushes a history entry and C1's unsaved-note guard keys on navigation (the D-072 rule).

### Honest about absence

No invoice reads "No invoice created", never RM0.00 — a zero total reads as a bill for nothing when the truth is there is no bill. Several invoices show a count. Voided documents are never counted as active.

**Measured before any scrolling:** bar present and all four buttons in the first screen at 1920/1366/900/375; zero money-mutating controls; zero buttons under 44px on mobile; no overlap with the sticky quick-nav; no horizontal overflow; editor height unchanged at 520/445/300/300.

---

## D-076 — G4.5d2: the Last Visit Snapshot

A GP's first question is almost always "what happened last time?", and the answer was behind the Previous Visits drawer. The snapshot puts the headline on screen: when, who, what for, what was found, what was given, what was issued, what it cost.

### Read-only by construction, not by intention

It renders from `useVisitHistory` — the G4 hook that contains no mutation and whose cache keys are namespaced to `visit-history`, so nothing here can write and nothing here can invalidate the current visit's caches out from under an open consultation. It does not touch the selected visit id, the URL, or the C1 draft key. "View History" opens the same approved G4 drawer. Click-to-switch is **not** restored.

### Data: the existing summary, extended

No new endpoint. `VisitHistoryService`'s summary gained `invoices`, `panelName` and `memo` — the patient and branch checks already on that route cover them, and a second route would be a second place to get them wrong.

Invoices are exposed as a **list, never a total**. No visit-level total is stored, so combining several would be inventing a figure; the snapshot says "2 invoices" instead. Tests assert the payload has no `invoiceTotal`, `totalAmount` or `amountDue` field at all, so there is nothing for a UI to render as RM0.00.

### Honest missing-data handling

Every field is a stored value. Where one is absent the snapshot says *"Complaint not recorded"*, *"Diagnosis not recorded"*, *"Medication details not recorded"*, *"Attending doctor not recorded"*, *"No invoice created"* — never "None", "Normal" or a zero.

The one that matters most clinically: a diagnosis is labelled **Primary only when the priority was explicitly recorded as PRIMARY** (the summary's `isPrimary`). Being first in the list is not evidence of anything — G2a made "priority not recorded" a real state and the snapshot respects it.

### Seeded history

`prisma/g45d2-history-populate.ts` builds a patient with six previous visits and one open current visit with no saved note, covering: full well-recorded case (MC 2 days, cash PAID, 3 medications → "+1 more"); panel UNPAID with an ENT referral; a memo instead of an MC; three diagnoses with a 1-day MC; no document at all; and a legacy record with no recorded priority, no medication and no invoice. Different attending doctors, cash and panel.

Every visit is created through `POST /visits`, so all six use the approved monotonic allocator (D-068) — no visit number is written directly and none is reused. Only `check_in_at` is backdated, so the history reads as a real timeline while every row was still written through the API's own rules.

Retirement is the existing `g45-fixture-retire.ts`, whose prefix was widened to `KUWICK-FIXTURE G45 ` so it covers both review patients. Dry-run by default; `--confirm` retires; deterministic reset is retire-then-repopulate.

### C1 and current-visit safety, measured

Typed an unsaved 58-character draft, opened the History drawer, closed it:

- the unsaved note is **byte-for-byte unchanged**
- the URL is unchanged and still carries the current visit id
- no unsaved-note prompt appeared
- **no database row was created or removed** across the whole review (visits, notes, diagnoses, prescriptions, documents and invoices counted before and after)

### One thing the checks caught

The band labels were 11px. That is below the floor D-072 set for clinical text, and these labels sit beside clinical text and are read in the same glance — raised to 12px on both the snapshot and the completion bar.

**Verification:** `prisma/g45d2-snapshot-verify.ts` — 30 checks at 1920×1080, 1366×768, 900 and 375, all passing: correct visit selected, date/time/number/doctor/complaint/diagnosis accurate against the backend, Primary label only when recorded, at most two medications with an accurate "+N more", MC and referral summaries accurate, invoice total and status matching stored values, panel named, no horizontal overflow, no text below 12px, 44px View History on mobile, cross-tenant history refused 404, unauthenticated refused 401.

444 backend tests (up from 439), 187 frontend, both typechecks clean.

**Reversibility**: Low for both. Neither changes stored data; the bottom Documents and Invoice sections remain for rollback.

---

## D-077 — G4.5d3: the Clinical Canvas as a product, not a page

The functional work was accepted; this is the visual and workflow closure against the approved mockup. Three of the changes are data-semantic corrections, not styling.

### The attending clinician was mislabelled, not mis-sourced

The fixture put a **nurse** in the attending position and the band printed `DR` above her name. Two separate faults:

- **The source was always right.** Both the band and the history summary read the visit's own stored `staffId → staff.fullName/role`. Nothing consulted the record creator, the registrar or "the first staff member the tenant returned".
- **The wording was wrong.** `attendingClinician()` now follows the stored ROLE: a doctor is `Dr Amira Rahman`; anyone else is `Attending clinician: Amy Tan` with no title; nobody stored is `Attending clinician not recorded`. Stored `Dr.`/`Dr` prefixes are stripped and re-applied once, so `DR Dr. Amira Rahman` is gone.
- **The fixture was wrong.** The seed now selects from active DOCTOR roles only and *throws* if the tenant has none, rather than quietly using a nurse.

### One clock

`17:19` in the band and `1:19 AM` in the snapshot were on the same screen. `clinicTime.ts` is now the single formatter — `3 Aug 2026 · 17:19`, 24-hour. Kuwick stores no per-tenant IANA timezone, so rendering is the browser's zone; inventing one would assert a fact the database does not hold. When that field exists, three functions change.

### Design tokens, not painted components

`:root` custom properties carry navy/teal, surfaces, text and the five status PAIRS. Anything hard-coding navy inside one component becomes the next inconsistency, so the tokens are declared once and can carry the rest of the app. Navy for primary actions; teal for clinical emphasis (a recorded Primary, a delivered service); **red reserved** for allergy and destructive confirmation. Every status chip renders its word — colour never carries meaning alone.

### Duplication removed

- **Vitals appeared twice** — the Canvas strip *and* `VisitObservationsPanel`. The strip is now the single compact component and owns `Record / Edit`; the full panel appears only when expanded. Flow is untouched.
- **Attachments** rendered a large empty placeholder. Empty is now one row: `Attachments 0  [Upload]`.
- **Previous Visits** existed twice — a band button and the snapshot's View History. The band button is gone; the freed space became **Patient Summary**, which desktop never had.

### Action hierarchy

One primary action per row, everything else behind More: Diagnosis keeps Set Primary (Remove → More), Medications keep Dispense (Cancel → More), Orders show only Start / Complete / View Result. Every confirmation, reason requirement, permission and audit rule is unchanged — a red button on every row made destruction the most eye-catching thing in the panel.

### Completion bar states

The label matches the state: `No invoice created → Open Billing`, one invoice → `Open Invoice`, several → `View Invoices`. The earlier version offered "Open Invoice" beside "No invoice created", promising to open something that does not exist. Several invoices now show a **count only** — the previous combined total was this component's invention.

### History drawer

`Billing: Cash` became `Invoice RM85.00 · Paid · Cash` / `RM120.00 · Unpaid · Panel AIA`, from data already in the payload. Several invoices → a count, never a sum.

### Two defects the screenshots caught

1. **The floating chat button sat on top of an order's "View Result"** at 1920 — not only on mobile as first assumed. It is hidden inside the Clinical Workspace at every width; chat remains in the global header.
2. **The mockup composes the snapshot and completion bar as ONE strip.** Stacking them cost ~50px of the first screen, which is what pushed Direct Services out of view. Side by side above 1500px, stacked below.

**Verification** on one professional review patient (`KUWICK-FIXTURE G45 Professional Canvas`): current visit with 4 diagnoses, 5 medications, 3 orders across all three states, 2 direct services, MC + referral, invoice, 2 images, vitals, and no saved note; plus 6 previous visits covering panel/cash, paid/unpaid, MC/referral/memo/none, and one legacy record with no recorded priority.

32 snapshot checks and the four-viewport Canvas measurement pass: editor unchanged at 520/445/300/300, no horizontal overflow anywhere, no clinical text below 12px, zero money-mutating controls in the completion bar, no quick-nav overlap, cross-tenant history 404, unauthenticated 401, and the unsaved note byte-for-byte identical across opening History.

444 backend tests, 191 frontend, both typechecks clean.

**Reversibility**: Low. No stored data changes; the tokens and components are additive.

---

## D-078 — G4.5d3b Part A: a view switch destroyed unsaved clinical text

Found by the mandated pre-implementation audit of the existing Flow view, before any Flow work began.

`ClinicalNotesTab` seeds a blank draft on mount. `initialisedFor` is a **ref**, so a remount re-runs the effect — and switching Canvas ↔ Flow remounts the component. On a visit with no saved notes, the blank seed landed on top of text the doctor had already typed, because `syncFromServer` replaces `drafts[key]` unconditionally.

**Measured: 61 characters of unsaved clinical text became 0 on a single view switch.** No prompt, no warning, no recovery — and the doctor's next action would have been to keep typing into an editor that had silently discarded their assessment.

The fix is one guard: **seed, never overwrite.** If a draft already exists at the blank key, the effect returns without touching it. Saved-note loading is unchanged.

This is the reason a "presentation-only" toggle got an audit before being offered as a clinic default. A layout preference that can destroy an unsigned clinical note is not a presentation change.

**Reversibility**: Trivial. One early return.

---

## D-079 — S3: the queue was completely unauthenticated

Part L found that every queue mutation route — create, call, arrived, move-to-dispensary, complete, cancel — had **no authentication, no role check and no branch check**. Anyone who could reach the API could register an arrival, call a patient to a room, silently reassign the attending doctor on someone else's visit, or close a visit. The Queue screen's buttons were the only thing standing in the way, and a button is presentation.

### Every route now passes one gate

`authoriseTicket` resolves the actor from the verified session (`requireActor`), checks the action against `QUEUE_MATRIX`, reads the ticket under the tenant, and checks branch access against the **visit's stored clinic** — the same authority G3c, S1 and S2 use. A foreign ticket reads back as nothing under RLS and gets the identical 404 a nonexistent id gets.

### Three judgement calls, taken narrowly

`NURSE` and `DISPENSARY` do not exist in the `Role` enum, so neither appears; nothing was invented. Where the intended policy could not be read confidently off existing screens, the **narrower** option was taken — granting a privilege later is an ordinary product change, whereas discovering that a role silently held one is an incident.

1. **`ASSIGN_CLINICIAN` → owner + front desk.** Reassigning the attending clinician changes the clinical record's authorship; it is not a queue movement. Doctors excluded.
2. **`COMPLETE_TICKET` → owner + front desk + finance.** Completion also sets `Visit.checkOutAt`, so it closes the visit. That is counter work, following `MARK_PAID`'s reasoning exactly (D-066). **Doctors excluded.**
3. **`CANCEL_TICKET` → owner + front desk.** A doctor who wants a patient removed asks the counter, which is how the paper process already works.

### Four defects fixed beyond authorisation

- **The ticket was written from the request's `clinicId`.** It is now written from the clinic `VisitService` resolved, so a browser cannot file a ticket into a branch it has no access to.
- **`call` could set `Visit.staffId` to any id at all** — another tenant's staff, another branch's, or an inactive account — as a side effect of calling a patient. It now requires `ASSIGN_CLINICIAN` and resolves the clinician (exists, active, branch-authorised) exactly as D-069 does. A room from another branch is refused too.
- **Completion was two unprotected writes.** Ticket → `COMPLETED`, then `Visit.checkOutAt` separately. A failure between them left a completed ticket on a visit that never closed, with nothing to say which was true. Both writes are now one transaction, the status is **re-read inside it** so a racing request cannot win on a stale read, and a repeat is a no-op rather than a second checkout.
- **Transitions were single-status `if`s.** They are now checked against an explicit legal map in which `COMPLETED` and `CANCELLED` have **no outgoing edges** — a closed visit is not reopened by moving a queue ticket. Repeated `arrived`/`moveToDispensary` are idempotent, because a double-click is not an error.

A second ticket for one visit hits `visitId @unique` and is refused as *"This visit is already in the queue."* — the constraint name is never exposed.

### Scope held

No new statuses, no doctor-completion fields, no schema change. `QueueTicket.visitId @unique` is retained per the owner's revision to the Part L proposal. 65 security tests in `queue-security.spec.ts`; 510 backend, 191 frontend, both typechecks clean.

**Known limitation**: cancellation still records only `cancelReason` — no cancelling actor, no timestamp. The schema cannot store them today, and S3 does not fabricate an audit trail. Carried to G4.5d3c-1.

**Reversibility**: Low risk, but this is a genuine behaviour change — roles that could previously do anything to the queue now cannot. Reverting restores an unauthenticated queue.

---

## D-080 — G4.5d3c-1: the doctor's phase is not the visit's end

Schema, migration and data contract only. No endpoint, no button, no destination service — those are G4.5d3c-2.

### Three events that were one

Kuwick could record that a note was signed and that a visit was checked out, and nothing in between. So "the doctor has finished; the patient is going to the dispensary" had nowhere to live, and the only way to express it was to close the visit — which is false while medication is still unprepared.

`Visit` gains `doctorCompletedAt`, `doctorCompletedByStaffId` and `doctorCompletedDestination` (DISPENSARY / PAYMENT / NONE). All nullable, none backfilled. **NULL means the data was not captured, never that it did not happen** — a timestamp invented here would be indistinguishable from one a doctor actually recorded. `NONE` means no dispensing and no patient-facing payment remained; it does not mean the visit is closed.

The completing doctor is stored separately from the attending clinician rather than assumed from it, because a locum can finish a colleague's consultation.

### AuditLog was inspected first, and rejected

Required by the brief, and the answer is no, on four counts:

- **No `visitId`, `clinicId` or `queueTicketId`.** Per-visit and branch-scoped history could only be reached by JSON extraction over an unindexed column.
- **Its actor is `actorUserId` — a User.** Every clinical attribution in Kuwick is Staff-based; recording workflow actors differently would split the answer to "who did this".
- **No typed previous/new status.** "Which visits went from a procedure back to the doctor" would be a JSON scan.
- **No relations at all**, so nothing prevents a row claiming a visit that belongs to another tenant.

It also has **zero call sites anywhere in the codebase**. Reusing an unused generic log would have been forcing history into a shape that cannot answer the questions asked of it.

`VisitWorkflowEvent` is append-only by construction: `ON DELETE RESTRICT` on visit, tenant, clinic and actor means history cannot be erased by deleting what it describes. The queue ticket is the deliberate exception — `ON DELETE SET NULL`, because a ticket is operational, not historical, and the event keeps its own copy of both statuses. `@@unique([tenantId, correlationId])` makes a retried request write one event rather than two.

### One ticket, many stations

`QueueTicket.visitId` stays `@unique` per the owner's revision. The ticket is the patient's **current** location; the event table is where they have been. That is what makes `IN_CONSULTATION → AT_PROCEDURE → IN_CONSULTATION` reconstructable without giving one visit several tickets.

`AT_PROCEDURE`, `READY_FOR_DISPENSARY` and `READY_FOR_PAYMENT` are **added, not substituted**. `DISPENSARY_PAYMENT` keeps its meaning and its rows; a historical record is what happened, not what the model now prefers.

### The new statuses are deliberately inert

Adding them to the enum made S3's exhaustive transition map demand entries, which is the type system doing its job. Those entries are **empty**. No route can produce these statuses, so writing their outgoing edges now would be deciding the new workflow's policy ahead of approval, inside the file whose purpose is to enforce approved policy. Empty is also the safe reading if a row somehow acquires one: refuse to move it rather than guess. Nine tests hold this — every existing route refuses a ticket in a new status, and `moveToDispensary` still writes the legacy combined status rather than silently splitting it.

### Rollback, stated plainly

PostgreSQL cannot DROP a value from an enum type. The columns and the table can be dropped cleanly; **the three enum values cannot**. Reverting them requires recreating the type and rewriting every dependent column, which is not a safe automatic down-migration. An unused enum value is harmless, so the practical rollback is: drop the new columns and table, leave the enum.

**Verification**: 25 schema checks against the live database — existing rows readable across 4 tenants and 267 visits, zero fabricated doctor-completion values, `visitId` uniqueness intact, FK delete rules as designed, a cross-tenant event INSERT refused by the WITH CHECK policy while a same-tenant one using a new status succeeds, and no probe row left behind. Both the tenant list and the backfill scan run with the correct GUC — read blind, each returns zero rows and *confirms its own false result* (D-048). 510 backend tests, 191 frontend, both typechecks clean.

**Reversibility**: Medium — see the enum limitation above.

---

## D-081 — S3b: a visit can change doctors without changing who wrote what

**This corrects D-079's judgement call 1**, on the owner's instruction. S3 kept doctors out of attending-clinician assignment entirely. That was too narrow: shift handover, escalation and a doctor called away are ordinary clinical events, and routing every one of them through the front desk — or through cancelling and recreating the visit — costs more than the risk it was guarding against.

### The rule is not "which role", it is "which role, given who holds the visit"

| | Claim a visit no doctor holds | Hand on a visit they hold | Take a visit from another doctor |
|---|---|---|---|
| **Owner / front desk** | ✅ to any doctor | ✅ | ✅ |
| **Doctor** | ✅ **to themselves only** | ✅ | ❌ |

A doctor picking up an unclaimed patient is clinical; deciding which *colleague* sees an unclaimed patient is scheduling, and scheduling belongs to the counter. The one thing still refused is a doctor taking a patient who is actively with someone else — that needs the holder to hand over, or the counter to reassign. The refusal says what to do instead and **never names the doctor currently holding the visit**.

The target is always resolved server-side and must be an active doctor in this tenant with access to the visit's branch. A doctor cannot hand a patient to a non-doctor.

### "Unassigned" does not exist, and was not faked

`Visit.staffId` is **not nullable** — every visit is assigned to whoever registered it, so a visit with no attending clinician cannot be represented at all. Rather than invent a sentinel staff row, CLAIM is defined against the real case: D-044's, where front desk registers a walk-in under themselves before anyone knows which doctor will see the patient, leaving the visit held by a **non-doctor**. A genuinely nullable attending clinician is a schema change and is **recorded as an open gap**, not quietly simulated.

### Prospective only

The operation writes `Visit.staffId` and nothing else — a test asserts the update payload has exactly one key. Notes, signatures, amendments, diagnoses, prescriptions, orders, services, documents and authorisation records keep the author they already have. Dr A's signed note stays Dr A's after the visit moves to Dr B. Queue status, `checkOutAt` and doctor-completion state are untouched: a change of doctor is not a change of workflow position.

### A reason when a doctor is replaced, not when one is picked up

"Why did the attending doctor change mid-consultation" is a question a clinic has to be able to answer. "Why did a doctor start seeing the walk-in" is not. Whitespace does not count.

Each change writes exactly **one** `ATTENDING_CLINICIAN_CHANGED` workflow event, in the **same transaction** as the visit write — an unrecorded handover and a recorded handover that did not happen are both wrong, and only atomicity rules out each. `previousStaffId` and `newStaffId` are **typed columns**, not a corner of `metadata`, for the same reason the status columns are: "every visit Dr A handed over last month" should be an ordinary indexed query. Both FKs are `ON DELETE RESTRICT` — a handover record whose doctors have been erased is not a handover record.

Transferring to the doctor who already holds the visit is a **no-op that writes no event**. The holder is re-read **inside** the transaction, so a doctor cannot win a race against a colleague who claimed the patient a moment earlier.

### Unsaved clinical text

Four frontend tests hold the C1 guarantee across a transfer: the draft key is tenant/branch/patient/visit/note and contains **no staff id**, so a transfer cannot re-key a draft; a refetch of the same note never syncs over local text whether dirty or not; unsaved text stays flagged so the doctor must resolve it explicitly; and the store holds content but never an author, which is why a transfer cannot misattribute one.

**Not built:** a pending-transfer/accept handshake. There is no such state in the model, and the direct path the owner described (Dr A transfers to Dr B) is what exists. Building an accept step is a new workflow, flagged rather than invented.

**Verification**: 94 queue security tests (up from 69), 539 backend, 195 frontend, both typechecks clean, 25 schema checks still green.

**Reversibility**: Low for the code. The enum value cannot be dropped (as D-080).

---

## D-082 — S3c: the person who typed the visit in is not the person seeing the patient

S3b had to define CLAIM as "the visit is held by a non-doctor", because `Visit.staffId` was `NOT NULL` and a walk-in nobody had been assigned to still had to name somebody. Front desk put themselves there. The field therefore could not distinguish **"Dr Amira is seeing this patient"** from **"Amy at the counter typed this in"** — and every screen, report and document default that read it inherited the ambiguity.

### Two facts, two fields

- **`Visit.staffId` is now nullable** and means only the current attending clinician. `NULL` is a real state: no doctor has taken this visit.
- **`Visit.registeredByStaffId`** records who created it, derived from the **authenticated actor**, never from the request. It is administrative provenance and must never be rendered as the attending clinician.

The name `staffId` is kept rather than corrected to `attendingStaffId`: it is read across the queue, canvas, documents, orders, prescriptions and reports, and renaming it would be churn without changing behaviour. Recorded as technical debt.

### Nothing existing was rewritten

All 267 visits across 4 tenants keep their stored `staffId` — a historical value may be a genuine attending clinician or a registrar stored under the old constraint, and there is **no reliable way to tell which**, so nothing was guessed. `registeredByStaffId` is `NULL` everywhere: Kuwick stores no separate record of who created a visit, so there is nothing to backfill *from*, and copying `staffId` into it would manufacture an attribution that was never captured.

### What the nullability forced into the open

Four call sites were silently relying on "a visit always has a doctor", and each needed a real answer rather than a `!`:

- **Documents, orders and prescriptions** have a *required* author that defaulted to `visit.staffId`. `authorForVisitWork` keeps the attending clinician as first choice, falling back to the authenticated actor — which is not a compromise but more accurate: if nobody is formally attending, the person who wrote the thing wrote it.
- **Attendance** is derived from visits. An unassigned visit now contributes nothing: it is evidence a *patient* arrived, not that any doctor was present. Counting it would invent a shift for nobody.
- **Revenue reports** group money by doctor. The money is real, so it goes to an explicit `Attending clinician not assigned` bucket — not dropped (the report would disagree with the ledger) and not credited to the front desk.
- **Invoice and document forms** preselected the visit's doctor. With none assigned they now preselect nobody rather than proposing the registrar.

### One thing S3c could newly enforce

Because the field can be empty, **the attending clinician can be held to actually being a doctor**. `resolveEligibleAttendingDoctor` refuses a non-doctor. The old test asserting "any active in-branch staff member" is superseded — that was never a policy, only a consequence of the `NOT NULL`.

### Presentation

`attendingClinician()` now takes the stored id, so two empty cases stop being one: explicit `null` reads **"Attending clinician not assigned"** (live and actionable — a doctor can claim it), while `undefined` keeps **"not recorded"** (the caller does not know). Saying "not assigned" about a visit that merely loaded without its staff relation would invite someone to fix a problem that is not there.

### Unsaved-draft contract, stated honestly

A backend transfer **cannot** inspect text held only in another browser's memory, and this does not pretend otherwise. What is guaranteed: the draft key contains no staff id, so a transfer cannot re-key a draft; a refetch never syncs over local text; the store holds content but never an author, so nothing can be re-attributed. What is **not** guaranteed: front-desk reassignment from another device cannot see, block on, or transfer a doctor's local draft. The blocking rule belongs in the transfer UI, on the browser that holds the draft. No browser persistence was added to paper over this.

**Verification**: 10 live-database checks and 546 backend tests, 195 frontend, both typechecks clean.

**Reversibility**: Reverting `staff_id` to `NOT NULL` is only safe while no unassigned visit exists. Once the new walk-in path is used, a down-migration would have to invent a doctor for every one — the exact fabrication this change exists to stop.

---

## D-083 — S3d: "append-only by construction" was a claim, not a fact

D-080 said `VisitWorkflowEvent` was append-only and pointed at `ON DELETE RESTRICT`. That was **too strong, and the owner was right to ask for proof.** RESTRICT stops a *parent* row being deleted out from under an event; it says nothing about the event itself. `UPDATE visit_workflow_events SET reason = '…'` and `DELETE FROM visit_workflow_events` were both permitted. A history anyone can rewrite is not a history.

### The policy set is the mechanism, not the role name

The table is already `FORCE ROW LEVEL SECURITY`, and under FORCE **a command with no applicable policy is denied — including for the table owner**, which is what the application connects as. So the single `ALL` policy is split into `SELECT` and `INSERT`, and **no UPDATE or DELETE policy is written. That absence is the enforcement.** This was chosen over `REVOKE` alone because it does not depend on the role's *name* (which differs per environment) and cannot be sidestepped by a connection that happens to own the table. REVOKE is added as well, so a future `ALTER TABLE … NO FORCE` does not silently reopen the door.

### TRUNCATE — found by the check, not by the plan

`TRUNCATE` is a **separate privilege from DELETE and is not filtered by row-level security at all**. Revoking UPDATE and DELETE without it would have left the loudest possible hole behind the tidiest possible proof: one statement empties the entire audit trail while every other check still reads green. The verification now asserts it explicitly.

### Verified as the application role, against the real database

A mocked service proving no endpoint calls `update` would show only that today's code is well behaved — nothing about raw SQL, a future endpoint, or a mistake. 15 checks run on the live connection, including that the prober is **not** a superuser (a superuser bypasses RLS and would prove nothing), that INSERT still works, and that cross-tenant insert and read remain refused after the split.

**Known limitation, stated plainly**: a superuser or the database owner can drop the policies or turn FORCE off. No in-database mechanism prevents that. What is guaranteed is that the *application* cannot update, delete or truncate a workflow event through any route.

---

## D-084 — G4.5d3c-1b: the two questions the model could not answer

Schema only. No completion service, no destination rule, no UI.

### "Does this patient need the dispensary?"

Nothing distinguished a script the clinic fills from one the patient takes elsewhere, so the only available rule was **"a Prescription row exists"** — wrong for an external script, for medicine the patient already has, and for advice with no supply at all. `Prescription.supplyMode` is the missing input: `ONSITE_DISPENSE` / `EXTERNAL_PRESCRIPTION` / `PATIENT_OWN_SUPPLY` / `DEFERRED` / `NO_SUPPLY_REQUIRED`. It describes **intent at prescribing time** and is not a dispensing status — `PrescriptionStatus` still records what happened. `DEFERRED` is explicitly *unresolved*, not *dispensed*.

### "Does this patient need the payment counter?"

`patientPaidAmount` is money **received**, and it is only computed at pay time. So a fully panel-covered invoice sits at UNPAID with `patientPaidAmount = 0` — **indistinguishable from a cash invoice nobody has paid.** `Invoice.patientResponsibilityAmount` is what is **owed**:

| | total | panel | responsibility | paid | remaining |
|---|---|---|---|---|---|
| Cash | 85 | 0 | **85** | 0 | 85 → counter |
| Fully panel-covered | 120 | 120 | **0** | 0 | 0 → **no counter** |
| Copayment | 150 | 120 | **30** | 0 | 30 → counter |

Invariant for newly calculated invoices: `panelCoveredAmount + patientResponsibilityAmount = totalAmount`. Remaining work: `max(responsibility − paid, 0)`. **`Invoice.status = UNPAID` must never be the sole test** — rows 1 and 2 are both UNPAID and need opposite destinations, which is asserted as a check in its own right.

### No defaults, deliberately

Both columns are nullable with **no database DEFAULT and no backfill**. A default would make every row written during the compatibility period indistinguishable from one where a human actually chose — and the entire purpose of these columns is to stop the system guessing. NULL means *not captured*, and a destination rule must report **UNDETERMINED**.

No CHECK constraint enforces the invariant. It holds for invoices calculated by the *future* billing rule; existing rows are all NULL, so a constraint would be vacuous now and could reject legitimate data later if a rounding rule changes. It belongs where the amounts are computed, not frozen into the table before the rule that maintains it exists.

### Where responsibility must later be set

`InvoiceService` — on create, on line add/remove, on quantity change, on panel selection and coverage calculation, and on copayment adjustment. Not on payment (that is `patientPaidAmount`) and not on cancellation. `InvoiceStatus` is unchanged: DRAFT/ISSUED/SUBMITTED belongs to G4.5d6, and overloading financial status with an issue/submission lifecycle is the exact conflation the audit warned about.

**Verification**: 18 live-database checks — 360 prescriptions and 235 invoices readable, zero backfilled, no PAID or CANCELLED invoice touched, all five supply modes written and rolled back, cross-tenant access still denied. 546 backend tests, 195 frontend, both typechecks clean.

---

## D-085 — G4.5d3c-1c: the author is whoever did it

S3c introduced `authorForVisitWork`, which preferred `Visit.staffId` and fell back to the actor. **That was wrong and the owner caught it.** It meant a prescription written by anyone on a visit assigned to Dr A was recorded as Dr A's. Silent "on behalf of" attribution is the one thing a clinical record must never do: the author of a prescription is a medico-legal statement about who exercised judgement, not a convenience default.

### The rule

The clinical author is **always the authenticated actor who performed the action**, and that actor must hold a role entitled to author clinical work (`canAuthorNarrative` — the rule C0 already established for notes, reused rather than reinvented). `Visit.staffId` says who is currently attending. It does not say who wrote this.

- **Prescriptions and clinical orders** — author is the prescribing/ordering clinician. Front desk and finance are refused outright, and the role is checked **before the visit is read**, so a refusal leaks nothing about the visit.
- **Copying a previous prescription** is a *new* prescribing decision, so it is authored by whoever made it — not inherited from the source row.
- **Documents** — `issuedByStaffId` is the **creator**, not the author. Front desk may create a draft (an approved part of the workflow) and is recorded honestly as its creator; the clinical claim is made separately at authorisation, by a doctor, with its own frozen identity snapshot (D-064). Creator is therefore *not* gated on a clinical role — it carries no clinical claim.

A second defect surfaced while fixing the first: **`dto.issuedByStaffId` was accepted from the browser**, so a caller could put any name on a document. Both halves of that are gone.

### Unassigned visits

`Visit.staffId` may be NULL. A missing attending clinician is **never** solved by substituting the registrar, the front-desk actor, the invoice creator or arbitrary staff. A clinical action needing a doctor uses the authenticated doctor, or is **rejected**. "Nobody is attending" is not a reason to lower the bar for who may prescribe.

An on-behalf workflow (a doctor dictating, a scribe entering) needs explicit permission, visible identity and its own audit. It is deliberately **not** built — a silent version of it is exactly the defect being removed.

### Cancellation audit

`QueueTicket` stores `cancelReason` and nothing else — no actor, no timestamp, which S3 reported as a gap and declined to fabricate. Rather than add two columns used by one action, the approved immutable event carries it: `VISIT_CANCELLED` with actor, both statuses, reason and a database-set `createdAt` the caller cannot back-date. Being append-only at the database level (D-083), it cannot later be edited to say someone else cancelled the visit.

The status change moved **into the same transaction** as the event — an unrecorded cancellation and a recorded one that did not happen are both wrong, and only atomicity rules out each. A repeat writes nothing and records **no second event**: two events for one cancellation is a false history, worse than none. A `COMPLETED` ticket still cannot be cancelled. Nothing else is touched — the visit, prescriptions, orders, documents, invoices and stock movements all survive a cancelled ticket, because a patient who left is not a patient who was never here.

**Verification**: 13 new attribution tests plus 5 cancellation-audit tests; 562 backend, 195 frontend, both typechecks clean.

**Reversibility**: Low risk, but a real behaviour change — roles that could previously cause a clinical record to be written under someone else's name now cannot.

---

## D-086 — G4.5d3c-2: the server decides where the patient goes

Backend only. No Canvas footer, no queue screen, no Flow view.

### The two shortcuts this exists to refuse

> "a Prescription exists" does **not** mean dispensing is required
> "an Invoice is UNPAID" does **not** mean the patient owes anything

An external prescription needs no dispensary. A fully panel-covered invoice sits at UNPAID with nothing for the patient to pay. Both were unanswerable before D-084 added the fields; where those fields are NULL this service reports **UNDETERMINED** instead of guessing. The DTO has **no destination field** — accepting one would let a browser route a patient past the dispensary.

### Precedence

Clinical blockers, then medicine, then money — money never jumps the queue over medicine.

1. **Unsigned note** or **open procedure** → blocked. A procedure still running is the strongest blocker there is: completing would close a phase whose findings do not exist yet.
2. **DEFERRED or NULL supply mode** → blocked, in the owner's exact words for DEFERRED.
3. **ONSITE_DISPENSE still ORDERED** → `DISPENSARY` / `READY_FOR_DISPENSARY`.
4. **Billing UNDETERMINED** → `PAYMENT` / `READY_FOR_PAYMENT`, reason `BILLING_REVIEW_REQUIRED`. Deliberately not phrased as payment due: telling a patient they owe money we cannot compute is worse than admitting we have not worked it out.
5. **Remaining > 0** → `PAYMENT`, reason `PATIENT_PAYMENT_REQUIRED`.
6. **Remaining = 0** → `NONE`.

Every non-cancelled invoice is summed, `max(owed, 0)` **per invoice** — a credit on one bill is not change owed on the next, and netting them would hide a real balance. One NULL responsibility makes the whole visit undetermined; substituting `totalAmount` would invent a debt for a panel patient who owes nothing.

### Who may complete

The attending clinician, and nobody else. **There is deliberately no override permission**: none exists in the `Role` enum, and inventing one would put a clinical bypass in the same commit that introduces the rule it bypasses. A colleague who needs to finish the consultation takes the visit first — S3b made that a one-step audited action.

### `Visit.checkOutAt` — the decision

**Never set, in any branch, including `NONE`.** Doctor-phase completion is not visit completion (owner decision 2), and collapsing them for the one convenient case would destroy the distinction everywhere else. Closing the visit stays a separate explicit act. Three tests assert the update payload has no `checkOutAt` key.

### Idempotency

A repeat returns the **recorded** result and **re-derives nothing**. That matters more than it looks: prescriptions get dispensed and invoices get paid afterwards, so a second call an hour later would otherwise "correct" a completed consultation to somewhere the patient has already been. The completed-check runs *before* the attending check, so a colleague who asks about a finished visit gets the answer rather than a 403.

### A test that was wrong, and the service that was right

Three cases came out `PAYMENT` where the first draft of the tests expected `NONE`. The service was correct: a prescription is a chargeable item, so a visit carrying one with **no invoice raised** has unbilled work on it, and the owner's rule is explicit — do not silently close a visit containing unbilled chargeable items. The tests were corrected to assert what the requirement actually says (*not* DISPENSARY), and two cases were added to pin the billing behaviour deliberately rather than by accident.

**Verification**: 41 tests in this service; 603 backend, 195 frontend, both typechecks clean.

**Known limitations**: the signed-note rule requires at least one signed `DOCTOR_NARRATIVE` and nothing subtler; concurrency rests on the transaction plus the in-transaction re-read, not on `SELECT … FOR UPDATE`; `BILLING_REVIEW_REQUIRED` cannot be distinguished from `PATIENT_PAYMENT_REQUIRED` on a repeat call, so the safer of the two is reported.

---

## D-087 — G4.5d3c-2b: closing a visit, and the bypass that could do it anyway

### The reason had to be stored, not re-derived

`READY_FOR_PAYMENT` has two meanings — a real balance, and billing nobody has worked out — and the queue status cannot tell them apart. After a refresh the screen could only guess, and guessing here means telling a patient they owe money nobody has calculated.

Option A: one nullable typed column, `Visit.doctorCompletedRoutingReason`. Chosen over reading it back out of the workflow event because "the DOCTOR_PHASE_COMPLETED event for this visit" is a query with an ordering assumption baked in, and a visit completed, corrected and completed again would have two. A column has one value and no retrieval rule to get wrong.

**Not backfilled.** Visits completed before this read NULL — *not captured*, never `NO_DOWNSTREAM_WORK`. Inferring one now from today's prescriptions and invoices is exactly the re-derivation the column exists to prevent, and would produce a reason contradicting where the patient was actually sent.

### Concurrency: proved, not asserted

The previous version re-read inside the transaction and trusted what it saw. **Under READ COMMITTED that is not enough** — two requests can both read NULL, both pass, and both write.

Both services now put the precondition **in the WHERE clause** (`updateMany … WHERE checkOutAt IS NULL`), making check-and-write one atomic statement. The first writer locks the row; the second blocks, re-evaluates after the commit, matches nothing, and gets count 0. Exactly one can ever see count 1, whatever their idempotency keys.

Verified against the **live database under real READ COMMITTED**, with genuinely overlapping transactions (`pg_sleep` inside each, after BEGIN, before the write). Two concurrent claims → [1, 0]. Three → one winner. **And a control: the naive read-then-write shape gives [1, 1] — both commit.** A concurrency test that cannot fail proves nothing, so this one demonstrates it can.

### The legacy bypass

`QueueTicketService.complete` was made atomic and authorised by S3 — but it still set `Visit.checkOutAt` after checking one thing: that the ticket was in DISPENSARY_PAYMENT. It would close a visit with medication undispensed, a bill nobody raised, or a doctor phase that never happened. **Every rule the new service enforces, walked straight past.**

Two implementations of "finish the visit" is how they drift, so this one no longer has an implementation: it resolves the visit and delegates. The route keeps working; the unsafe path underneath it does not.

### Blockers

All of them are collected and returned together — a counter clerk fixing four problems one refresh at a time is how a queue backs up. Codes for the UI to branch on; messages that say what to do and never name a table, enum or constraint.

**Documents deliberately do not block.** Kuwick has no concept of a document being *required* for a visit, so every optional draft would block every completion — an MC the patient decided not to take would trap the visit open forever. Reported as a limitation rather than invented.

**Verification**: 31 tests in the completion service, 7 real-database concurrency checks; 595 backend, 195 frontend, both typechecks clean.

**Known limitations**: the routing reason is NULL for visits completed before this migration; `PrescriptionSupplyMode` cannot express "partially dispensed"; there is still no required-document concept.

---

## D-088 — G4.5d3c-2c: asking without changing, and the two answers that must agree

Backend only. `GET /visits/:id/doctor-phase-status`. **No Canvas footer, no Send to Procedure, no UI of any kind** — this checkpoint gives a screen something true to ask, and stops there.

### One evaluator, three callers

The preview, the refusal and the commit all run `evaluateDoctorPhase`. There is no second implementation of "can this consultation finish", because two of them is how a screen comes to offer a button the server then refuses — and the person who pays for that is a doctor who has already told the patient they are done.

The write still runs the evaluator **itself, inside its own transaction**, against the queue ticket read in that same transaction. A preview is evidence about the past: between the read and the write a colleague can take the visit, a nurse can start a procedure, a ticket can move. The read is a courtesy to the UI and is never an input to the decision.

### Blockers are collected, not raced

All of them, every time, in a fixed source order — queue state, then the record, then the work, then the medicine. The order is declared rather than emergent, so "the first blocker" is a stable thing for a screen to render and for a rejected write to use as its message. The previous write threw on the first problem it found: a doctor told to sign the note, who signed it and was then told about a procedure, and then about a medication, made three round trips to learn one thing.

`MEDICATION_SUPPLY_UNCONFIRMED` and `MEDICATION_SUPPLY_DEFERRED` stayed separate codes. They are different facts about the clinic — nobody has said, versus somebody said "later" — and collapsing them would tell a doctor to set a supply mode that is already set.

Messages name no table, column, enum value or constraint. The old queue-state message interpolated the raw `QueueTicketStatus`; it now reads as a sentence, and a test asserts no schema vocabulary reaches a user through this path.

### Billing decides where, never whether

**Billing produces no blocker.** An unraised invoice or an outstanding balance changes the routing reason — where the patient goes *after* the doctor is done — and has never been a reason a clinician cannot finish a consultation. Making a billing state a clinical blocker would let a slow front desk hold a doctor at their desk, and the doctor could do nothing about it.

This is the one place the doctor phase and the *visit* phase deliberately differ: `UNBILLED_CHARGEABLE_ITEMS` and `PATIENT_BALANCE_REMAINING` do block **visit** completion (D-087), because closing the visit is the assertion that the money is settled. Finishing the consultation asserts nothing of the kind.

### `PROCEDURE_PENDING` withholds the destination

Destination `null`, routing reason `null` — not `NONE`.

The procedure's findings are an **input** to the routing decision: they can add an order, a prescription, or a charge. Any destination computed while one is open is a guess about a visit that has not stopped changing, and `NONE` in particular would say "nothing further" about a patient whose investigation has not reported. `null` says "not yet knowable", which is the true answer. The billing query is not even issued in this branch.

It is the only blocker that suppresses routing, and deliberately so: an unsigned note and a ticket at the wrong stage say nothing about where the patient goes once they are fixed, so the preview still answers.

### A completed phase is read back, never re-derived

The stored `doctorCompletedDestination` and `doctorCompletedRoutingReason`, with no evaluation performed — a test asserts the four derivation queries are never issued. This matters more on the read than it did on the write: a screen refreshes. Prescriptions get dispensed and bills get settled afterwards, so a re-derivation an hour later describes a patient who has already moved on, and would do it on every poll.

A visit completed before D-087's column existed reads `null`. **Not captured** — never `NO_DOWNSTREAM_WORK`.

### Side-effect freedom: enforced, not asserted

The read runs in a transaction that sets `transaction_read_only` locally — the same GUC `SET TRANSACTION READ ONLY` sets. PostgreSQL refuses any `INSERT`, `UPDATE` or `DELETE` inside it with SQLSTATE **25006**. "This endpoint has no side effects" is otherwise a comment, and comments do not survive the next edit; this survives someone adding a write six months from now, because their write fails loudly at the server.

Set through `set_config` rather than `SET`: a plain `SET` is a utility statement and does not survive being prepared, which is how Prisma sends raw SQL.

Verified against a **live PostgreSQL 16 over the extended protocol**: `UPDATE`, `INSERT` and `DELETE` each refused with 25006; tenant scoping still applied inside the read-only block; the setting confined to its own transaction. **And a control: the same `UPDATE` commits in a transaction without the setting.** A proof that cannot fail proves nothing.

### Who may read it

Any active staff member with access to the visit's branch — the same gate as the visit-completion blocker read, and deliberately **wider than the write**, which still admits only the attending clinician. The payload is workflow state: queue stage, whether a note is signed, whether medicine or a procedure is outstanding. No note text, no diagnosis, no medication name, no amount. A covering doctor and a front desk asking why a consultation is stuck get an answer; nobody gets clinical content they could not already see.

Tenant, branch and non-disclosure protections are unchanged: a visit in another tenant is invisible to RLS and returns the same 404 as one that does not exist.

**Verification**: 78 tests in this service (37 new), 7 live-database read-only checks including the control; 632 backend, 195 frontend, both typechecks clean.

**Known limitations**:

- The preview's destination is computed from supply modes **as they stand**. A visit whose only medication is `DEFERRED` previews the destination as if that medication needed no dispensary — correct for the data recorded, but it will change when the mode is set. The blocker is reported alongside it, and the commit re-evaluates, so no patient can be routed on this; it is a preview that can move, not a wrong answer.
- A visit with no queue ticket at all (a record-only visit created outside the front desk) reports `QUEUE_STATE_INELIGIBLE`. That preserves the existing rule — the doctor phase has always required a queue presence — but the code says "wrong stage" for what is really "no queue at all".
- The read is per-visit; there is no batch endpoint, so a queue screen wanting this for twenty visits would issue twenty requests. Not needed by anything built today.
- The signed-note rule is still "at least one signed `DOCTOR_NARRATIVE`" and nothing subtler.

---

## D-089 — G4.5d3c-3a: the Consultation Footer, and what it refuses to know

Frontend only. The Canvas gains a Consultation Footer — the doctor's end of the consultation — after the clinical workspace content. **No Queue/Counter Complete Visit UI, no Flow view, no procedure transition, no Dispensary Workspace.** Nothing above the footer changed: context band, snapshot, note, rail, drawers and the C1 protections are untouched.

### The footer computes nothing clinical

Every judgement it renders is the server's. `doctorPhasePresentation.ts` is pure mapping — blocker code → approved sentence, routing reason → button copy — and the tests prove there is no input by which a prescription count, an invoice or an order status could reach it. The read (`GET doctor-phase-status`, D-088) is **advisory for presentation**; the write stays authoritative and re-evaluates in its own transaction. When a preview goes stale, the write's refusal carries fresh structured blockers and the footer swaps the enabled button for them — the one currency both sides share is the blocker code.

The owner's wording is pinned in one table, client-side, and rendered **from the code, never from the server's message string** — so no server change can put an enum, a column name or a driver string in front of a doctor. An unrecognised code from a newer server is dropped, not rendered raw. Blockers are re-ordered against the declared list, all shown together, each mapped to at most one review action (two medication blockers → ONE "Review Medications"), and review actions only navigate — `scrollIntoView` + focus on the existing section, same no-hash rule as the quick-nav (D-072). `QUEUE_STATE_INELIGIBLE` deliberately maps to **no action**: there is no reliable doctor-side queue control, and inventing one implies the doctor can fix it alone. `PROCEDURE_PENDING` maps to "Review Orders", never "Send to Procedure" — no transition service exists, and a button that looks like it moves a patient but does not is worse than no button.

### What the doctor is never offered

**"Complete Visit" — in any state.** Closing the visit asserts dispensing and billing are done, which is counter work under a different permission (D-087). The completed footer says "Awaiting overall completion" until `checkOutAt` exists, and nothing on the bar can set it. The eligible button exists only when the server reports zero blockers AND a routing reason — a derived destination arriving alongside a blocker is a preview, not permission, and a null reason (a pending procedure) yields no button even with no blockers. `BILLING_REVIEW_REQUIRED` is never phrased as payment anywhere: button, supporting copy, confirmation and the completed "Next station: Billing Review" all say the clinic has not confirmed responsibility, because the alternative is telling a patient they owe money nobody has computed.

One compact confirmation, destination never a choice. The completed summary renders stored values only — the presentation module has no invoice or prescription input, so later billing/dispensing events *cannot* change it, which is D-088's no-re-derivation rule carried through to the pixels.

### C1, and the invalidation that was not written

The obvious post-mutation move — invalidate everything about the visit — would refetch clinical notes and push a server seed under an editor holding unsaved text. The mutation invalidates **only** the phase status, queue tickets and the visit row. The footer owns no clinical content and cannot remount the note; the component tests render a mount-counting editor beside it and assert the count stays at 1 and the text survives preview, success, failure and refetch. `refetchOnWindowFocus` is off for the status query, same reasoning as C1's note query.

### Sticky, considered and refused

The footer is the last element on the record, not a sticky bar. Sticky here would sit over the note editor's lower lines on a laptop, over rail dropdowns, and interact with the mobile quick-nav that is already sticky at the top — three overlap problems to solve for a bar the doctor reaches once, at the end. The brief permitted sticky "where safe"; not-sticky is the safe choice and costs one scroll.

### Verification

First DOM tests in the web suite (jsdom, opt-in per file; config moved to `vitest.config.ts` because vitest 4 stopped honouring the `test` block in `vite.config.ts`). 100 new frontend tests (48 presentation + 32 component + 20 existing-suite growth): 275 frontend, 632 backend, both typechecks clean. Screenshots in `docs/g45d3c3a-screenshots/` from the populated professional fixture: desktop eligible/blocked/confirmation/completed, tablet billing-review, mobile blocked/completed — all states real API round-trips, the completion performed through the actual UI.

**Known limitations**:

- **Supply mode has no entry UI**, so `MEDICATION_SUPPLY_UNCONFIRMED` can only be cleared by a checkpoint that builds one (the fixtures set it in the database). The blocker is honest; the fix-it path is not built yet.
- The Medications rail's "N to dispense" badge counts `ORDERED` rows without reading `supplyMode`, so a patient-own-supply item still shows as "to dispense" in the rail while the footer correctly routes past the dispensary. Pre-existing display, out of scope here, worth a cleanup.
- "Completed by" resolves the staff name from the staff list; a completer outside that list (rare — a deactivated account) renders "Not recorded" rather than fetching the name individually.
- The footer is per-visit and polls nothing: a phase completed at another station appears on the next query refresh (mutation, remount or manual retry), not live.

---

## D-090 — G4.5d3c-3a0v: the scroll between the doctor and the footer

Frontend only, visual closure only. The footer itself — states, wording, colours, state machine — is untouched; this checkpoint changes how far away it is. **No Supply Mode UI, no Queue/Counter Complete Visit, no Flow view.**

### The duplicate sections are gone from the Canvas

The active Canvas rendered the current visit's Documents and Invoice twice: once in the top Visit Actions band (D-075), and again as full accordions below the workspace (D-071's `SecondarySections`). The bottom pair duplicated the top band's summary for the same visit and stood permanently between the clinical work and the Consultation Footer.

They are removed **from the Canvas composition only**. The full surfaces now open as drawers from the top band's own buttons — "More Documents" and "Open Invoice" — mounting the SAME `DocumentsTab` and `InvoiceSummary` the Flow layout's tabs mount, so there is still exactly one implementation per surface. A drawer, never navigation: the consultation stays mounted behind it, closing it returns to the same unsaved text (the History Drawer rule, D-067). The shared components (`SecondarySections`, `DocumentsSection`, `InvoiceSection`) stay in the tree untouched; a test pins both facts — absent from the Canvas, present in the codebase.

Create MC / Create Referral were already direct entries into `CreateDocumentDrawer` and are unchanged.

### The editor reserves what typing needs, not what symmetry wants

The Canvas editor was `height: min(58vh, 520px)` — a FIXED height whatever the note held, originally chosen (D-054) to stop lower sections stealing the typing area. With the page on one natural scroll that protection no longer needs a fixed box, and its cost had become the finding: a four-line SOAP note carried hundreds of blank pixels, all of them between the doctor and the footer.

Two rules replace it, chosen by a CLASS on the same `EditorContent` node (`editorSurfaceClass`), never a remount:

- **Editable** (`.kw-editor-fill`): `min-height: 400px` — inside the owner's 380–440 range — and grows naturally with content. No fixed height, no `overflow-y`, no inner scrollbar the layout imposes.
- **Signed/read-only** (`.kw-editor-signed`): `min-height: 260px`, sized by its content. Nobody types into a signed note; the reservation bought nothing but scroll distance.
- Flow/tablet/mobile (`.kw-editor-min`): unchanged at 300px.

### Measured, before → after (1440×900, real fixtures)

| Page | Before | After |
|---|---|---|
| Short signed note, completed footer | 1459px tall, footer at 1353px | **1116px, footer at 1011px** |
| Footer scroll past the fold | ~527px | **~216px** (signed), ~264px (editable) |
| Duplicate sections in DOM | present | **absent** (asserted at capture time) |

An editable note keeps its full 400px surface and still lands the footer about one-quarter viewport below the fold. The footer stays non-sticky (D-089's reasoning unchanged) and remains the final element of the active Canvas.

### C1

The height is CSS on the same node and the surface choice is a class string — the TipTap instance is never recreated by any of it, which a test pins by asserting `RichTextEditor` renders exactly one `EditorContent` fed by `editorSurfaceClass`. Draft-key semantics untouched; the existing C1 suites and the D-089 footer/editor-isolation tests all run unchanged.

**Verification**: 19 new tests (composition, height rules, class selection, Visit Actions as the now-sole entry point); 294 frontend, 632 backend, both typechecks clean. Screenshots in `docs/g45d3c3a0v-screenshots/` with capture-time geometry printed above.

**Known limitations**:

- The removed sections' collapsed one-line summaries (document counts, invoice total at a glance) are no longer permanently visible on the Canvas; the top band carries a shorter version of the same facts. If the owner misses the richer line, it belongs in the top band, not in a restored bottom section.
- The editable floor means a *blank* editable note still shows ~400px of empty surface — deliberate (typing room), but it is the one place blank height survives.
- `kw-anchor-documents` / `kw-anchor-invoice` no longer exist on the Canvas; nothing references them today (quick-nav never did), but a future deep-link to those anchors would need the drawers instead.

---

## D-091 — G4.5d3c-3a1: the supply intent gets a control, and the counts stop lying

`Prescription.supplyMode` had columns (D-084), routing rules (D-086/D-088) and a blocker — and no way for a doctor to set it except a database fixture. This checkpoint is that way, plus the corrections its absence had been hiding. **No Queue/Counter Complete Visit, no Flow view, no Dispensary Workspace, no OTC workflow.**

### Where the control lives

In the prescribing workflow and nowhere else: a labelled select in the **Add Medication form**, visibly defaulting to "Dispense from clinic" and submitting `ONSITE_DISPENSE` **explicitly** — the stored value is what the doctor saw selected, never a hidden database default (a test pins that an absent value stores NULL). On each ORDERED row: the prescribing drawer carries an inline labelled select; the Canvas rail carries a "Supply mode" submenu under the row's More menu, so the intent is editable without leaving the Canvas. Not in the footer, the invoice, documents, the queue or settings.

The owner's five labels live in `medicationSupplyPresentation.ts`; no raw enum value renders anywhere (tested, including the status chips, which used to print `ORDERED` verbatim and now say "Ordered"). **NULL reads "Supply mode not confirmed"** — its own words, never clinic dispensing — and existing NULL rows are not backfilled or auto-converted.

### The server side

`PATCH /prescriptions/:id/supply-mode`, one field. The same author gate as prescribing itself (`requireClinicalAuthor`, D-085): front desk, finance, stock, anonymous and inactive accounts are refused at the server; cross-branch is refused; a foreign tenant's row is RLS-invisible and 404s like a missing one. **Authorship is never rewritten** — the update's payload is `{supplyMode}` alone (tested), so `prescribedByStaffId` keeps recording who prescribed; a colleague's change acts under their own authenticated identity. DISPENSED refuses with a reason (the mode is now a historical fact about medicine already handed over); CANCELLED refuses as not editable. Copy-Previous deliberately does NOT copy the source's supply mode: this visit's supply intent is this visit's decision, so copied rows arrive unresolved.

### Rail accuracy

"To dispense" now means `ORDERED + ONSITE_DISPENSE` — nothing else. The old count treated every ORDERED row as dispensary work, telling the counter to expect medicine that was never coming. NULL rows get their own separate badge ("1 supply mode unresolved" / "2 supply modes unresolved" — pluralised), never folded into the dispensing number. **Dispense buttons obey the same rule**: only an ORDERED + ONSITE row offers one, on both surfaces; external/own-supply/deferred/no-supply/NULL/DISPENSED/CANCELLED offer none. Doctor dispensing permissions are not widened — this narrows where the existing action is offered; the real dispensing surface remains the future Dispensary Workspace.

### The footer loop

Every prescription mutation invalidates exactly two queries: the visit's prescriptions and its `doctor-phase-status`. Nothing else — the clinical-notes query is untouched (tested), so no medication change can push a server seed toward an editor holding C1 draft text. Eligibility appears only from the server's status response; nothing in the browser derives it, and nothing ever calls completion automatically. "Review Medications" now lands on the **first unresolved row** where one exists (found by a DOM marker the rail sets from the same presentation rule as the badge — nothing re-derived), focuses it, and rings it briefly; otherwise it falls back to the section.

### Mobile closure

**Quick-nav**: CSS scroll shadows (content-pinned covers over edge shades, no JS) say "more tabs this way" and vanish at each end of the scroll; a tapped tab scrolls itself fully into view; Diagnosis/Medications render as "Dx"/"Meds" below 480px while `aria-label` keeps the full names. **Add Order / Add Service**: the compact [select | button] pair overflowed its card at phone widths; at ≤767px they stack — full-width field, full-width named button beneath — measured 0px document overflow at 390px. Desktop and tablet keep the side-by-side pair.

**Verification**: 10 new backend tests (22 in the prescription suite), 33 new frontend tests across four files; 645 backend, 328 frontend, both typechecks clean. Screenshots in `docs/g45d3c3a1-screenshots/`, including the end-to-end frame (07b): supply mode resolved through the UI and the footer flipped to the server-derived eligible action in the same session.

**Known limitations**:

- Copied prescriptions arrive with supply mode unresolved (deliberate — see above), which means Copy-Previous now routinely produces the unresolved badge until the doctor confirms each mode.
- The Doctor Canvas still offers Dispense at all (correctly gated); whether it should remain once the Dispensary Workspace exists is that checkpoint's decision.
- The "Item strength" tag and stock line on the drawer list are untouched; only supply facts changed.
- Quick-nav scroll shadows rely on `background-attachment: local`, which iOS Safari has historically been inconsistent about; the fallback is a plain white row with the snap/scroll-into-view behaviour still active.

---

## D-092 — G4.5d3c-3b1a: the benefit terms a visit was actually seen under

First of the four 3b1 sub-checkpoints from the 3b0 audit. Schema + capture endpoints only — **no money is computed here**; the 3b1b engine will read what this stores. No UI, no queue changes, no discounts, no markups.

### The snapshot lives on the Visit

Fourteen nullable columns on `Visit`: member reference, verification status/actor/timestamp/portal-reference, coverage type (`UNLIMITED | VISIT_LIMIT`) with `panelVisitLimitAmount`, copayment type (`NONE | FIXED_AMOUNT | PERCENTAGE`) with `panelCopaymentValue` — plus five `panelOriginal*` columns and the three override-audit fields. Captured for THIS visit and never re-read from the panel's live configuration: the audit's staleness finding (pay-time pricing from live `limitAmount`) is what this schema exists to end. **NULL means "not captured"** and the engine must treat it as unresolved — never as unlimited coverage, never as zero copay.

### Selecting a panel is not verifying it

`VisitService.create` stores `PENDING_VERIFICATION` the moment a `panelClinicId` is chosen (both direct visits and the queue path, which delegates). Only an explicit, attributed staff action moves it on — `VERIFIED` and `FAILED` via `PATCH /visits/:id/panel-verification`, `OVERRIDDEN` via `PATCH /visits/:id/panel-benefit-override`. A FAILED verification deliberately stores **no terms**: recording benefit figures the portal refused to confirm would launder a guess into a snapshot.

### Verification is counter work; override is a financial correction

Verify: OWNER_ADMIN / FRONT_DESK_CLINICAL_STAFF / FINANCE_STAFF. Override: OWNER_ADMIN / FINANCE_STAFF only, with a **mandatory reason**, actor and timestamp — held to the same tier as cancelling an invoice (D-066's reasoning). Doctors are refused both: eligibility terms are not a clinical judgement. Branch access enforced; a foreign tenant's visit is the same 404 as a missing one; a completed visit's snapshot is locked (correcting a settled visit's terms is credit-note territory, not a quiet edit).

### The originals are append-only

`panelOriginal*` is written exactly once — at first capture — and never again. A re-verification updates the working terms; an override replaces the working terms and stamps `OVERRIDDEN`; neither touches the record of what verification first said. An override on a never-verified visit records `PENDING_VERIFICATION` as the original truth rather than inventing a verification that never happened.

### Term validation fails closed

VISIT_LIMIT requires a positive limit; UNLIMITED refuses one. FIXED/PERCENTAGE copay requires a positive value; NONE refuses one; percentage is bounded (0, 100]. An omitted copay type is stored as an explicit NONE. Every invalid combination is refused rather than stored for the engine to reinterpret.

### Line-level responsibility columns

`InvoiceLine` gains `panelResponsibilityAmount`, `patientResponsibilityAmount` (nullable — NULL = not computed, never zero; invariant once computed: their sum equals the line amount) and `panelExclusionReason` (snapshotted at exclusion time, so a later exclusion-list change cannot rewrite a line's history). **No writer yet** — that is 3b1b's whole job, stated here so the gap is a plan rather than a surprise.

**Verification**: 26 tests in the new service, 2 new creation-state tests; 673 backend, 328 frontend, both typechecks clean; migration `20260804035856_panel_benefit_snapshot_and_line_responsibility` applied. Live smoke against the running API: panel visit created PENDING_VERIFICATION; doctor 403 on both routes; front desk verified (terms + originals written once); front desk 403 on override; UNLIMITED-with-limit refused 400.

**Known limitations**: no UI captures the verification yet (3b2's Billing Review / registration surface); `BILLING_REVIEW_REQUIRED` still cannot be cleared until 3b1b writes responsibility; the completed-visit lock has no adjustment workflow behind it yet (deliberate — credit notes are a later, owner-gated design).

---

## D-093 — G4.5d3c-3b1: billing foundation closure

The owner consolidated the planned 3b1a–3b1d sub-checkpoints into a single checkpoint after 3b1a landed (D-092 remains part of it, unreverted). This record closes the 3b0 audit's headline finding: **`Invoice.patientResponsibilityAmount` now has a production writer**, and everything that feeds it — pricing, benefit terms, discounts, cancellation, chargeability — is persisted, attributed and recomputed inside the same transactions that change billing state.

### One pure engine computes responsibility; every mutation calls it

`billing-calculation.ts` is a pure function — no I/O, no Prisma — so money paths are exhaustively testable. Order of operations, fixed: active (non-cancelled) lines → line discounts (clamped to the line) → covered/excluded partition → visit-limit cap `min(eligible, limit)` → copayment → panel total → overall invoice discount → per-line proportional allocation. `InvoiceService.recalculateInvoice` runs it inside every mutating transaction (create, add line, cancel line, both discounts) and `PanelBenefitService` triggers it for a visit's UNPAID invoices after verify/override, reading benefit terms **only from the Visit snapshot** — never live panel configuration. An unresolved snapshot (not VERIFIED/OVERRIDDEN, or terms missing) yields NULL responsibility everywhere, and NULL stays NULL until a human resolves it.

### Discount policy v1: AFTER_PANEL_SPLIT_PATIENT_ONLY (owner decision)

An overall invoice discount reduces **only the patient's portion** — the panel's contractual receivable is never discounted away by the counter. Cash invoices discount the full amount (patient portion = everything). The engine takes the policy as a structural step, not a hard-coded assumption, so a future policy can be added without re-deriving the split. An overall discount is refused while responsibility is unresolved (there is no patient portion to bound it). Line discounts apply before the split and are clamped to the line. Both levels persist type/value/computed amount/reason/actor/timestamp. RBAC (extending D-066's single gate with `APPLY_DISCOUNT`): OWNER_ADMIN and FINANCE_STAFF only — front desk and doctors are refused, and there are no clinic-configured limits yet by owner decision.

### Visit-limit allocation is exact, not approximately proportional

Per-line panel and patient shares are allocated proportionally **in cents**, with the rounding residue assigned deterministically to the final covered line — so the sum of line-level responsibility **exactly equals** the invoice-level responsibility, always. Percentage copayment (owner decision): percentage × the covered amount *after* exclusions and *after* the visit-limit cap — eligible 250 under a 200 limit at 10% gives panel 180, patient 70 — and never touches excluded items.

### Pricing truth moved server-side

`billing-pricing.ts` resolves a sourced line's unit price on the server with the owner's precedence — specific `PanelPriceOverride` REPLACES, never stacks with, the new panel-wide fixed markups (`PanelClinic.inventoryMarkupAmount` / `serviceMarkupAmount` added to cash price); cash price is the floor. The client-sent unit price is **ignored** for sourced lines; an unpriceable source is refused, not defaulted. Provenance persists per line (`priceRule` enum, `baseUnitPrice`, `panelMarkupAmount`) so a price can always answer "why this number" — and none of it renders on a standard invoice. Manual lines require an explicit price and are stamped MANUAL.

### Chargeability follows supply intent (reverses one D-086 behaviour)

Owner decision: only `ONSITE_DISPENSE` is a clinic medication charge. EXTERNAL_PRESCRIPTION / PATIENT_OWN_SUPPLY / NO_SUPPLY_REQUIRED are never billing work — so an external-prescription-only visit no longer routes to billing review (a D-086 test asserted it did; deliberately reversed). DEFERRED and NULL are *unresolved*: listed as work, never chargeable. `billing-worklist.ts` walks the sources — not the invoice — so `UNBILLED_CHARGEABLE_ITEMS` now fires even when an invoice exists (the audit's silencing hole), and a cancelled line honestly reopens its source.

### Lines are cancelled, never erased

DELETE on an invoice line now stamps `cancelledAt`/actor/reason instead of deleting the row — the audit trail keeps what was on the bill and who took it off. Cancelled lines drop out of totals, duplicate-source checks (`cancelledAt: null`), the worklist's billed-state and every rendered surface, but stay queryable.

### Dispensing is an atomic claim, proven live

`dispense()` claims with D-087's pattern — preconditions (`status: ORDERED, supplyMode: ONSITE_DISPENSE`) in the `updateMany WHERE`, stock movement riding the same transaction, dispenser attributed (`dispensedByStaffId`). The supply-mode API bypass is closed: a non-ONSITE prescription cannot be dispensed no matter what the client sends. `prisma/g45d3c3b1-dispense-check.ts` proves it against the live database: two pg_sleep-overlapped claims → exactly one winner and ONE stock movement; three-way race → one winner; EXTERNAL/NULL cannot claim; and the old read-then-write shape run as a CONTROL double-claims [1,1] — a proof that cannot fail proves nothing. (Found along the way: the app role cannot hard-delete a Visit because `visit_workflow_events` is append-only — correct behaviour; the harness soft-cleans around it.)

### Payment refuses to guess

`pay()` uses **persisted** responsibility only: NULL responsibility, an unresolved benefit snapshot, or an unresolvable balance each refuse with "Billing responsibility has not been confirmed." — never recomputed from live panel config at pay time (the audit's staleness defect, now structurally impossible: `computePanelSplit` is deleted). PANEL settlement additionally requires the persisted patient portion to be exactly zero. Legacy invoices with NULL responsibility stay explicitly unresolved — **no silent backfill**, even when PAID with amounts present; the recalculator refuses non-UNPAID invoices.

**Verification**: 48 owner-enumerated tests landed across `billing-calculation.spec` (25), `billing-worklist.spec` (9), invoice + panel-benefit (113), prescription dispense rewrite (28), completion suites updated for source-aware detection; 744 backend, 328 frontend, both typechecks clean; live dispense harness 6/6 including the CONTROL; migration `20260804042144_billing_foundation_closure` applied. Live API smoke of the settled flow recorded in the checkpoint report.

**Known limitations**: no discount-clearing endpoint (cancel-and-reissue territory, owner-gated); consultation fee absent until 3b2's auto-proposed source-linked item; no UI for discounts or benefit capture (3b2); legacy NULL invoices resolve only through explicit Billing Review; percentage-copay base is the post-limit covered amount by owner decision 3.

---

## D-094 — G4.5d3c-3b2: the counter can finish the bill

3b1 made billing responsibility real and enforced it. This is the workspace that lets someone *resolve* it — and the consultation fee that nobody has to remember. Route: the existing `/billing/visits/:visitId` behind the existing billing gate. No new Finance module, no new design system, no Doctor Canvas changes.

### The consultation fee is configuration, not memory

The 3b0 audit's plainest operational gap: a locum records medications and the consultation fee is simply lost. A clinic now configures **consultation tariff rules** (Clinic Settings → Consultation Tariffs): rule name, active flag, visit classification, a clinic-local `HH:MM`–`HH:MM` band inclusive at both ends, the ServiceCatalog record to charge, optional effective dates, branch scope. `startTime > endTime` crosses midnight, so 23:00–07:59 is one band. **A rule carries no price**: it selects the SERVICE, and the approved 3b1 resolver prices it — specific `PanelPriceOverride` → cash + panel service markup → cash. Panel consultation rates therefore live where every other panel rate lives; there is no second pricing surface to drift. The owner's shapes are all representable and all proven live: cash day RM35 / night RM50, AIA day RM20 / night RM30 (different per band), MARA RM40 in both bands. No panel name, time or price is hard-coded. **A clinic with no active rule has consultation auto-billing off** — existing tenants behave exactly as before until they configure one.

### The tariff follows the consultation, not the clock

The timestamp source, in order: the visit's earliest `CONSULTATION_STARTED` workflow event; else `QueueTicket.calledAt`; else `Visit.checkInAt`. All three are stored before billing opens. The enum value existed since D-083 with no writer — the WAITING → IN_CONSULTATION queue transition now writes it **inside the same transaction as the status change**, so a visit whose ticket says the consultation happened cannot lack the timestamp that prices it. Invoice-creation time, Billing-Review-open time, payment time and the current clock are never consulted. Proven live: a 22:55 consultation bills the DAY tariff no matter when billing runs. Times convert through the clinic's stored IANA timezone via `Intl` — a real conversion of a real instant, deliberately not the appointment module's local-time-in-UTC-getters simplification, because these are event timestamps rather than schedule templates. Overlapping bands resolve narrowest-first, oldest rule as tiebreak: a stable answer, never an arbitrary one.

### Auto-add is an idempotent write, never a read with a side effect

Billing Review invokes `POST /invoices/:id/ensure-consultation` once per invoice on open. It locks the visit `FOR UPDATE`, resolves the state, and adds a source-linked, server-priced, quantity-1 line only when the resolver says READY. **One active consultation line per visit** is the rule; the source link is the visit id (consulting has no order row) plus the rule that selected it. Five concurrent calls produce exactly one charge — proven against the live database, not asserted. A financial write was deliberately kept out of any GET, and out of a browser-only effect.

### Exemptions are recorded, never inferred

`VisitClassification` (CONSULTATION | OTC_ONLY | DRESSING_ONLY | PROCEDURE_ONLY | FOLLOW_UP_NO_CONSULTATION) on the Visit — NULL derives (an OTC-queue visit is OTC_ONLY, everything else a consultation). Set by counter staff, locked once the visit completes, never read from diagnosis or note text. A classification with no configured rule is EXEMPT and silently uncharged; a CONSULTATION visit whose time no band covers is `CONSULTATION_TARIFF_REVIEW_REQUIRED` — a blocker that names the configuration screen, with **no guessed line**. Where a real consultation did occur on an exempt visit, `POST /invoices/:id/consultation-charge` adds it explicitly, still rule-driven and still server-priced.

### Waiving is cancelling, with a reason

An auto-added consultation is waived through 3b1's auditable cancellation: `cancelReason` is now **mandatory** (min 3 chars) at the DTO, and the action moved from EDIT_LINES to a new **CANCEL_LINE** tier — OWNER_ADMIN, FINANCE_STAFF and FRONT_DESK_CLINICAL_STAFF. Doctors are refused: they do not manage billing corrections from the clinical surface. The UI offers the owner's reason list with a free-text "Other". A waived consultation leaves the totals, stays in history, recalculates responsibility, and is **never silently re-added** — only the explicit add brings it back.

### Sourced quantity is the server's too

3b1 moved price server-side and left quantity to the client. Closed: a prescription-sourced line bills `Prescription.quantity`, an order-sourced line bills 1, consultation bills 1, and a client figure is ignored in all three. Only a **DISPENSED + ONSITE_DISPENSE** prescription can be finalised as a medication charge — v1 bills what was actually supplied, so partial dispensing is refused rather than approximated. An uncompleted TASK_ORDER and a cancelled order are refused. Manual lines still take an explicit quantity and price and stay MANUAL, for operational charges with no clinical source.

### The worklist says why, not just what

States expanded to READY / AWAITING_DISPENSE / UNRESOLVED_SUPPLY / NOT_READY / NOT_CHARGEABLE / TARIFF_REVIEW / WAIVED, each with a `stateReason`, the source's own status, supply mode and server quantity. Non-chargeable sources are now **listed with their reason** rather than omitted, so the counter can see that an external prescription was considered and correctly excluded. "Add to invoice" appears only where the server says READY. Doctor-phase routing widened to `pendingBillingWork` (ready-but-unbilled *and* ordered-not-yet-dispensed) plus tariff review, so a visit with billing ahead of it never routes past the counter.

### Payment refuses what the counter cannot yet know

`pay()` additionally refuses while any READY source is unbilled (naming the items) or a consultation tariff needs review, and PANEL now requires a **positive panel amount** as well as zero patient responsibility. Labels: Cash, Card, QR Payment, Bank Transfer, and **"Panel — No Patient Payment"** — which says the patient owes nothing and never that the panel has paid; that receivable stays with Finance → Panel & Claims. All-or-nothing is unchanged: no partial amount input exists. Settling refreshes invoice, worklist and blockers together, and **never completes the visit**.

**Verification**: 820 backend tests (37 suites) and 407 frontend tests (20 files), both typechecks clean; migration `20260804054027_consultation_tariff_and_billing_review`; 32/32 live checks against the running API and real database (`prisma/g45d3c3b2-billing-review-check.ts`) covering the 22:55 example, midnight-crossing bands, five concurrent ensures → one charge, AIA/MARA panel pricing, all three exemptions, waiver reason enforcement, quantity/price truth, discount tiers, and every payment gate; 18 screenshots in `docs/g45d3c3b2-screenshots/` with no horizontal overflow at 1440/834/375. Two existing expectations changed deliberately, both because the approved behaviour changed: the queue's WAITING → IN_CONSULTATION assertions now check the transactional write plus the event, and one line-cancellation test supplies the now-mandatory reason.

**Known limitations**: no partial dispensing, so a short-supplied medication must be corrected by cancelling and re-adding; the tariff has no public-holiday or per-doctor dimension (deliberately out of v1); a rule cannot be deleted, only deactivated; no discount-clearing endpoint; consultation for a walk-in with no ticket falls back to `checkInAt`, which is the registration moment rather than the consultation's; internal pricing provenance is persisted but has no management surface to read it yet.

---

## D-095 — G4.5d3c-3b: the queue tells the truth, and the visit can be closed

Three checkpoints built the machinery to decide whether a visit may end. This one shows it and acts on it. Route unchanged: `/queue`, existing design, existing permission model.

### The queue stopped losing patients

`QueueManagementPage` filtered four statuses. `AT_PROCEDURE`, `READY_FOR_DISPENSARY` and `READY_FOR_PAYMENT` matched nothing — so the moment a doctor completed their phase, that patient **disappeared from the board entirely**. Six stages now, with every status mapped in one table (`queue-stage.ts`, mirrored by `queuePresentation.ts`): Waiting, Consultation (holding both IN_CONSULTATION and AT_PROCEDURE, the latter carrying an "At procedure" indicator rather than a tab of its own), Dispensary, Payment, Completed. CANCELLED has *no* stage and is counted separately, never as active work. The legacy `DISPENSARY_PAYMENT` shows under Payment labelled "Dispensary/Payment — Legacy"; nothing creates new ones. A spec asserts every enum member reaches a stage, because a status with no home is a patient nobody can see.

### One server read, and the browser decides nothing

`GET /queue-tickets/board` returns each ticket with its stage, dispensing progress (clinic-dispensed medication only — an external script is not dispensary work), billing state from the **persisted** 3b1 calculation, outstanding blockers, and `canComplete`. That last field is the point: eligibility is decided by the same `collectBlockers` the completion endpoint runs, **imported rather than reimplemented**, because a board computing its own answer eventually offers a button the server refuses. Blockers are evaluated only for stages where completion is plausible; per-visit evaluation is still several queries and batching it behind one loader is recorded as a limitation rather than solved by duplicating the rules.

### Complete Visit lives in one place and asks first

Queue Management only. Billing Review *resolves billing* and, once clear, says so and offers **Return to Queue** — there is deliberately no second completion button there. Every completion path calls `PATCH /visits/:id/complete`, the one operation that sets `checkOutAt`. The action is offered only where the server said yes; where it said no, the control stays visible but disabled **with the reason attached** (tooltip and `aria-description`), so staff learn what to fix instead of wondering where the button went. A role without the permission sees no button at all. Confirmation is mandatory and states what is being asserted: patient, visit, doctor phase, procedures, dispensing, billing, patient balance, and — where relevant — the panel's share, labelled as claimed by Finance and explicitly **not patient debt**. The preview can go stale, so a 400 carrying blockers is caught and displayed rather than reported as a generic failure.

### Two things cannot be closed over

**Dispensing.** `DISPENSING_PENDING` blocks completion for every role including OWNER_ADMIN; there is no override, and the live proof exercises front desk and owner side by side. Medication that has not been supplied cannot be waved through a queue button — the supply mode or the dispensing itself has to be resolved in the clinical workflow.

**An outstanding patient balance.** The visit stays in Payment. No write-off, no left-without-payment, no credit approval, no owner override: those need an auditable financial policy that does not exist yet, and the patient leaving the building is not the same fact as the bill being settled.

A **panel receivable is not either of those**. A visit whose patient owes nothing completes even though the panel has not paid the clinic — proven live, and the confirmation says so in words.

### Blockers carry destinations, not just complaints

Each blocker names the problem, who resolves it and where to go: clinical blockers to the clinical visit, money blockers to Billing Review. Counter staff are never handed a clinical action — the procedure blocker says in as many words that they must not mark it done. Consultation-tariff review gets no tab of its own: it is badged in the Payment row and counted in the payment workload, per owner decision 5.

### Mobile closures from the 3b2 review

The floating chat launcher sat on top of "Add to invoice" on a phone. Billing Review and Queue Management now carry `kw-operational-surface`; below 992px the launcher stands down there (chat stays in the header), and above it the surface keeps a clear corner — verified by measuring the launcher's rectangle against every button on the page. "Set visit type" became a real control that, once set, reads "Visit type: Consultation [Change]" with the full accessible name retained. Three further defects the screenshots exposed and this checkpoint fixes: the invoice action column clipped at desktop width (columns carrying no information — Discount when nothing is discounted, Panel on a self-pay bill — are no longer rendered), the queue page title crushed to one character per line on a 375px screen, and "RM 60.00" breaking the same way inside the confirmation modal.

**Verification**: 860 backend tests (39 suites) and 447 frontend tests (22 files), both typechecks clean; **34/34 live checks** against the running API and real database (`prisma/g45d3c3b-queue-completion-check.ts`) covering stage mapping, cancelled exclusion, all four valid routes, panel-covered completion, the owner's inability to bypass dispensing, balance blocking, permissions, and completion effects — including that four **concurrent** completions produce exactly one completion and one workflow event, a repeat reports the original `checkOutAt`, and completion changes no stock, no invoice total and no panel receivable. 18 screenshots in `docs/g45d3c3b-screenshots/`, no horizontal overflow at 1440/834/375.

**Known limitations**: the board evaluates blockers per visit rather than through a batch loader, so a very large active queue costs more queries than it should; there is still no queue-side action that moves a ticket from Dispensary to Payment (that transition belongs to the Dispensary Workspace, and the interim path remains the clinical visit); `AT_PROCEDURE` has an indicator but no procedure-specific column; the Waiting and Consultation tabs still read from the ticket list rather than the board, so their rows carry no billing state (they do not need it yet); and completed history is capped at today's tickets.

---

## D-096 — G4.5d3c-3c: the Canvas stops costing the doctor time, and documentation stops holding the patient

Seven things the owner reported from using the Canvas at clinic pace. None of them is a feature; all of them are friction that multiplies by 100–200 patients a day. No schema change, no migration.

### The note editor is bounded

D-090 removed the editor's fixed height so a short SOAP note stopped reserving hundreds of blank pixels. The consequence, unnoticed until a long consultation, was that it then grew **without limit**: the diagnoses, medications, orders and the Consultation Footer were pushed steadily down the page, and finishing a consultation meant scrolling past everything just written to reach the button. A floor *and* a ceiling now — `min(52vh, 520px)` on desktop, lower on tablet and lower again on a phone — with the doctor's own text scrolling **inside** the editor past that point. The surrounding Canvas stops moving. The signed-note surface is bounded too: a long sealed note buries the footer exactly as a long draft does.

**Focus Mode** widens the note by standing the rail down, and does so entirely through a class on `<body>`. That mechanism is the decision. Rendering a different, wider layout would unmount `RichTextEditor`, destroying the TipTap instance along with the cursor position and the undo history — and C1 (D-052) and D-078 both exist because unsaved clinical text has been lost to remounts before. A class toggle cannot cost a keystroke, and the tests assert mounts, not renders. Escape exits, because a mode with no keyboard exit is a trap.

### BMI is calculated while it is being typed

There were two implementations of the clinic's BMI rule on the client and none in the entry form: the doctor had to save a set of vitals and wait for a round trip to learn the BMI of the patient in front of them. One function per process now — `vitalsBmi.ts` on the web, `vitals-bmi.ts` on the API — over `weightKg / (heightCm/100)²`, one decimal, and a **shared fixture table asserted identically on both sides** so they cannot drift. (`apps/api` does not depend on `@kuwick/shared` — no dependency, no tsconfig path, no jest mapper — so a genuinely shared module would have meant wiring that package into the Nest build for one formula. The duplicated table is the guard instead, and it is load-bearing.)

Everything else in that module exists to make the formula safe to render on every keystroke against half-typed fields: zero height would be Infinity, a partially typed field is *not knowable* rather than zero, and a non-numeric string is NaN. The contract is a finite positive number or null — never NaN, never Infinity, never a string the caller has to re-check. No network request: typing a weight must not cost a request.

### Vitals: the fields are simply there, and the duplicate is prevented rather than hidden

Recording began with an Add action that revealed the form — one click before any typing could start, on the commonest act on the panel, on every visit. The entry fields are the panel's resting state now, with saved readings above them as a compact **editable** summary. No field, no attribution and no correction rule was removed: Correct still opens the same form with the same mandatory reason and the same immutable revision behind it.

The duplicate the owner reported had **two** root causes, and neither was rendering:

1. **The form submits on Enter.** The Save button carries `loading`, which stops a second *click* — Enter submits the form directly and never consults the button. A nurse types the last figure, hits Enter, sees nothing on a slow network, hits Enter again. Two POSTs, two rows, one reading.
2. **`record()` had no server-side protection of any kind.** It inserted unconditionally on every call; nothing in the controller, the service or the database asked whether that reading was already there. Any retry produced a second row.

Both are fixed, independently, because a guard living in a browser protects one form. The server compares the incoming reading against the most recent one **by the same recorder, on the same visit, inside sixty seconds**, using the same canonical content hash the revision trail already uses — so 36.5 and 36.50 are one reading and the decision cannot drift from how the record hashes itself. A match returns the existing row rather than an error, which makes a retry safe. The check-then-insert is made atomic by a transaction-scoped **advisory lock keyed on the visit**: there is no existing row to claim atomically (D-087's pattern needs one), and without the lock two concurrent requests would both read the state before either insert. Proven live: four concurrent identical submissions produce one observation and one audit revision, with all four callers getting a success.

Each of the three conditions excludes a legitimate case. A repeat BP after treatment is a real clinical act — any changed value is a new row, an identical reading later is a new row, and a second nurse confirming a reading is a separate, separately attributed act.

### Attachments: several at once, and a PDF that says it is a PDF

The file input had no `multiple` and the handler took `files[0]`. A doctor selecting four scanned pages uploaded one and the browser discarded three, silently. Every chosen file is uploaded now, **sequentially and each in its own request**, with its own progress and its own result: one rejection marks that file failed and the loop continues, and the files that landed are stated as uploaded so nobody re-uploads a wound photo and creates a duplicate. Not `Promise.all` (which cannot say *which* file failed) and not a bulk endpoint (which would lose the good files with the bad).

A PDF is never rendered as a picture — an `<img>` pointed at PDF bytes shows the browser's broken-image glyph, which inside a clinical record reads as *the file is missing* rather than *this is a document*. It gets a file card with its icon, its type in words and a download action. On the Canvas strip a non-image used to be the bare text "1 non-image", with no name and no way to open it; it is a card there too. Classification falls back to the file extension when the MIME type is `application/octet-stream`, which is what several scanner and phone-share paths send.

### Medication supply mode

The control was already visible and already pre-selected (D-091). What was missing is that a pre-selected value reads as a choice somebody made, so doctors stopped reading it: it labels itself as the default now, and says when to change it. The schema still has **no** column default, deliberately — a column default would make a row nobody looked at indistinguishable from one a prescriber deliberately set (D-084). A pre-selected control cannot do that.

**Copy Previous** wrote no supply mode at all, so every copied line arrived NULL and each one became a blocker to clear by hand; five repeat medications produced five blockers. The explicit rule now: **carry over what the source recorded; where the source recorded nothing, or recorded DEFERRED, take the clinic's default.** Carrying over matters — silently converting an external prescription to clinic dispensing would assert the clinic is supplying medicine it is not. Defaulting matters too: a copy is a new prescribing decision made today (the service already re-authors it for that reason), so it gets the same visible default a freshly typed line gets. DEFERRED is treated as unrecorded because it was a decision about a visit that has ended, and carrying it forward would manufacture a new blocker out of an old hesitation. **The source row is never rewritten** — a legacy NULL stays NULL and stays unresolved. The clinic is told which happened, because the rows alone cannot say.

### Documentation Pending: the note stops holding the patient, and still holds the visit

An unsigned clinical note refused the whole doctor-phase routing decision. A patient with a prescription in hand sat in the consultation room until the prose was finished — which inverts the queue in a clinic seeing 200 patients a day, because the note is written between patients or at the end of a block, and none of that is a reason for someone to wait.

`SIGNED_NOTE_REQUIRED` is gone from the doctor-phase blockers. The requirement itself is not: it moved to `VisitCompletionService` as `CLINICAL_DOCUMENTATION_PENDING`, where it holds the **paperwork** instead of a person. A visit could never close without a signed note before and it still cannot — for every role, owner included, with no override. Nothing auto-saves and nothing auto-signs; the draft in the editor is untouched by completion, and the live proof asserts that completing with the note unsigned writes zero clinical notes.

The state is **derived**, not stored: it is the same signed-narrative count the blocker was built from, so it can never disagree with the notes themselves, and no migration was needed. What *is* recorded is the answer **at the moment of completion**, on the append-only `DOCTOR_PHASE_COMPLETED` event, which already carries the actor, the actor's name and the time. That one has to be stored: re-deriving it later would silently rewrite itself the instant the doctor went back and signed, erasing the fact that the patient was sent on without a record. A phase completed before this was recorded reads NULL — *not recorded*, which is not the same as *documentation was complete*.

The footer distinguishes four cases, and **amber and red mean different things**: amber is a state that permits the action, red is one that forbids it. Red had come to mean both, and a doctor who sees the same alarm for "you cannot proceed" and "you have not finished writing" learns to read neither.

- **A** — eligible, documentation complete: neutral, green chip, ordinary confirmation.
- **B** — eligible, documentation pending: **amber** panel, "Clinical note not signed" chip, the action unchanged and never withheld, and the confirmation asks *"Send Patient with documentation pending?"* — naming the consequence rather than implying the software will handle it.
- **C** — blocked: **red**, the action withheld. The documentation state is not shown beside it; a doctor facing a real blocker does not need a softer problem competing for the same glance.
- **D** — completed with the note still unsigned: amber, naming who sent the patient on and when, from the recorded event.

**Verification**: 927 backend tests (42 suites) and 608 frontend tests (27 files), both typechecks clean; **36/36 live checks** against the running API and real database (`prisma/g45d3c3c-canvas-speed-check.ts`). 20 screenshots in `docs/g45d3c3c-screenshots/`.

**A latent flake fixed on the way**: `visit-completion.service.spec.ts` supplied no consultation start time, so D-094's tariff matching formatted the current wall clock instead — the assertions passed by day and failed between 23:00 and 08:00 clinic time. The fixture now pins a fixed instant.

**Known limitations**: the sixty-second duplicate window is a judgement, not a measured threshold — it is short enough that no genuine repeat measurement can fall inside it, and any changed value bypasses it entirely; the advisory lock serialises concurrent vitals writes per visit, which is correct but is a serialisation point if a clinic ever records vitals from several devices at once; multi-file upload is sequential by design (a shared clinic connection makes six concurrent multi-megabyte photos slower and likelier to time out), so a large batch is as slow as the sum of its files; the attachment endpoint enforces a 15 MB size limit but **no file-type allow-list** — the browser's `accept` attribute is a picker hint and stops nothing on the wire, so a direct caller can post any type into a clinical record. That is pre-existing and is reported rather than closed here, because deciding which document types a clinic may attach is a policy call and not something to settle inside an upload-ergonomics fix.

---

## D-097 — G4.5d3c-3c1: the vitals panel goes quiet again, and an attachment has to prove what it is

Two closure corrections on D-096. Narrow by intent: no routing change, no BMI change, no change to the duplicate-vitals protection.

### The resting state after a save is compact

3c made the entry fields the panel's resting state, which was right for a visit with nothing recorded and wrong for one with a saved reading: the compact summary AND an empty form were both on screen. That is not a state anybody asked for, and it cost most of the Canvas to display it.

The panel now has an explicit mode instead of two booleans that could both be true:

- **FIRST_ENTRY** — no observations exist. The fields *are* the panel: no Add step in front of them, and no Cancel, because there is nothing to go back to.
- **SUMMARY** — the resting state once anything is saved. Every value, the BMI, the recorder and the time, with **Edit** and **Record New Reading**. No form underneath.
- **EDIT** — correcting one specific reading. Populated from it, carrying its `expectedVersion`, still requiring a reason and still writing an immutable revision (C0/D-051 untouched). Cancel returns to SUMMARY having written nothing.
- **NEW_READING** — a deliberate later measurement. Blank, no reason field, creates a row.

The mode is `null` by default and *follows the data*; only a deliberate Edit or Record New Reading pins it, and finishing either releases it. That is what makes a successful save land in the summary rather than back on an empty form — the defect being corrected is structurally impossible now rather than fixed by an extra `setState`.

**Edit and Record New Reading are deliberately different actions with different words**, because they are different clinical claims: one says the recorded reading was wrong, the other says the patient was measured again. An always-open blank form conflated them by default, which is exactly the ambiguity the owner's correction removes.

One implementation note worth keeping: the form is only *mounted* in a form mode, so its fields cannot be populated from the click handler that opened it — antd warns the instance is not connected to any Form, and the values would be written into a form that does not exist yet. Population happens in an effect keyed on the mode.

### An attachment has to prove what it is

The endpoint enforced a 15 MB limit and nothing else. The browser's `accept` attribute is a picker hint: a direct caller never opens a file picker, so **anything at all** could be written into a patient's record and served back with whatever Content-Type it claimed.

Four types for v1 — JPEG, PNG, WebP, PDF — and three checks that must **all** pass:

1. the **declared MIME type** is on the allow-list;
2. the **extension** is on the allow-list *and* agrees with the declared type;
3. the **file's own leading bytes** identify it as that type.

The third is the only one a caller cannot talk their way around, and it was available for nothing: the upload interceptor already uses `memoryStorage`, so the whole buffer exists before anything reaches disk. No new dependency, no format parsing, no execution of the content — a comparison of the first few bytes against a fixed table. `payload.exe` renamed to `report.pdf` and declared as `application/pdf` satisfies checks 1 and 2 and is refused by 3.

What this deliberately does **not** do is decode, re-encode or sanitise image content. That needs an image library — a large dependency with its own history of parser vulnerabilities, on a path that handles hostile input by definition. A strict allow-list plus signature inspection is the strongest thing available without importing that risk, and the spec asked for the strongest *practical* validation, not the heaviest.

Applied to **both** clinical upload endpoints. An order result is a clinical attachment by any other name, and a policy covering one and not the other would simply move where the unvalidated file goes.

Three further things the same change closes: the stored filename is **sanitised** before it is persisted (it is rendered in the record, used as the download name and echoed into a `Content-Disposition` header — a newline there is a response-splitting primitive); the stored MIME type is now the **validator's**, not the request's, so what is served back is a type the clinic actually accepted; and the picker's `accept` list was narrowed from `image/*` to the four real types, so the dialog stops offering formats that could only fail on arrival. That last one is a convenience, not a control, and is documented as such.

The refusal message is uniform — *"Unsupported file type. Upload JPG, PNG, WebP or PDF."* — whichever check failed. Telling a caller *which* one they tripped is a free oracle for the next attempt, and it tells a clinic nothing they can act on. It is rendered as **visible text against the file that failed**, not a tooltip: a tooltip is unreachable on a touch screen and invisible to anyone scanning the list.

Everything the correction required to survive, survives: the 15 MB limit, multi-file selection, per-file results, one rejected file not cancelling the permitted ones in the same selection, tenant and branch checks, authenticated retrieval, image thumbnails and PDF cards.

**Verification**: 966 backend tests (43 suites) and 628 frontend tests (27 files), both typechecks clean; **24/24 live checks** over real HTTP (`prisma/g45d3c3c1-attachment-security-check.ts`) including seven hostile uploads sent without a browser anywhere in the path, and **36/36** on the re-run 3c suite. 6 screenshots in `docs/g45d3c3c1-screenshots/`.

**Three test fixtures were strengthened, not weakened**, and it is worth saying why they changed: `visit-attachment.service.spec.ts`, `order-service.service.spec.ts` and the 3c live script all uploaded buffers that were not the type they claimed (`Buffer.from('x')` as a PNG, zero-filled arrays as PDFs). The old endpoint accepted them because nothing looked at the bytes. They now carry real signatures — a fixture claiming to be a PNG has to be one, exactly as a hostile upload would have to be.

**Known limitations**: content is validated but not sanitised, so a *genuine* JPEG carrying a malicious payload in its metadata is stored as-is (mitigated by `Content-Disposition: attachment` on retrieval, and by the fact that closing it needs an image-processing dependency this phase deliberately avoids); a PDF is accepted on its header alone and its interior — JavaScript actions, embedded files — is not inspected, which would need a PDF parser with the same objection; HEIC and TIFF remain unsupported, so a doctor whose phone shoots HEIC must convert before uploading, and admitting them is deliberately deferred until preview support exists; and the picker's narrowed `accept` list will hide a legitimate file from the dialog if a clinic's scanner emits an unusual MIME type for a PDF, in which case the file can still be chosen via "All files" and will pass validation on its bytes.

---

## D-098 — G4.5d5b: the dispensary gets its own counter, and a drug label stops being written by the browser

Dispensing lived inside the Doctor's Medications tab. The person handing medicine to a patient was working in a clinical editor built for somebody else's job, on a screen that also offered to change the prescription — and two things had gone unnoticed underneath that.

**`dispense()` called `requireActor` and nothing else.** Any authenticated staff member of any role, from any branch, could move clinic stock. Authentication is not permission. There is now a written action matrix (`dispensary-authorization.ts`) covering view, print, dispense and resolve-stock, enforced on every route and re-enforced inside each transaction alongside the existing branch check. The owner's v1 decision holds: **no new DISPENSARY_STAFF role** — a small Malaysian clinic has no dedicated dispenser, so existing roles carry the actions. `STOCK_STAFF` may look at the board and fix stock; they may not hand medicine over, because that is a clinical hand-over with a named dispenser on the record. `FINANCE_STAFF` cannot see the dispensary at all.

**The drug label was assembled in the browser and left no record.** A medication name and a set of directions that reach a printer from page state are a name and directions nobody has verified against the prescription, and a clinic could not answer "was this label printed, and by whom" — the question that only ever gets asked when something has gone wrong. Labels are now composed **server-side from the record** inside one tenant-scoped transaction, and printing writes an append-only `label_prints` row with a sequence allocated against a unique constraint, so two simultaneous prints cannot both be "the first".

**Nothing on a label is fabricated.** No generic name, no dosage form, no route, no structured warning, no translation and no barcode: the schema carries none of them reliably, and a route printed wrongly on a medication label is a patient-safety defect rather than a cosmetic gap. Where a field is absent it is omitted — never filled with a plausible default, and never left as a labelled blank, which reads as a decision somebody made. The clinic branch line is omitted for the same reason: `Clinic` stores a name and no separate branch label.

**PRINT LABEL != DISPENSE**, and it is proved rather than asserted. Printing moves no stock, changes no prescription status, moves no queue ticket, creates no invoice line, takes no payment and completes no visit. Live check 13–15 reads the stock level, the prescription, the ticket, the movement count and the invoice count either side of a real print over HTTP and asserts every one is unchanged.

`READY_FOR_DISPENSARY` had **no outgoing edge at all** in `queue-authorization.ts` — the map said a patient could arrive at the dispensary and never leave. It now moves to `READY_FOR_PAYMENT` or `CANCELLED`, and dispensing the last clinic-supplied medication moves the ticket atomically and records one `DISPENSING_COMPLETED` event.

**The quantity is never accepted from the caller.** There is no partial dispensing in this product, so the server reads the prescribed quantity from the record and the workspace shows it as text rather than a field. Live check 20 sends `quantity: 1` and `quantityDispensed: 1` deliberately alongside the request and asserts the full prescribed 15 moved.

**Where stock and prescription units cannot be compared, the answer is that they cannot be compared.** There is no unit-conversion model: dose × frequency × duration cannot be turned into bottles or millilitres without one. `UNIT_UNKNOWN` renders as "Unit needs review" with no number attached, because a confident wrong figure in front of a dispenser is worse than an honest absence. A shortage does not block dispensing — that was the approved policy — but it is never silent: the confirmation disables itself until the dispenser ticks an explicit acknowledgement, and the stock movement records that they did.

Multi-dispense runs **one transaction per prescription**, not one for the batch. A failure on the fourth item must not roll back the three already handed across the counter, and the result is reported per item rather than summarised by its worst outcome — "failed" on a mixed batch is how a dispenser is sent to hand over medicine that has already left the shelf.

The workspace itself is a **split, not a table with a drawer**: the dispenser's attention moves between "who is next" and "what do they need" continuously, and both panes scroll independently. Nothing is auto-selected, because on a busy board the first row changes as people are served. Invalidation after dispensing touches the board, that visit's prescriptions and the queue — and nothing clinical, preserving C1/D-052 and D-091.

**Two defects were found by the verification itself, and both are fixed rather than noted.**

The first: `label_prints` was created with a single permissive `tenant_isolation` policy and a `GRANT SELECT, INSERT`, and its comment claimed append-only. Both halves were true and the conclusion was wrong — a policy with no `FOR` clause covers every command, and the application connects as the table's owner, who holds every privilege regardless of grants. A plain `DELETE FROM label_prints` succeeded against the running database. Closed the way S3d (D-083) closed it for `visit_workflow_events`: separate SELECT and INSERT policies with no UPDATE and no DELETE policy at all, under FORCE RLS, plus a `REVOKE` of UPDATE, DELETE **and TRUNCATE** — TRUNCATE being a separate privilege that RLS does not filter, and which would otherwise empty the whole history in one statement.

The second: `colorWarning` and `colorSuccess` were handed antd the *chip foreground* values from the token file. antd derives a whole ramp from its base colour, so deriving a background from a near-brown `#92400e` is what made every warning Alert in the application render as muddy tan. antd now gets the hue at its natural mid saturation; `KuwickStatusTag` keeps the explicit fg/bg pair, where the contrast was chosen rather than calculated.

**Preview is not print.** The workspace shows the dispenser the label before it goes to the printer, and that preview must come from the record — but it must not land in the print history, or "was this printed" stops meaning printed. `GET …/label-preview` shares the assembly and the eligibility refusals with `POST …/label` through one loader and one composer, writes nothing, and reports what the *next* print would be so a reprint says "Reprint #2" honestly.

**The append-only guarantee has a cost, and it is stated rather than discovered later.** Because `label_prints` references `prescriptions` `ON DELETE RESTRICT`, and the referential-integrity check locks referencing rows using privileges the migration revokes, **no prescription can be hard-deleted by the application role at all** — measured, and true even for a prescription with zero label prints. Production is unaffected: prescriptions have always been soft-deleted (`deletedAt`) and no route hard-deletes a visit. The four fixture-cleanup scripts and the shared `visitDeleteStatements` helper now soft-close prescriptions and visits instead of erasing them, which is the same trade `visit_workflow_events` made under D-083.

**One stale fixture was corrected, not the product.** `g45d3c3b-queue-completion-check.ts` predates D-096 and created no clinical note, so every completion it asserted had been failing on `CLINICAL_DOCUMENTATION_PENDING` since the 3c baseline landed. The fixture now writes a SIGNED narrative for visits whose doctor phase is finished — matching what the product requires — while the 3c suite continues to prove that an unsigned note blocks completion.

**Verification**: 1079 backend tests (46 suites), 788 frontend tests (33 files), both typechecks clean, 57 migrations applied; **27/27 live checks** over real HTTP (`prisma/g45d5b-dispensary-check.ts`) including seven refusals sent with no browser in the path; 28 populated screenshots in `docs/g45d5b-screenshots/`.

**Known limitations, stated plainly**: the 70 × 40 mm print preset has been checked against the browser's own print preview and **no thermal printer has been tested** — there is no printer SDK, no silent printing, and printing goes through the standard browser dialog, so a clinic must verify their own label stock before relying on the alignment (`docs/DISPENSARY_LABELS.md`); the label carries no barcode or QR code; there is no partial dispensing, no medication return and no dispense reversal after hand-over, all excluded by decision; a dispensed row cannot be corrected through the application at all, so a mis-dispense is an inventory adjustment; the board's stock comparison is only made where the prescription's quantity is genuinely a stock-unit quantity, and says so otherwise; and `STOCK_STAFF` can be granted `RESOLVE_STOCK_ISSUE` by the matrix but the dispensary offers no control for it — the work is done in Inventory, and the permission exists so the server has an answer if a route is added later.

---

## D-099 — b0/b1-0: one attachments region, and a medicine you can find by the word the clinic uses

**Two duplicates, and the reason unit tests could not see either.**

The Canvas rendered `ClinicalImageStrip` and `VisitAttachmentsPanel` one above the other, each with its own "Attachments (N)" heading, its own thumbnails and its own Upload — and the strip's Upload button doubled as the expand toggle for the panel below it. So a doctor who attached a file saw the heading twice, the photo twice, and a Hide/Upload pair over the note area. Neither component was wrong. Every test either of them had passed throughout and would have kept passing: **a duplicate is invisible to a test that renders one of the duplicates.** Both are deleted; `VisitAttachments` is the only one, and it mounts in exactly ONE place (inside `ClinicalNotesTab`, below the editor, above the save row — where PDF p.2 puts it and where it cannot reach the typing area). Flow and Canvas get the same region because they get the same mount, and the page owns no attachments state at all. Pinned by a rendered count in both layouts before AND after a real upload, by a source-tree assertion that there is one mount and both old components are gone, and by an E2E on the assembled page in both layouts that also asserts the region's box does not overlap the editor's.

**The attachment filing tag is stored, not derived.** `visit_attachments.category` (PHOTO | LAB | LETTER). The approved canvas settles it by itself: `referral-hosp.jpg` is an image file and a LETTER, so no rule over the MIME type can produce that screen. Upload SUGGESTS a kind from the file type and records **nobody** for it — `categorySetBy` stays null until a person actually files it, so "no human has classified this yet" stays answerable from the row. Re-filing goes through its own route, records who and when, and bumps `version` so a stale browser cannot overwrite a newer decision. LETTER is never guessed, because nothing in the bytes could guess it. The backfill lifts FORCE RLS and puts it straight back and then proves the rows moved, because `visit_attachments` is FORCE ROW LEVEL SECURITY and a bare `UPDATE` there matches zero rows and reports success (D-048).

**The diagnosis outage repeated itself in the medicine catalogue, and it took two different fixes.** 181 of the clinic's 236 medicines carry a Malay `groupTag` — BATUK, DEMAM, ANTIBIOTIK, 42 groups — and nothing looked at that column. Measured against the running server: "batuk" found **0** medicines, now 9; "demam" 0, now 5; "antibiotik" 0, now 26. The server matched `name` and `code` only. **Flow's Select never asks the server at all** — it loads the catalogue and filters client-side on the option's printed label — so a server-only fix would have left one of the two surfaces exactly as broken, which is precisely how the diagnosis defect survived a green build. Both now match name, code, groupTag and sourceName; the list is stated once in `item-search.ts` and tested, rather than re-derived in a `where` clause. Sentence columns (`remark`, `instruction`, `indication`) are deliberately excluded: "for cough and cold" in a remark would put an antihistamine under every cough search.

**The search row now says what the choice is actually made on** — group, strength, price, stock, CASH ONLY — where it previously said the strength and nothing else, so "which of these do we have, and what does it cost" meant leaving the consultation. Stock travels WITH the item rather than being annotated from a whole-table stock fetch: the same download-everything mistake `findAll` was bounded to fix, one table across. **"Out of stock" and "stock unknown" are different sentences**; a missing stock record is never rendered as zero, because nobody-has-counted-these and we-have-none send a doctor to different places. CASH ONLY is stated and never applied — turning the flag into behaviour is a billing decision a search list does not get to make.

**A design-system defect found on the way.** `KuwickSearchOption.detail` is documented as "a quiet second line" and was folded into the `title` attribute and nowhere else — a tooltip, which this project had already ruled out for upload errors as unreachable on a touch screen and invisible to anyone scanning a list. It renders as a real second line now; every `KuwickSearchSelect` gains it, Add Procedure included.

**Two defects found by the tests rather than by review, both fixed.** A fully successful upload batch now clears its progress list: the chip is the confirmation, and keeping "ear-left.png · Uploaded" under a chip that already says `ear-left.png` printed the filename twice — the same complaint as the doubled heading. A batch with any failure keeps its list, because the reason has to stay readable. And A0's viewport sweep failed the first attachment chip at 1366px, because the filename ellipsised: `overflow: hidden` on a clinical record's content is exactly what A0 exists to catch. **Exempting ellipsis from that sweep was the tempting fix and the wrong one** — antd's own card titles ellipsise, so the exemption would have masked the Vitals-title defect A0 was written for. The name wraps instead, and costs a second line.

**Owner decision, 2026-08-13 — a prescriber MAY override a medicine's price**, recorded with actor and timestamp, and that override sits at the top of the pricing precedence. Chosen over leaving it read-only and over requiring a reason. Not yet built; the constraint to hold when it is, is that it stores on the **prescription** (not the invoice line, which is derived), that `resolveSourcedPrice` stays the single place that resolves money and keeps returning null rather than trusting a client figure, and that a panel-contract price being beaten by a typed figure is visible to the doctor on a panel visit — the one case where they cannot otherwise see what they are overriding.

**Verification**: 1149 frontend tests (57 files), 1242 backend tests (52 suites), both typechecks clean, 66 migrations applied with no drift; the full Playwright suite green including the golden path and its OTC variant; the new category route exercised live over HTTP (200 with attribution and a version bump, 409 on a stale version, 400 naming the three valid kinds); CI green in Actions on both units and on master.

---

## Appendix — deletion-sensitive numbering still outstanding (report only)

Recorded at the owner's request after G4c1. **Nothing here is changed.** Each derives its next number from `count(*) + 1`, which is the defect D-068 fixed for visits: the count falls behind the highest number in use as soon as any row is deleted.

| | Invoice | Claim batch | Queue ticket |
|---|---|---|---|
| **Model / table** | `Invoice` / `invoices` | `ClaimBatch` / `claim_batches` | `QueueTicket` / `queue_tickets` |
| **Visible format** | `INV-000001` | `CLAIM-000001` | `ticketNumber` int → `displayNumber` `W001`, `A001`, … |
| **Allocation** | `invoice.count() + 1` | `claimBatch.count() + 1` | `count()+1` filtered to today, per clinic **per queue type** |
| **Unique constraint** | `@@unique([tenantId, invoiceNumber])` | `@@unique([tenantId, batchNumber])` | **none** — indexes only |
| **Scope** | tenant | tenant | intended: clinic + queue type + day |
| **Deletion possible?** | No API delete route (cancel only), but fixtures, data migration and manual correction all delete rows — Kuwick's own fixture ledger does | Same | Yes, and rows are naturally short-lived |
| **Impact of collision** | Unique index rejects → **invoice creation fails with a 500**; the clinic cannot bill | Batch creation fails; panel claims cannot be submitted | **No constraint to reject it** — two patients silently share a display number, e.g. two "W001" called to different rooms |
| **Reuse `VisitNumberCounter`?** | **Yes, directly** — same tenant scope, same shape; needs a series key or a second counter table | **Yes, directly** | **Partly.** The key would be (tenant, clinic, queueType, date) and it must reset daily, which a monotonic counter does not do by itself. It also needs a unique constraint before a counter is worth adding |

**Does any of this block Medical Record testing?** Not today: measured across all four tenants, `count` equals `max` for both invoices and claim batches, so no collision is pending. It becomes blocking the moment a populated fixture deletes an invoice — which Kuwick's own fixtures do — so it will bite during G4.5 populated testing rather than before it.

**Suggested order if approved:** invoice first (highest impact, direct reuse), claim batch second (same change), queue ticket last and separately, because it needs a unique constraint and a daily-reset key design first.

---

## Decisions requiring owner sign-off (not unilaterally decided — tracked here for visibility, detailed in `PRODUCT_REQUIREMENTS.md` §17)

- ~~Diagnosis deletion is a hard delete with no audit trail (D-059)~~ — **resolved by D-061.**
- ~~Documents are hard-deleted (D-061)~~ — **resolved by D-062.**
- ~~Visit attachments are hard-deleted, file included (D-061)~~ — **resolved by D-062.**
- ~~Order attachments are hard-deleted, file included (D-061)~~ — **resolved by D-062.**
- **Prescriptions are soft-deleted but unattributed**: `deletedAt` is set and the row survives, and deletion is blocked once the item leaves `ORDERED` — but no actor and no reason are recorded. Clinically better than the others, still short of the diagnosis standard. Recommended for a **medication-governance checkpoint after G3**.
- **Orders/procedures have no delete route at all** — only `cancel`, which sets `CANCELLED` and stores `cancelReason`. This one is already acceptable; it lacks a cancelling-actor field, which is a smaller gap.
- ~~Visit numbering breaks after any deletion (found in G4, D-067)~~ — **resolved by D-068.**
- ~~`POST /visits` does not verify the patient belongs to the caller’s tenant (found during G4c1)~~ — **resolved by D-069.**
- ~~`POST /appointments` does not verify the patient or clinic belongs to the caller’s tenant~~ — **resolved by D-070.**
- ~~`STANDARD_SERVICE` carries a task lifecycle it does not need (found in G4.5c, D-071)~~ — **resolved by D-073.**
- **One pre-existing duplicate invoice line, on a PAID invoice** (found in the D-073 audit). A single `TASK_ORDER` is charged twice on `DEMO-INV-00178`, which is `PAID`. **Owner decision (recorded):** do not modify or delete it — it stands as a legacy financial anomaly. The transactional duplicate guard stays; a database `UNIQUE` constraint waits until Kuwick has an audited credit-note / debit-note / financial-adjustment workflow able to correct a paid record safely.
- **Three numbering allocators are still `count(*) + 1`** — invoice, claim batch and queue ticket. Detailed in the appendix above; not blocking today, but the invoice one will bite during populated G4.5 testing.
- **The wider API RBAC gap remains open** (D-056). Clinical notes, observations, diagnoses, document authorisation (D-064) and the five invoice mutation routes (D-066) now have server-side role enforcement; the rest of the API does not.

These touch billing, panel claims, clinical workflow, or data ownership and are intentionally **not** resolved above:

- Doctor incentive formula: worked semantics now captured in full from Klinik Hijraa (`docs/PROPOSED_ADDENDUM_2026-08-01_klinik-hijraa-admin-reference.md`) — spec is no longer the blocker, building it is; still needs owner go-ahead to schedule (OQ#2, blocks 1c only)
- Booking-commission attribution mechanism (OQ#7, blocks the Online Booking Portal only)
- Yezza-audit drafts: multi-session packages (OQ#16), front-desk booking-rule override (OQ#17), payment-at-booking (OQ#18)
- Klinik Hijraa audit drafts not yet addressed: staff price tier (OQ#11), inter-branch billing (OQ#12), patient-app scope (OQ#13), clinical program generalization (OQ#14), WhatsApp delivery risk (OQ#15)
- Data migration mechanism from the existing Kuwick system
