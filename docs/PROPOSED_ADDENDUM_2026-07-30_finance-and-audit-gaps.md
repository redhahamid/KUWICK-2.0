# Proposed Addendum — Klinik Hijraa Admin-Panel Audit (2026-07-30)

**Status: DRAFT — NOT MERGED.** This is a proposal for owner review only. Nothing here has been
written into `PRODUCT_REQUIREMENTS.md` or `DECISIONS.md`. If approved (in whole or in part), the
relevant sections below should be folded into those files directly, and this file deleted.

**Source**: full section-by-section walkthrough of the Klinik Hijraa admin panel (Operation, Stock,
Panel, Finance, Clinical, Setting), conducted 2026-07-30, compared against `PRODUCT_REQUIREMENTS.md`
as it stood at commit `8739718`. This is the "management reference system" `PRODUCT_REQUIREMENTS.md`
§1 already cites as a source audit — this pass goes deeper than what's currently reflected in the
document.

---

## Part 1 — Proposed new §3 module: Finance

`PRODUCT_REQUIREMENTS.md` §3 currently has no Finance module. Sales reporting is implied under
Clinical Operations ("per-visit invoicing with payment status") and Reports & Analytics ("Sales
(cash vs. panel)"), but nothing currently owns **statutory compliance** (e-Invoice/LHDN), **tax
configuration**, **company/bank registration**, or **inter-branch billing**. The audit shows these
as a distinct module in the reference system, not a sub-feature of Clinical or Reports.

### Proposed §3 entry

**G. Finance** — Business/Tax/E-invoice Settings, Sales Reporting (multiple views: billing detail,
transaction detail, daily summary, by payment method, by panel), e-Invoice Submission (LHDN
MyInvois), Inter-Branch/Inter-Company Billing.

### Proposed §4 Detailed Feature List entry

**Finance**
Company registration, tax (GST/SST), and banking details configured once per tenant; per-tax-type
rate table; MyInvois/LHDN connection management with sandbox and production environments kept
separate, taxpayer TIN, MSIC industry code, and a connection test action; multi-view sales
reporting (billing detail, transaction detail, daily summary, summary by payment method, summary by
panel) sharing a common filter set (date range, time range, doctor, visit type, payment method,
treatment) with export; monthly e-Invoice consolidation and per-bill submission workflow against
LHDN with status tracking; inter-branch/inter-company billing where one branch is invoiced by
another at cost for stock or shared services.

### Why this is proposed as critical (owner sign-off), not a routine addition

- **e-Invoicing is a Malaysian statutory requirement (LHDN/MyInvois)**, not a product preference —
  its absence from the current architecture isn't a missing nice-to-have, it's a compliance gap.
  Every invoice-generating path (Clinical visit invoicing, Panel Claims) may need an e-Invoice
  submission hook, which is an architectural dependency, not a bolt-on report.
- Promoting Finance to a first-class module changes §3's module list and §5's permission matrix
  (Finance Staff's row already exists in §5 but its scope is currently defined only in terms of
  invoices/panel/reports — it would need to expand to settings/e-invoice/tax).
- Per the CTO operating agreement (`DECISIONS.md` header), this affects billing and major product
  direction — not decided unilaterally here.

---

## Part 2 — Proposed additions to §17 Open Questions

Continuing the existing numbering (current highest is #7, Booking attribution for commission
billing).

**8. Should Finance become a first-class §3 module?** — **PARTIALLY RESOLVED, 2026-07-31 (`DECISIONS.md` D-032)**: the owner confirmed e-Invoice/LHDN MyInvois specifically is in-scope (kuwick.com already has it built; work pending the owner's reference screenshots). The broader question — sales reporting, tax/company/banking settings, inter-branch billing as a first-class module vs. distributed across Core/Reports — is still open.

**9. Negative stock: hard block or monitored exception?** — **RESOLVED (2026-07-30, owner decision — see `DECISIONS.md` D-020).** §8 stated "Stock cannot go negative," but the reference system has a dedicated **Negative Dispensing log** (dispensed below available stock, tracked with shortfall and staff attribution) — implying the real-world practice is to allow it and flag it after the fact, not block it at the point of dispensing. The owner confirmed this directly: stock is allowed to go negative (front-line staff dispense/invoice immediately even when system stock hasn't caught up with physically-received goods, matching how the owner's current CMS, Avixo, operates), surfaced via a negative-stock reconciliation report rather than blocked. The DB `CHECK` constraint from the original 1d build has been dropped; `PRODUCT_REQUIREMENTS.md` §8 and `DATABASE_ARCHITECTURE.md` §6 are updated to match.

**10. Per-panel claim submission mode — is one claim workflow enough?** — **RESOLVED, 2026-07-31 (`DECISIONS.md` D-031)**: one status lifecycle for every panel; per-panel variance (AIA's 24h-aggregate-then-submit, MARA's manual courier, others' own portals) is captured as data — free-form batch creation timing + a submission-method field on the batch — not as a hardcoded per-panel workflow fork. — the current Panel Claims module (§3E) assumes a single, uniform invoice → batch → submit → reconcile workflow. The reference system's **AIA sub-module** shows at least one panel needs a structurally different path: an itemized claim builder whose output is manually keyed into an external insurer portal, with its own price tier and its own time-based rate rule ("night consultation" surcharge) layered on top of the standard tier pricing. This also bears directly on **existing Open Question #3** (holiday/after-hours surcharge vs. panel-locked pricing) — new evidence suggesting panels can define their own time-based pricing override independent of the clinic-wide surcharge rule. Needs a decision: is "claim submission mode" (standard vs. itemized-builder) a per-panel-company configuration Kuwick 2.0 must support, and does panel-specific time-based pricing supersede or stack with the clinic-wide holiday/after-hours rule?

**11. Staff price tier — is staff-as-patient billing in scope?** — the reference system's item pricing includes a "Staff Hijraa" tier alongside Selfpay and panel tiers, implying staff members are treated as patients at a discounted internal rate. Nothing in the current spec (Item Master, §4 Inventory, or HR) addresses staff self-treatment or its billing/reporting treatment (does it count toward clinic revenue KPIs, doctor productivity, etc.?). Needs a decision on whether this is in scope for Phase One.

**12. Inter-branch/inter-company billing — is a branch ever its own billable entity?** — the reference system bills one branch (Paka) for stock transferred from Central at cost, as if Paka were a separate company, distinct from cross-tenant billing (§2/D-001, which is about unrelated clinic *businesses*). The current Branch model (§3 Core: "Clinic & Branch/Location Setup") has no concept of a branch being its own billable/invoiced entity. Needs a decision: is this modeled as an attribute on Branch ("bills at cost to a separate legal entity"), or is Paka actually a distinct tenant under D-001's multi-tenant model and this was mis-observed as intra-tenant?

**13. Patient-facing app scope beyond booking — screening packages and family access?** — Setting → Patient App in the reference system includes Screening Packages, Screening Requests, and Family Access (linked family-member accounts), none of which appear in §5's Patient (Portal) row ("Own records only (read), Self-booking only") or §3B's Online Booking Portal description. Needs a decision: expand the patient portal's Phase-One/Phase-Two scope to include these, or explicitly exclude them as out of scope for now.

**14. Weight-loss and recall-list clinical programs — generalize or treat as tenant-specific?** — the reference system has purpose-built tracking for a weight-loss program (enrollment, target achievement, dose cohorts) and a Follow-up/recall module (Weight Loss, NCD, Lab Results, Appointment, Birthday Wish categories with a "Remind" action). Given the confirmed multi-tenant SaaS direction (D-001, §2), hardcoding a weight-loss-specific dashboard doesn't generalize to other clinic tenants. Needs a decision: build a generic "Program Enrollment & Recall" primitive that any tenant can configure (categories, KPIs, reminder triggers), or treat this as Klinik-Hijraa-specific customization outside the core product for now.

**15. WhatsApp delivery mechanism — accept the unofficial-automation risk?** — `DECISIONS.md` D-012 defers the WhatsApp/SMS provider choice. The reference system uses unofficial WhatsApp Web/Desktop automation on a clinic PC rather than the official Meta Business API, noting the paid API as a future option. This carries real risk (number bans, ToS violation) that should be an explicit, accepted risk if adopted — not a default arrived at silently when a provider is eventually chosen.

---

## Part 3 — Non-critical additions (informational — not blocking, no sign-off needed)

These don't touch billing/clinical/data-ownership/major-direction and can likely be logged as
routine `DECISIONS.md`/spec additions once Finance/Inventory/Reports are actually built, rather than
requiring owner sign-off now:

- Segmented P&L reporting (sales/visits/profit/margin per business segment) as an extension of
  existing §12 Reports & KPIs.
- Item-level multi-tier pricing matrix (Selfpay + multiple panel tiers) as the concrete shape of
  §3E's "contracted pricing tiers."
- "Stock RQ" as a lighter-weight internal supply request distinct from the full Procurement Request
  → PO flow already in §3D.
- Price-variance ("price changed") flagging between ordered and invoiced cost, and a "loose items"
  stock-take category kept for record only — both fit inside existing §3D scope.
- "Runner" (internal staff paging/coordination board) and "Closing" (end-of-day cash-up
  reconciliation) as operational features with no current home — Closing in particular overlaps
  Finance + HR (incentives) and may be worth a KPI/audit-log line once Finance is scoped.
