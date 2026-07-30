# Proposed Addendum — Yezza Appointment Module Audit (2026-07-30)

**Status: DRAFT — NOT MERGED.** This is a proposal for owner review only. Nothing here has been
written into `PRODUCT_REQUIREMENTS.md` or `DECISIONS.md`. If approved (in whole or in part), the
relevant sections below should be folded into those files directly, and this file deleted.

**Source**: full walkthrough of Yezza's clinic-admin Appointment module (Calendar view, List view
and its six tabs, filter/customize-column tooling, the appointment-creation wizard, and the
edit/reschedule/cancel workflows) plus Yezza's patient-facing booking flow
(`klinikhijraa-bangi.yezza.co/appointment` — service selection → date/doctor/slot → patient
info), both conducted 2026-07-30, compared against `PRODUCT_REQUIREMENTS.md` and the built
Appointment module (1b) as of commit `a225683`.

---

## Part 1 — Update to Open Question #7 (Booking attribution for commission billing)

**Status: PARTIALLY INFORMED, not resolved.**

`PRODUCT_REQUIREMENTS.md` §17.7 already commits to attribution being "provable, not
self-reported... derived from which endpoint/auth-context created the booking... not accepted as
caller-supplied input" — matching Kuwick's existing `AppointmentSource` enum (`ONLINE_PORTAL` /
`FRONT_DESK`), set by which code path creates the row, never by a field the caller fills in.

**What this audit confirms**: Yezza's patient-facing booking flow has no source-selection UI at
any of its three screens — the patient is never asked "how did you hear about us" or anything
equivalent. Independently, Yezza's admin calendar detail panel displays a **"booking source"**
field per appointment that reads as system-derived, not patient-entered. Both observations are
consistent with, and support, the attribution *mechanism* already decided in §17.7. That mechanism
question wasn't really in doubt, though — this audit removes lingering uncertainty about it rather
than settling something contested.

**What remains genuinely open** — the two things `DEVELOPMENT_ROADMAP.md` actually lists as
blocking the Online Booking Portal:
- **Billing trigger event** (commission earned on booking-*created* vs. visit-*completed*) — no
  evidence either way. Yezza does not appear to run a per-booking commission model at all; it reads
  as a standard practice-management SaaS where the clinic pays for the platform outright, with no
  visible concept of Yezza taking a cut per booking. A different business model doesn't inform this
  decision.
- **Cross-tenant billing/reporting** (aggregating portal-attributed bookings across tenants to bill
  clinics commission) — same: Yezza's admin views are single-clinic, and nothing here shows how a
  platform operator would run this even if Yezza did charge commission internally.

**Conclusion**: OQ#7 stays open. This audit narrows it — the attribution *mechanism* is validated,
not just assumed — but the two decisions that actually block the portal still need explicit owner
sign-off, and this source material doesn't supply an answer for either.

---

## Part 2 — Proposed additions to §17 Open Questions

Continuing the existing numbering (current highest is #15, from
`PROPOSED_ADDENDUM_2026-07-30_finance-and-audit-gaps.md`).

**16. Multi-session treatment packages — build now or defer?** — Yezza's admin has a dedicated "To Be Scheduled" tab (Name, Services, Providers, **Total Sessions**, **Scheduled** count, **Dates Pending**) and an "Advanced appointment" flow with its own "Set Appointments" step for scheduling a package's sessions progressively, separate from the single-appointment wizard. Kuwick's target design already lists `RecurringAppointmentTemplate` (`DATABASE_ARCHITECTURE.md` §4) as owed but not yet built. This audit gives it concrete shape: it isn't just a recurrence rule that spawns independent appointments, it needs its own tracked state — total sessions vs. sessions actually scheduled vs. dates still pending — queryable as a package, not reconstructed after the fact from a set of appointment rows. Needs a decision: build this as part of finishing 1b, or explicitly defer to Phase 2 with the gap tracked here?

**17. Override toggle — should front-desk be able to bypass booking rules?** — `AppointmentBookingValidator` is a hard, unconditional gate today: a booking cannot be created outside a doctor's roster, qualification, or capacity, with no bypass path at all. Yezza's booking wizard and edit modal both expose an "Override" toggle (tooltipped "Ignore the booking rule and allow last-minute bookings") for exactly the case a hard gate can't handle — a walk-in patient needs to be squeezed onto a fully-booked day. This is a real, everyday front-desk need Kuwick currently has no way to satisfy. It isn't free to add: bypassing a business rule should almost certainly be audit-logged as its own flagged event (beyond the general audit trail §11 already requires) and probably restricted to a role the fixed permission matrix (§5) doesn't yet distinguish for this purpose — RBAC itself is deferred entirely (D-018). Needs a decision: build the override now (and gate it to which role, once RBAC exists), or leave the hard gate in place and accept that front-desk cannot work around a fully-booked day?

**18. Payment-status-at-booking — does Appointment need its own lightweight payment concept?** — Kuwick's design deliberately keeps all payment/invoicing owned by Clinical Operations (`Invoice`, generated from a `Visit` — §9 data-ownership table); `Appointment` carries no payment field at all. Yezza's flow shows payment entering much earlier than that: a booking fee is displayed to the patient before any visit exists, the admin booking wizard has its own Payment step, and every appointment row/detail view shows a payment-status icon with a "Record payment" action — all before arrival, let alone a completed visit. This is an architectural gap, not a UI nicety: Kuwick's current model has no way to represent "patient paid a deposit at booking time" independent of the eventual visit invoice. It crosses Appointment/Clinical/Finance ownership boundaries — the same Finance-module gap already flagged in `PROPOSED_ADDENDUM_2026-07-30_finance-and-audit-gaps.md` Part 1 — and needs a decision before the Online Booking Portal collects any payment: does `Appointment` gain its own deposit/payment-status field, does this stay a Finance-module concern layered on top after the fact, or is deposit-taking out of scope for Kuwick's Phase One entirely?

---

## Part 3 — Non-critical confirmations (informational — not blocking, no sign-off needed)

Yezza's admin surface has substantially more depth than Kuwick's current list view — a Calendar
view (Day/Week/Month/Provider/List), a status-count/"Potential sales" summary bar, a 5-category
filter panel, Customize Column, per-row WhatsApp messaging, and editable WhatsApp reminder/
thank-you/no-show templates. None of this needs a decision now: it's Reports and Notifications
scope Kuwick has already, correctly, deferred (D-012 defers the notification provider; Reports &
Analytics is 1f, last in the roadmap). This audit just confirms those deferred areas are real,
validated clinic needs worth prioritizing when their turn comes, not scope creep.
