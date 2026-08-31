# Management system — gap audit

The acceptance question this document answers, per domain and per workflow:

> *Can a real clinic operate this workflow in Kuwick without going back to the
> Hijraa Admin system, the payroll Excel, or the panel Google Sheet?*

**Classification used throughout**

| Label | Meaning |
|---|---|
| ✅ **PRODUCTION-USABLE** | Works end to end, calculations defensible, exceptions exist. |
| 🟡 **INCOMPLETE** | Works, but a real workflow step is missing. |
| ⚙️ **ENGINE / NOT READY** | Arithmetic exists and is tested; configuration or verification does not. |
| 🖥️ **UI / BACKEND MISSING** | Screen exists, the write path behind it does not. |
| 🔌 **BACKEND / UI MISSING** | Endpoint exists and is called by nothing. |
| ♻️ **LEGACY BUT REUSABLE** | Mounted from `/management`; same data, same endpoints. |
| ❌ **MISSING** | Not built. |
| ⚠️ **MISLEADING** | Present in a way that could be read as more than it is. |

---

## Where this branch actually stands

The honest summary before the tables:

- **The server is further along than the product.** Nine endpoints exist that no
  screen calls. That was true at the last review and is still the single
  clearest signal about this branch.
- **Payroll arithmetic went from wrong to right in this pass**, and is now the
  best-tested part of the system — but it still cannot be used to pay anyone,
  for reasons that are configuration and verification, not code.
- **Stock and Finance day-end are genuinely usable.** Panel claim *tracking* is
  too — but its *arithmetic* is not, which is the finding of this pass and is
  described below.
- **Reading the owner's six real workbooks moved two verdicts backwards.** That
  is what source material is for. A verdict written from a description of a
  workflow is a hypothesis; a verdict written from the file is a measurement.
- **Nothing in Operation invents its own numbers**, which was the main risk there.

---

## 1 · HR & Payroll

| Capability | Status | Gap | Canonical source | Acceptance |
|---|---|---|---|---|
| Employee master (personal, employment, payroll, statutory IDs, bank) | ✅ | — | `EmployeeProfile` | Present |
| **Add / edit employee from Admin** | 🔌 | `useUpsertEmployee` exists, called by nothing. Only reachable at `/management/hr/staff` | `EmployeeProfile` | A form in HR |
| Date of birth as payroll data | ✅ *(this pass)* | — | `EmployeeProfile.dateOfBirth` | Missing DOB now blocks the run |
| EPF rate election (11% / 9%) | ✅ *(this pass)* | — | `EmployeeProfile.epfEmployeeRate` | Selects the right table |
| **Employing legal entity** | ❌ | The two workbooks name two different companies. Payroll and every statutory filing are per employer | — | A legal-entity model above branch |
| Attendance: clock in/out, late, missing punch, OT capture | ✅ | — | `AttendanceRecord` | Present |
| **Attendance correction UI** | 🔌 | `PATCH /workforce/attendance/:id/correct` exists; no screen | `AttendanceRecord` | A correction form with reason + approval |
| Overtime approval gate | ✅ | Unapproved OT never reaches a payslip and is raised as an exception | `AttendanceRecord.overtimeApproved` | Present |
| **OT lifecycle (draft→submitted→approved→locked), tiers, rest/holiday rules** | 🟡 | Engine supports 4 tiers incl. flat-rate; the service still applies a single 1.5× | `AttendanceRecord` | Per-tier claim rows |
| Leave request / approval / balance / roster effect | ✅ | Approved leave really does block booking | `LeaveRequest` | Present |
| **Leave type + policy configuration** | 🔌 | `GET/POST /workforce/leave/policies` exists; no screen | `LeavePolicy` | A policy editor |
| **Employee claims / reimbursements** | ❌ | Not modelled at all | — | Claim lifecycle + payroll feed |
| Roster (providers) | ✅ | One roster, shared with the calendar | `ProviderShift` | Present |
| **Non-clinical staff rostering** | ❌ | The board rosters providers only | `ProviderShift` | Non-provider shifts |
| Doctor incentives: rules, run, approval, payroll feed | ✅ | Restricted to APPROVED/PAID runs | `IncentiveRule/Run/Result` | Present |
| **Incentive rule configuration UI** | 🔌 | `POST /workforce/incentives/rules` exists; no screen | `IncentiveRule` | A rule editor |
| Staff medical benefits | ✅ | Derived balance, no running total to correct | `StaffBenefitAccount` | Present |
| Roles, permission matrix, custom roles | ✅ | Server-enforced | `ClinicCustomRole` | Present |

### Payroll specifically

| Capability | Status | Note |
|---|---|---|
| **EPF / SOCSO / EIS band tables, age-aware** | ✅ *(this pass)* | Reproduces every figure in the clinic's spreadsheet. 35 tests. |
| **Per-component statutory liability** | ✅ *(this pass)* | Three different bases. Overtime is SOCSO wages, not EPF wages. |
| **Ordinary Rate of Pay, two divisors** | ✅ *(this pass)* | 26-day OT, 31-day UPL, 7.5 h/day, frozen onto the run. |
| **Statutory rate verification state** | ✅ *(this pass)* | DRAFT / CORROBORATED / VERIFIED. Seeded set is CORROBORATED. |
| **Payroll inputs (manual amounts, PCB)** | ✅ *(this pass)* | `PayrollInputEntry`, with `earnedPeriod` for pay in arrears. |
| Run lifecycle, exceptions, locking, adjustments | ✅ | Approved runs immutable except by adjustment row. |
| **PCB / MTD calculation** | ❌ **by decision** | Neither lawful method implemented. Blocking exception until entered. |
| **Statutory tables verified against the authority** | ⚙️ | `kwsp.gov.my`, `perkeso.gov.my`, `hasil.gov.my` unreachable from this environment. |
| **Payslip** | ❌ | Nothing generates, renders, prints or stores one. |
| **Bank payment file / payment batch** | ❌ | No export, no paid state beyond the run's own. |
| **Statutory output files (EPF/SOCSO/EIS/PCB, EA, CP8D)** | ❌ | None. |
| **Multiple payment dates per period** | ❌ | The clinic pays on the 1st, 15th and 30th. Kuwick produces one net figure. |
| **HRD levy** | ❌ | 1% of basic, an employer cost. Not modelled. |

---

## 2 · Finance

| Capability | Status | Gap |
|---|---|---|
| Day-end: open → count → variance → mandatory reason → close → reopen | ✅ | — |
| Payment ledger, refunds, reversals kept distinct | ✅ | Append-only, DB-enforced |
| Invoice listing with truthful statuses | ✅ | — |
| **Invoice detail drill-down** | ❌ | Listing only |
| Receivables, patient vs panel, aged | ✅ | — |
| Credit notes — approve / issue, two-person rule | ✅ | — |
| **Credit notes — create** | 🔌 | `POST /finance/credit-notes` + `useCreateCreditNote` exist; no screen |
| **Debit notes** | ❌ | No model, no endpoint |
| SST / tax from line-level rules | ✅ | — |
| Drug profitability | ✅ | Standard cost; limitation stated on screen |
| Service profitability with COST NOT CONFIGURED | ✅ | Never treated as zero |
| Inter-company | 🟡 | Lists flagged transfers and unreferenced ones; cannot raise or settle |
| **e-Invoice (LHDN)** | ⚠️→✅ | Honest placeholder page. Nothing behind it, and it says so |
| **Payroll → Finance cost feed** | ❌ | Approved payroll does not reach Finance |
| **Accounts payable (supplier invoices, ageing, payments)** | ❌ *(found this pass)* | Nothing. See Stock — the clinic runs it as thirty spreadsheet tabs, and its own roll-up sums the wrong column |
| Month-on-month sales | 🟡 | Daily and custom ranges only |

---

## 3 · Stock

| Capability | Status | Gap |
|---|---|---|
| Item catalogue, pricing, suppliers | ✅ | — |
| Purchase orders, receipt, GRN | ✅ (legacy) | ♻️ mounted from `/management` |
| Movement ledger | ✅ | Append-only, DB trigger |
| Transfers: send, receive, discrepancy | ✅ | Shortfall stays missing |
| **New transfer from Admin** | ❌ | Receiving exists; raising does not |
| Stock take: count → submit → approve → post | ✅ | Typing a count changes nothing |
| Exception queues (low, negative, expiry, slow, discrepancy) | ✅ | — |
| Valuation | ✅ | Selling value clearly not profit |
| **Costing method** | 🟡 | Standard cost. Weighted-average / FIFO not implemented; limitation documented |
| **Price change history** | ❌ | No audit of who changed a price |
| **New-item request → approve → create** | ❌ *(found this pass)* | Any staff member can ask for a new item today; approval is a text note in a spreadsheet cell. No state, no actor, no date, and no duplicate check against the catalogue |
| **Promotional (bonus) price** | ❌ *(found this pass)* | The clinic pays `MIN(list price, bonus price)`. A real pricing rule, unmodelled |
| **Price change captured at goods-in** | ❌ *(found this pass)* | The order queue records old price → new price at receipt — the moment cost actually changes. Also the foundation for moving off standard cost |
| **Item activated on receipt, not on order** | ❌ *(found this pass)* | Four activation states in the clinic's sheet; none in Kuwick |
| **Supplier delivery SLA** | ❌ *(found this pass)* | "Max 1 week" lives in a column heading. Nothing measures it |
| **Selling value at stock-take time** | ❌ *(found this pass)* | Kuwick shows cost variance; the count sheet also values the shelf at patient prices |
| **Supplier invoice → payable → payment** | ❌ *(found this pass)* | **Kuwick cannot answer "what do we owe suppliers".** Thirty supplier sheets exist for exactly this question. Three models, a screen, and a link from invoice to goods receipt. The largest gap outside payroll |
| **Supplier payment terms, credit limit** | ❌ *(found this pass)* | Terms differ per supplier and are held in three places in the spreadsheet; credit limits are free-text notes |

---

## 4 · Panel

| Capability | Status | Gap |
|---|---|---|
| Panel company configuration, per-panel rules | ✅ | Three panels, three rule sets |
| Submission queue + readiness checklist | ✅ | — |
| Mark submitted, record outcome, write off | ✅ | — |
| Re-claim with original↔replacement linkage | ✅ | Refuses a second replacement |
| Work queues (rejected, partial, overdue) | ✅ | — |
| Reconciliation and aging | ✅ | — |
| **Record payment received (remittance)** | ✅ *(this pass)* | Reconciliation ▸ Record a payment. Allocations must equal the payment exactly, checked live. Drove RM60 through end to end: claim moved PARTIALLY_PAID → PAID, received RM249.60 → RM309.60, ledger still reconciles |
| **Claims awaiting payment** | ✅ *(this pass)* | New `GET /panel-workspace/awaiting-payment` — the work queue is the *problem* queue and could not answer "what is this panel still owed on" |
| **Claim history / audit trail** | 🔌 | `ClaimEvent` rows written, `timeline()` exists; no screen |
| **Expected receivable — fee treatment** | ✅ *(defect found and fixed this pass)* | `computeClaimBalance` used `claimed + fee` per D-041. The clinic's workbook and **2,615 of 2,640 banked payments** say `claimed − fee`. **Owner superseded D-041 on 2026-08-31**: four-state `PanelFeeTreatment`, effective-dated `PanelFeeTerm`, per-claim snapshot, migrated with a measured impact report (D-112, `PANEL_FEE_DIRECTION_CORRECTION.md`) |
| **Payment terms beyond N calendar days** | ✅ *(this pass)* | Ranges, working days, SERVICE/SUBMISSION/INVOICE anchors, and a term that varies by the employer behind a TPA |
| **Overdue as a computed state** | ✅ *(this pass)* | Derived from the panel's term shape; a range is late only past its far edge |
| **Re-claim deadline (2 months)** | ✅ *(this pass)* | Counted down per claim from the original service date, orange inside a fortnight |
| **Rejected claim → patient receivable** | ✅ *(this pass)* | Moves onto the invoice's patient share; explicitly not a write-off |
| **Rejection reason taxonomy** | ✅ *(this pass)* | Seven categories read off the clinic's own register, plus the free text |
| **Claim import** | ❌ | 7,146 claims for one branch-year, 30% unpaid. No cutover without an importer |

---

## 5 · Operation

| Capability | Status | Gap |
|---|---|---|
| Overview: volume, sales, average bill, alerts | ✅ | Consumes domain data, invents nothing |
| Segment P&L, configurable mapping | ✅ | Contribution never called net profit |
| Programmes | ✅ | No inferred clinical status |
| Doctor productivity | ✅ | Never implies doctor earnings |
| Marketing: audience builder, templates, prepared queue | ✅ | Manual send ≠ sent; no fake delivery |
| **`marketing_audiences` table** | ⚠️ | Written by nothing. Dead, not duplicate — use it or drop it |
| Wait times, patient/procedure analysis | ✅ (legacy) | ♻️ mounted |

---

## 6 · Cross-cutting

| Item | Status | Note |
|---|---|---|
| RLS, tenant isolation, append-only triggers | ✅ | Non-superuser app role; integration-tested |
| RBAC, multi-role, custom roles | ✅ | Server-enforced |
| Audit on high-risk changes | ✅ | `recordAudit` on admin transactions |
| **Owner pinned to one branch** | ✅ *(fixed this pass)* | Viewing scope now follows account permission; provider branch stays the form default |
| **Duplicate sources of truth** | ✅ none | Checked, not assumed |
| **Data migration paths (HR, panel, stock, finance opening balances)** | ❌ | No importers |

---

## The dependency order, and why it was changed

The brief proposed Wave 1 = shared foundations + HR/payroll. That order was kept,
and Wave 1 was taken further than the rest **deliberately**:

1. It is the only domain where the owner supplied authoritative source material,
   so it is the only one where "correct" could be established rather than argued.
2. Payroll was the only domain with a **live correctness defect** — the
   percentage EPF engine — as opposed to missing features. A wrong number is
   worse than an absent screen.
3. Finance, Stock, Panel and Operation are mostly missing *screens over existing
   endpoints*, which is lower-risk work that does not block on research.

Waves 2–6 are therefore **not started**. What each needs is listed above; nothing
in this pass has made any of them harder.

---

## What would have to be true for each domain to be production ready

| Domain | Verdict | Exact condition |
|---|---|---|
| **Operation** | ✅ **PRODUCTION READY** | — |
| **Stock** | ✅ **PRODUCTION READY** for daily operation | Dispensing, counting, ordering and receiving all hold up, and Stock Take is strictly better than the sheet it replaces. Raise-transfer and price-change history are conveniences. Costing limitation must stay visible. **Not production-ready for buying:** supplier invoices, payables and payments do not exist, so the clinic keeps thirty supplier sheets. That is a Finance-shaped gap sitting inside Stock's chain. |
| **Panel** | ⚠️ **CONDITIONALLY READY** | Reading the clinic's workbook found a correctness defect in Kuwick — the fee was added where the banked money proves it is withheld — and **that is now fixed, migrated and measured** (D-112). Payment terms, the re-claim deadline, the rejection taxonomy and the rejected→patient route all landed this pass. **One blocker remains: no importer for the 7,146 live claims**, so a real cutover is not yet possible. One panel is `UNCONFIGURED` pending an owner answer. |
| **Finance** | ⚠️ **CONDITIONALLY READY** | Blockers: credit-note creation, invoice detail. e-Invoice and debit notes are absent and honestly labelled. |
| **HR** | ⚠️ **CONDITIONALLY READY** | Blockers: add/edit employee from Admin, leave-policy config, attendance correction. |
| **Payroll** | ❌ **NOT PRODUCTION READY** | Blockers, all named: (1) statutory tables unverified against KWSP/PERKESO; (2) no PCB engine; (3) no payslip; (4) no bank file; (5) no statutory output files. |
