# Management UAT — the flows to run, and what to look for

**Fifteen workflows an owner can run against the seeded clinic, each with the
question it is meant to answer and the figure that proves it worked.**

The programme's acceptance question is: *can a real clinic operate these
workflows in Kuwick without going back to the old Hijraa system, the payroll
Excel, or the panel Google Sheet?* These flows are how you decide that for
yourself rather than taking a report's word for it.

**Sign in**: `owner@admin-uat.kuwick.invalid` / `AdminUat!2026`. Three other
accounts (`finance@`, `stock@`, `panel@`, same password) exist so permission
boundaries can be checked from the other side.

These flows are written against the **local** Management fixture
(`seed-admin-uat.ts`, clinic "Klinik Contoh (UAT)", two branches). A Railway UAT
deployment is seeded by `seed-staging-uat.ts` instead — different clinic, single
branch, and the owner there is `owner@uat.kuwick.invalid`. Check the clinic name
in the header before concluding a credential is broken; the
[Management A–Z guide](./KUWICK_MANAGEMENT_A_TO_Z_USER_UAT_GUIDE.md#1-before-you-start)
has the full table.

**Every figure below is synthetic.** The seeded clinic is fictional and none of
it comes from the workbooks; see
[`MIGRATION_AND_IMPORT_SAFETY.md`](./MIGRATION_AND_IMPORT_SAFETY.md).

Screenshots of every step: [`screenshots/admin/management-completion/`](./screenshots/admin/management-completion/).

---

## A · Panel money — the three questions a claim queue cannot answer

### A1. What did we bill a panel and never claim?
`Finance → Panel money`

1. Read the strip: **billed RM985, claimed RM720, and RM265 never claimed.**
2. Open **Never claimed**. Two invoices, the older waiting **70 days**.
3. Note the ageing panel at the bottom, and that nothing is called *late*.

**Why this matters.** Those two invoices appear in no claim listing anywhere —
they are invisible by construction, which is why the clinic reconciles a
billing export against the workbook by hand every month. **Kuwick does not put
a deadline on them**: no panel record states a first-submission window, and the
two-month rule in the rejection register is about re-claiming. The age is a
fact; a deadline would be a rule nobody agreed.

**Fails if**: the figure is zero, or a claim that was rejected has not returned
its invoice to "never claimed" — a rejected claim frees its invoice, so that
money is genuinely unasked-for again.

### A2. What do the panels' admin fees cost us?
`Finance → Panel money`

1. **Admin fees borne RM33.60**, with more still to come.
2. Read the amber notice: *N claims carry a fee whose direction nobody has
   configured*. Their fee is in **neither** figure.

**Why this matters.** Only askable since 2026-08-31 (D-112): the clinic bills
RM100 and banks RM92, and that RM8 appeared in no ledger. An unconfigured fee
is excluded and **counted**, never quietly treated as zero — that assumption is
what let the original error survive.

### A3. Did a panel actually take its fee?
`Finance → Panel money → Fee exceptions`

1. One row: claimed RM120, the rule expects RM110.40, **RM120 arrived**.
2. Read the counters: taken, still owed, closed without payment, cannot be
   attributed.

**Why this matters.** This is the standing version of the forensic pass that
found two such payments in 2,640 workbook rows. **A short-paid claim reads
"cannot be attributed", not "the fee was taken"** — on a part-approved claim
the gap could be the rejection or the fee, and nothing in the numbers tells
them apart.

---

## B · Supplier payables — the question Kuwick could not answer at all

### B1. What do we owe, and what must we pay this week?
`Finance → Supplier payables`

1. **Owed RM9,715 · overdue RM1,860 · due this week RM6,300 · disputed RM940 ·
   undated RM615.**
2. Read the amber notice naming the supplier with **no payment term recorded**.

**Why this matters.** The clinic's own payable workbook computes its headline
by summing the payment **date** column. Here every figure is derived from
allocated payments, and **no term means no due date** — Kuwick will not assume
thirty days, and says which supplier to go and ask.

### B2. Pay a supplier
`Finance → Supplier payables → Pay`

1. Enter an amount and allocate it across the open invoices.
2. Try to save with the allocations not equal to the payment. **Refused.**
3. Try `PATCH` an invoice to `PAID` directly (API). **Refused**: *"PAID is
   derived from the payments allocated to this invoice."*

**Fails if**: an invoice can be marked paid without money behind it.

---

## C · Panel claims — the workbook's own workflow

### C1. Configure a panel's fee, effective-dated
`Panel → Panel configuration`

1. Four treatments: **withheld / added / no fee / unconfigured.**
2. Set a treatment with an effective date. Look at the term history column.
3. Claims not yet sent are re-stamped; **claims already submitted are not.**

**Why this matters.** A contract change next year must not rewrite the
arithmetic of a claim already sent and argued about.

### C2. Work a rejection
`Panel → Claim workspace → Work queue`

1. Every rejection carries a **category** beside the free text.
2. A claim that can be re-claimed shows a **countdown from the original service
   date** — not from the rejection, which is what makes the deadline easy to
   lose.
3. **Charge patient** moves the rejected amount onto the patient's share of the
   same invoice. It is not styled as a danger action and it is not a write-off.

**Fails if**: the countdown appears on claims that cannot be re-claimed, or
charging the patient does not leave the invoice unpaid.

### C3. Import the claim workbook
`Panel → Import claims`

1. Choose the panel **and the branch**. Note the tag: every row will be stamped
   with the panel's own fee treatment, *never a column in the file*.
2. Upload a file with defects. **Nothing is imported**, and every problem is
   listed with its line number.
3. Fix the file and check it again. Read the totals: **claimed, fees, expected
   receivable, already received, still outstanding.**
4. **Compare those against your workbook's own TOTAL row.** Only then commit.
5. Go to `Finance → Panel money`. The fee figures have moved by the imported
   claims' fees.

**Why this matters.** Step 4 is the only check that proves an import is right,
and it cannot be made afterwards. Re-uploading the same file imports nothing.

**Fails if**: the commit button appears while problems are listed, or a second
upload of the same file creates duplicates.

---

## D · Stock — the operating model behind the workbooks

### D1. Ask for something the catalogue does not stock
`Stock → New item requests`

1. Raise a request. A near-duplicate is **flagged at request time**.
2. Approve it. The duplicate check **runs again**, and approving a flagged
   request requires acknowledging it.
3. The item is created **inactive and awaiting first receipt** — it cannot be
   dispensed until a delivery arrives.

**Why this matters.** Two entries for one medicine means two stock levels, two
costs, and a count that never reconciles.

### D2. Receive at a different price
`Stock → Purchase orders → Receive`

1. Receive at a unit cost different from the one ordered.
2. `Stock → Items & pricing → price history`: the change is recorded with
   **who** and **when**.
3. Try to edit that history row directly (API). **Refused** — append-only.

### D3. What is about to expire, and how much of it is left?
`Stock → Near expiry`

1. **Received** is what arrived in the batch. **At risk (at most)** is bounded
   by what the clinic holds of the item.
2. Dispense the item down. The received figure does not move; the at-risk
   figure does. Sell it out entirely and the batch **leaves the list**.

**Why this matters.** Nothing attributes a dispense to a batch, so what is left
of one is not a number that exists. Kuwick reports the ceiling — a certainty —
rather than inferring a remainder from expiry order, which would be an
assumption presented as a quantity (D-114).

### D4. Count the shelves
`Stock → Stock take`

Counted **cost** and counted **retail** sit side by side. They are never added,
and the difference is never called profit.

---

## E · The boundaries — what Kuwick refuses

Run these to see the system say no. A management system that only demonstrates
its happy paths has not been tested.

| Try this | Expect |
|---|---|
| Approve a payroll run on unverified statutory rates | Refused unless the gap is explicitly acknowledged |
| Approve a payroll run for an employee inside PCB | **Blocked** — Kuwick does not calculate MTD |
| Edit a payslip line on an approved run | Database refuses: *"correct it with a payroll adjustment"* |
| Charge an **imported** claim to a patient | Refused — no invoice to move the money onto |
| Mark a supplier invoice `PAID` | Refused — PAID is derived |
| Reverse a payment by editing it | Database refuses — a reversal is a new row |
| Import a file with a date like `4/11/25` | Refused — it means different days in different countries |
| Delete a reference catalogue row | Refused — retire it with `active = false` |

---

## F · What these flows deliberately do not cover

Stated so the pack is not read as claiming more than it shows.

| Not covered | Why |
|---|---|
| **A real payroll run** | The statutory tables are `CORROBORATED`, not `VERIFIED` — this environment cannot reach KWSP or PERKESO. Payroll stays NOT READY until somebody with access verifies them. |
| **PCB / MTD** | No engine, by decision. |
| **Submitting a claim to a panel portal** | Deliberate: no browser automation into panel portals. |
| **Importing supplier invoices or opening stock** | No importer, and none needed — payables are typed in and opening stock comes from the first count. |
| **A second month of anything** | The seed is one clinic-year. Trends over multiple periods are not demonstrable from it. |
