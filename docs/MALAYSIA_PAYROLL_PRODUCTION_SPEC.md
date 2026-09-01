# Malaysia HR & Payroll — production specification (Phase 1)

**Status: SPECIFICATION ONLY. Nothing here is implemented.**
**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Written:** 1 September 2026

This is the implementation source of truth for the Malaysia HR & Payroll
programme. Where it states a statutory rule, that rule is **UNVERIFIED** and
carries the authority that must confirm it. Where it states an architectural
decision, that decision is made and is binding on implementation.

Companion documents:
`MALAYSIA_PAYROLL_CURRENT_STATE_AUDIT.md` (Phase 0) ·
`apps/api/src/workforce/statutory/statutory-register.json` (machine-readable
register) · `PAYROLLPANDA_KUWICK_COMPARISON.md` ·
`KUWICK_PAYROLL_GAP_MATRIX.md`

---

## 1 · Scope

A production-grade Malaysian clinic HRIS and payroll system: employee master,
effective-dated pay, attendance/leave/OT/claims/incentive feeds, a statutory
engine, a controlled payroll run with maker-checker and an immutable approved
snapshot, payslips, bank and statutory **exports**, year-end forms, Finance
posting, and reporting — for one clinic group that may operate more than one
legal employer.

## 2 · Non-goals

- **Submitting to any authority or bank.** Kuwick's boundary is
  CALCULATE → PREPARE → VALIDATE → EXPORT → RECONCILE. API submission to KWSP,
  PERKESO, HASiL or a bank is a separate project with its own risk assessment.
- **A general Malaysian payroll product.** Multi-currency, union agreements,
  industry award structures and complex shift premia are out.
- **Reimplementing the accountant.** Where a clinic's accountant files PCB, the
  honest product records the figure with an actor and a timestamp.
- **Reverse-engineering any competitor's calculation.**

## 3 · Evidence hierarchy

| Tier | Sources | May establish |
|---|---|---|
| **A** | HASiL/LHDN · KWSP · PERKESO · JTKSM · HRD Corp · Acts, Regulations, Gazettes, official schedules and specifications | **Statutory rules** |
| **B** | PayrollPanda · MySyarikat · Talenox · SQL Payroll | Workflow patterns; corroboration of an output. **Never law** |
| **C** | Hijraa payroll workbooks | How the clinic operates today; reconciliation expectations. **Never law** |
| **D** | Blogs, calculators, articles | **Never a sole authority** |

**No majority voting.** If three calculators disagree with an official schedule,
the schedule wins. If two Tier B products agree with each other and no Tier A
source has been read, the rule is still UNVERIFIED.

## 4 · Official source register

`apps/api/src/workforce/statutory/statutory-register.json` — 26 calculation-critical
rules, each with authority, official document, effective date, version, Kuwick
implementation, automated test, expected result and verification status.

**Current position: 21 UNVERIFIED, 5 CORROBORATED, 0 verified against any
authority.** Every Tier A host is unreachable from the build environment
(measured; see Phase 0 §0). The register records that as the blocking reason per
rule rather than leaving the gap implicit.

## 5 · Verification-status model

`UNVERIFIED` → `CORROBORATED` → `OFFICIAL_SOURCE_VERIFIED` →
`OFFICIAL_TEST_VECTOR_VERIFIED`

Rules binding on implementation:

1. **Status is never upgraded silently.** An upgrade is a commit that names the
   document read, the person who read it and the date.
2. **A competitor or calculator agreeing raises at most `CORROBORATED`.**
3. **`OFFICIAL_TEST_VECTOR_VERIFIED` requires the authority's own published
   vectors**, not vectors derived from its prose.
4. **A payroll run may not be approved against a rule set below
   `OFFICIAL_SOURCE_VERIFIED`.** This tightens the existing gate, which today
   accepts a locally-defined `VERIFIED`.
5. **PCB hard gate:** PCB is not production-ready until the applicable official
   HASiL 2026 MTD test vectors pass.

## 6 · Terminology

| Term | Meaning in this spec |
|---|---|
| **Tenant** | The Kuwick customer — a clinic group |
| **Legal Employer** | The entity that employs, files and pays. Holds statutory registrations |
| **Branch** | A physical location. An operational and cost dimension, never an employer |
| **Employee** | A person employed by exactly one Legal Employer at a time |
| **Pay Component** | A named, versioned, statutorily-classified kind of money |
| **Payroll Input** | A per-employee, per-period instance of a component |
| **Recurring** | An input attached to the employee, repeating each period |
| **Additional** | An input attached to a single run |
| **Run** | One calculation for one employer, period and run type |
| **Snapshot** | The immutable record of what was approved |

## 7 · Legal employer architecture

```
Tenant (clinic group)
 └── LegalEmployer          ← statutory identity, bank identity, filing identity
      ├── Branch            ← operational / cost / reporting dimension
      └── Employee          ← employed BY the employer, WORKS AT branches
```

**`LegalEmployer` holds:** registered name, registration number (SSM/ROC), EPF
employer number, SOCSO employer code, LHDN employer number (`E`), HRD Corp
registration and category, address for the payslip, bank account for payments,
and the payroll policy default.

**Binding decisions:**
- Statutory registrations, statutory exports, bank files and year-end forms
  belong to the **employer**, never the branch.
- An employee has exactly one employer at a time, effective-dated.
- A staff member may work at several branches; branch is an allocation on the
  payroll line, never identity.
- **An Owner who is also a provider must not have employer scope inferred from
  provider branch identity.** Employer scope is explicit and permissioned.
- A single-entity clinic configures one employer and never sees the complexity.

## 8 · Branch / location architecture

Branch already exists as `Clinic`. It gains no statutory meaning. Payroll lines
carry a `branchId` for cost allocation. Reports roll up by branch **and** by
employer; exports only ever by employer.

## 9 · Employee payroll profile

Additions to `EmployeeProfile`, all effective-dated where marked ⏱:

identity · **nationality (coded, not free text)** · **residentialStatus
(Resident/Non-resident)** · DOB · employment dates ⏱ · employment status ⏱ ·
worker category ⏱ · **legalEmployerId** ⏱ · working branches · department ·
position · payroll policy · salary basis ⏱ · **salary** ⏱ (§10) · bank/payment
method · TIN · **EPF profile** (membership category, election, voluntary rates) ·
**SOCSO profile** (category, scheme applicability) · **EIS profile** ·
**LINDUNG 24 Jam profile** (participation state ⏱) · **HRD classification** ·
**TP3 / opening YTD** · **TP1 reliefs** · **dependants** (spouse status,
children with effective dates) · statutory identifiers.

**Binding: no unsafe unknown fallback.** Kuwick's existing behaviour — unknown
DOB returns `null` with a reason rather than assuming under-60 — is the pattern
for **every** field that changes statutory treatment. Missing data that can
change treatment becomes a visible exception, never a default.

## 10 · Effective-dated salary history

New `EmployeeSalary`: `employeeId`, `basis` (monthly/daily/hourly), `amount`,
`effectiveFrom`, `effectiveTo?`, `reason`, `actorId`, `createdAt`.

**Binding:** the calculation resolves the salary **in force for the period**,
never `EmployeeProfile.basicSalary`. That column is migrated into the first
salary row and then dropped. Historical payroll never silently reads today's pay.

## 11 · Pay-component architecture

New `PayComponent`, versioned and effective-dated, replacing the hardcoded
`DEFAULT_COMPONENT_LIABILITY`.

| Attribute | Notes |
|---|---|
| `code`, `name`, `type` | ADDITION / DEDUCTION / OVERTIME |
| `category` | REMUNERATION / ALLOWANCE / BENEFIT_IN_KIND / PERQUISITE / TAX_DEDUCTION / PAYROLL_DEDUCTION |
| `calculationMode` | AMOUNT / PER_UNIT |
| `includeIn` | GROSS_AND_NET / GROSS_ONLY / NET_ONLY / NONE |
| `pcbLiable`, `epfLiable`, `socsoLiable`, `eisLiable` | the four independent flags |
| **`hrdLiable`** | PayrollPanda has no such flag; HRD leviable wages may not equal gross |
| **`includeInOrpBase`** | fixes the dead flag |
| **`includeInUnpaidLeaveBase`** | distinct from ORP |
| **`additionalRemuneration`** | PCB treatment |
| `pcbExemptionLimit` | annual cap where one applies |
| `eaField` | year-end classification |
| `prorated` | whether a partial month reduces it |
| `employerSide` | employer cost, not employee pay |
| `systemControlled` | presets are read-only |
| `effectiveFrom/To`, `version`, `sourceRef` | provenance |

**Binding decisions:**
- **Presets are system-controlled and versioned.** A clinic may enable, disable
  or create — never redefine a preset's statutory flags.
- **Changing a statutory flag is an audited, reasoned, effective-dated act** that
  does not alter past calculations. PayrollPanda changes these with no
  confirmation and no history; that is a defect, not a pattern.
- **Every seeded flag ships `UNVERIFIED`** and is listed in the register.
- `payroll-items_1.md` is a **comparison checklist**, never the source of a flag.

## 12 · Payroll input architecture

Closes the Phase 0 Trace A dead end.

`PayrollInput` (evolving `PayrollInputEntry`): employer · employee · period ·
`componentCode` · amount **or** rate/hours/units/days · **`source`**
(MANUAL / ATTENDANCE / LEAVE / CLAIM / INCENTIVE / RECURRING / IMPORT) ·
**`sourceRecordId`** · `earnedPeriod` · `paymentPeriod` · `actorId` · `createdAt`
· `reason?` · `approvalState?`.

**Write paths, in build order:**
1. **Per-employee input drawer** — the single highest-value screen.
2. Bulk grid entry for one component across employees.
3. Recurring items on the employee profile.
4. Controlled CSV import with a dry run.

**Binding:** upstream feeds **materialise** into inputs rather than being read
live at calculation time, so that every figure on a payslip has a reviewable row
with a source and an actor. Duplicate protection is a unique constraint on
`(employer, employee, period, componentCode, sourceRecordId)`.

## 13 · Recurring versus additional remuneration

PayrollPanda decides this by *attachment point* and never labels it. **Kuwick
adopts the same rule and makes it visible**: every input row is badged
`RECURRING` or `ADDITIONAL`, and the badge drives `additionalRemuneration` for
PCB. A user must never have to infer statutory treatment from where a row
happens to sit.

## 14–18 · Upstream integration

Canonical, one-way, source-linked:

```
Roster → Attendance → approved OT      → PayrollInput(source=ATTENDANCE)
Leave  → approved leave / UPL          → PayrollInput(source=LEAVE)
Claims → approved claim                → PayrollInput(source=CLAIM)
Incentive run → approved result        → PayrollInput(source=INCENTIVE)
```

**Binding:** payroll never recomputes upstream truth; it imports it with a link.
Re-importing is idempotent on `sourceRecordId`. **The existing roster is the
working-days source — no second schedule object is created.** OT multipliers are
enforced by rule (weekday / rest day / public holiday) rather than by trusting
the user to pick the right pay item.

## 19 · Proration

New `PayrollPolicy` with **five independent bases**, each FIXED_DAYS(n) /
WORKING_DAYS / CALENDAR_DAYS:

salary proration · overtime base rate · unpaid leave · leave pay ·
**termination proration** (the fifth, which PayrollPanda lacks and whose absence
produced an overstated final month in the audit).

**Binding: the working is shown, not just the result** — `RM3,000 × 11/30
calendar days = RM1,100.00` on the row and on the payslip.

## 20 · Joiner

Prorate from `startDate`, inclusive. Selection by date, not by employment status
alone. An employee whose start date falls after the period end is excluded with
an INFO note rather than silently absent.

## 21 · Leaver, termination, final pay

Reasons: Terminated / Redundant / Resigned / Retired / Left Malaysia / Deceased /
Other — "Left Malaysia" drives tax clearance. Captures last day, a proration
choice naming the policy basis inline, and validates last day ≥ start date.

**Binding, fixing both audited defects:** the final month **is** re-prorated, and
archiving someone whose period is already approved **blocks** with an offer to
open a correction run. Never silently archive and leave approved payroll stale.

## 22–27 · Statutory schemes

Every rule below is **UNVERIFIED**. Structure is specified; values are not.

- **§22 EPF** — band lookup on the band ceiling (structure already correct). Add:
  age-75 boundary, citizenship/PR/non-Malaysian classification, pre-Aug-1998
  membership category, voluntary employee and employer contributions.
- **§23 SOCSO** — split Employment Injury and Invalidity as distinct schemes;
  add foreign-worker treatment; version the ceiling.
- **§24 EIS** — modelled under Act 800, separately from Act 4.
- **§25 LINDUNG 24 Jam** — a **distinct scheme**, not a SOCSO boolean. Needs
  participation state with history, local opt-in/opt-out, foreign-worker
  mandatory commencement, phase-aware rates, employer remittance, and its own
  export. Entirely unimplemented today.
- **§26 HRD Corp** — employer-level rate and category **plus** a per-component
  `hrdLiable` flag, because leviable wages may not equal gross.
- **§27 PCB/MTD** — the LHDN Computerised Calculation method, cumulative, from
  the official 2026 specification only. **Hard gate: official test vectors must
  pass.** Until then `computePcb` keeps returning `null` and the input path
  (§12) carries the externally-computed figure with an actor and a timestamp.

## 28–30 · TP1, TP3, CP38 and zakat

TP1 relief entries per period with caps. TP3 reproduced as the actual LHDN form,
bilingual, two previous employers. CP38 as a directed deduction distinct from
PCB. Zakat distinguishing payroll-deducted from employee-paid. All **UNVERIFIED**.

## 31 · YTD and opening balances

New `EmployeeYtd`: employer · employee · tax year · month · gross · PCB · CP38 ·
EPF ee/er · SOCSO ee/er · EIS ee/er · LINDUNG · zakat · additional remuneration ·
`source` (CALCULATED / OPENING_IMPORT) · actor · timestamp.

**Binding:** YTD is **derived from approved runs** and **never editable** for
months Kuwick calculated. Opening months are imported once, audited, and locked
when a later period is approved. This is the substrate PCB, Form EA and mid-year
migration all sit on.

## 32–33 · Payroll run architecture

Replace `@@unique([tenantId, clinicId, period])` with
`@@unique([legalEmployerId, period, runType, sequence])`.

Run types: `REGULAR` · `OFF_CYCLE_BONUS` · `CORRECTION` · `FINAL_PAY`.
Each carries its own payment date. Statutory treatment across related runs in one
period must not double-count contributions — an explicit invariant and test.

## 34 · Exception model

`BLOCKING` (gates approval) · `WARNING` (visible, passable) · `INFO`.

Each exception carries employee, cause, **consequence**, remediation, a deep link
to the fix, whether override is permitted, and the override actor and reason.
Modelled on the best copy found in the audit: *name the condition, name the
consequence, give the remedies.*

Minimum set: missing statutory identity · unknown DOB · missing employer ·
missing/invalid bank details · negative net · invalid salary dates · unresolved
TP3/YTD · missing PCB · duplicate input · unapproved OT or claim · missing
statutory engine version · unsupported effective date · variance beyond threshold.

## 35 · Variance control

Before approval: current vs previous period on headcount, gross, net, employer
cost and each statutory total, plus employee-level material changes. Movement
beyond a configurable threshold raises a WARNING. This is the single
highest-value payroll control and neither PayrollPanda nor Kuwick has it.

## 36 · Approval and maker-checker

Confirmation restates employer, period, run type, payment date, headcount, gross,
net, employer cost, statutory totals, **blocking exceptions = 0**, and the
warning count. Records preparer, reviewer, approver, timestamps, snapshot hash
and statutory versions. Optional second approval above a configurable amount.

Kuwick already enforces approver ≠ preparer. **Keep it.** Do not copy
PayrollPanda's one-click, no-dialog, no-actor approval.

## 37 · Immutable approved snapshot

**The deepest fork in the design, and Kuwick deliberately diverges.**

PayrollPanda recalculates live until approval, freezes on approval, and re-derives
from *current* master data on reopen, holding no inspectable snapshot. That makes
"what exactly did we approve in January?" unanswerable.

**Kuwick snapshots on approval:** employee payroll state, salary version, every
input with its source, component versions, statutory engine versions, statutory
bases, calculated amounts, totals, employer identity and payment date — hashed.

## 38 · Reopen and correction

Reopen preserves the prior snapshot, calculates a candidate, shows a
**before/after diff**, requires a reason, appends an audit event and creates a new
version. **What was originally approved is never erased.**

## 39 · Audit trail

Append-only, over: salary changes · statutory-profile changes · pay-component
changes · inputs · upstream imports · calculation · exception override ·
approval · reopen · correction · payslip regeneration · exports · payment-file
generation. Actor, timestamp, before/after. Kuwick's `withAdminTx` already does
permission + tenant + audit in one transaction; this extends its coverage.

## 40 · Payslip

Generated **only** from locked snapshot data. Adds to today's payslip: YTD
columns, OT hours and rate breakdown, statutory identifiers, payment method,
**revision marker** for a corrected payslip, and download history.
**The non-production warning stays until §5's gate is met.**

## 41 · Bank payment

Export only after the format is verified. Validate account details before
generating. Reconcile the file total against the run total or refuse.
States: `NOT_GENERATED` → `GENERATED` → `DOWNLOADED`; anything beyond requires
external evidence. **A generated file is not a payment.**

## 42 · Statutory outputs

EPF · SOCSO · EIS · LINDUNG 24 Jam · PCB/CP39 · combined PERKESO where
officially supported, plus reconciliation. Per employer, never per branch.
Boundary: CALCULATE → PREPARE → VALIDATE → EXPORT → RECONCILE.

## 43 · Year-end

Form E, EA, CP8D — versioned by tax year, data-driven so a new format is
configuration. **If an authority has not released the year's form, say so and
refuse to produce it.** Adopted directly from the audit; it is the most honest
behaviour observed in the competitor.

## 44 · Finance integration

Approved payroll posts from the locked snapshot, once, as distinct liabilities:
employee net pay · EPF · SOCSO · EIS · LINDUNG · PCB · CP38 · HRD · other
deductions · employer statutory cost. No duplicated ledger. Correction posts a
delta with its own reference. **Today payroll posts nothing to Finance.**

## 45 · Reports

Payroll register · totals · employer cost · employee cost breakdown · statutory
totals · by branch/employer/department · **variance** · joiner/leaver · OT ·
leave/UPL · claims · incentives · statutory reconciliation · payment
reconciliation · payroll history · correction history. Drill-down from any total
to employee, input and source.

## 46 · RBAC

Replace 6 permissions with 11: `hr.employee.view` · `hr.employee.manage` ·
**`hr.salary.view`** (pay visibility as its own right) · `hr.payroll.view` ·
`hr.payroll.run` · `hr.payroll.approve` · **`hr.payroll.reopen`** ·
**`hr.payroll.export.bank`** · **`hr.payroll.export.statutory`** ·
**`hr.payroll.export.reports`** · **`hr.statutory.manage`**.

**Binding:** all legal-employer scoped, branch scoped where appropriate, enforced
server-side, audited. Today `hr.payroll.approve` also grants rewriting the
statutory rate tables — that conflation is removed.

## 47 · RLS and security

Every new table gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and `tenant_isolation`
on `current_setting('app.tenant_id', true)`, matching the existing 14 payroll
tables. Employer scoping is enforced in the service layer above RLS. IC, bank and
statutory identifiers remain behind HR-gated endpoints only.

## 48 · Migration

Four supported onboarding shapes: (A) 1 January, no history; (B) mid-year with
opening YTD; (C) open/unpaid items carried in; (D) historical reference only.
Controlled templates, dry run, all-or-nothing, traceable to a named import batch
— reusing the claim-importer pattern already proven in this codebase.

## 49 · Data model changes

| Change | Kind |
|---|---|
| `LegalEmployer` (new) | additive |
| `EmployeeSalary` (new) | additive + data migration from `basicSalary` |
| `PayComponent` + `PayComponentVersion` (new) | additive + seed |
| `PayrollPolicy` (new, five bases) | additive |
| `PayrollInput` (evolve `PayrollInputEntry`) | additive columns |
| `EmployeeYtd` (new) | additive |
| `EmployeeTaxProfile`, `EmployeeDependant`, `Tp1Relief`, `Tp3PreviousEmployment` (new) | additive |
| `LindungParticipation` (new) | additive |
| `PayrollSnapshot` (new) | additive |
| `PayrollException` (new — today a JSON blob on the run) | additive + data migration |
| `PayrollRun` + `legalEmployerId`, `runType`, `sequence`, `paymentDate` | additive then **constraint change** |
| `EmployeeProfile` + `legalEmployerId`, `residentialStatus`, coded nationality | additive |
| Drop `EmployeeProfile.basicSalary` | **destructive — last, after §10 is live** |
| Replace run unique constraint | **constraint-changing** |

## 50 · API

New: employer CRUD · salary history · pay components · payroll policies ·
**payroll inputs (the Trace A fix)** · YTD · tax profile/TP1/TP3 · exceptions ·
variance · snapshot · reopen/correct · exports. All through `withAdminTx`.

## 51 · UI

Payroll run grid with per-employee expansion · **input drawer** · exception
centre · variance panel · approval confirmation · correction diff · employee
payroll profile · statutory settings · policy editor · YTD grid · TP3 form ·
payslip · reports. **Every server error is surfaced** (§52).

## 52 · Calculation invariants

1. `gross − employeeDeductions = net`, exactly, in cents.
2. Every statutory figure is `null` or a number — never `0` standing in for
   unknown.
3. `employerCost = gross + employerStatutory`.
4. Related runs in one period never double-count a contribution.
5. A snapshot recomputed from its own frozen inputs reproduces its totals.
6. Sum of payroll-line branch allocations equals the line total.
7. **A rejected save always produces a visible message** — asserted in the test
   suite as a consequence, not a component.

## 53 · Statutory versioning

Every scheme's rules are effective-dated and versioned; runs freeze the versions
they used; a rule change never alters a past run.

## 54–58 · Testing

**§54 Official test vectors** — HASiL 2026 MTD (hard gate); EPF Third Schedule
boundaries incl. RM5,000 and RM20,000 transitions, ages 60 and 75, citizenship
categories; SOCSO/EIS band edges and the ceiling; LINDUNG phases and the
foreign-worker commencement; HRD categories and leviable-wage inclusion/exclusion;
Employment Act OT and proration.
**§55 Unit** — pure functions, boundary-first.
**§56 Integration** — real PostgreSQL as the non-superuser role, RLS and
permissions included.
**§57 E2E** — full lifecycle including reopen, correction and historical
reproducibility.
**§58 Month-end synthetic UAT** — §59 below.

## 59 · Synthetic UAT population

20 synthetic employees: normal · EPF boundary · above SOCSO/EIS ceiling ·
mid-month joiner · mid-month leaver · age 60+ · age 75 boundary · foreign worker ·
LINDUNG local opt-in · LINDUNG local opt-out · foreign mandatory LINDUNG · OT ·
UPL · claim + incentive · bonus/additional remuneration · TP3/YTD migrant ·
missing statutory data · near-zero net · mid-year salary change · final pay.
**Synthetic names and values only.**

## 60 · Rollout

Behind a feature flag, employer by employer, with the NOT READY guard on until
§5's gate is met. Parallel run against the clinic's workbook for at least one
full month before any reliance.

## 61 · Rollback

Additive migrations first; the destructive `basicSalary` drop last and only after
a full period has run on `EmployeeSalary`. Snapshots make a rollback safe: prior
approved runs remain readable without the new engine.

## 62 · Production acceptance gates

| # | Gate |
|--:|---|
| 1 | Every calculation-critical rule ≥ `OFFICIAL_SOURCE_VERIFIED` |
| 2 | PCB passes the official HASiL 2026 vectors |
| 3 | A full synthetic month-end reconciles end to end |
| 4 | An approved run reproduces from its snapshot |
| 5 | A correction preserves the prior snapshot and shows a diff |
| 6 | Zero BLOCKING exceptions can be bypassed |
| 7 | Finance liabilities equal payroll totals |
| 8 | RLS and permission tests pass for every new surface |
| 9 | Visual UAT reviewed by a person |
| 10 | Parallel run agrees with the clinic's own figures, differences explained |

**All ten. Payroll is PRODUCTION READY on no fewer.**

## 63 · Known limitations at spec time

1. No Tier A source is reachable; all 26 rules are UNVERIFIED or CORROBORATED.
2. No HASiL 2026 specification or test vectors have been obtained.
3. LINDUNG 24 Jam rates, phases and commencement are from the brief, not PERKESO.
4. HRD leviable-wage definition unknown.
5. Employment Act ORP definition unknown — Kuwick's own code contradicts itself.
6. PayrollPanda's payslip content, unpaid-leave arithmetic and in-run item
   behaviour were BLOCKED in the audit and remain unobserved.
7. Whether the clinic's 26/31 divisors are lawful is unestablished.
