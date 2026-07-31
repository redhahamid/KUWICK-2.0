# Kuwick 2.0 — Product Requirements

**Status:** Canonical source of truth for product scope.
**Authority:** This document is derived directly from (a) `Kuwick 2.0 Requirements Specification.pdf` (based on authorized audits of the existing Kuwick, Yezza appointment workflows, and an authorized management reference system) and (b) the product owner's restated specification of 2026-07-27, which supersedes paraphrase in case of any wording difference. Sections marked **OPEN** are explicitly not yet decided and must not be treated as settled scope.

Do not add modules, fields, or business rules beyond what is written here without logging the addition in `DECISIONS.md` and, if it touches a critical-decision category (patient safety, clinical workflow, billing, panel claims, security, data ownership, major product direction), getting explicit owner sign-off first.

---

## 1. Executive Vision

Kuwick 2.0 is a single, unified clinic operating system for Malaysian outpatient clinics, replacing the current fragmented Kuwick with one connected platform covering clinical care, appointments, staffing, inventory, panel billing, and management analytics.

**One source of truth**: a patient, a doctor, an item, a panel, and a visit each exist as a single record referenced everywhere they appear — nothing is re-entered or re-synced between disconnected tools.

Three audiences share one interface:
- Front-desk and clinical staff running day-to-day care
- Back-office staff handling stock, HR, and billing
- Clinic owners/management needing real-time visibility into business performance

Where existing Kuwick already does clinical work well, Kuwick 2.0 preserves and refines that experience rather than rebuilding it, while adding the operational depth clinics currently patch together with spreadsheets or third-party tools.

## 2. Tenancy Model — **CONFIRMED 2026-07-27**

Kuwick 2.0 is built as a **multi-tenant SaaS platform**: it must support multiple, unrelated clinic businesses (tenants), each with their own branches, staff, patients, and data, fully isolated from one another. This was an open question during initialization and was resolved by the product owner in favor of multi-tenancy over a single-clinic model, to avoid a costly re-architecture if the product is resold later.

Practical consequence carried into `SYSTEM_ARCHITECTURE.md` and `DATABASE_ARCHITECTURE.md`: every table in every module carries a tenant boundary, every auth token is tenant-scoped, and no query may cross tenants even accidentally (enforced at the database layer, not just in application code).

## 3. Module & Submenu Structure

**0. Core / Shared Foundation** — Patient Master, User & Role Management, Clinic & Branch/Location Setup, Global Settings, Notification Center, Audit Log. *(Sits under a Tenant/Organization boundary per §2.)*

**A. Clinical Operations** *(existing, refined)* — Patient Directory, Patient Dashboard, Clinical Notes, Orders & Services, Diagnoses, Medications & Prescriptions, Documents, Invoices, Queue Management, Procedure/Task Queue.

**B. Appointment** — Calendar (Day/Week/Month/Provider/List), Clinic & Branch Selector, Service Catalog linkage, Doctor Schedule (weekly recurring, effective-dated, leave/exception overrides), Slot & Capacity Engine, Online Booking Portal, Admin Booking, Lifecycle Actions, Appointment Analytics.

**C. Human Resources** — Staff Directory, Attendance (from clinical check-in/out), Leave Management, Public Holiday Rules (auto after-hours surcharge), Overtime Rules, Doctor Incentive Engine (default rule + per-doctor override), Approval Workflow, HR Reports. **No full payroll in Phase One** (see §16).

**D. Inventory & Procurement** — Item Master (pricing, dose/frequency/duration, indication metadata), Stock by Clinic/Location, Batch & Expiry, Stock Movement Log, Stock Take (with variance), Adjustments, Low-Stock Alerts, Supplier Directory, Procurement Request → Purchase Order → Approval → Goods Received Note (full/partial), Stock Transfer between branches, Cost & Stock Valuation, Central Procurement Queue.

**E. Panel Claims** — Panel Master (contracted pricing tiers, contracted entity, BRN/TIN, person-in-charge), Patient Panel Eligibility, Panel Invoice, Claim Batch, Claim Submission & Status Tracking, Payment Received, Knock-off, Partial Settlement, Deductions & Rejections, Reconciliation, Outstanding Aging, Panel Reports.

**F. Reports & Analytics** — Executive Dashboard (interactive, drill-down, Power-BI-style charts): Sales (cash vs. panel), Appointment Analytics, Queue & Patient Flow, Doctor Performance, Doctor Incentives, HR Attendance & Overtime, Inventory Movement & Valuation, Procurement, Panel Claims & Aging, Reconciliation, Clinic/Branch Comparison.

## 4. Detailed Feature List

### Clinical Operations
Patient search/registration with NRIC validation; expandable profile (gender, race, address, emergency contact, known allergies); attending physician assignment; rich-text clinical notes with dictation and smart abbreviations; orders & services attached to a visit; diagnosis catalog with custom/summarized/full tagging; prescription writing with "copy previous prescription"; generated document templates linked to a visit; per-visit invoicing with payment status; queue stages with a public-facing monitor display and configurable running text/voice announcements; procedure task queue with requester and status tracking.

### Appointment
Multi-branch and multi-room aware booking; service-driven doctor filtering; configurable slot length and daily capacity per doctor/service; recurring appointment templates; doctor weekly roster with effective-dated changes and leave/exception overrides; patient self-service booking portal; front-desk booking with an advanced multi-step flow; automated confirmation and reminder notifications; one-click reschedule/cancel/no-show/arrived status changes; direct conversion of an appointment into a queue ticket and then into a visit record; analytics on booking volume, no-show rate, and utilization.

### Human Resources
Staff directory segmented by clinic/branch and role; attendance captured from clinical check-in/out; leave request and approval workflow; configurable public holiday calendar with automatic after-hours surcharge rules; overtime tracking; doctor incentive engine (default rule plus per-doctor custom overrides); HR reporting on attendance, leave balances, and incentive payouts.

### Inventory & Procurement
Item master with pricing, dosage, and indication metadata; per-branch stock levels with minimum thresholds and consumption-rate forecasting; batch/expiry tracking with alerts; low-stock and below-minimum dashboards; supplier directory; procurement requests rolling into purchase orders with approval; goods-received recording supporting partial deliveries; inter-branch stock transfer requests; periodic stock take with automatic variance calculation; cost/valuation reporting.

### Panel Claims
Panel company master with contracted pricing tiers; patient-level panel eligibility linkage; automatic panel invoice generation from a visit; claim batching by panel and period; claim submission status tracking; payment receipt and knock-off against outstanding invoices; partial settlement handling; deduction/rejection reason capture; panel-by-panel reconciliation; outstanding-aging report.

### Reports & Analytics
Executive dashboard with interactive, clickable charts (patients per period, revenue trends, doctor productivity, service-line revenue breakdown, branch comparison) supporting drill-down from summary to transaction level, filterable by date range, branch, doctor, and service.

## 5. User Roles & Permissions

| Role | Clinical | Appointment | HR | Inventory | Panel Claims | Reports |
|---|---|---|---|---|---|---|
| Clinic Owner/Admin | Full | Full | Full | Full | Full | Full |
| Doctor (Resident) | Own patients, full clinical actions | View/manage own schedule | View own attendance/incentive | View only | View only | Own performance only |
| Doctor (Locum) | Own patients, full clinical actions | View own schedule | View own attendance (no incentive) | None | None | None |
| Front-Desk/Clinical Staff | Queue, registration, limited notes | Full booking actions | Own attendance | View | **OPEN — see §17.1** | None |
| Finance Staff | View invoices | View | None | Cost/valuation view | Full | Sales/panel/aging |
| HR Staff | None | None | Full | None | None | HR reports |
| Stock Staff | None | None | None | Full | None | Inventory reports |
| Panel Staff | None | None | None | None | Full | Panel reports |
| Patient (Portal) | Own records only (read) | Self-booking only | None | None | None | None |

## 6. End-to-End Workflows (Representative)

**Appointment → Visit**: patient or front desk selects a service; system filters to doctors qualified for that service; an available slot is chosen against the doctor's roster and existing bookings; appointment is confirmed and a reminder scheduled; on the appointment date the patient is marked arrived, which auto-creates a queue ticket; completing the queue stage converts it into a clinical visit record without duplicate data entry.

**Procurement → Stock**: stock staff raise a procurement request when an item falls below its minimum threshold (or manually); it's approved, converted into a purchase order to a supplier; goods are received (fully or partially) against the order with batch/expiry captured; stock levels and valuation update automatically; any shortfall triggers a follow-up order.

**Panel Claim → Payment**: a visit for a panel-eligible patient generates a panel invoice at the contracted price tier; invoices are batched by panel and period into a claim; the claim is submitted and its status tracked; payment received from the panel is matched and knocked off against the batch (supporting partial settlement and deduction reasons); any unmatched balance ages into the outstanding report.

**Doctor Incentive Calculation**: at month end, completed visits assigned to each resident doctor are totaled; the default rule (or that doctor's custom rule) is applied against the sales threshold and percentage; the calculated incentive feeds into HR reports. *(Exact formula semantics are **OPEN** — see §17.2.)*

## 7. Status Lifecycles

- **Appointment**: Requested → Confirmed → Reminded → Arrived → In Queue → Completed (Converted to Visit) | alternates: Rescheduled, Cancelled, No-Show.
- **Queue/Visit**: Waiting → In Consultation → Dispensary & Payment → Completed.
- **Procurement**: Requested → Approved → Ordered → Partially Received → Fully Received → Closed | alternates: Rejected, Cancelled.
- **Panel Claim**: Invoice Generated → Batched → Submitted → Accepted/Rejected/Deducted → Paid (Full/Partial) → Reconciled → (if unpaid) Aging.

## 8. Business Rules

- A doctor can only be booked for a service they are configured to perform, and only within their active roster minus approved leave or exceptions.
- Appointment slot length and daily capacity are configurable per doctor and per service, not fixed clinic-wide.
- Public holidays and defined after-hours windows automatically apply a surcharge consultation rate. *(Interaction with panel-locked pricing is **OPEN** — see §17.3.)*
- Doctor incentives follow a clinic-wide default rule (minimum sales threshold, flat amount earned above it, plus a percentage of everything beyond that threshold) unless a doctor has an approved custom rule; locum doctors are excluded from incentive calculations by default. *(Exact formula semantics **OPEN** — see §17.2.)*
- Stock is allowed to go negative — **CONFIRMED BY OWNER, 2026-07-30** (`DECISIONS.md` D-020), superseding this rule's original "stock cannot go negative" wording: front-line staff dispense/invoice immediately even when system stock hasn't caught up with physically-received goods, and negative rows are surfaced for admin reconciliation (a dedicated negative-stock report) rather than blocked at the point of dispensing. Any item falling below its configured minimum at a branch is separately, automatically flagged for reorder.
- Panel claims must reference a valid, active panel eligibility on the patient at time of visit, and pricing is locked to that panel's contracted tier rather than the clinic's standard price.

## 9. Data Ownership & Source of Truth

| Entity | Owning Module | Consumed By |
|---|---|---|
| Patient record | Clinical Operations | Appointment, Panel Claims, Reports |
| Appointment | Appointment | Clinical Operations (visit conversion), Reports |
| Staff/Doctor profile | HR | Appointment (scheduling), Clinical, Reports |
| Item/Stock | Inventory | Clinical (orders/medications), Reports |
| Panel master & eligibility | Panel Claims | Clinical (billing), Reports |
| Visit/Invoice | Clinical Operations | Panel Claims, Reports |

All other modules **read** these entities; they never hold a duplicate, editable copy.

## 10. Required Notifications

| Trigger | Channel | Recipient |
|---|---|---|
| Appointment confirmed/reminder | SMS/WhatsApp/App | Patient |
| Appointment rescheduled/cancelled | SMS/App | Patient, assigned doctor |
| Low stock / below minimum | In-app/Email | Stock staff |
| Purchase order approved/received | In-app | Requester, stock staff |
| Panel claim rejected/deducted | In-app/Email | Panel/Finance staff |
| Leave request submitted/approved | In-app | Staff, approver |
| Incentive calculated | In-app | Doctor, HR |

WhatsApp/SMS provider selection is a non-critical technical decision — see `DECISIONS.md`.

## 11. Required Audit Logs

Every create/edit/delete on patient records, prescriptions, invoices, stock adjustments, purchase orders, panel claims, and user/role changes must capture **who** performed the action, **timestamp**, **before/after values**, and the **module/record affected** — retained indefinitely, viewable by Clinic Owner/Admin roles only.

## 12. Reports & KPIs

Sales (cash vs. panel, by service, by branch), appointment volume and no-show rate, queue wait/consultation/dispensary time, doctor productivity (patients seen, revenue generated, revenue per patient), doctor incentive payouts, HR attendance and overtime, inventory movement and stock valuation, procurement spend and lead time, panel claims submitted/accepted/rejected and outstanding aging, and branch-to-branch comparison — all as interactive, filterable, drill-down charts on the executive dashboard, not static tables alone.

## 13. Desktop and Mobile UI Principles

Desktop is the primary interface for front-desk, clinical, and back-office workflows given data-entry density. Mobile/tablet is optimized for doctors reviewing schedules and patient summaries on the move, queue monitor displays, and the patient-facing booking portal. Both share the same design system and role-based navigation — no feature is desktop-only unless inherently high-density data entry. Full detail in `UI_DESIGN_SYSTEM.md`.

## 14. Phase-One MVP Scope

Clinical Operations (as-is, refined UI); full Appointment module including online booking portal and slot/capacity engine; core HR (staff directory, attendance, leave, public holidays, doctor incentive engine); core Inventory (item master, stock by branch, low-stock alerts, purchase order → goods-received); core Panel Claims (panel master, invoice generation, claim submission, payment/knock-off); Reports & Analytics executive dashboard covering sales, appointments, doctor performance, and panel aging.

## 15. Phase-Two Features

Multi-branch stock transfer and central procurement budgeting, stock take/variance workflow, advanced panel reconciliation and itemization submission, overtime automation, approval-workflow customization, clinic/branch comparison analytics, and deeper drill-down cross-tab analytics.

## 16. Features Explicitly Excluded

Full payroll processing (salary computation, statutory deductions, bank disbursement) is excluded unless proven essential later; candidate for a dedicated payroll integration rather than a built-in module.

## 17. Open Questions — Owner Decision Required

These affect billing, panel claims, clinical workflow, or data ownership — per the CTO operating agreement, these are **not** decided unilaterally. Each will be raised explicitly for sign-off before the relevant Phase-1 module is built; none block initialization.

1. **Front-desk visibility into panel eligibility** — **RESOLVED, 2026-07-31 (`DECISIONS.md` D-029)**: eligibility verification stays external/manual (staff check the panel's own portal); Kuwick surfaces read-only reference data (limit + exclusions) at registration to support that check, not to replace it.
2. **Doctor incentive formula, precise semantics** — "minimum sales threshold, flat amount earned above it, plus a percentage of everything beyond that threshold" (§8) is worded ambiguously. Needs a worked numeric example (e.g., "threshold RM10,000, flat RM500, plus 10% of everything above RM10,000 — on RM15,000 sales, incentive = ?") before this can be built correctly, since it's a compensation calculation.
3. **Holiday/after-hours surcharge vs. panel-locked contracted pricing** — **RESOLVED (interaction rule only), 2026-07-31 (`DECISIONS.md` D-030)**: varies per panel (some define their own time-based rate override); the surcharge engine itself doesn't exist yet for any visit type and stays unbuilt until scoped.
4. **Panel pricing override governance** — no rule yet for what happens if a panel price needs to be overridden against its centrally contracted tier (from the source PDF's risk register).
5. **Data migration from existing Kuwick** — no confirmed export mechanism exists since Kuwick 2.0 is being built without access to the old system's source code (from the source PDF's risk register).
6. **Foreign patients without NRIC** — **RESOLVED, 2026-07-30 (`DECISIONS.md` D-022)**: an ID Type selector (NRIC/Passport) on patient registration, matching the already-built `PatientIdentifierType` enum, with basic format validation only (no NRIC checksum or passport-specific rule) — matching the owner's live kuwick.com reference.
7. **Booking attribution for commission billing** — the patient-facing Online Booking Portal (§3B, §4) has no defined mechanism for proving a given booking originated from Kuwick's portal rather than a clinic's own walk-in/phone booking, despite this being required to bill clinics commission on portal-driven bookings. Not previously identified as a gap; raised before the portal is built rather than after. Two things need a decision, not just one:
   - **Billing trigger event** — is commission earned when the booking is *created* through the portal, or only when the resulting visit is *completed* (a portal booking that no-shows or gets cancelled may or may not owe commission)? This mirrors the cash-vs-panel revenue distinction Reports & Analytics (§12) already draws for completed visits.
   - **Cross-tenant billing/reporting** — generating a commission invoice per clinic requires reading portal-attributed bookings *across* tenants, which is a new capability nothing in the current design accounts for: every table is tenant-isolated via `FORCE ROW LEVEL SECURITY` with no exceptions, including for the application's own database role. A commission report needs a deliberate platform-admin path across that boundary, not an incidental one.

   Whatever is decided, attribution itself must be **provable**, not self-reported: it needs to be derived from which endpoint/auth-context created the booking (the portal and staff-booking paths are structurally distinct entry points a client can't misrepresent) and recorded immutably at creation, not accepted as caller-supplied input on the booking record.

## 18. Acceptance Criteria (Phase-One, Representative)

- **Appointment**: a booking cannot be created for a doctor outside their active roster or for a service they aren't configured to perform; converting an arrived appointment into a queue ticket must carry over patient and service data without re-entry.
- **Inventory**: an item falling below its configured minimum must appear on the low-stock alert within the same session; a goods-received entry against a partial delivery must correctly reduce the outstanding PO quantity.
- **Panel Claims**: a claim batch total must always equal the sum of its included invoices; a partial payment must correctly reduce the outstanding balance without closing the claim.
- **HR**: an incentive calculation for a locum doctor must always compute to zero regardless of sales volume, matching the default-rule exclusion.

## 19. Risks (from source audit)

Because Kuwick 2.0 is built without access to the existing Kuwick source code, data migration needs a defined export mechanism not yet confirmed as available. The payroll boundary is undecided beyond "excluded for Phase One." Governance of panel pricing overrides vs. each panel's centrally contracted tier needs a clear conflict-resolution rule. The new team must design original screens and data structures rather than replicate any observed third-party interface — no proprietary UI/UX from the audited reference systems may be reproduced.

## 20. Traceability (Source → Requirement → Decision)

| Source Observation | Kuwick Requirement | Decision | Phase |
|---|---|---|---|
| Kuwick: patient dashboard tabs | Clinical Operations module structure | Adopt (refine UI only) | MVP |
| Kuwick: queue with monitor display | Queue Management | Adopt | MVP |
| Kuwick: appointment repeat options | Appointment recurring templates | Adapt (add capacity/slot engine) | MVP |
| Yezza: service-type-driven doctor filtering | Appointment service-doctor mapping rule | Adapt (rebuilt originally) | MVP |
| Yezza: multi-view calendar | Appointment calendar views | Adapt (redesigned UI) | MVP |
| Yezza: 3-step advanced booking wizard | Admin booking flow | Adapt | Phase 2 |
| Management ref: operations analytics | Reports & Analytics executive dashboard | Adapt (original design) | MVP |
| Management ref: stock module | Inventory & Procurement module | Adapt | MVP core / Phase 2 advanced |
| Management ref: panel module | Panel Claims module | Adapt | MVP core / Phase 2 advanced |
| Management ref: HR doctor incentive rule engine | Doctor Incentive Engine | Adapt | MVP |
| Management ref: public holiday surcharge rule | Business rule under Appointment/Billing | Adapt | MVP |
| Management ref: attendance via clinical check-in/out | HR Attendance | Adapt | MVP |
| Real patient/panel records viewed during audit | — | **Reject** — never reproduced or reused; PII observed only for structural understanding | N/A |

*Build blueprint for Kuwick 2.0 — not for redistribution of any third-party proprietary design.*
