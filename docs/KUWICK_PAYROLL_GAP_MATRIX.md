# Kuwick payroll — gap matrix

Three sources, compared capability by capability:

- **PayrollPanda** — ⏳ *not yet captured.* See `PAYROLLPANDA_WORKFLOW_AUDIT.md`
  for why (the domain is blocked by this environment's network policy, and there
  is no browser here to authenticate in) and for the capture plan that fills this
  column in. Every cell reading ⏳ is genuinely unknown, not "probably fine".
- **Hijraa current** — the clinic's two payroll workbooks, already audited in
  `HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md` and `HR_PAYROLL_RECONCILIATION.md`.
- **Kuwick current** — read from the code on
  `claude/kuwick-2-visual-audit-k9uk5z`, not from memory of it. Every claim below
  has a file and, where it matters, a line.

**Priorities:** P0 blocker before live payroll · P1 required for a reliable
production payroll · P2 important improvement · P3 optional/later ·
**N/A** not appropriate for Kuwick.

---

## The finding that changes the shape of the problem

The final programme report listed five payroll blockers, all of them about
statute and verification. Reading the code for this audit turned up a sixth that
is neither, and it is more immediate than the other five:

> **`PayrollInputEntry` has no write path in the application.**
>
> The table exists, carries RLS, is indexed, and is read by
> `payroll.service.ts:271` during every calculation. But there is **no DTO, no
> controller route and no service method that creates one**. The only writers in
> the entire repository are the seed script (`seed-admin-uat.ts:2249`) and one
> integration test, both going straight to Prisma.

Follow that through the calculation:

1. `statutory.ts:299` — `computePcb` returns `null` for every employee who is
   subject to PCB. By design; PCB is not implemented.
2. `payroll.service.ts:427` — a `null` PCB with no input entry raises a
   **blocking exception**.
3. `payroll.service.ts:609` — `approve()` throws if there are any exceptions.

So for any clinic with at least one PCB-applicable employee, **no payroll run can
ever reach `APPROVED` through the product.** The design anticipated this exactly
— the schema comment on `PayrollInputEntry` says *"the clinic already computes
PCB outside its spreadsheet and keys it in; this is that step, with an actor and
a timestamp on it"* — but that step was never built as a screen or an endpoint.

The only workaround available in the product is to set `pcbApplicable = false`
on every employee via `upsert-employee.dto.ts:52`, which is a lie about their tax
status and would silently suppress the exception rather than answer it.

This does not contradict the "NOT PRODUCTION READY" verdict — it reinforces it —
but it does change what the *first* fix is. **The cheapest thing that moves
payroll from "cannot complete" to "completable under supervision" is a payroll
input screen, not a PCB engine.** It is the one P0 here that is a form over a
table that already exists, with no statutory research in front of it.

---

## 1 · Company, legal entity and scope

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| Employing legal entity | ⏳ | Two different company names across the two workbooks; no model, resolved by which file you opened | **Absent.** No entity model anywhere. `PayrollRun` is scoped to `tenantId` + optional `clinicId` (a *branch*) | Statutory submissions are per employer, and Kuwick cannot name an employer | **High.** EPF/SOCSO/LHDN filings are per employer number; a wrong employer on a submission is a compliance failure | Add `LegalEntity` (name, registration no, EPF/SOCSO/LHDN employer numbers, address). Payroll runs belong to an entity; branches roll up to one | **P0** | — |
| Employee → entity | ⏳ | Implicit | Employee belongs to `Staff.clinicId` (branch) only | Cannot say who legally employs someone | High — same as above | `EmployeeProfile.legalEntityId`, required before a run includes them | **P0** | LegalEntity |
| Doctor working at several branches | ⏳ | Handled by hand | One `clinicId` per staff row | A multi-branch doctor is paid from one branch or duplicated | Medium | Employment is to an *entity*; branch becomes a cost allocation on the payroll line, not identity | **P1** | LegalEntity |
| Consolidated reporting, per-entity submission | ⏳ | Manual | n/a | — | Medium | Reports filter by entity and roll up; exports are always per entity | **P1** | LegalEntity |
| Multi-company under one owner | ⏳ | Two files | Tenant = clinic group | — | Low | Several entities per tenant | **P2** | LegalEntity |

## 2 · Employee master and HR maintenance

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| Create/edit employee | ⏳ | Hijraa Admin | **Endpoint exists** (`POST workforce/employees/:staffId`, `upsert-employee.dto.ts`); **no screen calls it** (`EmployeesPage.tsx` is read-only) | Form only | Medium — clinic keeps the old system open | Build the form over the endpoint that already works | **P1** | — |
| Completeness visibility | ⏳ | None | Completeness scoring exists on the HR overview | — | — | Keep; extend to name the specific missing field | P2 | — |
| Statutory identifiers | ⏳ | In workbook | Stored (`epfNumber`, `socsoNumber`, `taxNumber`); explicitly never used to derive a rate | No format validation; not required before a run | Medium — a submission export would carry blanks | Validate format; make them blocking at export, not at save | **P1** | Statutory exports |
| Bank details | ⏳ | In workbook | Stored (`bankName`, `bankAccountNo`, `bankAccountName`) | No validation of any kind | **High** — a wrong account number pays a stranger | Per-bank format validation; blocking before bank-file export | **P1** | Bank file |
| Date of birth | ⏳ | In workbook | Stored, and **correctly blocking**: unknown DOB is an exception, never assumed under-60 (`payroll.service.ts:306`) | None — this is right | — | Keep exactly as is | — | — |
| Tax profile (marital, spouse, children) | ⏳ | Not modelled; PCB typed by hand | **Absent.** `maritalStatus` is a free-text field on the profile and feeds nothing | No PCB calculation is possible without it | **High** | Model spouse status and child count with effective dates | **P1** | PCB engine |
| Previous employment / TP3 | ⏳ | Absent | **Absent** | A mid-year joiner's PCB cannot be right | High | TP3 capture at onboarding | **P1** | PCB engine, YTD |
| TP1 deductions and rebates | ⏳ | Absent | **Absent** | — | Medium | Per-period TP1 entry | **P2** | PCB engine |
| Salary revision history | ⏳ | Overwritten in the sheet | **Absent.** `basicSalary` is one mutable field. Recalculating an unlocked past run reads *today's* salary | A raise silently reprices unapproved history | **High** | Effective-dated salary records; the run reads the rate in force for the period | **P1** | — |
| Employment dates | ⏳ | Tracked loosely | `startDate`/`endDate` stored — **and never read by the calculation** | See proration below | High | Use them | **P0** | Proration |

## 3 · The payroll run

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| **Payroll inputs (allowance, bonus, claim, PCB)** | ⏳ | Typed into the sheet | **Schema only — no write path.** See the finding above | **Payroll cannot be completed end to end** | **Critical** | Build the input screen + endpoint over `PayrollInputEntry` | **P0** | — |
| Mid-month joiner / leaver proration | ⏳ | By hand | **Absent.** Employees are selected by `employmentStatus` alone (`payroll.service.ts:219`); no date filter, no proration | Someone who joined on the 20th is paid a full month | **Critical** — overpayment, every time it happens | Prorate on `startDate`/`endDate`; make the proration visible on the payslip | **P0** | Employment dates |
| Final payroll on termination | ⏳ | By hand | **Absent.** A terminated employee simply drops out of the query — including pay they are owed | Unpaid final wages | **High** | Explicit final-pay run | **P1** | Proration |
| Off-cycle / second run in a period | ⏳ | Three payment dates per period (1st, 15th, 30th) | **Impossible.** `@@unique([tenantId, clinicId, period])` allows exactly one run per branch per month | Cannot reproduce how the clinic actually pays | **High** — this is the clinic's real cadence | Allow several runs per period with a sequence and a type (regular/off-cycle/bonus/final) | **P1** | — |
| Ordinary Rate of Pay base | ⏳ | Basic only | **Comment and code disagree.** `computeBases` computes `ordinaryRateBaseCents` correctly from every ORP-liable component — and **nothing reads it** (zero consumers repo-wide). The service hardcodes `orpBase = basicCents` (`payroll.service.ts:339`) | Overtime and unpaid leave are priced off basic alone; the `ordinaryRateOfPay` liability flag is dead data | **Medium.** Basic-only may be defensible policy — but then the flag and the comment are wrong; if it is not, every OT hour is underpaid | Decide deliberately, then make code and comment agree. Either consume `ordinaryRateBaseCents` or delete the flag | **P1** | Component config |
| Overtime tiers | ⏳ | Four tiers, three multipliers + one flat rate | Engine supports tiers; **the service only ever passes one** — `[{ 'Normal day (1.5x)', 1.5 }]` (`payroll.service.ts:350`) | Rest-day and public-holiday overtime cannot be paid | **High** | Wire the configured tiers through | **P1** | Component config |
| Unpaid leave types | ⏳ | By hand | Hardcoded `new Set(['UNPAID'])` (`payroll.service.ts:318`) | A clinic's own unpaid types are ignored | Medium | Move onto the leave-type configuration | **P2** | Leave policy config |
| Exception queue | ⏳ | None — the sheet cannot object | **Strong.** Blocking exceptions for: no salary, no DOB, unapproved OT, missing punch, unknown component, missing PCB, incomplete band table, wage outside all bands | — | — | Keep. This is better than the spreadsheet by a wide margin | — | — |
| Approval, separation of duties | ⏳ | None | **Strong.** Approver ≠ creator, owner documented as the exception (`payroll.service.ts:605`); zero exceptions required | — | — | Keep | — | — |
| Lock after approval | ⏳ | None | **Strong.** DB trigger refuses recalculation; adjustments are the only path (`PayrollAdjustment`) | — | — | Keep | — | — |
| Frozen snapshots | ⏳ | None | **Strong.** Statutory rules, ORP divisors and the employee record are all frozen onto the run/line | — | — | Keep | — | — |
| Month-on-month variance check | ⏳ | None | **Absent** | An outlier net pay is not flagged | Medium | Compare each line to the prior period; flag movement over a threshold | **P2** | — |

## 4 · Statutory

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| EPF | ⏳ | Third Schedule table in the sheet | Band table with band-ceiling rule, age-60 branch, 11%/9% election, RM5,000 employer step. **35/35 reconciled against the workbooks** | Tables are `CORROBORATED`, never authority-verified | **Critical** | Verify against KWSP; only a human with access may mark `VERIFIED` | **P0** | Authority access |
| SOCSO / EIS | ⏳ | VLOOKUP (employer) + typed (employee) | Both sides from one band lookup — they cannot disagree | Same verification gap | **Critical** | As above, against PERKESO | **P0** | Authority access |
| PCB | ⏳ | **Typed by hand; no formula exists in either workbook** | **Not implemented, deliberately.** Returns `null` and blocks | No engine — and no way to key the manual figure in either | **Critical** | Short term: the input screen. Long term: LHDN Computerised Calculation, from the official spec only | **P0** | Input screen, YTD, tax profile |
| HRD Corp levy | ⏳ | 1% of basic | **Absent** — no employer-cost line | Employer cost understated | Medium | Add as an employer-side component | **P2** | Component config |
| Year-to-date | ⏳ | Implicit in the sheet | **Absent — no YTD anywhere in the repo** | PCB, EA forms and mid-year migration are all impossible without it | **Critical** | Accumulate YTD per employee per entity per year, from approved runs only | **P0** | Legal entity |
| Rate-set versioning | ⏳ | None | **Strong.** Effective-dated, with `verificationStatus`, `verifiedBy`, `sourceUrl`; approval blocked below `VERIFIED` | — | — | Keep. Do not weaken for a competitor's agreement | — | — |

## 5 · Pay component model

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| Component liability matrix | ⏳ | Five status codes (1–5) | **Present and centralised** — `ComponentLiability` with `epf`, `socso`, `eis`, `pcb`, `ordinaryRateOfPay`, `additionalRemuneration`; the clinic's five codes are mapped | Not scattered — but **hardcoded in TypeScript**, not configuration | Medium — a new component needs a deploy | Move `DEFAULT_COMPONENT_LIABILITY` into a `PayComponent` table, effective-dated, seeded from today's values | **P1** | — |
| Missing switches | ⏳ | n/a | Six modelled | No `hrdLevy`, `unpaidLeaveBase` (distinct from ORP), `recurring`, `employerSide`, `taxableBenefit`, `reimbursement`, `prorated` | Medium | Add when the table lands | **P1** | Component table |
| Unknown component is not silently dropped | ⏳ | n/a | **Strong** — raises an exception (`payroll.service.ts:389`) | — | — | Keep | — | — |
| Earned vs paid period | ⏳ | Earned one month, paid the next | Modelled (`PayrollInputEntry.earnedPeriod`) — **no screen shows it** | Payslip cannot say "this is December's overtime" | Medium | Surface on the input screen and the payslip | **P2** | Input screen |
| Loans / advances balance | ⏳ | Tracked in the sheet | Only an `ADVANCE_RECOVERY` component — no balance, no schedule | Cannot tell what is still owed | Medium | Loan record with a recovery schedule | **P2** | Input screen |
| Claims / reimbursements | ⏳ | "Hutang medical claim" column | No workflow; would be a manual input | — | Low | Claim submission → approval → payroll input | **P3** | Input screen |

## 6 · Payslip, outputs, self-service

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| Payslip | ⏳ | None issued | **Exists** (D-116). Employee block, period, earnings, deductions, net, **employer contributions shown separately**, draft watermark, self-checking net, states when a figure is uncalculated | No YTD; no OT hours/rate breakdown; no statutory ID numbers; no payment method; no version marker | Medium | Add those five | **P2** | YTD |
| Payslip honesty guard | ⏳ | n/a | **Strong** — a provisional run's payslip says so on its face | — | — | Keep. Do not remove while tables are unverified | — | — |
| Bank payment file | ⏳ | Manual bank portal | **Absent** | Payment stays manual | **High** | Per-bank export, with a total that reconciles to the run before it will generate | **P1** | Bank validation, legal entity |
| EPF/SOCSO/EIS/PCB exports | ⏳ | Manual | **Absent** | Filing stays manual | **High** | Per-entity exports | **P1** | Legal entity, statutory IDs |
| EA form / year-end | ⏳ | Manual | **Absent** | — | High (annual) | Generate from YTD | **P1** | YTD |
| Employee self-service | ⏳ | None | **Absent** | Payslips distributed by hand | Low | Later | **P3** | Payslip |
| Audit trail | ⏳ | None | **Strong** — every payroll mutation goes through `withAdminTx` (permission + tenant + audit row in one transaction) | — | — | Keep | — | — |

## 7 · Migration and opening balances

| Capability | PayrollPanda | Hijraa current | Kuwick current | Gap | Risk | Recommendation | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| Employee import | ⏳ | n/a | **Absent** | Typed in once | Low — the clinic is small | Manual entry is acceptable | **P3** | Employee form |
| Opening YTD import | ⏳ | n/a | **Absent** | **Mid-year cutover is impossible** | **Critical** if going live mid-year | Import YTD gross, EPF, SOCSO, EIS, PCB, zakat, additional remuneration | **P0** *(if mid-year)* | YTD |
| Prior-employer TP3 | ⏳ | n/a | **Absent** | Mid-year joiners' PCB wrong | High | Capture at onboarding | **P1** | PCB engine |
| Leave balances | ⏳ | Sheet | `LeaveBalance` exists with an adjust endpoint | — | Low | Fine | — | — |

### Minimum opening dataset for a correct next payroll

Derived from what the calculation actually reads, plus what a lawful PCB
computation needs. **A mid-year cutover that skips any line in the first group
produces a wrong first payslip.**

**Required, per employee:**
date of birth · employment start date · legal entity · basic salary effective
from · EPF/SOCSO/EIS/PCB applicability · EPF employee election (11 or 9) ·
statutory identifiers (EPF, SOCSO, tax) · bank name, account number, account name

**Required, per employee, for the year to date at cutover:**
gross remuneration · EPF employee and employer · SOCSO employee and employer ·
EIS employee and employer · PCB paid · zakat paid · additional remuneration paid
separately from normal · months already paid in the year

**Required, per employee, only if they joined mid-year:**
previous employer's TP3 figures — remuneration, EPF, PCB

**Required, per entity:** registered name, registration number, EPF/SOCSO/LHDN
employer numbers, address for the payslip

---

## Recommendation summary

### P0 — blockers before any live payroll

| # | Item | Why it is P0 | Statutory research needed? |
|--:|---|---|---|
| 1 | **Payroll input screen + endpoint** | Without it no run can be approved at all | **No** — form over an existing table |
| 2 | **Proration for joiners and leavers** | Full month paid to someone who worked a week | **No** |
| 3 | **Legal entity model** | Nothing can be filed without an employer | **No** |
| 4 | **Year-to-date accumulation** | PCB, EA and migration all sit on it | **No** |
| 5 | **Verify EPF/SOCSO/EIS against the authorities** | Every figure rests on unverified tables | **Yes** — needs KWSP/PERKESO access |
| 6 | **PCB engine** | The largest deduction is not computed | **Yes** — LHDN spec only |
| 7 | Opening YTD import *(only if going live mid-year)* | Otherwise the first payslip is wrong | No |

**Items 1–4 need no statutory research and no external access.** They are the
part of the P0 list that can be built now. Items 5 and 6 are gated on access to
the authorities and must not be shortcut through a competitor.

### P1 — required for a reliable production payroll

Salary revision history · employment-date-aware selection · off-cycle runs ·
final pay on termination · overtime tiers wired through · the ORP base decision ·
component configuration table · tax profile (spouse, children) · TP3 capture ·
bank file with validation · statutory exports · EA form · HR maintenance screens
(employee, leave policy, attendance correction — all three endpoints already
exist) · statutory identifier validation at export

### P2 / P3

P2: HRD levy · earned-vs-paid period on screen · loan balances · month-on-month
variance detection · payslip YTD and OT breakdown · unpaid-leave types from
configuration · TP1
P3: claims workflow · employee self-service · employee import

### Not appropriate for Kuwick

- **A payroll product's full breadth.** Kuwick pays one small clinic group, not
  arbitrary Malaysian employers. Multi-currency, union rules, complex shift
  premia and industry award structures are not worth carrying.
- **Reimplementing what an accountant already does well.** If the clinic's
  accountant files PCB, the honest product is one that records the figure with an
  actor and a timestamp — which is what the input screen gives — rather than a
  half-built engine.

---

## Assumptions in the existing Kuwick code this audit calls into question

Named individually, because Part 13 asked for them.

1. **`PayrollInputEntry` is reachable.** The schema comment describes keying PCB
   in as an existing step. It is not: there is no write path. Every downstream
   design decision that assumed the escape hatch existed needs revisiting.
2. **The ORP base is basic-only.** `computeBases` computes a full
   `ordinaryRateBaseCents` that nothing consumes, while the service uses
   `basicCents`. One of the two is wrong, and the `ordinaryRateOfPay` flag on
   every component is currently dead data either way.
3. **Employment status is a sufficient filter.** Selecting by
   `ACTIVE|PROBATION|NOTICE` with no date test assumes everyone worked the whole
   month. Joiners, leavers and anyone on `NOTICE` past their last day are all
   paid in full.
4. **Salary is a single current value.** No history means a recalculation of an
   unlocked past period silently applies today's rate.
5. **One run per branch per month is enough.** The clinic pays on three dates per
   period. The unique constraint makes that unrepresentable.
6. **Overtime is always a normal day.** The engine takes tiers; the caller passes
   one hardcoded 1.5× tier, so rest-day and public-holiday work cannot be paid
   correctly.
7. **The branch is the payroll boundary.** It is the *employer* that files, and
   Kuwick has no employer.
8. **Component liability is stable enough to compile in.** Centralising it was
   right; freezing it in TypeScript means a new allowance needs a deployment.

None of these were found by the test suite, which is worth noting: the 30 tests
in `payroll-calculation.spec.ts` all exercise the pure functions, and the pure
functions are correct. Items 1–7 are all in the *service* that calls them.

---

## What this matrix must not become

The ⏳ column is the point of the exercise, and it is empty. When it is filled:

- No cell in it makes a Kuwick rate set `VERIFIED`.
- No cell in it removes the NOT READY guard.
- Everything statutory in it is labelled **WORKFLOW REFERENCE ONLY** until
  checked against KWSP, PERKESO or LHDN directly.

A competitor is evidence about *product design*. It is not evidence about *law*.
