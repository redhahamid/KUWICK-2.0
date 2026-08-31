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
| **7,146 historical and open claims** | — | 🔴 | — | **G-12.** No importer. 30% of those rows are unpaid, live money. **The one remaining blocker.** |
| **What the admin fee costs the clinic** | Finance ▸ Panel money ▸ Admin fees borne | 🟢 | — | **New.** Only askable since D-112 established the fee is withheld. Borne vs expected, with unconfigured fees excluded from both and counted. |
| **A panel that did not take its fee** | Finance ▸ Panel money ▸ Fee exceptions | 🟢 | — | **New.** The forensic pass that found two such payments in 2,640 workbook rows, run continuously against every settled claim (D-113). |

> **Corrected verdict: one blocker stands between the clinic and closing this
> file, and it is the importer.** The pass before last said the workbook could
> be retired, on the strength of a *description* of the workflow; reading the
> file itself moved that backwards. It has since moved forward again on
> evidence rather than optimism: **G-1** the receivable arithmetic (D-041
> superseded 2026-08-31, migrated and measured), **G-2** the term shapes,
> **G-3** the computed due date, **G-4** the re-claim countdown, **G-5** charge
> to patient, **G-6** the rejection taxonomy, **G-10** the rejection-rate KPI,
> and **G-13** billed-versus-claimed are all built, tested and on screen.
>
> What remains is **G-12, the importer for 7,146 live claims**, plus three
> single-panel shapes (G-7 monthly-invoice fee, G-8 fee tiers, G-11 per-scheme
> split) that need an owner decision more than they need code. Submitting to the
> portal stays manual by design.

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
| **PCB** | — | 🔴 | **Computed in the LHDN calculator and keyed in** | No MTD engine, by decision |
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
| **Value the shelf at patient prices during a count** | — | 🔴 | Cost variance only |
| **Printable count sheet to carry round** | — | 🔴 | Not built |

### 5.2 · List new medication

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| Item catalogue with cost, price, pack size, supplier | Stock ▸ Items & Pricing | 🟢 | Fields, not prose |
| **Any staff member requests a new item** | — | 🔴 | No request workflow |
| **Stock admin approves it into existence** | — | 🔴 | Approval is a text note in a cell today |
| **Duplicate check before creating** | — | 🔴 | How a catalogue grows two entries for one medicine |
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
| **Promotional / bonus price — pay `MIN(list, bonus)`** | — | 🔴 | Real pricing rule, not modelled |
| **Old price → new price captured at goods-in** | — | 🔴 | The moment cost actually changes |
| **Item activated on receipt, not on order** | — | 🔴 | Four activation states in the sheet; none in Kuwick |
| **Supplier delivery SLA ("max 1 week")** | — | 🔴 | Lives in a column heading; nothing measures it |
| Consumables and admin spend on one rail | Same procurement chain | 🟢 | — |
| Half-yearly archive sheets | One ledger, date-filtered | 🟢 | Cross-boundary questions stop being manual |

### 5.5 · Medications payable listing

**One sheet per supplier, thirty of them.** This is the largest gap in the whole
programme outside payroll.

| Old workflow | Kuwick replacement | Status | Blocker |
|---|---|---|---|
| **Supplier invoice** | — | 🔴 | No model |
| **Amount / paid / balance per invoice** | — | 🔴 | No model |
| **What do we owe suppliers, in total** | — | 🔴 | **Kuwick cannot answer this at all** |
| **Payment terms per supplier** | — | 🔴 | Held in the heading, the `+n` in the formula, and the roll-up — three places |
| **Days due, and "what must I pay this week"** | — | 🔴 | The operating question the file exists for |
| **Supplier credit limit** | — | 🔴 | A free-text note today |
| **Record a payment to a supplier** | — | 🔴 | No model |
| **Match an invoice to its goods receipt** | — | 🔴 | Impossible in the sheet too — no link exists either side |

> The roll-up that answers "what do we owe" **sums the payment-date column
> instead of the balance column**. The clinic's headline payable figure is built
> from dates. Nothing in Kuwick reproduces that, because nothing in Kuwick
> computes it at all.

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

**Nothing yet, and that is a change from the last pass.** Reading the six real
workbooks moved the panel sheet backwards and added five tools that were not on
this matrix at all.

| Tool | Can it be retired? | What stands in the way |
|---|---|---|
| **Hijraa Admin** | **Mostly**, for day-to-day operation | Employee editing, credit-note creation, raise-transfer. Each is a form over an endpoint that already works. |
| **Panel claim workbook** | **No** *(was "yes")* | Eight of thirteen gaps closed — ~~G-1 fee direction~~ **(D-112)**, ~~G-2 terms~~, ~~G-3 overdue~~, ~~G-4 deadline~~, ~~G-5 self-pay~~, ~~G-6 taxonomy~~, ~~G-10 KPI~~, ~~G-13 billed vs claimed~~ **(D-113)**. What stands in the way is **G-12: no importer for 7,146 live claims.** |
| **Que order medication** | **Close** | Bonus price, price-change-at-receipt, item activation on goods-in, supplier SLA. |
| **Consumable que order** | **Close** | Same list. The file needs nothing Kuwick's procurement chain does not already have in shape. |
| **Inventory count sheet** | **Yes, on the count itself** | Kuwick is strictly better here — it computes the variance the sheet never had, and requires a second approver. Keep the sheet only for the printable walk-round list and selling-value-at-count. |
| **List new medication** | **No** | No request-and-approve workflow, and no duplicate check. |
| **Medications payable listing** | **No** | Nothing to move to. No supplier invoice, no payable, no supplier payment in Kuwick. |
| **Payroll listing Excel** | **No** | Payment-date split, HRD levy, legal entity |
| **AAS payroll workbook** | **No** | PCB, payslip, verification of the statutory tables |

### The pattern, restated after reading the real files

The last pass said *"almost every remaining blocker is a screen over an endpoint
that already works."* That was true of what had been examined then. It is no
longer the whole picture:

1. **Screens over working endpoints** — employee editing, credit notes,
   raise-transfer, incentive rules, leave policy, claim history. Still the
   largest category, still the cheapest.
2. **Configuration shapes that cannot express reality** — panel payment terms,
   panel fee direction and tiers, supplier terms and credit limits. Cheap in
   code, but each one needs an owner decision first, and G-1 needs one before
   any panel receivable can be trusted.
3. **Genuinely unbuilt subsystems** — supplier invoice/payable/payment, the
   new-item request workflow, rejected-claim-to-patient conversion, PCB,
   payslips, bank files, statutory exports, the legal-entity model.
4. **Migration** — every one of these files holds live open balances. There is
   no importer for any of them, and no cutover is possible without one.

Categories 3 and 4 are the honest answer to "why can the clinic not stop using
these files yet."
