# Kuwick 2.0 — Management Owner UAT Guide

**Purpose:** structured acceptance testing of the **Management system** (Operation
analytics, Stock, Panel & Claims, HR, Finance) by the clinic owner and senior staff —
so you can confirm the system does what `MANAGEMENT_USER_MANUAL.md` says, find genuine
defects, and avoid reporting *intended restrictions* as bugs.

**Scope:** Management only. The appointments diary, patient booking, clinical
consultation, dispensary and queue have their own guides; they appear below only as
the steps that *create* the facts Management shows.

**Time needed:** roughly one working day for the full pass, with two people (one
"counter/doctor" pair to generate facts, one owner to verify Management).

---

## 1. Before you start

### 1.1 The environment

Test on the **UAT deployment** (the Railway-hosted staging environment Kuwick set up
for you), never on your live clinic. Confirm you are on UAT by the web address and by
the synthetic clinic name. Note the **build** code from the user menu — write it on
every result you record. If figures look stale mid-test, refresh the page; reports
read live data but do not auto-refresh.

Two valid starting states:

- **Seeded UAT tenant** — the standard staging seed creates the clinic **"Klinik UAT
  Staging (Synthetic)"** with five logins (one shared password, set at seed time):

  | Login | Role it simulates |
  |---|---|
  | `owner@uat.kuwick.invalid` | Owner-admin |
  | `frontdesk@uat.kuwick.invalid` | Front desk (counter + clinical staff) |
  | `finance@uat.kuwick.invalid` | Finance staff |
  | `doctor@uat.kuwick.invalid` | Doctor |
  | `stock@uat.kuwick.invalid` | Stock staff |

  plus medicines in deliberate stock states (adequate / low / out-of-stock), four
  services (General Consultation RM 35, Wound Dressing RM 25, Full Blood Count RM 45,
  Nebuliser RM 30), an all-day consultation tariff, one panel ("UAT Panel Sdn Bhd"),
  and a queue of patients staged at every step of the visit (waiting, in consultation,
  ready for dispensary, ready for payment, panel patient, documentation pending).

- **A clean tenant you set up yourself** using
  `MANAGEMENT_FIRST_TIME_SETUP_CHECKLIST.md` — a stronger test of setup itself.

The scripts below work with either; steps marked **(seeded)** lean on seed data.

### 1.2 The golden rule: defect vs intended restriction

Before filing anything, apply these three checks:

1. **A refusal that names your account is intended.** Messages in the pattern
   *"Your account is not permitted to …"*, *"Only an owner may …"*, *"Only a doctor
   may …"*, *"…needs the billing-corrections permission"*, *"Billing responsibility
   has not been confirmed."*, *"This is the last owner account…"* are the permission
   system and billing safeguards **working correctly**. The defect would be the
   *opposite* — the action succeeding for an account that should be refused.
2. **Check the known-limitations table (Section 9) and the User Manual Chapter 12 /
   Appendix A.** If the behaviour is listed there, it is a known gap, already
   recorded — you may still note that it matters to you, but it is not a new defect.
3. **Reproduce it twice.** Note the exact steps, account used, and build code. A
   one-off you cannot reproduce goes in as "observation", not "defect".

A genuine defect is: a wrong number (money, stock or count that does not match the
facts you created), an action that succeeds when the manual says it must be refused
(or vice versa where not listed as a known gap), data appearing under the wrong
patient/panel/branch, an error page/crash, or history changing after the manual says
it is frozen.

### 1.3 Recording results

Keep a simple log — one row per test ID below: **Pass / Fail / Observation**, with
the build code and, for failures, the exact steps, account, expected vs actual, and a
screenshot. A defect report template is in Section 10.

---

## 2. Access & permission tests (ACC)

Run these first — they establish trust in every later refusal. Use the seeded logins
(or equivalents you created).

**UAT-ACC-01 — Everyone can see Management (known gap, verify it consciously).**
Sign in as each of the five accounts; open Management from the user menu.
*Expected:* every account can open Management and view reports. This is the recorded
access-control gap (Manual 3.2) — record it as confirmed, not as a new defect.

**UAT-ACC-02 — Discounts are corrections-only.**
As `frontdesk`, open a **Paid-pending** visit's Billing Review (seeded: any
ready-for-payment patient) with an Unpaid invoice; try to apply an invoice discount.
*Expected:* refused — *"Applying a discount or cancelling an invoice needs the
billing-corrections permission."* Repeat as `finance` or `owner`. *Expected:*
succeeds, and the discount requires a written reason.

**UAT-ACC-03 — Only owners manage users.**
As `frontdesk`, open Management ▸ HR ▸ Staff. *Expected:* the list is visible but the
**Access** button is absent/refused, and creating staff is refused. As `owner`:
full access.

**UAT-ACC-04 — Professional fields are owner-admin-only.**
As `finance` (or any non-owner-admin), edit a doctor's staff record and try to change
the MMC/verification/signing fields. *Expected:* refused. As `owner`: succeeds, and
the change is recorded.

**UAT-ACC-05 — Doctor role needs an MMC number.**
As `owner`, create a new staff member with no MMC number; open their Access drawer.
*Expected:* the **Doctor** checkbox is disabled with the tooltip explaining a medical
registration number is needed first.

**UAT-ACC-06 — The last owner is protected.**
As `owner` (with no other account holding Owner), open your own Access drawer and
save your access with **Administrator ticked but Owner not ticked**. *Expected:*
refused — *"This is the last owner account. Assign OWNER to somebody else before
removing it here."*

**UAT-ACC-07 — Deactivation is total.**
As `owner`, create a throwaway staff member with a login; sign in as them to prove it
works; deactivate them; sign in again and try any action (e.g. open a patient, take a
payment). *Expected:* the account signs in but every gated action is refused (an
inactive account holds zero permissions). Reactivate or leave deactivated — deletion
is (correctly) impossible.

**UAT-ACC-08 — Individual grant with a reason.**
As `owner`, grant `billing.corrections` to the front-desk account **without** typing
a reason. *Expected:* refused until a reason (≥ 3 characters) is entered. With a
reason: succeeds; after the front desk signs in again, UAT-ACC-02's refusal turns
into success. Remove by roles afterwards if you wish.

---

## 3. Finance & Sales tests (FIN)

Generate one clean fact-set first as the counter/doctor pair (or use the seeded
ready-for-payment patients), then verify as the owner.

**UAT-FIN-01 — Consultation fee is automatic.**
Take a consultation-classified visit to Billing Review; create the invoice.
*Expected:* a consultation line appears by itself at the tariff's service price
(seeded: RM 35), without anyone adding it. Re-open the page. *Expected:* still exactly
one consultation line (never duplicated).

**UAT-FIN-02 — Medicine is billed in packs.**
Prescribe 30 units of an item configured 10-per-pack; dispense; bill.
*Expected:* the medicine line shows quantity **3** (packs) × the pack price — not 30 ×
anything. If the item has no pack quantity, the expected behaviour is a **refusal**
naming the item (see UAT-STK-05), never a guessed price.

**UAT-FIN-03 — Payment is all-or-nothing, and freezes the invoice.**
Pay the invoice by Cash. *Expected:* one payment for exactly the remaining balance
(no partial option — known design); status becomes **Paid**; afterwards every change
(add line, discount, cancel) is refused. *Also expected (known gaps, verify
consciously):* no receipt can be printed, and nothing records which staff member took
the payment.

**UAT-FIN-04 — Cancelling is for unpaid invoices, with a reason.**
On a different visit, create an invoice, then cancel it. *Expected:* a reason is
mandatory; status becomes Cancelled. Try to cancel a **Paid** invoice. *Expected:*
refused (paid records are final — corrections to paid records are a recorded future
workflow).

**UAT-FIN-05 — Line cancellation keeps history.**
On an unpaid invoice, cancel one line (reason required). *Expected:* totals drop; the
line stays visible under "Cancelled … retained in financial history"; a waived
consultation is not silently re-added on reload.

**UAT-FIN-06 — Day-End Closing shows the day's money.**
After FIN-01…03, open Management ▸ Finance & Sales ▸ Day-End Closing for today.
*Expected:* Total Sales, Cash Collected and the Cash payment-method row match the
invoices you paid today (down to the sen); the panel patient (if billed today)
appears under Panel Billed and in the panel table; any invoice you created but left
unpaid appears in the yellow unpaid warning. Export both CSVs — files download and
match the tables. *Not a defect:* no close/lock button exists (known design);
payments taken before 8:00 am may appear under the previous date (known timezone
quirk); the page always shows all branches.

**UAT-FIN-07 — Invoice Listing is the transaction record.**
Open Invoice Listing (range: today). *Expected:* every invoice from your tests with
correct status, totals, patient-paid and panel amounts. Filter **Outstanding
(Unpaid)**. *Expected:* exactly the invoices you left unpaid. Filter **Cancelled**:
the FIN-04 invoice. CSV downloads.

**UAT-FIN-08 — Discount maths.**
As an account with corrections: apply a 10% invoice discount to an unpaid RM 100
self-pay invoice. *Expected:* patient responsibility RM 90; after paying, Day-End and
Sales Analysis count RM 90 (not RM 100). *Not a defect:* the dashboard's
category-donut figures are pre-discount (known quirk); there is no way to *remove* a
discount (known limitation — cancel the invoice and re-bill instead).

**UAT-FIN-09 — Sales Analysis consistency.**
Open Sales Analysis (range: today). *Expected:* Total Sales equals Day-End's Total
Sales for the same single day; panel vs non-panel counts match what you billed.
*Not a defect:* "Panel Sales" here is the full value of panel patients' invoices, so
it can exceed Day-End's "Panel Billed" (different definitions, both documented).

---

## 4. Clinic Operations report tests (OP)

**UAT-OP-01 — Patient Analysis counts visits, not bills.**
Note today's figures; register one new test patient and check them in (no billing).
*Expected:* Total Visits +1, Unique Patients +1, **New** +1 (the patient record was
created today). Check an existing patient in again: Visits +1, New unchanged.

**UAT-OP-02 — Waiting Times react to the queue.**
Let one test patient wait a known ~10 minutes before calling them, then complete the
visit. *Expected:* the visit appears in the measured count; the wait lands in the
right distribution bucket (0–15); averages are plausible. *Not a defect:* Visits can
exceed the measured count (uncalled tickets are counted as visits but not measured);
consultation and dispensary time are one combined figure (known design).

**UAT-OP-03 — Procedure Analysis shows ordered services only.**
After a paid invoice containing a Wound Dressing order. *Expected:* Wound Dressing
appears with its revenue; the consultation fee and medicines do **not** appear on
this page (by definition); "% by Doctors" credits the doctor who *ordered* it.

**UAT-OP-04 — Doctor Performance adds up.**
Open Doctor Performance for today. *Expected:* the doctor's Sales equals the paid
invoices attributed to their visits; patients = number of invoices; a visit with no
attending doctor shows under "Attending clinician not assigned". *Not a defect:* the
four category columns may not sum exactly to Sales when discounts were used; there is
no "score" or incentive figure (known scope).

**UAT-OP-05 — Executive Dashboard agrees with its sources.**
With today's range: Total Revenue = Day-End Total Sales; Panel Outstanding = the
Outstanding Aging tab's total (note it ignores the date range — "as of today");
the doctor leaderboard matches UAT-OP-04. Click a donut segment (highlights) and a
leaderboard row (expands revenue-per-patient).

**UAT-OP-06 — Empty states are honest.**
Set the range to a period before the seed/tests. *Expected:* "No data in this range
yet" placeholders and zeroed tiles — no errors, no invented numbers.

---

## 5. Stock tests (STK)

Use the stock login (or owner). Multi-branch testers: do these from a branch-bound
account, or expect the "Pick a clinic" prompt on the Items page (known behaviour).

**UAT-STK-01 — Buy stock: request → PO → receive.**
(a) On Stock Health ▸ Low Stock, press **Reorder** on a low item. *Expected:* a
Pending procurement request for the shortfall; the button changes to "Request
pending". (b) Approve it on Procurement Requests. *Expected:* status Approved — and
nothing else happens (no PO is created; known gap — the PO is created by hand).
(c) Create a Purchase Order to a supplier with that item, qty 10, unit cost.
*Expected:* status **Ordered**. (d) **Receive** 6 of 10 with batch number and expiry.
*Expected:* PO becomes **Partially Received**; on-hand +6; the batch appears under
Near Expiry with your expiry date (supplier column "—" is known behaviour for PO
receipts). (e) Receive the remaining 4. *Expected:* **Fully Received**; on-hand +10
total. *Also expected (known gaps):* the approved request never shows "Converted";
there is no way to cancel a PO; received unit cost updates nothing.

**UAT-STK-02 — Stock In for direct arrivals.**
Stock Health ▸ **Stock In**: add 5 packs of an item with batch/expiry and a supplier.
*Expected:* on-hand +5; the batch (with supplier this time) appears in Near Expiry
when within the window.

**UAT-STK-03 — Dispensing deducts once, in packs.**
Note an item's on-hand. Prescribe 30 units (10-per-pack); dispense at the Dispensary.
*Expected:* on-hand drops by exactly **3**. Attempt to dispense the same prescription
again (second click / second person). *Expected:* "already been dispensed" — the
balance does **not** drop again.

**UAT-STK-04 — Shortage is a warning, and negative stock is allowed.**
Dispense a quantity needing more packs than on-hand (seeded: the out-of-stock ORS or
low-stock items). *Expected:* a warning naming the shortfall; only after
**acknowledging** does it dispense; the balance goes negative and the item appears on
Stock Health ▸ **Negative Stock**. This is the owner-approved design, not a defect —
the tab is the reconciliation worklist.

**UAT-STK-05 — No pack quantity = honest refusal.**
Prescribe an item whose "quantity per stock unit" is empty (seeded: the item list
deliberately includes unconfirmed ones — see the red "needs attention" chip).
*Expected:* dispensing/billing that item is refused with instructions to fix the
item; it is never guessed at 1. Fix the item (set the pack quantity), retry.
*Expected:* now works, and the needs-attention count drops.

**UAT-STK-06 — Quick adjustment demands a reason.**
On Items, use **−** to remove 1 (breakage). *Expected:* the OK button stays disabled
until a reason is typed; afterwards the balance drops by 1.

**UAT-STK-07 — Stock take sets the truth.**
On Stock Take: for two items type counted quantities (one over, one short); submit.
*Expected:* "N item(s) adjusted", a result table showing only the variances, and the
balances now equal your counts exactly. *Not a defect:* no draft/approval step and no
per-line reason (known single-step design).

**UAT-STK-08 — Thresholds drive Low Stock.**
Set an item's min threshold above its balance. *Expected:* it appears on Low Stock
with the right "Short By". Set the threshold equal to the balance. *Expected (known
quirk):* the Items list shows a "Low" tag but the Low Stock tab does *not* list it.

**UAT-STK-09 — Near Expiry is an early-warning list, not a count.**
After dispensing most of a batch, check Near Expiry. *Expected (known limitation):*
the batch still shows its full received quantity — batch quantities are never reduced
by dispensing; the list tells you *what to check on the shelf*.

**UAT-STK-10 — Drug Movement reflects sales.**
After your paid medicine bills, open Drug Movement (range: today). *Expected:* the
dispensed-and-paid items appear with the right quantities and revenue; unbilled
dispensing does not. *Not a defect:* fast/slow tags are relative tertiles; never-sold
list may include deactivated items.

**UAT-STK-11 — Items cannot be deleted.**
Deactivate a test item. *Expected:* it stays in the list (greyed), stays on its past
prescriptions/invoices, and stops being offered for new prescribing. There is no
delete button — by design.

---

## 6. Panel & Claims tests (PAN)

Use the seeded panel (or one you created with **payment term 30 days** and **claim
fee 8%** for the fee test).

**UAT-PAN-01 — Panel choice is per visit, verification is the gate.**
Register a patient as Panel. Open the visit's Billing Review. *Expected:* "Not yet
verified", and paying is blocked with *"Billing responsibility has not been
confirmed."* — this refusal is correct behaviour.

**UAT-PAN-02 — The split follows the verified terms.**
Record verification: **Visit limit RM 200, co-payment 10%**, on a bill totalling
RM 250. *Expected:* panel responsibility **RM 180**, patient **RM 70** (RM 50 over
the limit + RM 20 co-pay, which is 10% of the capped RM 200). Try two more from the
manual's table (8.4) — e.g. Unlimited + RM 10 fixed → RM 240 / RM 10. Wrong splits
here are **high-priority defects**.

**UAT-PAN-03 — Exclusions are patient-payable.**
Add an exclusion for one service on the panel; bill a panel visit containing it.
*Expected:* that line is flagged excluded and lands entirely on the patient, on top
of the limit; the percentage co-pay is calculated without it.

**UAT-PAN-04 — Failed verification stores no guesses.**
On another panel visit, record verification result **Failed**. *Expected:* no terms
are stored; billing responsibility stays unconfirmed until finance **overrides**
(which demands a written reason and records the original state).

**UAT-PAN-05 — Override is finance/owner-only.**
As `frontdesk`, try the override. *Expected:* refused. As `finance`: succeeds with
reason.

**UAT-PAN-06 — "Panel — No Patient Payment" rules.**
On a fully covered bill (patient RM 0): *Expected:* settling with method Panel
works, and the screen notes the panel receivable is collected under Panel & Claims
(the message may say "Finance →" — a known stale label). On a bill where the patient
owes money: *Expected:* the Panel method is refused.

**UAT-PAN-07 — Paid panel invoices appear as claims by themselves.**
Open Management ▸ Panel & Claims ▸ Panel Claims ▸ pick the panel. *Expected:* every
panel invoice you settled appears in the create-batch list / Claim Listing as
**Unclaimed** — automatically, with no action from you. An **unpaid** panel invoice
does not appear (settle the patient side first — known design).

**UAT-PAN-08 — The claim fee is added, and the batch freezes amounts.**
With claim fee 8%: batch one invoice whose panel share is RM 100. *Expected:* the
batch line shows Claimed RM 100, Fee RM 8, **To Receive RM 108**, and the batch is
numbered `CLAIM-…`. (Fee configured as flat RM 5 → RM 105.) Change the panel's fee
afterwards. *Expected:* the existing batch's figures do **not** change (frozen at
creation).

**UAT-PAN-09 — Submission is recorded, not transmitted.**
Press **Submit** with method "Panel's Own Portal" and a reference. *Expected:* status
Submitted with your method/reference — and nothing was sent anywhere by Kuwick
(by design; confirm no one expects otherwise). The batch now appears under
**Outstanding Aging**; after more than the payment term (or with a 0-day term), the
overdue tag shows.

**UAT-PAN-10 — Outcomes, partial payment, rejection and re-claim.**
On a two-invoice batch: mark line 1 **Paid** in full; mark line 2 **Rejected** with
remarks. *Expected:* the batch shows Partially Paid; the rejected invoice
**reappears in the eligible list** for a fresh batch (the manual re-claim path);
receivable figures update. Then create the new batch for it. *Expected:* fee
recalculated fresh.

**UAT-PAN-11 — Reconcile closes the book.**
When every line is settled, **Reconcile** the batch. *Expected:* status Reconciled;
further edits refused; Outstanding Aging drops it; the Executive Dashboard's Panel
Outstanding falls accordingly.

**UAT-PAN-12 — Yearly Summary adds up.**
Open Yearly Summary for this year. *Expected:* claims/claimed/fee/paid/outstanding
match the batches you just made (including the TOTAL row); CSV downloads.

*Known traps to verify consciously (not defects):* an invoice cannot be removed from
a batch except via Rejected/Deducted; a payment of RM 0 cannot be recorded; a batch
with every line rejected displays as Partially Paid; recording more than the claimed
amount is not blocked (produces negative receivable — check it, then avoid it).

---

## 7. HR tests (HR)

**UAT-HR-01 — Staff creation with login** — covered by UAT-ACC-05/07; additionally
verify: the staff number and home clinic show on the list; a doctor's calendar colour
appears on the diary. *Known gaps to verify consciously:* the name cannot be edited
afterwards; there is no password reset.

**UAT-HR-02 — Attendance is derived from doctors' visits.**
After the doctor completed visits today, open Management ▸ HR ▸ Attendance.
*Expected:* one row for the doctor today — first check-in ≈ the first patient's
arrival, visit count right. *Also expected (by design):* the front-desk, finance and
stock accounts show **no rows ever**; a doctor with no visits shows nothing. Anyone
proposing to use this for payroll should re-read Manual 9.5.

**UAT-HR-03 — Leave blocks the diary when approved.**
File leave for the doctor next Monday; leave it **Pending**; check the public/staff
booking for that day. *Expected:* slots still offered (pending blocks nothing).
Approve it. *Expected:* Monday now offers no slots for that doctor ("on leave"), and
the roster shows a violet Leave chip. *Also verify (known gaps):* an appointment
already booked for Monday is not cancelled or flagged; no balance/entitlement is
checked; the "Approving as" person is picked from a dropdown (honour system — note
who your team should pick).

**UAT-HR-04 — Public holidays are opt-in per branch.**
Add a holiday next Friday. *Expected:* booking for Friday is **unchanged** (the
default). Switch on "observe public holidays" in the branch's Booking Rules.
*Expected:* Friday now offers no slots. Switch it back to match real practice.

**UAT-HR-05 — Roles page hygiene.**
Create a custom role "UAT Manager" with a few permissions; attach it to a test
account; verify the effective-permissions list grows; delete the role. *Expected:*
the deletion warns it will be removed from N staff, and the account's effective list
shrinks accordingly.

---

## 8. Cross-module consequence tests (X)

**UAT-X-01 — No tariff, no fee (the silent one).**
Deactivate every consultation tariff rule; run a fresh consultation visit to billing.
*Expected:* **no consultation line and no warning** — confirming the manual's biggest
setup caution. Reactivate the rule; new visits charge again (the unbilled visit's
invoice can have the charge added explicitly).

**UAT-X-02 — Money blocks visit completion.**
Try to complete a visit whose invoice is unpaid (or with an undispensed-but-billable
item). *Expected:* completion is blocked, naming the reason; paying (and dispensing)
unblocks it. There is no override — by design.

**UAT-X-03 — Config changes never rewrite history.**
After UAT-PAN-08: also change a panel item price override and re-open an already-paid
invoice and an existing claim. *Expected:* nothing changes anywhere; only *new*
bills use the new price.

**UAT-X-04 — The report day boundary.**
If you can test in the early morning (before 8:00 am): pay an invoice.
*Expected (known quirk to confirm, not a new defect):* it appears in the *previous*
day's Day-End.

**UAT-X-05 — One fact, many mirrors.**
For one paid panel visit, trace the same ringgit through: Billing Review →
Day-End → Invoice Listing → Sales Analysis → Panel Claims (claimed amount) →
Executive Dashboard. *Expected:* the same amounts everywhere, allowing each page's
documented definition differences (FIN-09). Any genuine mismatch is a
**high-priority defect** — capture all six screenshots.

---

## 9. Known limitations — do not file these as defects

The full list is `MANAGEMENT_USER_MANUAL.md` Chapter 12 and Appendix A. The ones
most often mistaken for bugs during UAT:

| You will notice | It is |
|---|---|
| Any staff login can open Management and all reports; stock/panel/claims/leave/holiday screens accept writes from any login | Recorded access-control gap (Manual 3.2) |
| "Viewing: (branch)" on report pages while numbers are company-wide | Recorded gap — only the Executive Dashboard filters by branch |
| Day-End has no close/lock/cash-count | By design today — it is a report |
| No receipt/invoice printing; no partial payment; no change calculation; no refunds or credit notes | Not built (recorded) |
| No SST/tax line; e-Invoice LHDN menu item greyed out | Not built; e-Invoice approved but pending |
| Who took a payment / who cancelled an invoice is not recorded | Recorded audit gap |
| Early-morning transactions on the previous report day; hour chart shifted | Recorded timezone quirk |
| Approved procurement request never becomes "Converted"; PO cannot be cancelled; no PO number; no GRN screen; supplier cannot be edited | Recorded inventory gaps |
| Near Expiry shows full received batch quantities; no FEFO | Recorded design limits |
| Negative stock allowed after an acknowledged shortage | Owner-approved design (D-020) |
| Stock take has no approval step or per-line reason | By design today |
| Claim fee can only be *added*, never deducted | Recorded — see Manual 8.7 for the workaround |
| No electronic claim submission, no claim form/statement generation | By design — submission happens outside Kuwick |
| Cannot remove an invoice from a batch; cannot record RM 0 received; all-rejected batch shows "Partially Paid" | Recorded claim quirks |
| Panel chosen per visit (no patient-level membership); GL is a text reference | Recorded scope |
| Attendance shows doctors only; leave has no balances; anyone can approve leave "as" anyone; holidays typed by hand | Recorded HR scope/gaps |
| No payroll, EPF/SOCSO/PCB, payslips, incentives | Out of scope by decision (Manual Ch. 10) |
| Staff name/supplier not editable; stray "Finance → Panel & Claims" label | Recorded screen gaps |

---

## 10. Defect report template

Copy one block per defect into your log / issue tracker:

```
ID:            (your running number, e.g. DEF-007)
Test:          (e.g. UAT-PAN-02, or "exploratory")
Build:         (the build code from the user menu)
Account used:  (e.g. finance@uat.kuwick.invalid)
Branch:        (if relevant)
Steps:         1. …
               2. …
Expected:      (what the manual / test script says should happen)
Actual:        (what happened — exact message text, exact numbers)
Money/stock impact:  (yes/no — wrong RM or wrong stock counts are high priority)
Reproducible:  (yes, every time / intermittent)
Screenshot(s): (attached)
Checked against Section 9 & Manual Ch.12/App.A:  (yes — not listed there)
```

**Priority guide:** wrong money or stock numbers, or a gated action succeeding for
the wrong account → **P1**. A workflow that cannot be completed at all → **P2**.
Wrong labels, confusing text, layout issues → **P3**. Known-limitation confirmations
→ record as observations with your business impact, so they can be prioritised for a
future phase.

---

## 11. Sign-off

UAT is complete when: every ACC/FIN/OP/STK/PAN/HR/X test has a recorded result; all
P1s are fixed and re-tested on a new build; P2s are fixed or explicitly accepted;
and the owner signs the log with the final build code. Keep the signed log — it is
the record of what was accepted, on which build, against which known limitations.
