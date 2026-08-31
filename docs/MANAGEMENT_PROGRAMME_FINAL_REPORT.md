# Master Management System — final programme report

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z`
**Not merged. No pull request opened.**

This is Part XVI of the programme brief, answered point by point in the order it
was asked. Where a number is stated it was measured on this branch, not
estimated. Where something does not work, it says so and names the blocker.

---

## 1 · Executive summary

The programme set one acceptance question:

> *Can a real clinic reasonably operate these management workflows in Kuwick
> without having to return to the old Hijraa Admin system, payroll Excel, or the
> panel tracking Google Sheet for a workflow that Kuwick claims to support?*

**For Operation, Stock, Panel and Finance: yes, in sequence, with the cutover
steps in `MIGRATION_AND_IMPORT_SAFETY.md`. For HR: yes for reading, no for
maintaining. For Payroll: no, and the reasons are verification and statute, not
code.**

Six of the nine tools the clinic runs today can be retired. Three cannot: the
two payroll workbooks, and the parts of Hijraa Admin that create and edit
records Kuwick can currently only display.

The three findings that mattered most were all found by reading the owner's own
files rather than by reasoning about them:

1. **The panel fee was being added where the bank proves it is withheld.** 2,615
   real bank credits say the panel keeps its fee out of the payment. Kuwick was
   computing `expected = claimed + fee`. The owner superseded D-041; the
   correction is D-112, it is effective-dated, historical claims were migrated,
   and the RM100 / RM8 / RM92 case is a regression test.
2. **The EPF engine was percentage arithmetic, and it was wrong on almost every
   wage in the clinic.** The Third Schedule computes on the *band ceiling*. On
   one real wage the old engine returned RM159.68 where the schedule gives
   RM161. 35 of 35 figures lifted from the clinic's workbooks now reconcile
   exactly.
3. **A batch's remaining quantity did not exist**, so the expiry reports were
   quietly reporting the full delivered quantity as at-risk stock. D-114 replaced
   the invented number with a stated ceiling.

Three more defects were found not by tests but by *looking at the screens* and by
CI: imported claims were invisible in Finance because the branch filter went
through an invoice they do not have; the near-expiry columns were patched into a
duplicated array and never rendered; and the panel reconciliation identity was
missing its over-recovery term. All three are fixed with regression coverage.

**Overall recommendation: READY FOR OWNER UAT** — with Payroll explicitly out of
scope for that UAT, because Kuwick refuses to approve a payroll run against
unverified statutory tables and that refusal is correct.

---

## 2 · Exact branch and SHA

| | |
|---|---|
| Branch | `claude/kuwick-2-visual-audit-k9uk5z` |
| HEAD at time of report | `ea7b1f276732c7d2e0a2628fcbae48c246539dab` |
| Base | `master` @ `a8d6cba44eb8d77aad2dd54fc2caaeb7dc9374b6` |
| Commits ahead of master | **44** |
| Diff vs master | **547 files changed, 73,745 insertions, 509 deletions** |
| Merged to master? | **No.** |
| Pull request opened? | **No.** |

The insertion count is dominated by 277 committed PNG screenshots. Source
changes since master: **156 new files, 25 modified** under `apps/api/src` and
`apps/web/src`.

---

## 3 · What existed before this programme

Master was an appointment and clinical product with a management *foundation*
rather than a management *system*:

- Appointments, public booking, patients, prescriptions, dispensary, queue —
  complete and in production use.
- Multi-tenant isolation with row-level security, a non-superuser application
  role, and a permission model.
- An Admin shell whose navigation was largely complete — it is 48 routed entries
  on this branch — but many of whose entries led to screens that displayed data
  and could not change it.
- Panel claims existed as *tracking*: batches, claims, statuses. The arithmetic
  behind them was wrong in one direction (the fee) and incomplete in another
  (billed-versus-claimed was not measured at all).
- Payroll existed as a simplified percentage engine with a synthetic PCB band
  table.
- Stock existed as levels and movements. There was no purchasing chain, no
  supplier payable, no new-item request, and no notion of what a delivery cost.

The clearest signal in the pre-programme audit, recorded in
`MANAGEMENT_SYSTEM_GAP_AUDIT.md`: **nine endpoints existed that no screen
called.** The server was ahead of the product.

---

## 4 · What was reused

Deliberately, and most of it:

- The whole tenancy, RLS, permission and audit substrate. Every new table joins
  it; no new table opts out.
- `withAdminTx(prisma, permission, fn)` — the single admin write path that
  checks the permission, sets `app.tenant_id`, and writes an audit row. Every
  new mutation in this programme goes through it. There are no exceptions.
- Money as integer cents throughout (`finance/money.ts`). No float touches money.
- The existing Admin shell, DataTable, drawer and modal vocabulary. The new
  screens are not a second design language.
- The Prisma schema conventions, the migration discipline (hand-written SQL,
  applied then resolved), and the seed architecture.
- The Playwright capture harness built in the earlier visual-UAT pass, extended
  with one more script rather than replaced.

Nothing was rewritten to make room for new work.

---

## 5 · What was changed

Grouped by the shape of the change rather than by file.

**Arithmetic corrected (3):** panel fee direction (D-112); EPF/SOCSO/EIS band
lookup replacing percentage arithmetic; batch remaining-quantity removed (D-114).

**Subsystems built that did not exist (7):**

| Subsystem | Core module |
|---|---|
| Supplier invoices, payables, payments, allocations, three-way match | `finance/supplier-payables.ts` + service |
| Panel money in Finance — billed vs claimed, fee cost, fee evidence | `finance/panel-money.ts` + service |
| Panel claim importer (CSV, dry-run, all-or-nothing, idempotent) | `panel/claim-import-csv.ts`, `claim-import.service.ts` |
| New-medication request → approve → activate-on-arrival | `inventory/new-item-request.service.ts` |
| Procurement pricing: `MIN(unit, bonus)`, price capture at goods-in | `inventory/procurement-pricing.ts` |
| Panel payment terms, re-claim deadline, rejection taxonomy | `panel/payment-terms.ts`, `panel-config.service.ts` |
| Payslip generation | `web/src/admin/hr/payslip.ts` |

**Invariant modules extracted as pure functions, unit-tested in isolation:**
`financial-invariants.ts`, `supplier-payables.ts`, `panel/payment-terms.ts`,
`inventory/procurement-pricing.ts`, `finance/panel-money.ts`,
`inventory/batch-exposure.ts`, `payroll-calculation.ts`, `payslip.ts`.

**Screens added or reworked:** Finance → Panel Money, Payables (4 tabs); Panel →
Configuration (fee treatment, terms, deadline), Work Queue, Import, Reconciliation;
Stock → New Item Requests, Near-Expiry, Stock Take selling value; HR → Payroll
run with blocking exceptions, Payslip.

**Documentation:** 14 new documents in `docs/`, 11 new decisions (D-106…D-116).

---

## 6 · Migration and schema changes

**16 migrations** on this branch, all hand-written SQL, all applied and resolved:

| Migration | What it does |
|---|---|
| `20260828100000_finance_payment_credit_tax_dayend` | Payment as its own record (D-106), credit notes, tax codes, day-end |
| `20260828120000_stock_ledger_transfers_takes` | Stock ledger, transfers, stock takes |
| `20260828140000_panel_claim_workspace` | Claim workspace states |
| `20260828160000_hr_workforce_payroll` | Workforce, payroll runs, components |
| `20260828180000_operations_analytics` | Operations analytics, segments, programmes |
| `20260828200000_audit_log_tenant_isolation` | Audit log brought inside RLS (D-111) |
| `20260831062110_payroll_statutory_verification_and_orp` | Rate sets with `verificationStatus`, ORP |
| `20260831064500_payroll_input_entries` | Typed payroll inputs with earned-period |
| `20260831120000_panel_fee_direction_and_terms` | Fee direction, payment terms |
| `20260831140000_claim_rejection_category` | Rejection taxonomy |
| `20260831150000_claim_charged_to_patient` | Rejected claim → patient route |
| `20260831160000_supplier_payables` | Supplier invoices, payments, allocations |
| `20260831170000_panel_fee_treatment_supersedes_d041` | **The D-112 correction + historical migration** |
| `20260831180000_stock_operating_model` | New-item requests, price changes, bonus pricing |
| `20260831190000_panel_claim_import` | `ClaimImportBatch`, nullable `ClaimBatchLine.invoiceId` |
| `20260831200000_claim_import_branch` | `ClaimImportBatch.clinicId` — the Finance visibility fix |

**Two are data migrations, not just schema:**

- `20260831170000` rewrites every historical claim's expected receivable from
  `claimed + fee` to `claimed − fee` where the panel's treatment is
  `WITHHELD_FROM_CLAIM`, and records the impact. It does not touch claims whose
  treatment is unknown; those become `UNCONFIGURED` and are excluded from the
  fee cost *and counted*, never assumed zero.
- `20260831190000` relaxes `ClaimBatchLine.invoiceId` to nullable — and
  immediately re-tightens it with a CHECK constraint: **a claim may have no
  invoice if and only if it came from a named import** (D-115). The invariant was
  not dropped; it was made conditional and enforced in the database.

**Rollback, stated accurately.** These are forward-only migrations. There are no
`down` scripts, and `MIGRATION_AND_IMPORT_SAFETY.md` covers *import* safety and
the cutover sequence — not per-migration rollback. Reverting the two data
migrations is not a schema operation: `20260831170000` backfills fee treatment
from the old `fee_direction` column and from whether a fee was configured at all,
and does not snapshot the prior receivable per row, so undoing it means restoring
from a backup taken before it ran. **Take that backup before the cutover.** The
importer is the exception that needs no backup: it is idempotent and every
imported row is traceable to a `ClaimImportBatch`, so an import can be undone by
deleting its batch.

---

## 7 · OPERATION readiness

**Working end to end:** operational overview with period filtering; segment P&L;
marketing programmes, segments, audiences, templates and dispatch preparation;
patient enrolment.

**The property that matters:** nothing in Operation invents a number. Every
figure on the operational dashboards is traceable to a transaction. Where a cost
is not configured, the surface says **COST NOT CONFIGURED** rather than
substituting zero — this was verified specifically for drug and procedure
profitability.

**Dispatch is prepared, not sent.** Kuwick composes the audience and the message
and stops. There is no SMS or email gateway wired, and the screen says so.

**Nothing outstanding that blocks operation.**

---

## 8 · STOCK readiness

**Working end to end:** catalogue, levels, batches, movements, dispensing,
transfers between branches, stock takes with variance and second-approver,
purchase orders, goods receiving, near-expiry, new-medication requests.

Five real workbooks were read. The operating model they describe is now
implemented:

| Workbook behaviour | Kuwick |
|---|---|
| Count sheet has no selling value | Stock Take shows selling value at count time |
| New medication requested by hand, no duplicate check | Request → duplicate guard → approval with an author |
| An approved item could be dispensed before it arrived | Item is inactive until its **first delivery arrives** |
| Bonus quantity priced inconsistently | `MIN(unit price, bonus price)` — and an absent promotion is not a promotion of zero |
| Price changes discovered at invoice time | Price change captured **at goods-in**, with who and when, immutable afterwards |
| Supplier lateness tracked nowhere | Supplier SLA measured from PO to receipt |

**The batch defect (D-114).** The near-expiry reports were showing the delivered
quantity of a batch as the quantity at risk. Kuwick does not track per-batch
remaining quantity — so the number was invented. It is replaced with
`atRiskCeiling = min(received, max(onHand, 0))` and a `fullyConsumed` flag, and
the screen states that it is a ceiling. A fully-dispensed batch is no longer
reported as expiring stock.

**Costing limitation, stated on the surface:** Kuwick values stock at last
purchase price, not weighted average. This is visible where it matters and is
not silently applied to profitability.

**Ready for daily operation and for buying.** The gap that previously kept Stock
out of production — supplier invoices and payables — closed this pass.

---

## 9 · PANEL readiness

Nine of thirteen gaps from the panel workbook audit closed this pass.

| Gap | Status |
|---|---|
| G-1 fee direction | **Closed** — D-112, migrated, tested |
| G-2 payment terms | **Closed** — range, working days, anchor |
| G-3 overdue | **Closed** — derived from terms, not typed |
| G-4 re-claim deadline | **Closed** — configured, never invented |
| G-5 self-pay route | **Closed** — rejected claim → patient invoice |
| G-6 rejection taxonomy | **Closed** |
| G-10 rejection-rate KPI | **Closed** |
| G-12 importer | **Closed** — D-115 |
| G-13 billed vs claimed | **Closed** — D-113 |
| G-7, G-8, G-9, G-11 | Open — reporting conveniences, none blocking |

**What the importer does and refuses to do.** Dry run by default. All-or-nothing:
a file with any problem imports nothing, even when told to commit. Idempotent by
claim number scoped to panel — re-running the same file imports nothing rather
than doubling the receivable. Nothing is invented: fee treatment comes from the
panel's configuration, not from the file. Every imported row is traceable to a
named `ClaimImportBatch`. A corrected re-upload imports only the new rows.

**The money model.** `panel-money.ts` answers four separate questions and never
conflates them: what was *billed* to panels versus what was *claimed*
(CLAIMED / UNCLAIMED / UNDER_CLAIMED / OVER_CLAIMED); whether the fee is a *cost*
(only `WITHHELD_FROM_CLAIM` is); what the bank *evidence* says about each claim
(TAKEN / NOT_TAKEN / OVERPAID / PENDING / NOT_PAID / INCONCLUSIVE /
NOT_APPLICABLE); and whether a remittance actually disagrees with the
withholding — with an `applicable` flag, so a remittance keyed net is not
reported as a discrepancy.

**Conditional on one thing:** a panel whose fee direction nobody has stated sits
in `UNCONFIGURED`. Kuwick excludes it from the fee cost **and counts it**, so it
cannot hide — the UAT seed carries one deliberately (1 withheld, 2 no-fee, 1
unconfigured) so the behaviour is visible on screen. Resolving it is an owner
answer, not a code change, and it has to happen before the cutover import,
because an import stamps each claim from the panel's configuration at the time.

---

## 10 · HR readiness

**Working:** employee directory with completeness scoring, roster, timesheet,
leave, benefits, incentives — all readable, filterable, and correct.

**Not working:** an employee cannot be created or edited from Admin. Leave policy
cannot be configured from Admin. Attendance cannot be corrected from Admin.

Each of those is a form over an endpoint that already exists. That is not an
excuse — it is the exact size of the remaining work, and it is why HR is
conditional rather than ready.

---

## 11 · PAYROLL readiness

This is the domain the programme improved most and the only one that is still
**not production ready**. Both statements are true and neither cancels the other.

**What was built:** the EPF Third Schedule band table with the band-ceiling rule;
SOCSO First and Second Category; EIS; the age-60 branch; the RM5,000 employer-rate
step; per-component statutory treatment (what is EPF wages, what is SOCSO wages);
Ordinary Rate of Pay with the clinic's own divisors (26 for OT, 31 for unpaid
leave, 7.5 hours a day); four overtime tiers; typed payroll inputs with an actor
and a timestamp; and a payslip that prints what is true about itself (D-116).

**35 of 35 figures lifted from the clinic's two workbooks reconcile exactly.**

**Why it still cannot pay anyone — five named blockers:**

1. **The statutory tables are `CORROBORATED`, not `VERIFIED`.** `kwsp.gov.my`,
   `perkeso.gov.my` and `hasil.gov.my` are all unreachable from this environment
   (HTTP 000). No rate in this system has been checked against the authority that
   publishes it. A payroll run **cannot be approved** against a non-`VERIFIED`
   rate set — that is enforced, not documented.
2. **There is no PCB engine.** Neither does the clinic's workbook have one — PCB
   is typed in by hand there. Kuwick does not calculate it either, and **says so**
   as a blocking exception per employee. It was not guessed.
3. **No bank payment file.**
4. **No statutory output files** (EPF/SOCSO/EIS/PCB submission formats).
5. **No employing-legal-entity model** — the two workbooks carry two different
   company names and Kuwick cannot represent that.

Two further differences are business-rule gaps rather than defects: the clinic
pays on three dates per period (Kuwick produces one run), and the HRD levy has no
employer-cost line.

**The NOT READY banner stays on the payroll screen.** It comes off when someone
with access to the official schedules verifies the seeded tables and a PCB rule
set exists.

---

## 12 · FINANCE readiness

**Working end to end:** payments as their own records (D-106), reversals, day-end
counting and closing with a real cash variance, service tax on the patient's
portion by default (D-107), receivables, profitability with COST NOT CONFIGURED
honesty, supplier payables (invoices, payments, allocations, terms, credit
limits, three-way match, disputes), and panel money.

**The payables model refuses to lie in five specific ways**, each an integration
test: it derives the due date from the supplier's term and refuses to invent one
when there is none; it refuses the same invoice number twice for one supplier; it
derives what is owed from allocations rather than a typed column; a payment must
equal what it says it settled and cannot overpay; and `PAID` cannot be declared by
hand — it is what the allocations say.

**Blockers:** credit notes can be listed but not created from Admin; there is no
invoice detail screen. e-Invoice (LHDN) and debit notes do not exist and are
labelled as absent rather than implied.

---

## 13 · Cross-module integration results

The programme's real test was whether the modules agree with each other.

| Chain | Result |
|---|---|
| Visit → invoice → payment → day-end | ✅ Cash counted at day-end reconciles to payments recorded; a seeded variance appears as a variance, not as a silent adjustment |
| Invoice → panel claim → remittance → Finance | ✅ Money billed to a panel that was never claimed is found and aged from settlement, not from invoice date |
| Rejected claim → patient invoice | ✅ The money returns to "never claimed" rather than vanishing |
| PO → goods receiving → stock level → item activation | ✅ An approved item activates the moment its first delivery arrives |
| Goods receiving → supplier invoice → payment → payable | ✅ Three-way match; over-allocation refused |
| Stock batch → near-expiry → exposure value | ✅ Fully-consumed batches excluded |
| Payroll input → calculation → payslip | ✅ Blocking exceptions propagate to the run and to the payslip face |
| **Import → panel dashboard → Finance panel money** | ✅ **After a fix.** Imported claims were invisible in Finance because the branch filter ran through an invoice they do not have. Now filtered by `invoice.visit.clinicId OR importBatch.clinicId`, with a regression test named for the defect. |

**The reconciliation identity**, checked live on the seeded clinic and asserted in
both unit and E2E tests:

```
received + outstanding + rejected + writtenOff  =  expectedReceivable + overRecovered
636.00  +   862.60    +  398.00  +    0.00      =     1,887.00        +      9.60
```

CI found the missing `overRecovered` term. It was added to the identity rather
than the assertion being loosened.

---

## 14 · Malaysian statutory sources

Documented in full in `MALAYSIA_PAYROLL_STATUTORY_SOURCES.md`, including the
exact rules implemented and the exact URLs that could not be reached.

| Scheme | Structure | Rate data | Primary-source verified |
|---|---|---|---|
| EPF / KWSP | Third Schedule band table, band-ceiling rule, RM20 / RM100 band widths, 11 % / 9 %, 13 % / 12 % employer step at RM5,000, age-60 branch (0 % / 4 %) | Clinic workbook, corroborated | ❌ **No** |
| SOCSO / PERKESO | First + Second Category band tables | Clinic workbook, corroborated | ❌ **No** |
| EIS / SIP | Band table | Clinic workbook, corroborated | ❌ **No** |
| PCB / MTD | Inputs modelled; **no calculation** | None | ❌ **No — and deliberately not guessed** |

`kwsp.gov.my`, `perkeso.gov.my` and `hasil.gov.my` return HTTP 000 from this
environment's egress policy. The response was architectural: every rate set
carries `verificationStatus`, `verifiedBy`, `verifiedAt` and `sourceUrl`; the
seeds ship `CORROBORATED`; approval is blocked below `VERIFIED`; and marking a set
`VERIFIED` is a permissioned, audited act by a person who has opened the official
schedule.

**No statutory compliance is claimed anywhere that has not been verified.**

---

## 15 · Excel payroll audit findings

Twelve differences were found between the two workbooks and Kuwick, classified in
`HR_PAYROLL_RECONCILIATION.md` §4. Summarised by class:

- **Excel errors, not reproduced (5):** a totals row that sums rows 5–20 for
  statutory contributions while basic pay sums 5–21, so **one employee was
  silently missing from every contribution total**; a net-pay formula that omits
  zakat; a "total earning" that omits allowances, bonus, incentives and other
  claims; a second net-pay formula that omits three deductions; and locale-
  ambiguous locum dates.
- **Excel workarounds (1):** employee SOCSO typed by hand while employer SOCSO is
  a `VLOOKUP`. In Kuwick both come from the same lookup and cannot disagree.
- **Outdated / non-compliant rule (1):** allowance, attendance and commission
  carry no EPF in the workbook. Commission is not on the EPF Act's closed list of
  exclusions. Kuwick defaults them to EPF-liable and makes exempting one a dated,
  audited configuration choice.
- **Insufficient data (2):** PCB has no formula anywhere in either workbook; and
  two different company names appear across the two files with no legal-entity
  model in Kuwick to hold them.
- **Different business rules (3):** three payment dates per period; variable pay
  earned one month and paid the next; HRD levy at 1 % of basic.

**No code was modified to match an incorrect spreadsheet.** D-4 through D-8 are
arithmetic errors in the workbook; Kuwick does the correct thing and the
difference is recorded rather than reproduced.

---

## 16 · Excel ↔ Kuwick reconciliation

**35 of 35 assertions pass**, and they are executable — `payroll-calculation.spec.ts`
runs them in CI. If the engine drifts from the spreadsheet, the build fails.

Reconciled: EPF employee and employer on five real wages; SOCSO and EIS on two;
the three wage bases (overtime in SOCSO/EIS but not EPF; unpaid leave reducing
all three; mileage in none); the ORP divisors and rounding order; four overtime
tiers; and unpaid leave on RM1,800 for one day.

The row that proves the point: wage RM1,451.61. Naïve `× 11 %` gives RM159.68 —
**which is what Kuwick returned before this programme.** The Third Schedule gives
RM161, because the wage sits in band 1,440.01–1,460.00 and the contribution is
computed on the ceiling.

**What the reconciliation does not cover, stated plainly:** PCB is not reconciled
because neither system calculates it; the tables are corroborated rather than
verified; only single-employee arithmetic is reconciled, because the workbook's
own totals row is provably wrong; and bonus, zakat and the 9 % EPF election are
implemented and unit-tested but appear in neither month of real data.

---

## 17 · Financial, stock and payroll invariants

Each is a pure function with its own unit tests, so it can be reasoned about
without a database.

**Financial** (`financial-invariants.ts`, 39 tests)
`received + outstanding + rejected + writtenOff = expectedReceivable + overRecovered`,
per claim and rolled up. Over-recovery is `max(claimedBack − expected, 0)` where
`claimedBack = max(approved if adjudicated else 0, received)` — it is a real
state, not an error swallowed into the receivable.

**Panel money** (`panel-money.ts`, 22 tests)
Billed and claimed are separate numbers. The fee is a cost **only** under
`WITHHELD_FROM_CLAIM`. An unresolved fee direction is excluded from the cost
**and counted** — never assumed zero. A remittance keyed net is not a discrepancy.

**Payables** (`supplier-payables.ts`)
Outstanding is derived from allocations. An allocation cannot exceed the invoice.
`PAID` is a consequence, never a declaration. A missing supplier term produces a
named exception, not a guessed due date.

**Stock** (`procurement-pricing.ts`, `batch-exposure.ts`, 7 tests)
Unit cost is `MIN(unit, bonus)`; an absent promotion is not a zero price. Batch
exposure is a **ceiling** (`min(received, max(onHand,0))`), and it says so.

**Payroll** (`payroll-calculation.ts`)
Contributions come from band lookup on the band ceiling, never from a percentage.
A component's statutory treatment is explicit per scheme. A missing PCB is a
blocking exception, never a zero. A run cannot be approved against a
non-`VERIFIED` rate set.

**The four kinds of number.** `MANAGEMENT_SOURCE_OF_TRUTH.md` registers every
number in the management system as exactly one of AUTHORITATIVE, DERIVED, MIRROR
or SNAPSHOT. A number is exactly one kind. That register is what made the panel
fee defect findable: `expectedReceivable` was declared DERIVED, and the derivation
was backwards.

---

## 18 · Security, RLS and RBAC assessment

Measured against the live database on this branch:

| Property | Measured |
|---|---|
| Tables in `public` (excl. migrations) | **140** |
| Tables with row-level security **enabled** | **134** |
| Of those, with `FORCE ROW LEVEL SECURITY` | **134 / 134** |
| Row-level security policies | **152** |
| Application role `kuwick_app` is superuser | **No** |
| Application role has `BYPASSRLS` | **No** |
| Tables with RLS enabled but not forced | **None** |

**The six tables without RLS**, and why each is correct: `platform_admins`,
`platform_settings`, `subscription_plans`, `default_document_templates`,
`default_panel_clinics`, `default_procedures`. All six are platform-global
reference or control data that is deliberately not tenant-scoped. No tenant
business data sits outside RLS.

**Audit logs are inside RLS** (D-111) — one clinic cannot read another's audit
trail, which was true of the data but not of its history before this programme.

**Authentication and tenant binding are global.** `TenantContextMiddleware` is
applied to every route and verifies the JWT, excluding only `health`, the
login/refresh routes themselves, the platform-admin routes (guarded separately by
`PlatformAuthGuard`, because a platform token carries no tenant claim) and the
public booking routes. No authenticated request reaches a service without a
tenant.

**RBAC — and the honest gap in it.** There are 61 named permissions.
`withAdminTx(prisma, permission, fn)` checks the permission, sets the tenant and
writes an audit row in one transaction, and **21 services use it — including
every module built or reworked in this programme**: finance (payments, day-end,
tax, credit notes, payables), panel (config, workspace, import), stock (admin,
takes, transfers), workforce (employee, leave, attendance, incentive, payroll),
analytics, and the new-item request.

**It is not universal.** Ten of the eleven pre-existing `inventory/*` services —
items, categories, suppliers, purchase orders, goods receiving, procurement
requests, panel pricing, age/dosage, CSV import and stock levels — write through
`TENANT_SCOPED_PRISMA` without going through `withAdminTx`, and their controllers
carry no per-endpoint permission decorator. `new-item-request.service.ts`, built
this pass, does.

What that does and does not mean:

- **Tenant isolation is not affected.** Those services use the tenant-scoped
  client, so RLS applies to every statement they issue. One clinic still cannot
  see or write another's inventory. This was verified by the RLS integration
  tests, which run as the non-superuser role.
- **What is missing is finer-grained authorisation and the audit row.** Any
  authenticated user of a clinic can call those inventory endpoints, and the
  writes leave no entry in the audit log. A receptionist who can sign in can
  create an item or edit a supplier.

This is a pre-existing gap that this programme did not introduce and did not
close. It is listed as an unresolved limitation (§24) rather than described as
solved.

**Enforcement is tested, not asserted:** 19 integration tests across
`rls-enforcement.e2e-spec.ts` and `tenant-isolation.e2e-spec.ts` run against real
PostgreSQL as the non-superuser role. `panel-money.e2e-spec.ts` includes a
cross-tenant test ("another clinic's panel money is invisible").

---

## 19 · Test counts

Measured on `ea7b1f2`.

| Suite | Runner | Suites | Tests | Result |
|---|---|--:|--:|---|
| API unit | jest | 105 | **2,286** | ✅ all pass |
| API integration (real PostgreSQL, non-superuser role) | jest | 16 | **165** | ✅ all pass |
| Web unit | vitest | 92 | **1,643** | ✅ all pass |
| E2E golden path | Playwright | 15 specs | — | see §20 |

**Total unit + integration: 4,094 tests.**

Locally on the same commit: `npx tsc --noEmit` clean in both `apps/api` and
`apps/web`, and `npm run build --workspace=apps/web` clean.

New in this programme: panel money 22, financial invariants 39, claim import CSV
18, batch exposure 7, payslip 18, plus the integration specs
`panel-money.e2e-spec.ts` (10), `panel-claim-import.e2e-spec.ts` (10),
`supplier-payables.e2e-spec.ts` (8) and `stock-operating-model.e2e-spec.ts` (7).

**No test was weakened, skipped or deleted to obtain a pass.** The one assertion
that changed — the panel reconciliation identity in `admin-panel.spec.ts` — gained
a term because the identity was incomplete, and the identity remains exact.

---

## 20 · CI result

**GREEN.** Run [219](https://github.com/redhahamid/KUWICK-2.0/actions/runs/33423266986)
on `ea7b1f2`, `conclusion: success`. Both jobs passed:

| Job | Result | Duration |
|---|---|---|
| `types + unit suites` | ✅ success | 7m 56s |
| `golden path (E2E)` | ✅ success | ~11m |

Every step in job 1 passed in order: provision the non-superuser role, apply
migrations, grant on the migrated schema, API typecheck, web typecheck, API unit
suite, web unit suite, **API integration suite against real PostgreSQL as the
non-superuser role**. Job 2 seeded seven fixture sets, built API and web, and ran
the Playwright suite over `e2e/`.

**This did not come easily, and the report should say so.** Four consecutive
commits on this branch were red before it. The failure was real, not flaky:
`admin-panel.spec.ts:42` was off by exactly RM9.60, and the cause was that the
panel reconciliation identity omitted its over-recovery term. The fix was to add
the term to `financial-invariants.ts`, the dashboard tile and the E2E assertion —
so the identity stayed exact — rather than to loosen the assertion. **CI found a
correctness defect that 4,094 unit and integration tests did not.**

One earlier run, on `fbc29e3`, shows `cancelled`: it was superseded by the next
push while still in flight. It is reported here as cancelled rather than counted
as a pass, because nobody observed it finish.

Note on the SHA: run 219 is the last run over the programme's **application
code**. The commit that adds this report changes documentation only — no file
under `apps/` — so the green above describes the code as it stands on this
branch. Its own CI run is reported to the owner separately rather than assumed.

---

## 21 · Screenshot index

**277 screenshots** committed on this branch, plus 6 capture manifests and 2
index READMEs, under `docs/screenshots/admin/`.

| Set | Count | Path | Contents |
|---|--:|---|---|
| Full UAT | 141 | `full-uat/` | Every Admin surface: Operation, Stock, Panel, HR, Finance; 5 cross-module workflow sequences; 9 named screens at 3 widths |
| Management completion | 24 | `management-completion/` | Shots 90–113: this programme's new surfaces |
| Programme | 5 | `programme/` | Owner UAT boards |
| Earlier passes | 107 | `admin/` | Appointment, booking and integration passes |

The management-completion set, in capture order:

| # | Shot | # | Shot |
|--:|---|--:|---|
| 90 | Finance → panel money, never claimed | 102 | Panel reconciliation, rejection rate |
| 91 | Finance → panel money by panel | 103 | Panel import, empty |
| 92 | Finance → fee exceptions | 104 | Panel import, file with problems |
| 93 | Finance → panel receipts | 105 | Panel import, dry run |
| 94 | Payables by supplier | 106 | Panel import, committed |
| 95 | Payables invoices | 107 | Panel money after import |
| 96 | Payables payments made | 108 | Stock new-item requests |
| 97 | Payables pay modal | 109 | Stock duplicate guard |
| 98 | Payables edit-terms modal | 110 | Stock near-expiry, at risk |
| 99 | Panel configuration, fee treatment | 111 | Stock take, selling value |
| 100 | Panel work queue, rejections | 112 | HR payroll run |
| 101 | Panel charge-to-patient modal | 113 | HR payslip |

Manifest: `management-completion/07-management-completion.json` — 24 captured,
**0 failures**.

**Every screenshot uses synthetic fictional data.** No patient name, staff name,
IC number, bank detail, claim identifier or supplier-sensitive value from the
owner's workbooks appears in any image.

---

## 22 · Replacement matrix — what can be retired

Full detail in `MANAGEMENT_SYSTEM_REPLACEMENT_MATRIX.md`. **Six of the nine.**

| Tool | Retire? | What stands in the way |
|---|---|---|
| **Inventory count sheet** | ✅ **Yes** | Nothing. Keep the paper only as a printable walk-round list. |
| **List new medication** | ✅ **Yes** | Nothing. |
| **Que order medication** | ✅ **Yes** | Nothing — all four gaps closed. |
| **Consumable que order** | ✅ **Yes** | Nothing — same chain. |
| **Medications payable listing** | ✅ **Yes, once open invoices are entered** | No importer; ~30 open invoices are typed in. Ask for an importer if there are hundreds. |
| **Panel claim workbook** | ✅ **Yes, in sequence** | Follow the cutover in `MIGRATION_AND_IMPORT_SAFETY.md` §6. Every panel's fee direction needs an owner answer *before* the import runs. |
| **Hijraa Admin** | ⚠️ **Mostly** | Employee editing, credit-note creation, raise-transfer. |
| **Payroll listing Excel** | ❌ **No** | Payment-date split, HRD levy, legal entity. |
| **AAS payroll workbook** | ❌ **No** | PCB has no engine; tables are `CORROBORATED`, not `VERIFIED`. |

---

## 23 · Exact remaining manual processes

Things a clinic on this branch still does outside Kuwick, or by hand inside it:

1. **PCB is typed in per employee, per run.** Kuwick records the actor and
   timestamp and blocks approval until every employee has one. This is what the
   clinic does today; it is now audited.
2. **Payroll is calculated in Kuwick and paid from the workbook** — no bank file,
   no statutory submission files.
3. **Employees are created and edited in Hijraa Admin**, then read in Kuwick.
4. **Credit notes are created in Hijraa Admin**, then listed in Kuwick.
5. **Inter-branch transfer requests are raised outside Kuwick** and received in it.
6. **Open supplier invoices are typed in once** at cutover (no importer).
7. **Opening stock is typed in once** at cutover (no importer).
8. **Remittance advice is read by a person** and entered. Kuwick reads no bank
   file or statement, and the screen says so.
9. **Marketing dispatch is prepared in Kuwick and sent elsewhere** — no gateway.
10. **Leave policy and attendance corrections** are configured outside Admin.

---

## 24 · Exact unresolved limitations

1. **No statutory rate has been verified against its publishing authority.** The
   environment cannot reach KWSP, PERKESO or LHDN. This is the single largest
   caveat in the system.
2. **No PCB engine exists.** Deliberate — it was not guessed.
3. **Stock is valued at last purchase price, not weighted average.** Visible on
   the surfaces that use it.
4. **Batch remaining quantity is not tracked**, so expiry exposure is a stated
   ceiling rather than an exact figure (D-114).
5. **A panel whose fee direction nobody has stated stays `UNCONFIGURED`.**
   Excluded from the fee cost and counted — it cannot hide, but it is not
   resolved, and only the owner can resolve it.
6. **Four panel gaps remain open** (G-7, G-8, G-9, G-11) — reporting conveniences.
7. **No e-Invoice (LHDN) and no debit notes.** Absent and labelled absent.
8. **No employing-legal-entity model**, so two company names cannot be held.
9. **Three payment dates per payroll period** are not modelled; Kuwick produces
   one run.
10. **Variable pay earned-one-month-paid-the-next** is carried in the data model
    (`PayrollInputEntry.earnedPeriod`) but no screen surfaces it.
11. **HRD levy** has no employer-cost line.
12. **Ten pre-existing `inventory/*` services write without a permission check
    and without an audit row** (§18). Tenant isolation is unaffected — they use
    the tenant-scoped client, so RLS applies — but any authenticated user of a
    clinic can create an item or edit a supplier, and the write is not audited.
    Pre-existing; not introduced and not closed by this programme.
13. **The E2E suite runs in CI only.** Playwright cannot launch locally in this
    environment (`chrome-headless-shell` is absent); the visual-UAT harness works
    because it drives `playwright-core` at the pre-installed Chromium directly.

---

## 25 · Per-domain readiness verdict

| Domain | Verdict | Exact condition or blocker |
|---|---|---|
| **OPERATION** | ✅ **PRODUCTION READY** | — |
| **STOCK** | ✅ **PRODUCTION READY** | The buying chain that previously held it back — supplier invoices, payables, payments — landed this pass. Two limitations stay visible on the surfaces that use them: last-purchase-price valuation, and expiry exposure as a ceiling. |
| **PANEL** | ⚠️ **CONDITIONALLY READY** | **Condition:** the owner states the fee direction for every panel still `UNCONFIGURED` — configuration must precede import, because an import stamps each claim from the panel's configuration — and the cutover follows `MIGRATION_AND_IMPORT_SAFETY.md` §6 — import dry-run, reconcile the dry-run totals against the workbook, then commit. The importer, the money model and the fee correction are all in place; what remains is an owner answer and a sequence. |
| **HR** | ⚠️ **CONDITIONALLY READY** | **Condition:** employees continue to be created and edited in Hijraa Admin. Kuwick reads HR correctly and completely; it cannot yet maintain it. Also outstanding: leave-policy configuration and attendance correction. |
| **PAYROLL** | ❌ **NOT PRODUCTION READY** | **Blockers:** (1) statutory tables are `CORROBORATED`, never verified against KWSP/PERKESO — approval is blocked below `VERIFIED`; (2) no PCB engine; (3) no bank payment file; (4) no statutory submission files; (5) no employing-legal-entity model. The arithmetic is correct and reconciles 35/35 against the clinic's own workbooks — but correct arithmetic on unverified tables is not a payroll system. |
| **FINANCE** | ⚠️ **CONDITIONALLY READY** | **Condition:** credit notes continue to be created in Hijraa Admin (Kuwick lists them but cannot issue one), and there is no invoice detail screen. Payments, day-end, tax, receivables, profitability, payables and panel money are all complete and integration-tested. |

---

## 26 · Final recommendation

## ✅ READY FOR OWNER UAT

**Scope of that UAT: Operation, Stock, Panel and Finance in full; HR read-only.**

**Payroll is explicitly excluded from this UAT.** Not because it is unfinished
work to be hidden, but because Kuwick will refuse to approve a payroll run
against statutory tables nobody has verified — and that refusal is the correct
behaviour, not a bug to work around during UAT. Payroll returns to UAT scope when
someone with access to `kwsp.gov.my` and `perkeso.gov.my` has verified the seeded
tables and a PCB rule set exists.

The acceptance question, answered domain by domain:

> *Can a real clinic reasonably operate these management workflows in Kuwick
> without returning to the old systems?*

- **Operation** — yes.
- **Stock** — yes, including buying. Five workbooks retire.
- **Panel** — yes, after the cutover sequence and one owner answer. The workbook
  retires.
- **Finance** — yes for everything except issuing a credit note.
- **HR** — yes for reading; no for maintaining.
- **Payroll** — no, and the report says so in five specific places rather than
  once in general.

**This branch is not merged and no pull request has been opened.**

---

## Appendix · Decisions recorded in this programme

| ID | Decision |
|---|---|
| D-106 | Money received becomes its own record |
| D-107 | Service tax lands on the patient's portion by default |
| D-108 | A typed count changes no stock until somebody else approves it |
| D-109 | Stock that never arrived stays missing |
| D-110 | Payroll refuses to print a statutory figure it cannot stand behind |
| D-111 | Audit logs come inside row-level security |
| D-112 | The panel fee is WITHHELD, not added — D-041 superseded on the evidence of 2,615 bank credits |
| D-113 | Panel money is reported in Finance, and Kuwick does not invent a first-submission deadline |
| D-114 | A batch's remaining quantity does not exist, so the expiry reports stop pretending it does |
| D-115 | A claim may have no invoice, if and only if it came from a named import |
| D-116 | The payslip prints what is true about itself, including that it may not be a payslip |

## Appendix · Documents produced

`MANAGEMENT_SOURCE_OF_TRUTH.md` · `MIGRATION_AND_IMPORT_SAFETY.md` ·
`MANAGEMENT_UAT_FLOWS.md` · `MANAGEMENT_SYSTEM_GAP_AUDIT.md` ·
`MANAGEMENT_SYSTEM_REPLACEMENT_MATRIX.md` · `PANEL_LEGACY_WORKFLOW_AUDIT.md` ·
`PANEL_FEE_DIRECTION_CORRECTION.md` · `STOCK_LEGACY_WORKFLOW_AUDIT.md` ·
`HR_PAYROLL_EXCEL_REFERENCE_AUDIT.md` · `HR_PAYROLL_RECONCILIATION.md` ·
`MALAYSIA_PAYROLL_STATUTORY_SOURCES.md` · `ADMIN_VISUAL_UAT_INVENTORY.md` ·
`ADMIN_INTEGRATION_PASS.md` · `ADMIN_SYSTEM_PRODUCTION_READINESS.md`

**Confidentiality.** No workbook was committed to Git, copied into `docs/`,
uploaded anywhere, or reproduced in a screenshot. Every finding above is
abstracted and redacted: structures, formulas, rules and error classes, never
names, IC numbers, bank details or claim identifiers. All UAT and screenshot data
is synthetic.
