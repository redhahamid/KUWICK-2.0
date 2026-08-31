# What Kuwick can retire, and what it cannot

One row per workflow the clinic runs today in an older tool. The question each
row answers is not "does Kuwick have a screen for this" but **"can the clinic
stop using the old thing"**.

| Status | Meaning |
|---|---|
| 🟢 **FULLY REPLACED** | Stop using the old tool for this. |
| 🟡 **PARTIALLY REPLACED** | Kuwick does most of it; a named step still happens elsewhere. |
| 🔴 **NOT REPLACED** | Keep using the old tool. |
| ⚪ **NOT APPLICABLE** | Out of scope for Kuwick. |

---

## 1 · Panel claim workbook

*Rewritten against the workbook itself.* Everything below is evidence from
[`PANEL_LEGACY_WORKFLOW_AUDIT.md`](./PANEL_LEGACY_WORKFLOW_AUDIT.md) — 31 sheets,
7,146 claims, one branch-year — not from a description of it. **Two rows moved
backwards when the real file was read**, and they are marked.

| Old workflow | Kuwick replacement | Status | Manual step outside Kuwick | Blocker |
|---|---|---|---|---|
| Track service date, patient, claim no., claimed amount | Panel ▸ Claim workspace | 🟢 | — | — |
| Decide what is ready to submit | Panel ▸ Submission queue + readiness checklist | 🟢 | — | — |
| Submit the claim | — | 🔴 | **Person opens the panel portal and keys it** | Deliberate: no browser automation into panel portals |
| Record that it was submitted, with reference | Mark-submitted modal | 🟢 | — | — |
| Record the panel's response | Record-outcome modal | 🟢 | Person reads the adjudication | — |
| Rejected / partially approved tracking | Work queue | 🟢 | — | — |
| Replacement claim number linkage | Re-claim workflow | 🟢 | — | — |
| Resubmission date, resolution, resolved date | Claim workspace columns | 🟢 | — | — |
| **Amount paid / receipt** | Panel ▸ Reconciliation ▸ **Record a payment** | 🟢 | Somebody reads the remittance advice | — |
| Remarks / owner of the claim | Claim workspace | 🟢 | — | — |
| Reconcile the listing against the billing system monthly | Finance ▸ **Panel money** ▸ Never claimed | 🟢 ⬇ | — | **Corrected.** An earlier pass said this ritual "disappears because claims derive from invoices" — wrong: a claim exists only when somebody raises one, so billed and claimed still drift. Kuwick now REPORTS the drift per invoice and per panel, aged from settlement, instead of needing a monthly export to find it (G-13, D-113). |
| **Admin fee and expected receivable** | Claim workspace — Claimed / Fee / Receivable | 🟢 | — | **Resolved.** D-041 superseded 2026-08-31 on the evidence of 2,615 banked payments: existing panels withhold. Four-state treatment, effective-dated, migrated, impact measured (D-112). |
| **Payment terms per panel** | Panel ▸ Panel configuration | 🟢 | — | **Resolved (G-2).** Range (`paymentTermMaxDays`), calendar or working days, and a SERVICE / SUBMISSION / INVOICE anchor. A TPA whose term is set by the employer is flagged rather than guessed. Public holidays are not modelled and the API says so. |
| **Overdue** | Aging views + per-line due date | 🟢 | — | **Resolved (G-3).** `resolveTermWindow` sets each line's due date at submission from that panel's own term; a range is judged against its FAR edge, so a panel is never chased early. |
| **2-month re-claim deadline** | Work queue ▸ re-claim countdown | 🟢 | — | **Resolved (G-4).** Per-panel `resubmissionWindowDays`, counted from the ORIGINAL service date, shown only on claims a re-claim is actually possible for, with an expired state. |
| **Rejected claim → patient bill** | Work queue ▸ Charge to patient | 🟢 | — | **Resolved (G-5).** Moves the rejected amount from the panel share to the patient share on the SAME invoice, keeping the link. Explicitly not a write-off. |
| **Why a claim was rejected, countable** | `rejectionCategory` + free text | 🟢 | — | **Resolved (G-6).** A reason code beside the prose, with the breakdown by amount on the dashboard and a count of rejections nobody has categorised. |
| Rejection rate as a KPI | Panel ▸ dashboard tile | 🟢 | — | **Resolved (G-10).** NULL rather than 0% where nothing has been claimed — "0% rejected" on a panel with no claims reads as excellent. |
| **7,146 historical and open claims** | Panel ▸ **Import claims** | 🟢 | Somebody exports the workbook to CSV | **Resolved (G-12).** Dry run reports the money before anything is written, so the totals can be checked against the workbook's own. All-or-nothing, idempotent, traceable. An imported claim has no invoice and a database CHECK says when that is allowed (D-115). |
| **What the admin fee costs the clinic** | Finance ▸ Panel money ▸ Admin fees borne | 🟢 | — | **New.** Only askable since D-112 established the fee is withheld. Borne vs expected, with unconfigured fees excluded from both and counted. |
| **A panel that did not take its fee** | Finance ▸ Panel money ▸ Fee exceptions | 🟢 | — | **New.** The forensic pass that found two such payments in 2,640 workbook rows, run continuously against every settled claim (D-113). |

> **Corrected verdict: the panel workbook can now be retired.** The pass before
> last said so on the strength of a *description* of the workflow; reading the
> file itself moved that backwards, and it has since moved forward again on
> evidence rather than optimism. **G-1** the receivable arithmetic (D-041
> superseded 2026-08-31, migrated and measured), **G-2** the term shapes,
> **G-3** the computed due date, **G-4** the re-claim countdown, **G-5** charge
> to patient, **G-6** the rejection taxonomy, **G-10** the rejection-rate KPI,
> **G-12** the importer, and **G-13** billed-versus-claimed are all built,
> tested and on screen.
>
> Retiring it is a sequence, not a switch — configure the panels, dry-run the
> file, check the totals against the workbook's own, commit, then run one full
> remittance cycle in Kuwick before the file goes read-only
> ([`MIGRATION_AND_IMPORT_SAFETY.md`](./MIGRATION_AND_IMPORT_SAFETY.md) §6).
>
> What remains are three single-panel shapes (G-7 monthly-invoice fee, G-8 fee
> tiers, G-11 per-scheme split) that need an owner decision more than they need
> code. Submitting to the portal stays manual by design.

---

## 2 · Payroll — AAS calculation workbook

| Old workflow | Kuwick replacement | Status | Manual step | Blocker |
|---|---|---|---|---|
| EPF band lookup, 11%/9%, 13%/12% step, RM20k rule | Statutory engine | 🟡 | — | **Tables not verified against KWSP** |
| SOCSO First/Second Category, RM6,000 ceiling | Statutory engine | 🟡 | — | **Not verified against PERKESO** |
| EIS 0.2/0.2, nil at 60+ | Statutory engine | 🟡 | — | **Not verified against PERKESO** |
| Contribution-status matrix per component | Component liability model | 🟢 | — | — |
| Three separate statutory bases | Component liability model | 🟢 | — | — |
| ORP: 26-day OT, 31-day UPL, 7.5 h | Frozen onto the run | 🟢 | — | — |
| OT tiers 1.5× / 2× / 3× / flat RM10 | `computeOvertime` | 🟡 | — | Engine supports all four; the service applies one |
| Unpaid leave deduction | `unpaidLeaveDeductionCents` | 🟢 | — | — |
| Age-60 branching | Statutory engine | 🟢 | — | — |
| **PCB** | — | 🔴 | **Computed in the LHDN calculator and keyed in** | No MTD engine, by decision. The payslip prints the keyed figure with a note saying it was entered by hand (D-116). |
| **Payslip** | — | 🔴 | **Workbook `PaySlip D` sheet** | Not built |
| Net pay / employer cost arithmetic | Payroll run | 🟢 | — | — |
| **Employer EPF/SOCSO/EIS totals for filing** | Run totals | 🟡 | Read off screen | No export file |

## 3 · Payroll listing workbook

| Old workflow | Kuwick replacement | Status | Manual step | Blocker |
|---|---|---|---|---|
| One row per employee with every component | Payroll ▸ Run detail table | 🟢 | — | — |
| Employee no., IC, KWSP no., bank, account | Employee profile (snapshotted onto the line) | 🟢 | — | — |
| Employer EPF / SOCSO / EIS columns | Run detail | 🟢 | — | — |
| **HRD levy 1% of basic** | — | 🔴 | Calculated by hand | Not modelled |
| Total company spent | Total cost to clinic | 🟢 | — | — |
| **Net pay on the 30th / OT etc. on the 15th / BOD fee on the 1st** | — | 🔴 | **Split done by hand** | One run produces one net figure |
| **Variable pay earned one month, paid the next** | `PayrollInputEntry.earnedPeriod` | 🟡 | — | Stored; no screen shows it |
| Doctor locum day book | — | 🔴 | Kept in the sheet | Locum sessions not captured as payroll input |
| Column chooser, export to Excel | DataTable column picker + export | 🟢 | — | — |
| **Two legal entities** | — | 🔴 | — | No employing-entity model |

---

## 4 · Hijraa Admin / Management system

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| Operations overview, patient volume, wait times | Admin ▸ Operation | 🟢 | — |
| Segment P&L | Operation ▸ Segments | 🟢 | — |
| Programmes and enrolment | Operation ▸ Programmes | 🟢 | — |
| Marketing audience + templates | Operation ▸ Marketing | 🟢 | Manual WhatsApp send is not "sent", and is labelled so |
| Item catalogue and pricing | Stock ▸ Items & Pricing | 🟢 | — |
| Stock by branch, valuation, expiry, slow-moving | Stock ▸ various | 🟢 | — |
| Purchase orders, receipt, procurement requests | Stock (legacy components, mounted) | 🟢 | — |
| Suppliers | Stock ▸ Suppliers | 🟢 | — |
| Stock transfers — receive | Stock ▸ Transfers | 🟢 | — |
| **Stock transfers — raise** | — | 🔴 | Not in Admin |
| Stock take: count → approve → post | Stock ▸ Stock Take | 🟢 | — |
| Movement ledger | Stock ▸ Movement Ledger | 🟢 | Append-only, DB-enforced |
| Sales reporting, day-end closing | Finance ▸ Sales, Day-end | 🟢 | — |
| Payments, refunds, reversals | Finance ▸ Payments | 🟢 | — |
| Invoices and receivables | Finance ▸ Invoices, Outstanding | 🟡 | No invoice detail drill-down |
| Credit notes — approve | Finance ▸ Credit notes | 🟢 | — |
| **Credit notes — raise** | — | 🔴 | Endpoint + hook exist; no screen |
| **Debit notes** | — | 🔴 | No model |
| SST / tax | Finance ▸ Tax | 🟢 | — |
| Drug and procedure profitability | Finance ▸ Profitability | 🟢 | Standard-cost limitation shown |
| Employee records | HR ▸ Employees | 🟡 | Read-only in Admin; editing only at `/management/hr/staff` |
| Attendance and timesheets | HR ▸ Timesheets | 🟡 | No correction screen |
| Leave | HR ▸ Leave | 🟡 | No policy configuration |
| Roster | HR ▸ Roster | 🟢 | Providers only |
| Doctor incentives | HR ▸ Doctor incentives | 🟡 | No rule editor |
| Staff benefits | HR ▸ Staff benefits | 🟢 | — |
| Roles and access | HR ▸ Roles & access | 🟢 | — |

## 5 · Stock workbooks (five files)

*From [`STOCK_LEGACY_WORKFLOW_AUDIT.md`](./STOCK_LEGACY_WORKFLOW_AUDIT.md).*
Read together the five files are one chain — request → order → receipt → cost →
invoice → payable → payment, with a physical count hanging off the side. Kuwick
holds the middle of that chain properly and both ends barely or not at all.

### 5.1 · Inventory count sheet

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| Count the shelf, item by item | Stock ▸ Stock Take | 🟢 | — |
| **Compare count against system quantity** | Stock Take variance | 🟢 | Kuwick computes it; **the sheet has no variance column at all** |
| System quantity to compare against | Read from the ledger | 🟢 | The sheet transcribes it by hand |
| Second person approves before posting | Stock Take approval | 🟢 | Typing a count changes nothing until approved |
| Value the shelf at **cost** | Stock Take + Valuation | 🟢 | — |
| **Value the shelf at patient prices during a count** | Stock Take detail | 🟢 | **Resolved.** Counted cost and counted retail sit side by side, per line and in total. Never added together, and the difference is never called profit. |
| **Printable count sheet to carry round** | — | 🔴 | Not built |

### 5.2 · List new medication

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| Item catalogue with cost, price, pack size, supplier | Stock ▸ Items & Pricing | 🟢 | Fields, not prose |
| **Any staff member requests a new item** | Stock ▸ New item requests | 🟢 | **Resolved.** What was asked for, why, and who decided. |
| **Stock admin approves it into existence** | Approve / reject with a reason | 🟢 | **Resolved.** A decision has an author and a date; a rejection must say why. |
| **Duplicate check before creating** | Checked twice | 🟢 | **Resolved.** At request time and again at approval; approving a flagged request requires `acknowledgeDuplicate`. Two entries for one medicine means two stock levels, two costs and a count that never reconciles. |
| Unit cost from pack size | Item fields | 🟢 | The sheet hardcodes `=6.84*90` per row |

### 5.3 · Que order medication + 5.4 · Consumable que order

The two files are the **same shape** — and the consumables file shares its
columns with marketing and admin spend. That is the clinic already telling us
procurement is one primitive with different items in it.

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| Request an order (pending list) | Stock ▸ `ProcurementRequest` | 🟢 | — |
| Raise the purchase order | Stock ▸ Purchase orders | 🟢 | — |
| Ordered vs received, both valued, partial receipt normal | Goods received notes | 🟢 | — |
| Invoice scan attached to the order | Invoice link column | 🟡 | Attachments exist; not wired to a PO |
| Order status | Enum | 🟢 | The sheet has free text, so four spellings of "ordered" coexist |
| **Promotional / bonus price — pay `MIN(list, bonus)`** | `PurchaseOrderLine.bonusUnitCost` | 🟢 | **Resolved.** `effectiveUnitCostCents` takes the lower of the two, and a NULL bonus is absent rather than a promotion of zero. |
| **Old price → new price captured at goods-in** | `item_price_changes` | 🟢 | **Resolved.** Written at receipt with the receiver's name, append-only at the database level. "Who changed our cost" was previously unanswerable from any source. |
| **Item activated on receipt, not on order** | `awaitingFirstReceipt` | 🟢 | **Resolved.** An approved item is created inactive; goods-in activates it. A catalogue entry never delivered cannot be dispensed. |
| **Supplier delivery SLA ("max 1 week")** | Payables ▸ Delivery column | 🟢 | **Resolved.** Ordered date against received date against the supplier's SLA. A supplier with no SLA recorded is neither on time nor late. |
| Consumables and admin spend on one rail | Same procurement chain | 🟢 | — |
| Half-yearly archive sheets | One ledger, date-filtered | 🟢 | Cross-boundary questions stop being manual |

### 5.5 · Medications payable listing

**One sheet per supplier, thirty of them.** This is the largest gap in the whole
programme outside payroll.

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| **Supplier invoice** | `supplier_invoices` | 🟢 | **Resolved.** |
| **Amount / paid / balance per invoice** | Derived from allocations | 🟢 | **Resolved, and there is no paid column** — it is the sum of the payments allocated to the invoice, so it cannot drift from the bank. |
| **What do we owe suppliers, in total** | Finance ▸ Supplier payables | 🟢 | **Resolved.** The question Kuwick could not answer at all. |
| **Payment terms per supplier** | `Supplier.paymentTermDays` | 🟢 | **Resolved**, in one place. **No term means no due date** — never an assumed thirty days — and the supplier is named on screen. |
| **Days due, and "what must I pay this week"** | Overdue / due-this-week tiles | 🟢 | **Resolved.** Aged from the DUE date; a disputed invoice is held out of both. |
| **Supplier credit limit** | `Supplier.creditLimitAmount` | 🟢 | **Resolved.** Warns, never blocks — a clinic that cannot buy medication over a number in a settings screen is worse off than one that is told. |
| **Record a payment to a supplier** | `supplier_payments` + allocations | 🟢 | **Resolved.** Allocations must equal the payment exactly. |
| **Match an invoice to its goods receipt** | Three-way `matchVariance` | 🟢 | **Resolved — and impossible in the sheet**, where no link exists either side. |

> The roll-up that answers "what do we owe" **sums the payment-date column
> instead of the balance column**. The clinic's headline payable figure is built
> from dates. Kuwick cannot reproduce that defect: what has been paid has no
> column at all, so there is nothing to point a range at — it is the sum of the
> payments allocated to each invoice, computed on read.

---

## 6 · Avixo-style reporting references

| Reference | Kuwick | Status |
|---|---|---|
| Sales, payments, day-end, invoices, outstanding | Finance | 🟢 |
| Credit / debit notes | Finance | 🟡 credit approve only; no debit note |
| Drug P&L | Finance ▸ Profitability | 🟢 |
| Service inventory | Stock ▸ Items | 🟢 |
| Panel / group invoices | Panel + Finance | 🟢 |
| e-Invoice (LHDN) | Placeholder | 🔴 nothing behind it, and it says so |

---

## What can be retired today

**Six of the nine, in sequence.** Reading the six real workbooks first moved the
panel sheet backwards and added five tools that were not on this matrix at all;
building against them has since moved most of it forward. Payroll is the
exception, and it is an honest one — see §2 and §3.

| Tool | Can it be retired? | What stands in the way |
|---|---|---|
| **Hijraa Admin** | **Mostly**, for day-to-day operation | Employee editing, credit-note creation, raise-transfer. Each is a form over an endpoint that already works. |
| **Panel claim workbook** | **Yes, in sequence** | Nine of thirteen gaps closed — ~~G-1 fee direction~~ **(D-112)**, ~~G-2 terms~~, ~~G-3 overdue~~, ~~G-4 deadline~~, ~~G-5 self-pay~~, ~~G-6 taxonomy~~, ~~G-10 KPI~~, ~~G-12 importer~~ **(D-115)**, ~~G-13 billed vs claimed~~ **(D-113)**. Retiring it is the cutover sequence in `MIGRATION_AND_IMPORT_SAFETY.md` §6, not a switch. |
| **Que order medication** | **Yes** | All four closed: bonus price, price-change-at-receipt, activation on goods-in, supplier SLA. |
| **Consumable que order** | **Yes** | Same list, same chain. |
| **Inventory count sheet** | **Yes** | Kuwick computes the variance the sheet never had, requires a second approver, and now shows selling value at count time. Keep the sheet only for the printable walk-round list. |
| **List new medication** | **Yes** | Request, duplicate check, approval with an author, and an item that cannot be dispensed until it has actually arrived. |
| **Medications payable listing** | **Yes, once the open invoices are entered** | Supplier invoices, payments, allocations, terms, credit limits and a three-way match all exist. No importer — thirty open invoices are typed in; ask for one if there are three hundred. |
| **Payroll listing Excel** | **No** | Payment-date split, HRD levy, legal entity. |
| **AAS payroll workbook** | **No** | PCB has no engine by decision, and the statutory tables are `CORROBORATED` rather than `VERIFIED`. The payslip itself now exists and states both facts on its face (D-116) — but a workbook you still need for PCB is a workbook you still keep. |

### The pattern, restated after building against the real files

An earlier pass said *"almost every remaining blocker is a screen over an
endpoint that already works."* Reading the files showed that was too
optimistic; building against them has now cleared most of what it missed. The
four categories, and where each stands:

1. **Screens over working endpoints** — employee editing, credit-note creation,
   raise-transfer, incentive rules, leave policy. Still the cheapest category
   and still the largest of what is left, but none of it blocks a workbook.
2. **Configuration shapes that could not express reality** — **closed.** Panel
   payment terms (range, working days, anchor), the four-state fee treatment
   effective-dated, supplier terms and credit limits. The one that mattered,
   G-1, was not a shape problem at all: the arithmetic was backwards, and the
   owner superseded D-041 on the evidence (D-112).
3. **Genuinely unbuilt subsystems** — supplier invoice/payable/payment
   **built**, the new-item request workflow **built**, rejected-claim-to-patient
   **built**, the payslip **built**. PCB, bank files, statutory exports and the
   legal-entity model remain, and all four are payroll.
4. **Migration** — **the panel claim importer is built** (D-115), which was the
   only one of these files whose open balances could not be typed in. Supplier
   invoices and opening stock have working manual paths and need no importer;
   payroll history is deliberately not imported (see
   `MIGRATION_AND_IMPORT_SAFETY.md` §5).

The honest answer to *"why can the clinic not stop using these files yet"* is
now much shorter than it was: **it can stop using six of the nine.** What keeps
the payroll workbook alive is PCB and the unverified statutory tables — neither
of which is a thing to build, and one of which is a thing to check.
