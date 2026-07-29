# Kuwick 2.0 — Development Roadmap

**Status:** Living document — phases are re-estimated as Phase 1 modules complete.

## Phase 0 — Initialization (this phase)

Environment, repository, technology stack, database architecture (Core/Shared Foundation only), and initial design system. No clinical-facing feature code. Ends with a summary presented to the product owner for approval before Phase 1 begins.

## Phase 1 — MVP, broken into sequential sub-phases

Ordered to minimize rework: Core Foundation must exist before anything else; Clinical Operations is lowest-risk (refining a proven workflow) and is what every other module reads from, so it comes right after Foundation.

| Sub-phase | Scope | Depends on | Notes |
|---|---|---|---|
| **1a — Clinical Operations** | Patient directory/dashboard, clinical notes, orders/services, diagnoses, prescriptions, documents, invoices, queue management | Core Foundation | Refine existing proven UX; original screens only (§19 constraint) |
| **1b — Appointment** | Full calendar views, branch/service-aware booking, slot/capacity engine, doctor roster + exceptions, online booking portal, admin booking, lifecycle actions, analytics | 1a (converts into a Visit) | Highest structural complexity in Phase 1 — the slot/capacity engine and roster-exception logic are new builds, not refinements |
| **1c — HR Core** | Staff directory, attendance (from clinical check-in/out), leave, public holidays, doctor incentive engine | 1a (attendance source), 1b (doctor roster) | **Blocked on owner decision**: exact incentive formula semantics (`PRODUCT_REQUIREMENTS.md` §17.2) must be confirmed with a worked numeric example before this ships |
| **1d — Inventory Core** | Item master, stock by branch, low-stock alerts, purchase order → goods-received | Core Foundation only | Batch/expiry tracking included here since goods-received acceptance criteria requires it; stock take/variance and inter-branch transfer deferred to Phase 2 |
| **1e — Panel Claims Core** | Panel master, invoice generation, claim submission, payment/knock-off | 1a (invoices from visits) | **Blocked on two owner decisions**: front-desk eligibility visibility (§17.1) and holiday-surcharge-vs-panel-price interaction (§17.3) |
| **1f — Reports MVP** | Executive dashboard: sales, appointments, doctor performance, panel aging | 1a–1e (reads their data) | Last, since it has nothing to aggregate until the other modules produce data |

Cross-cutting work (audit logging, notification dispatch, RBAC enforcement) is built incrementally inside each sub-phase against the shared interceptors/guards from `SYSTEM_ARCHITECTURE.md` §4 — not a separate sub-phase.

## Phase 2 — Post-MVP

Multi-branch stock transfer, central procurement budgeting, stock take/variance workflow, advanced panel reconciliation and itemization submission, overtime automation, approval-workflow customization, clinic/branch comparison analytics, deeper drill-down cross-tab analytics.

## Explicitly out of scope (revisit only if the product owner reopens it)

Full payroll processing (salary computation, statutory deductions, bank disbursement).

## Gating decisions before Phase 1 sub-phases can start

These are called out again here (also tracked in `PRODUCT_REQUIREMENTS.md` §17) because they block specific sub-phases above, not because they're forgotten:

1. Front-desk visibility into panel eligibility → blocks 1e
2. Doctor incentive formula worked example → blocks 1c
3. Holiday surcharge vs. panel-locked pricing → blocks 1e
4. Panel pricing override governance → blocks 1e (advanced reconciliation, Phase 2, but the base rule should be settled before 1e ships invoices under an ambiguous rule)
5. Data migration export mechanism from existing Kuwick → does not block any sub-phase's *build*, but must be resolved before any sub-phase goes live for real use
6. Foreign patient (non-NRIC) identifier handling → blocks 1a (patient registration)

Sub-phases without a blocking decision (1b, 1d, 1f) can start immediately once Phase 0 is approved.
