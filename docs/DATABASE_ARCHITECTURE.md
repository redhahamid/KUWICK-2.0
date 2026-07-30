# Kuwick 2.0 — Database Architecture

**Status:** Target design for the full product. Core / Shared Foundation (§2), HR-lite `Staff` only (§5), Appointment (§4, minus `RecurringAppointmentTemplate`), Inventory & Procurement (§6, Phase 1d core), and Clinical Operations (§3, Phase 1a — `ServiceCatalog` only so far) are implemented in the live database. Everything else in this document is the schema later Phase 1 sub-phases build against, not yet created.

## 1. Foundational decisions

| Decision | Choice | Rationale |
|---|---|---|
| Engine | PostgreSQL 16 | Real constraints (checks, foreign keys, triggers, row-level security) enforce business rules instead of trusting application code alone |
| Multi-tenancy | Shared database, shared schema, `tenant_id` column + Row-Level Security on every tenant-scoped table | Confirmed multi-tenant SaaS direction (`PRODUCT_REQUIREMENTS.md` §2); RLS is a database-enforced backstop so an incorrect query can't leak one clinic's data to another |
| Primary keys | UUID (v4) on every table | Non-guessable, safe to expose in URLs/APIs, no collision risk across tenants, standard for multi-tenant SaaS |
| Deletes | No hard deletes on Patient, Visit, Invoice, Prescription, PanelInvoice, ClaimBatch, PurchaseOrder, or User/Role changes — soft-delete (`deleted_at`) only | These are exactly the entities `PRODUCT_REQUIREMENTS.md` §11 requires indefinite audit trails for; a hard delete would defeat that. The application's database role has no `DELETE` grant on these tables (defense in depth beyond app-layer discipline) |
| Timestamps | `created_at`, `updated_at` on every table; `deleted_at` where soft-delete applies | Standard, and `updated_at` feeds the audit interceptor's before/after diff |
| Naming | `snake_case` in the database, mapped to PascalCase Prisma models via `@@map`/`@map` | Postgres convention; keeps generated TypeScript idiomatic without fighting SQL convention |
| Migrations | Prisma Migrate, one migration per reviewed change, never edited after being applied to any shared environment | Standard, reversible, auditable schema history |

## 2. Core / Shared Foundation — **implemented now**

```
Tenant
 └─ Clinic (branch/location)
      └─ UserClinicAccess ── User ── Role (enum, see §5.1 of PRODUCT_REQUIREMENTS)
 └─ Patient
 └─ GlobalSetting
 └─ NotificationLog
 └─ AuditLog
```

- **Tenant** — id, name, status, created_at. The root of all data isolation.
- **Clinic** — id, tenant_id, name, address, timezone. A branch/location within a tenant.
- **User** — id, tenant_id, email, password_hash, status, last_login_at. Login identity; a `Staff` record (HR module, Phase 1) links a User to employment details.
- **Role** — fixed enum matching `PRODUCT_REQUIREMENTS.md` §5 (Owner/Admin, Doctor Resident, Doctor Locum, Front-Desk/Clinical Staff, Finance Staff, HR Staff, Stock Staff, Panel Staff, Patient Portal) — not a freeform per-tenant table, since the spec defines a fixed permission matrix, not custom roles.
- **UserClinicAccess** — join table (user_id, clinic_id, role) — a user's role can differ by branch (e.g., front-desk at one branch, none at another).
- **Patient** — id, tenant_id, identifier_type (`nric`/`passport` — see open question in `PRODUCT_REQUIREMENTS.md` §17.6), identifier_value, name, dob, gender, race, address, emergency_contact, allergies (jsonb), created/updated. One record per patient per tenant, shared across that tenant's branches — this is the "single source of truth" patient record every other module references, never copies.
- **GlobalSetting** — tenant_id, key, value (jsonb) — per-tenant configuration (e.g., surcharge %, default incentive rule).
- **NotificationLog** — id, tenant_id, trigger_type, channel, recipient, payload (jsonb), status, sent_at — every dispatched notification from `PRODUCT_REQUIREMENTS.md` §10.
- **AuditLog** — id, tenant_id, actor_user_id, action (`create`/`update`/`delete`), entity_type, entity_id, before (jsonb), after (jsonb), created_at. Append-only — no update/delete grants at all on this table, including for the application role.

Row-Level Security: every table above except `AuditLog` (append-only, no read restriction needed beyond RBAC) has:
```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = current_setting('app.tenant_id')::uuid);
```
set per-request by the tenant-isolation guard described in `SYSTEM_ARCHITECTURE.md` §4.

## 3. Clinical Operations — **`ServiceCatalog` implemented (Phase 1a, Phase 1); rest target design**

`ServiceCatalog`, `Visit`, `ClinicalNote`, `Diagnosis`, `Prescription`, `OrderService`, `Document`, `Invoice`, `QueueTicket`. `Visit` is the hub: it's what `Appointment` converts into, what `PanelInvoice` bills against, and what `IncentiveResult` totals up. Owned entirely by Clinical Operations per the data-ownership table; every other module reads it, never writes it.

**`ServiceCatalog` consolidates Appointment's temporary `Service` stand-in** (built in 1b, `appointment_services` table) — a table rename plus a new `price` column (selfpay rate; panel-tier pricing stays owned by Panel Claims' future `PanelPriceTier`), not a new table. `SlotCapacityConfig`/`DoctorServiceQualification`/`Appointment` FKs carried over unchanged (Postgres FKs track by OID, not name).

## 4. Appointment — target design (Phase 1)

`Appointment`, `DoctorSchedule` (weekly recurring, effective-dated), `ScheduleException` (leave/exceptions), `SlotCapacityConfig` (per doctor + service), `RecurringAppointmentTemplate`.

Business-rule enforcement: a doctor can only be booked for a service they're qualified for and within their active roster — enforced by a `DoctorServiceQualification` join table plus an application-level check at booking time (a pure foreign key can't express "and within the roster minus exceptions," so this is checked in the booking service and covered by an acceptance test, not a database constraint alone).

## 5. Human Resources — target design (Phase 1)

`Staff` (links to `User` where the staff member has a login), `Attendance` (sourced from clinical check-in/out per the spec, not a separate punch system), `LeaveRequest`, `PublicHoliday`, `OvertimeRecord`, `IncentiveRule` (clinic-wide default + optional per-doctor override, `is_default` flag), `IncentiveResult` (one row per doctor per period, records which rule was applied).

The rule "locum incentive always computes to zero" (`PRODUCT_REQUIREMENTS.md` §18) is enforced in the calculation service, not the database — but the acceptance test for it lives here as a note so it isn't lost: **any `IncentiveResult` row for a `Staff.role_type = 'locum'` must have `calculated_amount = 0`, checked by a database CHECK constraint** as a second line of defense, not application code alone.

## 6. Inventory & Procurement — **implemented (Phase 1d)**

`Item` (selfpay `sell_price`/`cost`; panel-tier pricing stays owned by the future `PanelPriceTier` model per §9's data-ownership table, not duplicated here), `Supplier`, `StockLevel` (per clinic, cached/derived total), `StockBatch` (expiry tracking), `StockMovement` (append-only ledger — every quantity change is a row here, `StockLevel.quantity_on_hand` is a derived/cached total, never the only record of truth), `ProcurementRequest`, `PurchaseOrder`/`PurchaseOrderLine`, `GoodsReceivedNote`/`GoodsReceivedNoteLine`. Phase 2 adds `StockTransfer` and `StockTake`/`StockTakeLine`.

**`GoodsReceivedNote` is header/line, not flat** (`DECISIONS.md` D-019): a real receiving event routinely covers multiple PO lines with different quantities, batches, and expiries in one delivery — `GoodsReceivedNoteLine` (`goods_received_note_id`, `purchase_order_line_id`, `item_id`, `quantity_received`, `batch_number`, `expiry_date`, `unit_cost`) carries that detail, matching the header/line split already used by `PurchaseOrder`/`PurchaseOrderLine` and `ClaimBatch`/`ClaimBatchLine`.

**Stock is allowed to go negative** (`DECISIONS.md` D-020, owner decision 2026-07-30, superseding the original "stock cannot go negative" design): `StockLevel.quantity_on_hand` had a `CHECK (quantity_on_hand >= 0)` constraint, added in `add_inventory_module` and dropped in `allow_negative_stock` — front-line dispensing/invoicing must not block on system stock catching up with physically-received goods. Negative rows are surfaced for admin reconciliation via `GET /stock/negative-stock` (`StockService.listNegativeStock`), not prevented at write time. Every write still goes through `StockMovement` first with `StockLevel` updated in the same transaction, so the ledger remains the source of truth either way.

Business rule "a goods-received entry against a partial delivery must correctly reduce the outstanding PO quantity" (`PRODUCT_REQUIREMENTS.md` §18): receiving a `GoodsReceivedNoteLine` increments `PurchaseOrderLine.received_quantity` and creates the linked `StockBatch`/`StockMovement`/`StockLevel` update in one service-level transaction; `PurchaseOrder.status` is recomputed to `PARTIALLY_RECEIVED` or `FULLY_RECEIVED` in the same transaction. Application-service logic, not a DB trigger — unlike `ClaimBatch`'s total, this doesn't need to defend against direct writes from outside the app, since nothing else in Phase 1 writes to `PurchaseOrderLine`.

## 7. Panel Claims — target design (Phase 1 core / Phase 2 advanced)

`Panel` (name, BRN, TIN, person-in-charge, contract dates), `PanelPriceTier` (contracted price per service/item per panel), `PatientPanelEligibility` (active_from/active_to, status), `PanelInvoice` (generated from a `Visit`, price locked from the tier **at generation time** — copied onto the invoice row, not just referenced, so a later tier change never silently alters an already-issued invoice), `ClaimBatch`, `ClaimBatchLine`, `PaymentReceived`, `KnockOff`, `Deduction`.

Business rule "a claim batch total must always equal the sum of its included invoices" (`PRODUCT_REQUIREMENTS.md` §18 acceptance criteria): enforced by a trigger that recomputes `ClaimBatch.total_amount` from its `ClaimBatchLine` rows on every insert/delete of a line, rather than trusting application code to keep the cached total in sync.

Business rule "panel claims must reference a valid, active eligibility at time of visit": `PanelInvoice` stores a snapshot (`eligibility_id`, `eligibility_status_at_visit`) rather than only a live foreign key, so the historical claim remains correct even if eligibility later lapses.

## 8. Reports & Analytics

No owned tables. Reads across all modules. Phase 1 implements as direct queries; if dashboard load times become an issue with real data volume, materialized views refreshed on a schedule are the next step — not built preemptively.

## 9. Indexing strategy

Every tenant-scoped table is indexed on `(tenant_id, id)` at minimum; tables frequently filtered by branch additionally index `(tenant_id, clinic_id)`. Composite indexes are added per real query pattern once Phase 1 modules exist — not speculatively for tables that don't exist yet.

## 10. What's actually running right now

- PostgreSQL 16 installed as a Windows service, listening on 127.0.0.1:5432.
- A dedicated, non-superuser role `kuwick_dev` and database `kuwick_dev` — the application never connects as the `postgres` superuser.
- Migrations to date: Core/Shared Foundation (§2), HR-lite `Staff` (§5), Appointment (§4), Inventory & Procurement (§6, Phase 1d core), and Clinical Operations (§3, Phase 1a — `ServiceCatalog` only) — all with RLS policies enabled. The rest of Clinical Operations and Panel Claims tables don't exist yet — those arrive with their respective Phase 1a passes / Phase 1e.
