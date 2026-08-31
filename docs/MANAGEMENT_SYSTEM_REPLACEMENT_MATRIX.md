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

## 1 · Panel claim Google Sheet

| Old workflow | Kuwick replacement | Status | Manual step outside Kuwick | Blocker |
|---|---|---|---|---|
| Track service date, patient, claim no., claimed amount | Panel ▸ Claim workspace | 🟢 | — | — |
| Payment terms and due date per panel | Panel ▸ Panel configuration | 🟢 | — | — |
| Admin fee and expected receivable | Claim workspace — Claimed / Fee / Receivable columns | 🟢 | — | — |
| Decide what is ready to submit | Panel ▸ Submission queue + readiness checklist | 🟢 | — | — |
| Submit the claim | — | 🔴 | **Person opens the panel portal and keys it** | Deliberate: no browser automation into panel portals |
| Record that it was submitted, with reference | Mark-submitted modal | 🟢 | — | — |
| Record the panel's response | Record-outcome modal | 🟢 | Person reads the adjudication | — |
| Rejected / partially approved tracking | Work queue | 🟢 | — | — |
| Replacement claim number linkage | Re-claim workflow | 🟢 | — | — |
| Resubmission date, resolution, resolved date | Claim workspace columns | 🟢 | — | — |
| **Amount paid / receipt** | Panel ▸ Reconciliation ▸ **Record a payment** | 🟢 | Somebody reads the remittance advice | — |
| Outstanding and aging | Panel ▸ Reconciliation + Finance ▸ Outstanding | 🟢 | — | — |
| Remarks / owner of the claim | Claim workspace | 🟢 | — | — |

> **The sheet can now be retired**, with one honest caveat: submitting a claim
> is still a person opening the panel's portal and keying it in, which is
> deliberate — no panel in use here offers an interface to submit to. Everything
> the spreadsheet was actually used for — tracking, chasing, recording responses,
> re-claiming, and now booking the money — is in Kuwick.

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

## 5 · Avixo-style reporting references

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

**The panel Google Sheet — that one is done. The rest are close.**

| Tool | Can it be retired? | What stands in the way |
|---|---|---|
| **Panel Google Sheet** | **Yes** | Nothing. Submission to the portal stays manual by design. |
| **Hijraa Admin** | **Mostly**, for day-to-day operation | Employee editing, credit-note creation, raise-transfer. Each is a form over an existing endpoint. |
| **Payroll listing Excel** | No | Payment-date split, HRD levy, legal entity |
| **AAS payroll workbook** | **No** | PCB, payslip, and verification of the statutory tables |

The pattern is worth naming: **almost every remaining blocker is a screen over an
endpoint that already works.** The exceptions — PCB, payslips, bank files,
statutory exports, the legal-entity model — are genuinely unbuilt, and they are
all in payroll.
