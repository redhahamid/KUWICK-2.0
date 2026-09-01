# Malaysia HR & Payroll — current state audit (Phase 0)

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Audited:** 1 September 2026
**Method:** read from the code and the migrations, not from memory of them. Every
claim carries a file and, where it matters, a line number.

**Nothing in this document is an implementation.** Phase 0 establishes what is
actually there.

---

## 0 · The access position, stated first

Every Tier A statutory authority and every Tier B cross-check product is
unreachable from this environment. Measured, not assumed:

| Host | Result |
|---|---|
| `kwsp.gov.my`, `www.kwsp.gov.my` | **blocked** |
| `perkeso.gov.my`, `www.perkeso.gov.my` | **blocked** |
| `hasil.gov.my`, `www.hasil.gov.my`, `phl.hasil.gov.my` | **blocked** |
| `hrdcorp.gov.my` | **blocked** |
| `jtksm.mohr.gov.my` | **blocked** |
| `payrollpanda.my`, `mysyarikat.com.my`, `talenox.com` | **blocked** |
| `api.github.com` (control) | 200 |

The programme brief's own rule governs the consequence:

> *If official information cannot be accessed: STOP that calculation rule at
> UNVERIFIED. Do not guess. You may continue non-statutory work.*

So **every statutory calculation rule in this system stays UNVERIFIED**, and this
audit does not upgrade a single verification status. What it does instead is
separate the work that is blocked from the work that is not — and the useful
finding is that **the two foundational items are not blocked**.

---

## 1 · Capability classification

Legend: **WORKING** · **PARTIAL** · **BROKEN** · **MISSING** · **UNVERIFIED**
(exists and runs, but its correctness is not established) · **DEAD CODE**
(present, never reached).

### 1.1 Statutory engine

| Capability | State | Evidence |
|---|---|---|
| EPF band lookup, band-ceiling rule | **UNVERIFIED** | `statutory.ts:211` `computeEpf`. Correct *shape* — band table, not percentage. Reconciles 35/35 against the clinic workbooks. Never checked against KWSP |
| EPF age-60 branch | **UNVERIFIED** | `statutory.ts:204` `isOver60`. Cliff, not taper |
| EPF 11%/9% election | **UNVERIFIED** | `statutory.ts:227` — selects between two tables, not a multiplier |
| EPF age-75 boundary | **MISSING** | Only a 60 branch exists |
| EPF citizenship / PR / non-Malaysian | **MISSING** | No nationality-driven branch anywhere in `computeEpf` |
| EPF pre-Aug-1998 membership category | **MISSING** | Not modelled |
| EPF voluntary employee/employer contribution | **MISSING** | Not modelled |
| SOCSO First/Second Category | **UNVERIFIED** | `statutory.ts:241` |
| SOCSO Employment Injury vs Invalidity as separate schemes | **MISSING** | One combined band lookup |
| SOCSO foreign-worker treatment | **MISSING** | Not modelled |
| EIS band lookup + age-60 cessation | **UNVERIFIED** | `statutory.ts:261` |
| **PCB / MTD** | **MISSING, deliberately** | `statutory.ts:299` returns `null` with `PCB_NOT_IMPLEMENTED`. Documented decision, not an oversight |
| **LINDUNG 24 Jam** | **MISSING** | No reference anywhere in the repository |
| **HRD Corp levy** | **MISSING** | No reference anywhere in the repository |
| Rate-set effective dating + verification status | **WORKING** | `StatutoryRuleSet` — `effectiveFrom/To`, `verificationStatus`, `verifiedBy`, `verifiedAt`, `sourceUrl`. Approval blocked below `VERIFIED` |
| Statutory snapshot frozen onto the run | **WORKING** | `PayrollRun.statutorySnapshot` |
| Unknown-age refusal | **WORKING** | Returns `null` with a reason; never assumes under-60. Better than the PayrollPanda behaviour audited |

### 1.2 The payroll run

| Capability | State | Evidence |
|---|---|---|
| Run creation, one per branch per month | **PARTIAL** | `@@unique([tenantId, clinicId, period])` — schema:6911. Off-cycle, bonus, correction and final-pay runs are **unrepresentable** |
| Calculate | **WORKING** | `payroll.service.ts:192` |
| Exception generation | **WORKING** | 8 distinct blocking conditions; deterministic ordering |
| Approval requires zero exceptions | **WORKING** | `payroll.service.ts:609` |
| Separation of duties | **WORKING** | `payroll.service.ts:605` — approver ≠ preparer, owner documented as the exception |
| Lock after approval | **WORKING** | DB trigger refuses recalculation of a locked run |
| Correction by adjustment only | **WORKING** | `PayrollAdjustment` — signed, reasoned, actor-stamped |
| Employee snapshot on the line | **WORKING** | `PayrollLine.employeeSnapshot` |
| ORP divisors frozen on the run | **WORKING** | `orpOvertimeDays` 26, `orpUnpaidLeaveDays` 31, `orpHoursPerDay` 7.5 |
| **Full immutable approved snapshot** | **PARTIAL** | Statutory rules, ORP config and employee identity are frozen. **Inputs, component versions and source references are not.** A reopened run re-derives from current master data |
| **Reopen with before/after diff** | **MISSING** | There is no reopen at all — only adjustment |
| Variance vs previous period | **MISSING** | — |
| Run states | **PARTIAL** | `DRAFT → CALCULATED → APPROVED → PAID / CANCELLED`. No `REVIEW_REQUIRED`, no `READY_FOR_APPROVAL`, no separate payment-file or statutory-output state |

### 1.3 The five named traces

**Trace A — `PayrollInputEntry`, database → API → service → UI**

| Layer | Finding |
|---|---|
| Migration | `20260831064500_payroll_input_entries` — table created, RLS `ENABLE` + `FORCE`, `tenant_isolation` policy, unique on `(tenant, staff, period, componentCode)` |
| Prisma model | Present, well-documented, carries `earnedPeriod`, `createdByStaffId`, `note` |
| Service **read** | `payroll.service.ts:271` — `findMany` during every calculation |
| Service **write** | **NONE** |
| DTO | **NONE** — `apps/api/src/workforce/dto/` has 9 DTOs, none for payroll input |
| Controller route | **NONE** — `workforce.controller.ts` has 24 routes, none reaches it |
| UI | **NONE** — `PayrollPage.tsx` offers create run / calculate / approve / mark paid / adjust |
| Only writers repo-wide | `seed-admin-uat.ts:2249,2258,2267` and `workforce-payroll.e2e-spec.ts:333`, both direct Prisma |
| Raw-SQL back door | None — `payroll_input_entries` appears in no application SQL |

**Verdict: DEAD CODE on the write side.** The read path is live and load-bearing.

**Trace B — why PCB approval fails, end to end**

```
computePcb(profile)                         statutory.ts:299
  └─ pcbApplicable !== false  →  cents: null
                                            ↓
payroll.service.ts:427   null PCB + no input entry  →  BLOCKING exception
                                            ↓
payroll.service.ts:609   approve() throws if exceptions.length > 0
```

**Consequence: for any employer with at least one PCB-applicable employee, no
payroll run can reach `APPROVED` through the product.** The intended escape hatch
— key the externally-computed PCB in as a payroll input — is Trace A, and it does
not exist. The only in-product workaround is setting `pcbApplicable = false`
(`upsert-employee.dto.ts:52`), which misrepresents tax status and suppresses the
exception rather than answering it.

**Trace C — Ordinary Rate of Pay**

| Step | Finding |
|---|---|
| `computeBases` computes `ordinaryRateBaseCents` | `payroll-calculation.ts:176` — sums every component whose `liability.ordinaryRateOfPay` is true |
| Consumers of `ordinaryRateBaseCents` | **Zero, repository-wide** |
| What the service actually uses | `payroll.service.ts:339` — `const orpBase = basicCents;` |
| What the service's own comment claims | *"built from the earnings that COUNT toward it — basic and ORP-liable allowances"* |

**Verdict: the comment and the code disagree, and the `ordinaryRateOfPay` flag on
every component is DEAD DATA.** Basic-only may be defensible policy — but that is
an Employment Act question, currently unverifiable, and either way one of the two
must change.

**Trace D — salary history**

| Finding | Evidence |
|---|---|
| `EmployeeProfile.basicSalary` is a single mutable `Decimal?` | schema:6357 |
| No `SalaryRevision` / `SalaryHistory` / `Compensation` model | grep over all 140 models: none |
| Calculation reads it live | `payroll.service.ts` employee query, no date predicate |
| Consequence | Recalculating an **unlocked** past run applies today's salary to that period. Approved runs are protected only because the trigger blocks recalculation |

**Verdict: MISSING.** Effective dating exists for statutory rules and for panel
fee terms — the pattern is already in this codebase — but not for pay.

**Trace E — run uniqueness**

`@@unique([tenantId, clinicId, period])` at schema:6911 (and the identical
constraint on `IncentiveRun` at 6649). One run per branch per calendar month.
The clinic pays on **three dates per period**. Off-cycle bonus, correction and
final-pay runs are all unrepresentable.

**Trace F — YTD**

`grep -rin "ytd|yearToDate|year_to_date"` over `apps/api/src` and
`apps/web/src`: **no matches.** There is no YTD accumulation anywhere. PCB, Form
EA and any mid-year migration all sit on top of it.

### 1.4 Employee master

| Capability | State | Evidence |
|---|---|---|
| Identity, DOB, IC/passport | **WORKING** | Stored; never returned by a non-HR-gated endpoint |
| Statutory identifiers (EPF/SOCSO/tax) | **PARTIAL** | Stored; no format validation; not required before any export |
| Bank details | **PARTIAL** | Stored; **no validation of any kind** |
| Applicability switches | **WORKING** | `epfApplicable`, `socsoApplicable`, `eisApplicable`, `pcbApplicable` |
| EPF employee election | **WORKING** | `epfEmployeeRate` 11 or 9, documented as an election not a multiplier |
| Nationality / residency | **PARTIAL** | `nationality` is free text; **`residentialStatus` does not exist** and nothing branches on either |
| Marital status | **PARTIAL** | Free text; feeds nothing |
| Dependants / children | **MISSING** | — |
| TP3 previous employment | **MISSING** | — |
| TP1 reliefs | **MISSING** | — |
| **Employing legal entity** | **MISSING** | Employment is to `Staff.clinicId` — a *branch* |
| Create / edit from Admin | **PARTIAL** | Endpoint `POST workforce/employees/:staffId` exists and works; **no screen calls it** (`EmployeesPage.tsx` is read-only) |
| Completeness scoring | **WORKING** | On the HR overview |

### 1.5 Pay components

| Capability | State | Evidence |
|---|---|---|
| Liability centralised, not scattered | **WORKING** | `ComponentLiability` — one interface, one table |
| Six independent flags | **WORKING** | `epf`, `socso`, `eis`, `pcb`, `ordinaryRateOfPay`, `additionalRemuneration` |
| Clinic's five status codes mapped | **WORKING** | `LIABILITY_BY_STATUS_CODE` |
| 15 seeded components | **UNVERIFIED** | `DEFAULT_COMPONENT_LIABILITY` — every flag value unverified against any authority |
| **Configurable at runtime** | **MISSING** | Hardcoded in TypeScript. A new allowance needs a deployment |
| Missing flags | **MISSING** | `hrdLiable`, `unpaidLeaveBase` (distinct from ORP), `recurring`, `employerSide`, `taxableBenefit`, `reimbursement`, `prorated`, PCB exemption limit, EA field |
| Unknown component is not silently dropped | **WORKING** | `payroll.service.ts:389` raises an exception |
| `ordinaryRateOfPay` flag | **DEAD DATA** | See Trace C |
| `additionalRemuneration` flag | **DEAD DATA** | Set on BONUS and INCENTIVE, feeds `pcbAdditionalCents`, which no PCB engine consumes |

### 1.6 Upstream integration

| Feed | State | Evidence |
|---|---|---|
| Attendance → approved OT | **PARTIAL** | Read **live** at `payroll.service.ts:257`, not materialised |
| Leave → unpaid days | **PARTIAL** | Read live; unpaid types hardcoded `new Set(['UNPAID'])` at :318 |
| Incentive → payroll | **PARTIAL** | Read live from `IncentiveResult` where the run is APPROVED/PAID |
| Claims → payroll | **MISSING** | No claims module |
| **Source links preserved on the payroll line** | **MISSING** | Nothing records which attendance or leave record produced a figure |

**Architectural note.** Kuwick reads upstream sources *live at calculation time*;
the target architecture in the brief (§G) is
`Attendance → approved OT → Payroll Input`. Live reading has one real advantage —
it cannot double-feed — but it means no reviewable input list, no source
reference, no per-entry actor, and no way to adjust a derived figure without
changing the upstream record.

### 1.7 Outputs

| Capability | State |
|---|---|
| Payslip | **WORKING, guarded** — employer block, employee block, period, earnings, deductions, **employer contributions shown separately**, draft watermark, self-checking net, states when a figure is uncalculated. `payslip.ts`, 18 tests |
| Payslip YTD / OT breakdown / statutory IDs / payment method / version marker | **MISSING** |
| Bank payment file | **MISSING** |
| EPF / SOCSO / EIS / PCB / CP39 exports | **MISSING** |
| Form E / EA | **MISSING** |
| Payroll register, variance, reconciliation reports | **MISSING** |
| **Finance integration** | **MISSING** — payroll computes `employerCostTotal` and `netTotal` and posts **nothing** to Finance. The only `payroll` strings in `apps/api/src/finance/` are three audit action names |

### 1.8 Security

| Capability | State | Evidence |
|---|---|---|
| RLS on every payroll/HR table | **WORKING** | 14 tables, all `ENABLE` + `FORCE` + `tenant_isolation` |
| Every payroll mutation audited | **WORKING** | All go through `withAdminTx` — permission + tenant + audit row in one transaction |
| Branch scoping | **WORKING** | `assertBranchScope`, `admin-actor.ts:68` |
| Permissions defined | **PARTIAL** | 6: `hr.employee.manage`, `hr.attendance.manage`, `hr.leave.approve`, `hr.payroll.view`, `hr.payroll.run`, `hr.payroll.approve` |
| **Salary visibility as its own permission** | **MISSING** — `hr.payroll.view` conflates "see the run" with "see what people earn" |
| **Statutory settings permission** | **MISSING** — `upsertStatutoryRules` reuses `hr.payroll.approve` (`payroll.service.ts:94`), so approving a payroll and rewriting the statutory rate tables are the same right |
| Reopen/correct, bank export, statutory export, report export permissions | **MISSING** |
| **Legal-entity scoping** | **MISSING** — there is no entity to scope to |

### 1.9 Tests

| Suite | Tests | What it covers |
|---|--:|---|
| `payroll-calculation.spec.ts` | 30 | Pure functions: bases, ORP, OT tiers, unpaid leave, payslip assembly |
| `attendance-hours.spec.ts` | 10 | Timesheet aggregation |
| `incentive-calculation.spec.ts` | 15 | Incentive rules |
| `leave-balance.spec.ts` | 11 | Entitlement and balance |
| `workforce-payroll.e2e-spec.ts` | 14 | Run lifecycle against real PostgreSQL as the non-superuser role |
| `payslip.test.ts` (web) | 18 | Payslip rendering and honesty rules |
| **Total** | **98** | |

**The pattern worth naming: the pure functions are correct and well tested; every
defect in this audit is in the service that calls them.** Trace A (no write
path), Trace C (ORP base), proration, salary history, run uniqueness and the
single OT tier are all service-layer or schema-layer, and the 98 tests pass
regardless.

---

## 2 · Summary counts

| Classification | Count |
|---|--:|
| WORKING | 22 |
| PARTIAL | 13 |
| UNVERIFIED | 6 |
| MISSING | 33 |
| DEAD CODE / DEAD DATA | 3 |

The three dead items — the `PayrollInputEntry` write path, the
`ordinaryRateOfPay` flag and the `additionalRemuneration` flag — are all cases of
a correct structure built ahead of the consumer that would use it. That is not
waste: it means the schema work for inputs, ORP and additional remuneration is
already done and the fix is a caller, not a redesign.

---

## 3 · What Phase 0 concludes

1. **The foundations are sound and the gaps are honest.** RLS, audit, separation
   of duties, the lock, unknown-age refusal, the statutory verification gate and
   the payslip honesty rules are all genuinely good, and several are better than
   the audited competitor.
2. **Payroll cannot complete a single run end to end.** Trace A and Trace B
   together mean the product's own escape hatch is missing.
3. **Two structural absences block everything downstream:** no legal employer,
   and no effective-dated salary or immutable input snapshot.
4. **Every statutory rule is UNVERIFIED and must stay that way** until an
   authority is reachable. No status is upgraded by this audit.
5. **The critical path is not blocked by that.** The two items the PayrollPanda
   audit identifies as un-retrofittable — the snapshot decision (K-08) and the
   entity model (K-20) — both carry *"Statutory verification required: NO"*.

Phase 1 takes that split and turns it into a specification.
