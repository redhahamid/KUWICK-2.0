# Malaysia HR & Payroll — Stage 1 + Stage 2 checkpoint report

**Branch:** `claude/kuwick-2-visual-audit-k9uk5z` · **Head:** `049dc9f`
**Not merged. No pull request opened. Stage 3 not begun.**

Answering the 17 points the review asked for, in order.

---

## 1 · Exact migrations

**One migration, additive-first:** `20260901090000_payroll_stage1_stage2` (552 lines).

| Section | What it does | Kind |
|---|---|---|
| 1–8 | Eight new tables | additive |
| 9 | New columns on `employee_profiles`, `payroll_runs`, `payroll_input_entries` | additive |
| 9 | Replace the run's unique index | **constraint-changing** (strictly more permissive) |
| 10 | RLS on all eight new tables | additive |
| 10b | Replace `payroll_runs_locked()` | behaviour change, **narrowly widened** |
| 11 | Backfill | data migration |

**Nothing is dropped.** `employee_profiles.basic_salary` is still present and still read. The one
destructive step in the plan is deliberately not in this migration.

**Applies cleanly from an empty database** — proved by dropping and rebuilding `kuwick_test`, which is
what CI does on every run.

## 2 · Exact schema changes

**Eight new tables:** `legal_employers` · `employee_salaries` · `pay_components` · `payroll_policies` ·
`employee_recurring_items` · `payroll_snapshots` · `payroll_exceptions` · `employee_ytd`.

**Eleven new enums:** `SalaryBasis`, `PayComponentType`, `PayComponentCategory`,
`PayComponentIncludeIn`, `PayComponentCalculationMode`, `ProrationBasis`, `PayrollInputSource`,
`PayrollInputKind`, `PayrollRunType`, `PayrollExceptionSeverity`, `YtdSource`.

**Columns added to existing tables:**

| Table | Columns |
|---|---|
| `employee_profiles` | `legal_employer_id`, `payroll_policy_id`, `residential_status` |
| `payroll_runs` | `legal_employer_id`, `run_type`, `sequence`, `payment_date` |
| `payroll_input_entries` | `source`, `source_record_id`, `kind`, `reason` |

**Integrity that is enforced by the database, not by convention:**

| Guard | What it refuses |
|---|---|
| `payroll_snapshots_no_update` trigger | Any UPDATE or DELETE of a snapshot |
| `pay_components_overtime_not_in_orp_base` | Overtime entering the base that prices overtime |
| `payroll_exceptions_override_is_accountable` | An override without an actor, a reason and a timestamp |
| `payroll_input_entries_derived_has_source` | A derived input that does not name its source record |
| `payroll_input_entries_source_record_key` | The same upstream record materialised twice |
| `employee_salaries_period_ordered` | A salary that ends before it starts |
| `payroll_policies_days_positive` | A divisor of zero |
| `employee_ytd_month_valid` | A month outside 1–12 |

**RLS:** all eight new tables `ENABLE` + `FORCE` + `tenant_isolation`. Tenant coverage is now
**142 of 148 tables**, all 142 forcing. The six without remain the platform-global reference tables.

## 3 · Old versus new calculation read paths

**Deliberately, the calculation still reads the old paths.** Rule 5 said not to change existing payroll
output during a structural migration, and it does not: **no figure any run produces has moved.**

| Concern | Old path | New path | Read by the calculation today? |
|---|---|---|---|
| Salary | `EmployeeProfile.basicSalary` | `EmployeeSalary` resolved by period | **Old.** New path is built, tested and proved at parity |
| Component liability | `DEFAULT_COMPONENT_LIABILITY` constant | `PayComponent` rows | **Old.** Rows seeded to match exactly |
| Exceptions | JSON blob on the run | `PayrollException` rows | **Both.** Blob still written; **the gate now reads the rows** |
| Approval gate | any exception blocks | BLOCKING blocks, WARNING does not | **New** — a specified change, not a silent one |
| Employer | none | `PayrollRun.legalEmployerId` | Stamped, not yet used to scope |
| Snapshot | none | `PayrollSnapshot` on approval | **New** |

**The one intended behaviour change** is the approval gate. Warnings no longer block. That is the whole
reason severities exist — an unapproved-overtime note and an employee with no date of birth are not the
same kind of problem, and treating them alike made runs unapprovable for reasons nobody needed to fix.

**The ORP base, stated plainly.** `computeBases` derives an ordinary-rate base that nothing reads while
the service uses basic salary alone, so the `ordinaryRateOfPay` flag was dead data. It is now live and
configurable — but seeded `includeInOrpBase = true` for **basic pay only**, which reproduces today's
arithmetic exactly. Employment Act s60I defines the ordinary rate statutorily and that definition has not
been read; switching allowances on would have moved every overtime and unpaid-leave figure on a guess.
The question stays open as register **EA-01** and becomes a configuration change.

## 4 · Backfill result and parity evidence

| Backfill | Rows |
|---|--:|
| `legal_employers` (one per tenant) | 82 |
| `employee_profiles.legal_employer_id` | 8 |
| `payroll_runs.legal_employer_id` | 1 |
| `employee_salaries` from `basic_salary` | 6 |
| `employee_salaries` from `hourly_rate` | 1 |
| `payroll_exceptions` from the JSON blob | 5 |

**Salary parity, measured per employee:**

```
parity     | count
-----------+------
MATCH      |     7
BOTH-NULL  |     1
MISMATCH   |     0
```

Seven employees resolve to exactly the figure on their profile, basis and all. The eighth has neither a
salary nor an hourly rate, correctly produces no salary row, and still raises the existing "no salary"
blocking exception.

## 5 · Payroll input workflow

`apps/web/src/admin/hr/PayrollInputsDrawer.tsx`, opened from the payroll run.

**The flow:** Payroll run → *Payroll inputs* → *Add input* → choose component → amount → recurring or
additional → optional reason → Save. The grid then shows the row with **who entered it, when, from what
source, and why**.

**What it refuses:** an unknown component (400 with the reason); a negative amount ("the component
carries the sign, not the number"); any edit once the period is approved; editing a figure that came
from attendance, leave or an incentive — those are read-only with "from *source*" in place of the
Remove button, because retyping an overtime amount in payroll would leave the attendance record and the
payslip disagreeing with nothing to say which is right.

**Materialisation** (`POST /workforce/payroll/inputs/materialise`) pulls approved upstream figures in
with a `sourceRecordId`. Running it twice creates nothing the second time — proved by test, and enforced
by a partial unique index underneath.

## 6 · Legal employer workflow

`apps/web/src/admin/hr/LegalEmployersPage.tsx`, at `/admin/hr/employers`.

Lists every employer with its registration, EPF, SOCSO and LHDN numbers, its employee count, and a
**"Could it file?"** column naming exactly what is still missing. Creating or editing needs
`hr.statutory.manage`. Assigning an employee is `PATCH /workforce/employees/:staffId/legal-employer`,
and it **refuses** once that employee appears on an approved run — their contributions have been
reported under the employer that was on the run.

The same page carries the **pay-component catalogue** with all twelve attributes visible, including the
three the audited competitor has no equivalent for (`hrdLiable`, OT base, unpaid-leave base), and a
banner stating on the page that no flag has been checked against any authority.

## 7 · Salary history workflow

`GET /workforce/employees/:staffId/salary` → history, newest first, each row with the actor, the
timestamp and the reason. `POST` records a new rate from a date: it **closes the open row** at the day
before rather than editing it, so the old rate stays true of its own months.

`GET …/salary/resolve?period=YYYY-MM-DD` answers what a period resolves to **and why** — including
"salary changed during this period; 2 rates overlap it".

**It refuses** two rows starting the same day, a rate earlier than the current one, and any change
covering a period already approved.

## 8 · Snapshot and reopen workflow

**On approval** the run's employer, period, run type, payment date, per-employee salary version and
resolved amount, every input with its source, component versions, statutory rule-set version and bases,
derived amounts and totals are frozen into `PayrollSnapshot` and hashed (SHA-256 over canonical JSON,
key order irrelevant).

**Reopen** needs `hr.payroll.reopen` and a reason of at least five characters. The prior snapshot is
**preserved**; the run returns to CALCULATED; the next approval writes version *n+1*.

**`GET …/candidate-diff`** shows what a recalculation *would* change against the approved snapshot —
per employee, per field, with the delta — before anybody commits. The audited competitor warns that
figures may change and then shows nobody what did.

**The database backs this up.** Snapshots refuse UPDATE and DELETE by trigger, and the run lock now
permits a reopen **only when a snapshot already exists**: you may unlock only what has been frozen.

## 9 · Exception centre

`apps/web/src/admin/hr/PayrollExceptionCentre.tsx`, mounted on the run.

Eleven catalogued exception types, each carrying a **cause**, a **consequence** and a **remedy** — the
shape of the one genuinely excellent warning found in the competitor audit, which almost none of its
others share. Severities: BLOCKING (gates approval) · WARNING (visible, passable with a recorded reason)
· INFO.

Six are permanently non-overridable — `NO_SALARY`, `NO_DOB`, `NO_LEGAL_EMPLOYER`, `PCB_MISSING`,
`NEGATIVE_NET`, `UNKNOWN_COMPONENT` — and a test asserts that.

## 10 · Approval and variance workflow

**Approval is never one click.** The confirmation restates employer, period, headcount, gross, net,
employer cost, blocking count, warning count, flags anyone beyond the variance threshold, warns if the
statutory figures are unverified, and says that approving writes an immutable snapshot. Separation of
duties (approver ≠ preparer, owner documented as the exception) is unchanged.

**Variance** compares every employee's net pay against the previous period of the same type, classifying
each as NEW / LEFT / UNCHANGED / MOVED / MATERIAL, with headcount, joiners, leavers and total deltas.
The default threshold is 20 % and it is a product default, not a rule.

## 11 · RBAC matrix and enforcement

Six permissions became twelve. **67 permissions in total.**

| Permission | New? | Guards |
|---|---|---|
| `hr.view` | | Directory reads |
| `hr.employee.manage` | | Employee upsert, employer assignment, salary recording |
| `hr.attendance.manage` | | Attendance |
| `hr.leave.approve` | | Leave |
| `hr.payroll.view` | | Runs, inputs, exceptions, variance, snapshots |
| `hr.payroll.run` | | Calculate, payroll input writes, materialisation |
| `hr.payroll.approve` | | Approve, adjust, override an exception |
| **`hr.salary.view`** | ✅ | **Individual pay.** Was conflated with `hr.payroll.view` |
| **`hr.payroll.reopen`** | ✅ | Reopen an approved run |
| **`hr.payroll.export.bank`** | ✅ | Reserved — no exporter yet |
| **`hr.payroll.export.statutory`** | ✅ | Reserved — no exporter yet |
| **`hr.payroll.export.reports`** | ✅ | Reserved — no exporter yet |
| **`hr.statutory.manage`** | ✅ | **Rate tables, pay components, policies, employers** |

**The two conflations removed:** `hr.payroll.view` meant both "see that a run exists" and "see what
colleagues earn"; `hr.payroll.approve` *also* granted rewriting the statutory rate tables, so whoever
signed off a payroll could change the EPF schedule it was computed against.

Every write goes through `withAdminTx(prisma, permission, fn)` — permission, tenant and audit row in one
transaction. HR_STAFF still holds no payroll or salary right. Tenant isolation is tested with a
cross-tenant read returning nothing.

## 12 · Audit events

**Sixteen new audit actions**, each with actor, timestamp and before/after:

`legalEmployer.created` · `legalEmployer.updated` · `employee.employerAssigned` ·
`employeeSalary.recorded` · `payComponent.seeded` · `payComponent.created` · `payComponent.updated` ·
`payrollPolicy.created` · `payrollPolicy.updated` · `payrollInput.created` · `payrollInput.updated` ·
`payrollInput.deleted` · `payrollInput.materialised` · `payrollException.overridden` ·
`payrollSnapshot.created` · `payroll.reopened`

Reopen and exception-override both carry a mandatory `reason`.

## 13 · Test counts

| Suite | Before | After | New |
|---|--:|--:|--:|
| API unit | 2,286 | **2,334** | 48 |
| API integration | 165 | **186** | 21 |
| Web unit | 1,643 | **1,643** | 0 |
| **Total** | 4,094 | **4,163** | **69** |

New pure-function specs: `salary-resolution.spec.ts` (11), `payroll-snapshot.spec.ts` (12),
`payroll-exception.spec.ts` (13), `payroll-variance.spec.ts` (12).
New integration spec: `payroll-stage2.e2e-spec.ts` (21), against real PostgreSQL as the non-superuser
role.

Typechecks clean in both workspaces; web build clean.

## 14 · CI result

**Job 1 — `types + unit suites`: ✅ SUCCESS** on `b487a4c`, every step:
provision the non-superuser role · **apply migrations** · grant · API typecheck · web typecheck ·
**API unit suite** · **web unit suite** · **API integration suite against real PostgreSQL as the
non-superuser role**. All of Stage 1 and Stage 2 — including the 69 new tests — pass in CI.

**Job 2 — `golden path (E2E)`: ❌ FAILURE.** Three specs:

| Spec | Assertion |
|---|---|
| `admin-finance.spec.ts:52` | a row named `/Reversed/` is visible |
| `admin-hr.spec.ts:65` | the text *"A long day is not automatically overtime"* is visible |
| `admin-hr.spec.ts:95` | the row named `/2026-07/` contains *"Unverified rates"* |

### This failure is not Stage 1 + 2. It is the calendar.

Stage 1 + 2 touched **none** of the five files involved — verified with
`git diff c711fba~1..HEAD` over `admin-hr.spec.ts`, `admin-finance.spec.ts`, `seed-admin-uat.ts`,
`TimesheetPage.tsx` and `PaymentsPage.tsx`. All five are **UNTOUCHED**.

Reproduced on a scratch database built exactly as CI builds one — drop, migrate, provision, bootstrap,
seed — and then measured:

| Seeded by the UAT seed | Where the page looks | Result |
|---|---|---|
| Unapproved overtime on **2026-08-22** and **2026-08-27** | `TimesheetPage` defaults to `dayjs().startOf('month')` → **September** | outside the window |
| Reversed payments on **2026-08-12** | `PaymentsPage` defaults to the current month → **September** | outside the window |
| Payroll run for **2026-08** (`monthStart(-1)`) | spec hardcodes **`2026-07`** | no such row |

Each failing assertion sits behind a conditional that only renders when the data is present, so absent
data reads as a missing element rather than a wrong number.

**The seed writes last month's data; the pages default to this month; the specs assume the two
coincide.** That was true on **31 August 2026**, when run 220 was green, and stopped being true on
**1 September 2026**, when the month rolled over. Every red run on this branch is dated 1 September.
It is a pre-existing time bomb in the E2E layer that this stage happened to be the first thing to walk
into.

### The proposed patch — deliberately NOT applied here

Two changes, both in the test and seed layer, no production code:

1. **`admin-hr.spec.ts`** — derive the payroll period as "last month" the way the seed does
   (`monthStart(-1)`), instead of hardcoding `2026-07`.
2. **`seed-admin-uat.ts`** — place the *operational* demo data (attendance overtime, reversed
   payments) inside the **current** month, so the default view a clinic actually lands on has something
   in it. The payroll run correctly stays in the previous month, because payroll runs for a completed
   month; that one is the spec's job to derive.

It is not applied because the review said to stop after Stage 1 + 2 and report, the defect is not this
stage's, and the fix touches shared demo data used by every other spec — which cannot be validated to
green in this environment, since a full E2E pass needs seven seed steps this machine can only partly
reproduce. Applying an unvalidated change to shared fixtures at the end of a checkpoint is exactly the
widening the brief warns against.

**Reported as observed, not as inferred. A superseded job is not a passed job, and an unrelated failure
is not a green build.**

## 15 · Known remaining defects and gaps

1. **The E2E suite is red on a pre-existing calendar bug** (§14). Not caused by this stage, but it
   blocks the branch and will block every run until the seed and the spec stop assuming that "last
   month" and "the month the page opens on" are the same month. The patch is proposed in §14.
2. **No visual UAT was captured this stage.** The five new surfaces have not been photographed or
   reviewed by a person. Rule: *"Do not claim visual acceptance from automated tests."* This is the
   largest outstanding item before the screens are accepted.
3. **The calculation still reads the old paths** for salary and component liability. Deliberate (§3),
   but it means `EmployeeSalary` and `PayComponent` are proved-at-parity rather than in production use.
4. **Proration is not implemented.** The five bases are stored; nothing applies them. A mid-month joiner
   is still paid a full month — the original P0 defect stands, because whether a basis is lawful is
   blocked on JTKSM.
5. **`EmployeeYtd` has no writer yet.** The substrate exists; no approved run populates it.
6. **`EmployeeRecurringItem` has no UI.** The table and materialisation shape exist.
7. **Off-cycle runs are representable but have no UI** — `runType` and `sequence` are settable through
   the API only.
8. **The legacy exception JSON blob is still written** alongside the rows, so two representations exist
   until the calculation is rewritten in Stage 3.
9. **`hr.payroll.export.*` permissions guard nothing yet** — reserved for exporters that do not exist.
10. **The three export permissions and `residentialStatus` are recorded but unused**, which is honest
   scaffolding rather than working capability.

## 16 · Statutory items still blocked

**All 26 rules in the register remain UNVERIFIED or CORROBORATED. Nothing was upgraded.**

The owner located the official source set on 1 September 2026, and that is recorded per rule in
`statutory-register.json` as `officialUrl` and `ownerLocatedClaims`. **Locating a source is not reading
it.** Every named URL was retested from this environment and returns `000`.

| Blocked on | Items |
|---|---|
| **HASiL** | PCB engine and its hard gate, TP1, TP3, CP38, zakat treatment, CP39, Form E/EA/CP8D |
| **KWSP** | EPF verification, age-75, citizenship/PR, pre-Aug-1998 membership, voluntary contributions, EPF wage definition, file format |
| **PERKESO** | SOCSO scheme split, ceiling, foreign-worker; EIS eligibility; **LINDUNG 24 Jam entirely**; file formats |
| **HRD Corp** | Levy rates, category rules, and the leviable-wage definition |
| **JTKSM** | ORP definition (register EA-01), OT multipliers, lawful proration bases, final-pay obligations |

Two claims the owner supplied are recorded as **things to verify, not as rules**: the HRD Corp levy base
of `[(basic − unpaid leave) + fixed allowance]`, which is why `hrdLiable` stays an independent
attribute; and s60I's `monthly rate / 26`, which is why the ORP base is now live but its membership is
still open.

**The NOT READY guard is untouched. No payslip implies statutory compliance. No file has been called
valid. Nothing has been submitted to any authority or bank.**

## 17 · Updated production verdict

### **NOT PRODUCTION READY** — unchanged, and correctly so.

What changed is *why*. Before this stage there were two independent reasons: the statutory rules were
unverified, **and the product could not complete a payroll run at all**. The second is now gone.

| Gate (spec §62) | State |
|---|---|
| 1 · Every calculation-critical rule ≥ OFFICIAL_SOURCE_VERIFIED | ❌ 0 of 26 |
| 2 · PCB passes official HASiL vectors | ❌ No engine, no vectors |
| 3 · A full synthetic month-end reconciles | ❌ Not attempted |
| 4 · An approved run reproduces from its snapshot | ⚠️ Snapshot exists and is hashed; reproduction not yet asserted end to end |
| 5 · A correction preserves the prior snapshot and shows a diff | ✅ Built and tested |
| 6 · Zero BLOCKING exceptions can be bypassed | ✅ Enforced in the gate and by CHECK |
| 7 · Finance liabilities equal payroll totals | ❌ No Finance posting |
| 8 · RLS and permission tests pass for every new surface | ✅ — in CI, against real PostgreSQL as the non-superuser role |
| 9 · Visual UAT reviewed by a person | ❌ **Not captured** |
| 10 · Parallel run agrees with the clinic's figures | ❌ Not attempted |

**Three of ten met, one partial.** Payroll is now *operable under supervision* — a clinic could run,
review, approve, lock, reopen and correct a period, with every figure attributable — and it is still not
lawful to pay anyone with, because no statutory rule in it has been checked against the authority that
publishes it.

**Stage 3 is not begun and needs explicit approval.**
