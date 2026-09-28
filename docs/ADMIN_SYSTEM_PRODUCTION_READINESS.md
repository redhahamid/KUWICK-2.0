# Kuwick 2.0 — Admin System Production Readiness

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Status:** ready for owner UAT. **Not merged, and not production-ready as a whole.**

The five modules are architecturally complete and their arithmetic is tested. Two things stop the word "production-ready" applying to the system as a whole, and both are stated in full in §6: **Malaysian payroll cannot be run for a live period** (§6.1.1), and **stock is valued at standard cost only** (§6.2). Architectural completeness and production readiness are different claims, and this document keeps them apart.

This is the reference for the five back-office modules — Operation, Stock, Panel, HR, Finance — built as one system rather than five screens. It covers what the system does, what it deliberately refuses to do, the arithmetic it guarantees, who may do what, how to run each workflow, and what is still missing.

---

## 1. Architecture

### 1.1 Where it sits

The Admin system is an addition to the existing modular monolith, not a replacement. Nothing in the clinical path — appointments, queue, consultation, dispensary, billing, MyInvois, roster, login — changed shape. The Management area keeps its URLs and its screens; a clinic can run on both while this is taken through UAT.

```
apps/web/src/admin/          the five modules' UI, one shell, one table kit
apps/api/src/finance/        payments, credit notes, tax, day end, receivables
apps/api/src/stock/          the ledger, transfers, stock takes, valuation
apps/api/src/panel/          the claim workspace and panel configuration
apps/api/src/workforce/      employees, attendance, leave, incentives, payroll
apps/api/src/analytics/      operations, segments, programmes, marketing
```

Each API module follows the same shape: a controller that validates and scopes, a service that opens one transaction per operation, and — where there is arithmetic worth trusting — a **pure module** beside it with no database access at all:

| Pure module | What it decides |
|---|---|
| `finance/money.ts` | All money as integer cents; one rounding rule |
| `finance/financial-invariants.ts` | Invoice totals, patient balance, claim balance, aging |
| `finance/tax.ts` | Which rate was in force, and what "unmapped" means |
| `stock/stock-variance.ts` | Transfer discrepancies, stock-take variance |
| `workforce/attendance-hours.ts` | Worked minutes, lateness, overtime |
| `workforce/leave-balance.ts` | Entitlement, taken, carry-forward |
| `workforce/payroll-calculation.ts` | Gross, deductions, net, employer cost |
| `workforce/incentive-calculation.ts` | Threshold and per-procedure incentives |
| `analytics/segment-mapping.ts` | Which segment a billed line belongs to |

These exist so the number a screen shows, the number a report exports and the number a test asserts are produced by the same function. They are why §4 below can be stated as a guarantee rather than an intention.

### 1.2 One source of truth per concept

The brief's hardest constraint. Where an existing canonical entity was in place, the Admin system reuses it rather than starting a parallel one:

| Concept | Canonical home | What Admin adds |
|---|---|---|
| Staff identity | `Staff` + `User` | `EmployeeProfile` — employment facts, NOT a second person |
| Clinical provider | `Staff.isDoctor` + credentialing | nothing; the employee screen reads it |
| Roster | `ProviderShift` | nothing; HR reads it and links back to it |
| Service / item catalogue | `ServiceCatalog`, `Item` | a `taxCodeId`, a segment mapping rule |
| Invoice | `Invoice` + `InvoiceLine` | line-level tax; unchanged otherwise |
| Money received | **new** `Payment` | the ledger the invoice never had |
| Stock quantity | `StockMovement` | append-only enforcement, new movement types |
| Branch | `Clinic` | nothing |
| Panel company | `PanelClinic` | portal, terms, fee rules, document requirements |

Three concepts that used to be one are now three, deliberately: a **user account** (can sign in), an **employee profile** (is paid, takes leave), and a **clinical provider** (may sign a prescription). Collapsing them is how a clinic ends up letting the wrong person authorise a controlled drug.

### 1.3 Schema and migrations

Five additive migrations, in dependency order:

| Migration | Adds |
|---|---|
| `20260828100000_finance_payment_credit_tax_dayend` | `payments`, `credit_notes`, `credit_note_lines`, `tax_codes`, `tax_rates`, `day_end_closings` |
| `20260828120000_stock_ledger_transfers_takes` | `stock_transfers`, `stock_transfer_lines`, `stock_takes`, `stock_take_lines`, `stock_take_assignments`, `procurement_budgets` |
| `20260828140000_panel_claim_workspace` | `panel_remittances`, `panel_remittance_allocations`, `claim_events` |
| `20260828160000_hr_workforce_payroll` | `employee_profiles`, `attendance_records`, `leave_policies`, `leave_policy_entitlements`, `leave_balances`, `incentive_rules`, `incentive_runs`, `incentive_results`, `staff_benefit_*`, `statutory_rule_sets`, `payroll_runs`, `payroll_lines`, `payroll_adjustments` |
| `20260828180000_operations_analytics` | `business_segments`, `segment_mapping_rules`, `clinic_programmes`, `programme_enrolments`, `marketing_audiences`, `marketing_templates`, `marketing_dispatches` |

37 new tables. **Every one is additive.** No column was dropped, no table renamed, no production row rewritten. The one backfill (`payments`, from already-PAID invoices carrying a `patient_paid_amount`) is an idempotent `INSERT … WHERE NOT EXISTS`, so re-running the migration cannot duplicate a payment.

Every new table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy reading `current_setting('app.tenant_id', true)`, in the same migration that creates it — never as a follow-up.

### 1.4 What the database refuses

Six PL/pgSQL triggers, because an invariant enforced only in application code is an invariant one raw query away from being false:

| Trigger | Refuses |
|---|---|
| `payments_append_only` | Any UPDATE except stamping `reversed_at` / `day_end_closing_id` once; all DELETEs |
| `stock_movements_append_only` | Every UPDATE and DELETE, without exception |
| `claim_events_append_only` | Every UPDATE and DELETE |
| `payroll_adjustments_append_only` | Every UPDATE and DELETE |
| `payroll_lines_locked` | Any change to a line whose run is APPROVED or PAID |
| `payroll_runs_locked` | Any transition out of APPROVED except → PAID (totals unchanged) or → CANCELLED |

Plus CHECK constraints that encode facts rather than preferences: a payment amount is positive; a reversal has a reason; a remittance's net equals gross minus withheld; a transfer's two ends are different clinics; a claim line cannot supersede itself; a marketing dispatch's status is only ever `PREPARED` or `OPENED`.

`prisma/provision-app-role.sql` additionally REVOKEs `DELETE` from the application role on all four append-only tables, so the trigger is the second line of defence rather than the only one.

---

## 2. What each module answers

The brief's §10 hierarchy — **summary → exceptions → work queue → detail** — is the layout of all five landing pages, and each one opens with the question it exists to answer.

### Operation — "how is the clinic performing?"
Period presets (Today / This month / This quarter / Custom), scoped by branch. Visits, patients split new vs returning, revenue, panel portion, average bill, average wait, where patients came from, activity by day, doctor productivity.

**Segment P&L** replaces five hardcoded reports with configuration: a `BusinessSegment` plus `SegmentMappingRule` rows matching on service, item, category or description. Revenue that no rule classifies is reported as its own line, not spread across the others.

**Programmes** show enrolment, activity and contribution — and list, by name, the indicators they *cannot* produce.

**Marketing** builds an audience from live data and renders a message from a template. It sends nothing.

### Stock — "what requires attention today?"
Eight exception tiles: negative stock, below minimum, expired, expiring within the window, slow movers, transfers in transit, transfer discrepancies, open stock takes. Then valuation, labelled at cost with potential self-pay value beside it.

### Panel — "what is unsubmitted, what was rejected, what is still owed?"
Three views on one workspace: a submission queue with a per-panel completeness checklist, a work queue of rejections and overdue claims, and a reconciliation that states whether it balances.

### HR — "who is working, who is absent, what needs a decision?"
On duty now, finished today, late arrivals, on leave, rostered. Then the three things blocked on a manager: leave approvals, unapproved overtime, missing punches.

### Finance — "did yesterday reconcile, what is outstanding, are the figures right?"
Received this period, patient receivable, panel receivable, service tax, unreconciled days — then the list of days not yet closed, with a way into each.

---

## 3. Workflows

### 3.1 Recording money
A `Payment` is its own row: kind (PAYMENT / REFUND), tender, amount, who took it, when, and against which invoice. It is never a column on the invoice.

A **reversal** is not a refund. A refund is money genuinely handed back and it reduces net receipts. A reversal says the record was wrong: both the original and its reversing row stay on the ledger, both stamped `reversed_at`, and neither counts. The screens say so where somebody might otherwise read one as the other.

### 3.2 Day-end closing
A workflow, not a report, because a closing records three things that cannot be recovered afterwards: what a named person counted, what the system expected at that moment, and what they said about the difference.

1. **Expected** is derived from the payment ledger, bucketed CASH / CARD / QR / OTHER. PANEL settlements are excluded — no money moved at the counter.
2. **Count.** A blank tender means *not counted*, which is a different fact from counted-zero and stays different.
3. **Variance** appears only once something is counted, and is always counted minus expected.
4. **Close** requires an explanation when the variance is non-zero, and freezes an operational snapshot alongside the money.
5. **Reopen** needs a separate permission, records who and why, and increments a visible reopen count.

### 3.3 Stock movement
Every balance is the sum of an append-only ledger. Movement types: `GOODS_RECEIVED`, `DISPENSED`, `ADJUSTMENT`, `TRANSFER_OUT`, `TRANSFER_IN`, `STOCK_TAKE`, `INTERNAL_USE`, `WASTAGE`, `EXPIRY`, `RETURN_TO_SUPPLIER`, `RETURN_FROM_PATIENT`, `OPENING_BALANCE`.

One writer, `stock/stock-ledger.ts#postMovement`, which locks the level row before it reads. Every path — receiving, dispensing, adjustment, transfer, take, expiry — goes through it. A movement recorded in error is corrected by a compensating movement, never by an edit.

### 3.4 Branch transfer
Stock leaves the sender when it is **sent** and arrives at the receiver when it is **received**. In between it is in transit, on neither shelf and visible as such.

`quantitySent` is written once, at send, by the sender. `quantityReceived` is written once, at receipt, by the receiver. **The sender cannot alter what the receiver confirmed.** A difference is a discrepancy requiring a reason, and the missing stock *stays* missing — putting it back automatically would hide the loss. It is resolved by a deliberate adjustment once somebody knows what happened.

Inter-company transfers carry a separate financial reference. The **physical movement** and the **inter-company invoice** are tracked apart, because they happen at different times and can legitimately disagree.

### 3.5 Stock take
1. **Open** a take. Each line freezes `systemQuantity` — the variance is measured against what the ledger said when counting began, not against what it says at approval.
2. **Count.** Writes `countedQuantity` and nothing else. **Typing a count moves no stock.**
3. **Recount** where a number is doubted. A recount supersedes the first count, including a recount of zero.
4. **Submit**, then **approve — by somebody other than the submitter.**
5. **Post.** Only now does the ledger move, as `STOCK_TAKE` movements with reason `COUNT_CORRECTION`, one per varying line, each carrying the before-and-after in its note.

Lines may be excluded from posting. An excluded line moves nothing.

### 3.6 Panel claims
Lifecycle, with "sent" and "paid" never collapsed:

```
DRAFT → BATCHED → READY → SUBMITTED → ACKNOWLEDGED → ADJUDICATED
                                                    ├─ APPROVED → PARTIALLY_PAID → PAID
                                                    ├─ REJECTED → RESUBMITTED (new claim number)
                                                    └─ WRITTEN_OFF
```

Every transition writes an append-only `ClaimEvent` with actor, timestamp, amounts and reason.

**Kuwick does not submit to any panel portal.** No panel in use offers an interface it could submit to. What the workspace does is tell staff *which* claims are due, check each is complete against that panel's own documented requirements *before* somebody opens the portal, give them the portal link, and record what the portal gave back. "Mark submitted" records that a person keyed it in.

Money arrives as a `PanelRemittance` with allocations to individual claim lines, so a single bank transfer covering eleven claims is recorded as one receipt with eleven allocations — and a claim cannot be marked paid twice from the same remittance.

Rejections go to a work queue with an owner and an age. Each panel configures whether a rejection is corrected in place or re-claimed under a new number; a re-claim supersedes the original and pursues the same base amount.

### 3.7 Payroll
1. **Create** a run for a period and branch.
2. **Calculate.** Reads attendance (approved overtime only), leave, incentives and adjustments.
3. **Exceptions** — an employee with no salary on record, a missing punch, unapproved overtime — must be resolved. The approve button is disabled, not merely warned about.
4. **Approve** locks the run in the database. From that moment a correction is a `PayrollAdjustment`, appended, never an edit.
5. **Mark paid** is the only transition out of APPROVED that keeps the totals, and the trigger enforces that they are unchanged.

**Statutory deductions are configuration, not code.** See §6.1.

### 3.8 Doctor incentives
Rules are versioned and effective-dated. A run snapshots the rule version it used, so **a paid incentive is never recalculated with today's rules.** Approval is separate from calculation.

---

## 4. Financial invariants

These are guarantees, each with a test that fails if it stops holding.

**Separate entities, never merged:** invoice · payment · claim · receivable · credit note · refund · stock transfer · inter-company invoice.

| Invariant | Statement |
|---|---|
| Invoice total | `subtotal + tax = total`, and `patient responsibility + panel responsibility = total` |
| Unresolved split | A NULL responsibility is *unknown*, never zero. Such invoices are excluded from aged totals and counted separately |
| Net received | `Σ PAYMENT − Σ REFUND`, excluding every row stamped `reversed_at` |
| Patient balance | `patient responsibility − net received − credited`, clamped at zero; anything beyond is reported as `overpaid`, not as a negative debt |
| Credit notes | Only `ISSUED` notes reduce anything. A `DRAFT` credits nothing; a `VOID` credits nothing |
| Claim receivable | `claimed + panel fee`. Once adjudicated the collectable base becomes `approved` |
| Claim settlement | `approved + rejected + written off = expected receivable` |
| Remittance | `net = gross − withheld`, and allocations never exceed net |
| Aging | `CURRENT / 31–60 / 61–90 / 90+`, from invoice date, buckets summing to the headline |
| Day end | `variance = counted − expected`, and only where something was counted |
| Stock | `quantity on hand = Σ movements`, per item per branch, always |
| Payroll | `gross − deductions = net`; a locked run's totals cannot change |
| Tax | Summed from the tax each line actually carried, at the rate in force on that invoice's own date |

Money is integer cents everywhere (`finance/money.ts`). Rounding happens once, at a stated boundary, half away from zero.

**Unmapped is not zero-rated.** A line with no tax code is reported as *not classified* — a number the owner can act on — rather than assumed exempt.

The UAT seed re-derives every one of these from the rows it writes and refuses to report success if any drift. `npx tsx prisma/seed-admin-uat.ts --verify-only` re-checks a tenant without rebuilding it.

### 4.1 How each invariant is held

| Layer | What it catches |
|---|---|
| **Pure unit tests** — 144 across the arithmetic modules | The rule itself: money rounding (10), invoice/balance/claim/aging (23), tax in force (11), transfer and stock-take variance (17), attendance hours (10), leave balance (11), payroll (18), incentives (15), segment mapping (10), date parameters (19) |
| **Integration tests** against real PostgreSQL | The rule surviving a transaction, RLS, concurrency and a locked run: finance 11, stock 13, panel 10, workforce 12 |
| **Database triggers and CHECKs** | The rule surviving a raw query that never went through the application at all |
| **The seed's own `verify()`** | The rule holding over a whole realistic dataset, not just a fixture |
| **Browser tests** — 24 | The rule reaching the screen, and the screen not claiming more than the rule supports |

---

## 5. Permission model

> September 2026: the catalogue has grown to 82 keys, eleven of which nothing checks. The count, the eleven and the other findings are in `PERMISSIONS_AUDIT_2026-09.md`; the text below predates it.

73 permissions in one policy module, `core/permissions.ts`. Roles map to permission sets; individual grants are possible only for permissions listed in `INDIVIDUALLY_GRANTABLE`. Every refusal carries a message naming the permission required.

35 permissions are new. The ones that gate money, stock and people:

| Area | Permissions |
|---|---|
| Finance | `finance.view` `payment.record` `payment.reverse` `creditNote.create` `creditNote.approve` `dayEnd.count` `dayEnd.close` `dayEnd.reopen` `finance.configure` |
| Stock | `stock.view` `stock.adjust` `stock.transfer` `stock.transfer.receive` `stockTake.manage` `stockTake.approve` `stock.price.manage` `procurement.manage` |
| Panel | `panel.view` `panel.claim.manage` `panel.claim.submit` `panel.receipt.record` `panel.writeOff` `panel.configure` |
| HR | `hr.view` `hr.employee.manage` `hr.attendance.manage` `hr.leave.approve` `hr.payroll.view` `hr.payroll.run` `hr.payroll.approve` `hr.incentive.manage` |
| Analytics | `analytics.view` `analytics.configure` `marketing.manage` |

**Separations of duty enforced in code, not convention:**

- **A stock take is approved by somebody other than the person who submitted it.** This is an identity check in code, and it is the only true four-eyes rule in the system.
- A credit note needs `creditNote.create` to raise and the separate `creditNote.approve` to issue, and both names are stored on the note. There is **no identity check**: a person holding both permissions can approve their own, which a single-doctor clinic needs. The screen says as much and shows both names rather than implying a rule that is not enforced.
- `hr.payroll.view` is separate from `hr.view`: seeing that somebody is on leave is not seeing what they are paid.
- `dayEnd.reopen` is separate from `dayEnd.close`.
- A payroll run cannot be approved while it has unresolved exceptions — the button is disabled, not merely accompanied by a warning.

### 5.1 Tenant isolation, verified

Row-level security, branch scoping and tenant isolation are unchanged in shape and **no policy was weakened**. The application still refuses to boot as a database superuser (`assertNotSuperuser` runs before Nest starts).

Every one of the 37 new tables carries `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy, created in the same migration as the table. Checked directly against the database, the only tables in the schema without RLS are `_prisma_migrations`, three platform-wide `default_*` reference catalogues, and three `platform_*` / `subscription_plans` tables that belong to the platform admin surface and hold no tenant data.

**One policy was added rather than relaxed.** `audit_logs` had been deliberately left outside the original RLS sweep, on the recorded reasoning that an append-only table of clinical diffs needs no read restriction beyond RBAC. This work changed what is in it — basic salary before-and-after, payroll adjustment reasons, payment reversals, credit-note approvals — so migration `20260828200000_audit_log_tenant_isolation` brings it in line with every other table, with `WITH CHECK` as well as `USING` so a mis-set tenant id cannot file a salary change in somebody else's trail. Nothing in the application reads the table, so this costs nothing today; `docs/DATABASE_ARCHITECTURE.md` §2 has been updated to match, and two tests in `rls-enforcement.e2e-spec.ts` cover both halves.

**One test-harness bug was fixed on the way.** `test/global-setup.ts` ran `prisma migrate deploy` as `kuwick_app` — the deliberately unprivileged application role that owns nothing, so that RLS binds during tests. Any migration that created or altered a table therefore failed there and left a permanently-failed row, after which `migrate deploy` refused every later migration. It had already happened once and been resolved by hand. Migrations now run as the owner, which is what CI always passed for this purpose.

---

## 6. Known limitations

Stated plainly, because a limitation nobody mentions looks exactly like a feature that works.

### 6.1 Statutory payroll is configuration, and none exists
Malaysian **EPF, SOCSO, EIS and PCB** rates are not built into this system. They are rates a clinic owns, that change, and that need to be effective-dated and auditable. The schema for them exists (`StatutoryRuleSet`); no rate table is populated.

Until one is, a payroll run computes **gross and net without statutory deductions**, carries `statutoryStatus: NOT_CONFIGURED`, leaves every statutory column NULL, and says so on the run, on the list and on the run detail. Approving such a run requires an explicit acknowledgement.

**This system will not print a statutory figure it cannot stand behind.** The item-by-item position — including which parts have a working engine, which do not exist at all, and what must happen before Malaysian payroll may be run for real — is §6.1.1 immediately below.

### 6.1.1 Malaysia Payroll Statutory Readiness

**HR is architecturally complete. Malaysian payroll is NOT production-ready.** Those are different claims and the difference is this table. Nothing below has been verified against KWSP, PERKESO or LHDN schedules, because nothing below has been configured.

Three labels are used, and they mean exactly this:

- **IMPLEMENTED** — built, tested, working.
- **ENGINE READY BUT NOT CONFIGURED** — the calculation exists and is unit-tested, and it is driven entirely by a tenant-owned rate table. No such table exists, so the figure is not produced and is reported as absent rather than as zero.
- **NOT IMPLEMENTED** — does not exist.

| Item | Status | What is actually there |
|---|---|---|
| **KWSP / EPF** | ENGINE READY BUT NOT CONFIGURED | `computeEpf` takes employee rate, employer rate, an optional wage ceiling and a round-up-to-ringgit flag. Returns absent, with a note, when no rate is configured. No rate table populated. |
| **SOCSO / PERKESO** | ENGINE READY BUT NOT CONFIGURED | `computeBracketContribution` reads a configured bracket table and returns the employee and employer amounts for the band the wage falls in. No bracket table populated. |
| **EIS / SIP** | ENGINE READY BUT NOT CONFIGURED | The same bracket engine, its own table. No bracket table populated. |
| **PCB / MTD** | ENGINE READY BUT NOT CONFIGURED — **and the engine is a simplification** | `computePcb` applies a flat monthly relief then a configured band (base amount + percentage of excess). That is a progressive-band calculation, **not the LHDN MTD formula**: no cumulative year-to-date, no spouse or child relief, no zakat, no EPF-relief cap, no bonus/additional-remuneration handling. Configuring bands would produce a number; it would not produce a compliant MTD figure. Treat this as the thinnest item on the list. |
| **Employer contribution** | ENGINE READY BUT NOT CONFIGURED | `epfEmployer`, `socsoEmployer`, `eisEmployer` are computed and stored separately from the employee side, and roll into `employerCost` — the cost-to-clinic figure, which is not a payslip deduction. |
| **Employee contribution** | ENGINE READY BUT NOT CONFIGURED | `epfEmployee`, `socsoEmployee`, `eisEmployee`, `pcb`, all nullable. A NULL is "not computed" and is never rendered as RM0.00. |
| **Effective-dated statutory tables** | **IMPLEMENTED** | `StatutoryRuleSet` carries `jurisdiction`, `effectiveFrom`, `effectiveTo`, the four rule sets as JSON, and `verifiedAt` / `verifiedByStaffId` / `verificationNote`. A run resolves the set in force for its period. `PROVISIONAL` exists for a table entered but not yet verified — figures compute and are labelled unverified everywhere they appear. Endpoints: `GET`/`POST /workforce/payroll/statutory-rules`. |
| **Per-employee applicability** | **IMPLEMENTED** | `epfApplicable`, `socsoApplicable`, `eisApplicable`, `pcbApplicable` on the employee profile. A person outside a scheme contributes a real zero, which is a different fact from an uncomputed one and stays different. |
| **Statutory identifiers** | **IMPLEMENTED** | `epfNumber`, `socsoNumber`, `pcbCategory` on the employee profile. |
| **Statutory export / submission** | **NOT IMPLEMENTED** | No Borang A, no CP39, no CP8D, no EA form, no e-Caruman or PERKESO ASSIST file, no portal submission of any kind. Nothing is generated and nothing is transmitted. |
| **Payslip document** | **NOT IMPLEMENTED** | A payroll line is a row in a table. There is no printable or downloadable payslip. |

**What this means for the owner.** A payroll run today computes gross, allowances, deductions the clinic itself entered, and net. It carries `statutoryStatus: NOT_CONFIGURED`, leaves every statutory column NULL, says so on the run, on the list and on the detail, and requires an explicit acknowledgement before it can be approved. That is the system declining to guess, working as designed.

**Before Malaysian payroll can be called production-ready, all of the following must happen:**

1. EPF, SOCSO and EIS rate tables entered, effective-dated, and **verified against the current KWSP and PERKESO schedules by a person who signs for it** (the `verifiedBy` field exists for that signature).
2. The PCB engine reviewed against the LHDN MTD formula and either extended to it or explicitly scoped — a band table alone will not produce a compliant deduction.
3. A payslip document produced and reviewed.
4. Statutory submission files scoped and built, or the manual process documented as permanent.
5. A parallel run against a period already paid by the clinic's current method, reconciled line by line.

None of the five has been done. **Do not run Malaysian payroll on this system for a live period.**

### 6.2 Stock is valued at standard cost
Valuation is each item's **current cost price × quantity on hand**. Weighted-average and FIFO costing are not implemented and the screen does not claim otherwise. Drug P&L uses the same basis. Where an item has no cost on record it is counted separately rather than valued at zero.

"Potential self-pay value" is what stock would fetch if every unit sold at the cash price. **It is not profit and not a forecast.**

### 6.3 Segment and programme profit is contribution, not net profit
Gross profit is revenue less direct item cost. Rent, salaries, utilities and every other overhead are **not** allocated. No screen says "net profit". Billed lines with no cost on record are counted and disclosed, so the margin is understood to be optimistic by a stated amount rather than wrong by an unknown one.

### 6.4 No panel portal integration exists
No claim is transmitted anywhere. A person opens the portal and keys it in. The system tells them which claims, checks completeness first, and records the outcome.

### 6.5 No messaging integration exists
Kuwick builds the audience and renders the message. A staff member sends it themselves. Status is `PREPARED` (text generated) or `OPENED` (a staff member clicked through). **Neither means the patient received anything**, and the system never says they did.

### 6.6 No bank payment integration exists
Marking a payroll run PAID records that somebody paid it. No payment file is generated and no bank is contacted.

### 6.7 Programme clinical indicators cannot be derived
Control rates (HbA1c, blood pressure, cholesterol) need structured lab results with reference ranges. Kuwick records observations as free-form vitals. Dose-ladder progression needs a titration plan the schema does not hold. Both are listed by name on the programme dashboard rather than left as a silent gap, and neither is estimated.

### 6.8 Average wait time is thin
Derived from check-in to consultation-start where both are recorded. The screen states the sample size and the percentage of visits it covers, so a figure from two visits is not read as a month's performance.

### 6.9 Attendance has no hardware
`AttendanceRecord` is populated by clock in/out through the app and by manual correction with a reason. There is no biometric or badge integration. Missing punches are surfaced as an exception rather than guessed at.

### 6.10 Inter-company financial documents are recorded, not generated
A transfer can carry an inter-company reference. Producing the actual invoice between entities is outside this work.

---

## 7. Manual processes still required

| What | Why |
|---|---|
| Submitting panel claims to portals | No panel offers an API |
| Sending WhatsApp messages | No messaging integration |
| Paying salaries at the bank | No bank integration |
| Statutory contribution filing | No statutory rates configured (§6.1) |
| Issuing inter-company invoices | §6.10 |
| Physically counting stock | As it should be |

---

## 8. Operating guide

### 8.1 Daily
- **Finance ▸ Overview** — is "days not yet closed" empty for yesterday?
- **Stock ▸ What needs attention** — negative stock, expiring batches, transfers awaiting confirmation.
- **HR ▸ Today** — who is in, and what is blocked on you.
- **Finance ▸ Day-end closing** — count the drawer, explain any variance, close.

### 8.2 Weekly
- **Panel ▸ To submit** — clear the queue; fix what is flagged incomplete *before* opening the portal.
- **Panel ▸ Work queue** — rejections and overdue claims, each with an owner.
- **Finance ▸ Outstanding** — patient receivables over 60 days.

### 8.3 Monthly
- **Panel ▸ Reconciliation** — does it balance? It says so explicitly.
- **HR ▸ Timesheets** — approve genuine overtime; unapproved overtime is not paid.
- **HR ▸ Doctor incentives** — calculate, review, approve.
- **HR ▸ Payroll** — create, calculate, resolve exceptions, approve. Approval is final.
- **Stock ▸ Stock take** — count, submit, have a second person approve.
- **Operation ▸ Segment P&L** — check "not classified" is small; add mapping rules if it is not.

### 8.4 Setup, before going live
1. **Tax codes and rates** (Finance) — effective-dated. Map items and services, or their revenue reports as *not classified*.
2. **Statutory rule sets** (HR) — §6.1. Verify against the current schedules.
3. **Panels** (Panel ▸ Configuration) — portal URL, payment terms, claim fee, per-visit limit, document requirements, rejection handling. Without these, staff get no checklist.
4. **Business segments and mapping rules** (Operation).
5. **Leave policies and entitlements** (HR).
6. **Incentive rules** (HR), if doctors are on incentives.
7. **Minimum stock thresholds** per branch.

---

## 9. UAT data

`apps/api/prisma/seed-admin-uat.ts` builds one synthetic clinic group. It is guarded by `KUWICK_ADMIN_UAT_SEED=yes`, rebuilds only its own tenant, and touches nothing else.

Two branches, three suppliers, three doctors including a locum, counter and stock and finance and panel staff, three panels with different rules, cash/card/QR, a partial payment, a refund, a reversal, four aged outstanding invoices, an issued and a draft credit note, a day closed with a five-ringgit variance and four days still open. Stock: opening balances, below-minimum items, negative stock, near-expiry and expired batches, two purchase orders, three transfers including one with a discrepancy and one in transit, a posted and an open stock take, an expiry write-off. Panel: paid, partially paid, rejected-and-re-claimed, overdue, ready, and one incomplete claim. Workforce: eight employee profiles including one with no salary as a payroll exception, twenty days of attendance with lateness, overtime, a missing punch and a corrected record, four leave requests, a benefit account, two incentive rules with an approved run, and a payroll run that refuses to guess. Analytics: five segments with mapping rules, two programmes with enrolments, two message templates.

**Every name is invented, every identifier is in the reserved `000000-00-xxxx` form, and every address is on the `.invalid` TLD, which can never route.** Nothing in it came from or resembles a real record.

```bash
KUWICK_ADMIN_UAT_SEED=yes npx tsx prisma/seed-admin-uat.ts               # rebuild
KUWICK_ADMIN_UAT_SEED=yes npx tsx prisma/seed-admin-uat.ts --verify-only # re-check
```

Sign in as `owner@admin-uat.kuwick.invalid` (also `finance@`, `stock@`, `panel@`) with `AdminUat!2026` or `$ADMIN_UAT_PASSWORD`.

---

## 9.1 Running the tests

```bash
npm run test:api                                   # 2160 unit tests, 99 suites
npm run test:api:e2e                               # 121 integration tests against real PostgreSQL
npm --prefix apps/web test -- --run                # 1614 web tests, 90 files
npx playwright test                                # 68 browser tests, servers must be up
```

The browser suite needs both servers running and both seeds applied — the clinical UAT seed for the golden path, the admin seed for the five modules. CI does this in the `e2e` job.

**A note on running the browser suite against a long-lived dev database.** Two golden-path tests register a patient and then look for them in the Waiting tab. On a database that has been accumulating fixtures across many sessions — 57 stale WAITING tickets locally at the time of writing — the queue table paginates and the new row is not in the DOM, so both fail. This is identical on `master` and has nothing to do with this branch; CI creates the database fresh for every run, which is why it does not see it. If it bites locally, clear the day's queue or run against a fresh `kuwick_dev`.

`npm run lint` does not currently run: `apps/web` has no `eslint.config.js` and ESLint 9 no longer reads the legacy format. That is also true on `master`, and CI has no lint step, so nothing regressed — but it means the linter is not protecting anything today.

---

## 10. Future integration opportunities

Ordered by what would remove the most manual work.

1. **Panel portal submission**, where a panel offers an interface. The claim workspace already holds everything a submission needs; only the transport is missing.
2. **WhatsApp Business API** — would turn `PREPARED` into a genuine delivery status. Until then the distinction stands.
3. **Statutory rate tables**, published and versioned, so §6.1 closes without each clinic keying them in.
4. **Bank payment files** (e.g. an approved payroll run to a bank-format file) — the run is already locked and auditable, which is the hard half.
5. **Weighted-average or FIFO costing** — the movement ledger already carries everything needed to compute either.
6. **Structured lab results** with reference ranges, which would let programme control rates be derived instead of declared unavailable (§6.7).
7. **Biometric or badge attendance**, feeding the same `AttendanceRecord` the app writes today.
8. **Overhead allocation**, which would let §6.3 report net profit rather than contribution.
