# Pre-Merge Review — Appointment & Scheduling Module

**Branch:** `claude/kuwick-2-0-session-opener-bfumia` (tip `a121165` + this report's commit)
**Baseline:** `origin/master` @ `f7df6e0`
**Date:** 19 August 2026
**Scope:** the twelve-section hardening + product-QA pass ordered after the §57 build report, run before any fast-forward of master.

---

## 1. Scope and method

Every claim below was **measured against a running system**, not inferred from code: the security sections ran as the real non-superuser application role against real PostgreSQL; the QA sections drove the real UI over a seeded, Klinik Hijraa-shaped clinic week; the regression section ran every suite the repository has. Where a section found a defect, the defect is named, the fix is named, and the test that now pins it is named. Decision entries D-100…D-103 carry the full reasoning.

**Five hardening commits:** `e27c535` (§1), `7a6ebd2` (§2–3), `b555b61` (§4–5), `a121165` (§6–10), plus this report (§11–12).

---

## 2. §1 — Audit immutability

**Defect found and fixed.** `appointment_events` carried the combined FOR ALL `tenant_isolation` policy, so a tenant-scoped `UPDATE appointment_events SET reason='TAMPERED'` returned `UPDATE 1` — the DELETE/TRUNCATE protections existed, UPDATE did not. Migration `20260819160000_a_history_anyone_can_rewrite_is_not_a_history` closes it with three independent layers on `appointment_events` **and** `appointment_form_answers`:

| Layer | Mechanism | Binds |
|---|---|---|
| RLS | SELECT + INSERT policies only; no UPDATE/DELETE policy under FORCE RLS | every non-superuser, including the table owner |
| Triggers | BEFORE UPDATE (row) and BEFORE DELETE/TRUNCATE (statement) RAISE | **everyone, superusers included** |
| Privileges | app role holds INSERT + SELECT only | the application connection |

**Second defect, worse reach:** `provision-app-role.sql`'s broad GRANT re-opened UPDATE/DELETE on every audit table (including D-083's `visit_workflow_events`) on **every deploy**, because CI re-runs provisioning after `migrate deploy` and production re-runs it on password rotation. The file now ends with an append-only carve-out, so provisioning is idempotent *with* its guarantees.

**Proof:** `test/appointment-audit-immutability.e2e-spec.ts` — 14 tests, exercised from BOTH seats (kuwick_app: refusal by privilege; the owner/superuser: refusal by trigger), every attempt followed by a re-read proving the row unchanged, plus a grants assertion that fails the build if the carve-out is ever dropped. A side effect asserted deliberately: the ON DELETE CASCADE from `appointments` dead-ends in the DELETE trigger, so **an appointment that has history cannot be hard-deleted by anyone** — the module constraint, enforced at the bottom of the stack.

---

## 3. §2 — Public booking and RLS security

**The design held under attack; three repairs came out of the review** (all in `7a6ebd2`, D-101). Proven by `test/public-booking-security.e2e-spec.ts` (19 negative tests, all unauthenticated exactly as a stranger would be):

- The slug bootstrap is the **only** tenant-less query; everything else runs under ordinary RLS. A bare manage token with no tenant context reaches **nothing** at the database (asserted with the raw client).
- Unknown slug ≡ unpublished slug: one 404, same wording — no clinic enumeration.
- Tenant B's service uuid under tenant A's slug: providers 404, form-fields 404, and availability responds **byte-identically** to a nonsense uuid — no oracle for which uuids exist anywhere.
- Non-bookable and inactive services never appear; HIDDEN prices never leave the server (asserted the number is absent from the JSON, not merely unstyled).
- NRIC/phone enumeration: booking with an existing NRIC and a fresh one return **identical response shapes and identical messages**; the identifier is never echoed; the match confidence is recorded for staff and never revealed.
- Off-grid and wrong-length bookings refused; tenant B's doctor refused; a refused cross-tenant booking leaves tenant B's appointment count unchanged.
- **Repair 1:** `providers()`/`formFields()` answered for ANY service uuid (a retired service's doctor list and intake questions for the price of a leaked uuid) → both now gate on `bookable AND active` with the surface's standard 404.

## 4. §3 — Manage-token security

- Tokens are `randomBytes(32).toString('base64url')` — 256 bits, 43 chars, both generation sites. The **appointment uuid does not work as a token** (asserted). A forged token and a real token under the wrong clinic slug 404 identically.
- The manage view exposes the patient's **name only** — no phone, no NRIC, no internal ids, no other appointments; response keys are pinned by exact-set assertions.
- Reschedule **rotates** the token; the old link still opens (a patient checking a dead page is worse) but `can` is all-false and both mutation routes refuse. Cutoff and page-permission gates return the clinic's own wording ("ring the clinic").
- **Lifecycle documented as safe rather than adding expiry:** rotation-on-change + status gate + cutoff is the revocation mechanism; an expiring view would strand exactly the patient checking their time on the morning of the visit. A cancelled appointment's manage view shows only what the confirmation SMS already carried.
- **Repair 2 (found here, the important one):** staff reads (`findAll`/`findById`/`findDetail`) shipped `manageToken` — the patient's entire credential — to every signed-in appointment reader, unrendered by the drawer. Now redacted at the read boundary; the token exists in exactly two responses, both addressed to the patient. Pinned by test.
- Tokens are not logged: no request logger in the API, no Logger/console in the appointment module, event snapshots are whitelists without the token. (Reverse-proxy access logs in a future deployment would see manage URLs — a deployment note, not a repository defect.)
- **Repair 3:** `rescheduleByToken` was the one booking path without the two sorted advisory locks — two patients racing onto the last shared-capacity slot would both commit (the EXCLUDE constraint only backstops same-provider overlap). Same locks as `book()` now, taken before validation.

---

## 5. §4 — Deposit and payment hardening

Proven by `test/deposit-and-checkin.e2e-spec.ts` (§4 half) against real invoices:

- Paid fee → applied to the visit invoice **exactly once**, with a PAYMENT_CHANGED event; a second invoice on the same visit receives nothing (the single-valued link on the appointment is the guard).
- **Defect found and fixed (D-102):** cancelling the invoice stranded the deposit on the corpse — the replacement invoice skipped it (`depositInvoiceId: null` filter) and the counter would collect twice. `InvoiceService.cancel()` now releases the link in the same transaction; the test walks applied → released → re-applied and finds exactly three PAYMENT_CHANGED events telling that story.
- Reschedule carries fee, paid-stamp and link to the replacement; only the checked-in replacement's invoice sees the money.
- Cancel-before-invoice leaves the paid fee visible on the appointment for a human to settle — no invented refund flow.
- Unpaid fees are never applied; zero-fee appointments write no payment event; the DB CHECK (`no_payment_without_a_fee`) held throughout.
- **Deliberately absent:** webhook retry / duplicate-callback / gateway-idempotency scenarios. Kuwick has **no payment gateway** (docs §9–10); simulating one would test infrastructure that does not exist. `bookingFeePaidAt` is the single write-point a future gateway lands on, and everything downstream of it is what this section proved.

## 6. §5 — Appointment/Visit/Queue integrity

- **Defect found and fixed (D-102):** `checkIn` asserted status against a row read before its first transaction — two counters clicking together both passed and minted **two visits and two tickets** for one patient. Two atomic claims now (the D-087 shape): a status CAS for the CONFIRMED entry, and `visitId: null` on the link step for the already-ARRIVED entry, whose loser cancels its own duplicate ticket **in its own transaction** (the first attempt cancelled it inside the throwing transaction — the rollback resurrected it; the test caught two WAITING tickets behind a 409).
- **Defect found and fixed (D-102):** queue numbering was count-plus-one with no lock — two concurrent registrations both became "A007" for two **different** patients (observed in test output). Allocation now sits behind `pg_advisory_xact_lock` per clinic, stream and day, in the same transaction as the insert.
- Sequential double check-in refused by the status gate; check-in after cancel refused; concurrent doubles leave exactly one visit, one live ticket, and a cancelled duplicate with its reason recorded. 10/10 tests green.
- The three older integration suites (tenant-isolation, clinical-visit-queue, inventory-receiving) had rotted unwatched — pre-D-034 header auth, pre-D-094 transition expectations, stale dates, cleanup that deletes the undeletable. All repaired; they now authenticate with real signed JWTs (`test/auth.ts` — no test-only bypass added to the app).

---

## 7. §6 — Roster manual QA

Seeded week (`prisma/premerge-qa-seed.ts`): six providers across **both** schedule modes — monthly roster with morning/evening/**overnight 22:00→06:00** shifts, OFF and approved-LEAVE cells, a weekend locum; fixed-weekly with **split shifts** (09:00–13:00 + 14:30–18:00), a 10:00–20:00 pattern, and a deliberately long hyphenated name. Findings:

- The roster page renders both populations correctly: monthly-roster providers in the month grid with "Use a weekly pattern instead", fixed-weekly providers in per-day editors with "Move to the monthly roster" and "Copy last month".
- Editing a weekly pattern **end-dates** the old one (stated on the page, verified in `doctor-schedule.service.ts`).
- Approved leave refuses bookings through the engine with the human reason ("on approved leave that day") — re-verified via the availability route.
- Evidence: screenshots 07 (roster), 03 (split + night in week view), 15 (leave-driven empty state).

## 8. §7 — Calendar manual QA

**The pass earned its keep here (D-103).** The diary claimed "the clinic's own clock" and delivered the *browser's*: react-big-calendar positions by local Date fields, so raw instants drew the 09:00 patient at 01:00 for any reader outside Malaysia — while every label on the same chip said 09:00. Week view was worse: grid bounds derive from the roster (clinic hours), so the entire live morning sat **above the visible window**. And the fetch range, computed from browser-day boundaries, never asked the API for the clinic's early morning at all. Invisible on every Malaysian machine and every CI assertion to date.

Fixed with a two-way bridge at the grid's edge (`clinicWallDate` in, `fromClinicWallDate` out, clinic-day fetch range) — nothing stored changes shape. Same family: the canvas mini-month dotted appointments one day off their printed label after 16:00 UTC (antd cells carry the panel's time-of-day) — also the source of an hour-of-day CI flake, which failed `b555b61`'s CI run and went green in `a121165` **within the same flake window**, confirming cause and cure. And one honesty fix: rbc's 12-hour built-in label was a second clock on every chip next to our 24-hour clinic time; it is hidden and `cardLines` now leads with the clinic time at every card size.

After the fix, re-shot and verified: busy day with 12 booked/1 waiting/2 completed/1 no-show across six providers; single-provider filter; week view with the split-shift lunch gap and the night shift; month view; 1024-wide viewport; the drawer (clinic-zoned, MRN/phone/booked-by/payment/reminder, Check in + Reschedule).

## 9. §8 — Public patient booking manual QA

Desktop (1440) and mobile (390) both walked: services → doctor → time → details. Verified on screen:

- Price display variants: EXACT (RM 45.00), FROM (from RM 120.00), HIDDEN (no number in the page source at all); the RM50 deposit line; "Confirmed by the clinic" chip on approval services; BM+EN copy.
- The slot grid on the busy Wednesday shows Morning/Afternoon/Evening groups, **subtracts booked slots**, renders the split-shift lunch gap (…13:45, 14:30…) and offers the night shift's 22:00–23:45 — with 23:00 correctly withheld (booked).
- Empty states are sentences, not blanks: "Nothing free that day — that is too soon, please pick a later day" (same-day) and the no-provider day.
- Manage page (desktop): status chip, clinic-zone times, service, provider, patient name only, Change the time / Cancel per page settings.

## 10. §9 — UI/UX review

- One module, five surfaces, one tab strip — matches the blueprint's shape; retired URLs redirect (e2e-pinned).
- The page reads as **Kuwick**: same nav chrome, same KuwickStatusTag chip language as Queue/Dispensary, same empty-state and refusal voice ("That is too soon", "ring the clinic"), 24-hour clinic clock everywhere after D-103. Nothing copies Yezza's cosmetics; the audited *capabilities* are what carried over.
- Money is honest: Booked value vs realised revenue are separate figures with separate sources (price list vs invoices), labelled as such on the List.
- The one cosmetic debt found and accepted: two legacy synthetic UAT services ("Density …") share the public page with the QA services on the staging tenant — tenant data, not module behaviour.

## 11. §10 — Screenshot evidence

19 images in `docs/premerge-qa-screenshots/` (01–18 + 11b), captured at 1440/1024/390 wide through the real UI against the seeded week — calendar (5 angles + drawer), roster, list + waitlist, services, booking-page settings + Sharing tab with QR and per-service links, public desktop flow (4 stages incl. empty state), public mobile (2), manage page. Every image was reviewed, not just captured; the §7 defects were found *in* them, fixed, and the set re-shot.

---

## 12. §11 — Full regression

| Gate | Result |
|---|---|
| API unit suite (Jest) | **1897 / 1897** |
| Web unit suite (Vitest) | **1566 / 1566** |
| API integration suite — real PostgreSQL, as `kuwick_app` NOSUPERUSER NOBYPASSRLS (RLS, tenant-isolation, audit-immutability, public-booking security, deposit/check-in) | **63 / 63** |
| Playwright E2E (golden path + OTC, appointment module, public booking→check-in→visit→queue, manage-cancel, route sweep, viewport, catalogues, patient profile) | **40 / 40**, exit 0 |
| API typecheck / Web typecheck | clean / clean |
| API production build / Web production build | clean / clean |
| `prisma migrate status` | 86 migrations, schema up to date |
| Migration drift probe (fresh DB ← migrations, diffed against the datamodel) | **no structural drift** — remaining diff is constraint-name cosmetics plus the hand-written DB-level extras Prisma cannot express (partial indexes, RLS, triggers, EXCLUDE), which are deliberate; four FK `onDelete: Restrict` annotations were added to the datamodel so it now states what the migrations always enforced |
| CI on the branch tip (`a121165`, run 32285080052) | **success** — both jobs, including the new "API integration suite" step, which had never existed before this pass |

The CI gap itself was a §1 finding: **`test:api:e2e` had never run in CI** — the RLS and tenant-isolation proofs the whole design leans on were dead weight. The unit job now runs them against its real PostgreSQL as the application role on every push.

## 13. Verdict

**READY TO MERGE.**

Nine defects were found by this pass and all nine are fixed on the branch with pinning tests or re-shot evidence: audit UPDATE tampering; provisioning silently re-granting on audit tables; the uuid-knowledge leak on providers/form-fields; the manage-token exposure to staff reads; the missing locks on token reschedule; the stranded deposit on invoice cancel; duplicate visits/tickets under concurrent check-in; duplicate queue numbers under concurrent registration; and the calendar/canvas clinic-clock family. No open defects remain known.

**Residual risks, stated plainly:**
- A database superuser can drop the append-only triggers — no in-database mechanism prevents that (D-083's known limitation, unchanged; the triggers are the layer that *catches* a superuser who has not first dismantled them).
- The manage token travels in the URL path; a future reverse proxy's access log would see it. Deployment runbook concern.
- No payment gateway exists; §4's webhook semantics are consciously untested because they are unimplemented. The reconciliation downstream of `bookingFeePaidAt` is fully tested.
- `origin/master` remains at `f7df6e0` — **not fast-forwarded**, per instruction, awaiting explicit approval.
