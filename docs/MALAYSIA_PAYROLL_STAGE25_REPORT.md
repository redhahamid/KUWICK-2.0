# STAGE 2.5 — FOUNDATION, COMMERCIAL UX AND CROSS-MODULE INTEGRATION

**Stop-condition report.** Implementation and visual UAT are complete; work has
stopped here as instructed. Nothing is merged, no pull request is open, and
Stage 3 has not been started.

Baseline: commit `ed90c5b`, the approved DESIGN CHECKPOINT.
Branch: `claude/kuwick-2-visual-audit-k9uk5z`, pushed.

---

## 1 · Commits

| SHA | What it does |
|---|---|
| `ce9128f` | Canonical salary cutover — `EmployeeSalary` becomes the only figure payroll reads |
| `75ac9f0` | Upstream inputs materialised with provenance; claims, locum and the employee/contractor split |
| `df83dde` | Payroll Home and the six-step journey |
| `bb99124` | Employee workspace with the payroll-readiness checklist |
| `f8685c3` | Configurable approval rule (§4) |
| `4c02ce8` | The five payroll reports (§10) |
| `a84c6c9` | Branch-scope audit and plan (§5) |
| `f853206` | Four defects found by human-reviewing the screenshots |

108 files changed, 12,769 insertions, 447 deletions.

## 2 · Migrations

Three, all additive, all applied and verified against a fresh database.

| Migration | What it adds |
|---|---|
| `20260901120000_canonical_salary_cutover` | Backfills `employee_salaries` from `employee_profiles.basic_salary`, dated from `COALESCE(start_date, 2000-01-01)` |
| `20260901130000_stage25_cross_module` | `EngagementType`, `PaymentRoute`, `PayoutStatus`, claim and locum enums; `staff_claims`, `staff_claim_attachments`, `staff_claim_events`, `locum_sessions`; RLS + guarded grants; three check constraints; the payroll-input unique-index swap |
| `20260901140000_payroll_approval_modes` | `PayrollApprovalMode`; `payroll_approval_policies`, `payroll_run_approvals`; RLS + guarded grants; sequence check constraint; backfill of existing approvals |

Nothing is dropped. Every new table carries `ENABLE` + `FORCE ROW LEVEL
SECURITY` and a `tenant_isolation` policy on `current_setting('app.tenant_id')`,
matching the existing payroll tables.

## 3 · Salary cutover

`EmployeeSalary` is canonical. `EmployeeProfile.basicSalary` is legacy-only and
**closed for writing**: `POST /workforce/employees/:staffId` now refuses a
`basicSalary` or `hourlyRate` with a message naming the endpoint that accepts
one, because this endpoint has no effective date to forward it with and
inventing "from today" is the guess the effective-dated table exists to remove.

There is **no silent fallback**. `resolveSalaryForPayroll` returns one of three
outcomes and the calculation branches on all three:

* `RESOLVED` — the row in force for the period.
* `NO_SALARY` — a blocking exception with the employee's name; they are left
  out of the totals rather than paid zero.
* `CHANGED_MID_PERIOD` — **blocked, not prorated.** The exception carries the
  previous salary, the new salary, the date it changed and the affected period.
  No arithmetic is guessed.

Historical resolution is by date, so what somebody earned in March is the rate
that was in force in March. An approved run is immutable — the snapshot is
hashed at approval and a reopen produces a diff.

## 4 · Parity report

`apps/api/src/workforce/salary-parity.ts` compares the legacy column with the
canonical table per employee and returns a verdict: `MATCH`, `LEGACY_ONLY`,
`CANONICAL_ONLY`, `AMOUNT_DIFFERS`, `CHANGED_MID_PERIOD`, `BASIS_UNSUPPORTED`
or `NEITHER`. `clean` is true only when `mismatched === 0`. **It repairs
nothing** — a report that fixes what it finds cannot be used as proof.

On the seeded UAT tenant the report is clean: every employee with a legacy
figure has a canonical row for the same amount.

## 5 · Employee workspace

Eight tabs: Overview, Employment, Salary, Attendance, Leave, Claims, Payroll,
Documents. The header names the **legal employer** ("Employed by Klinik Contoh
Sdn Bhd") separately from the **working branch** ("Works at Contoh Central") —
the same person can have two different answers.

The payroll-readiness checklist names five things and says what is missing
about each, in the same owner language the exception centre uses: salary in
force, bank account, monthly tax, EPF/SOCSO/EIS identifiers, date of birth.
Contractors get no checklist — theirs would be a list of employee obligations
they do not have.

No unsupported future statutory field appears anywhere. Salary is behind
`hr.salary.view` and bank details behind `hr.payroll.view`, both enforced
server-side; the ordinary HR read returns presence, not values, and an e2e test
asserts the ordinary read carries no salary and no bank account.

## 6 · Attendance, roster and overtime → payroll

Approved overtime becomes a `payroll_input_entries` row with
`source: 'ATTENDANCE'`, the attendance record's id, the approver's name and the
earned period. Unapproved overtime raises a warning naming the hours; it does
not silently pay or silently drop them. The multiplier is a named constant
(`OVERTIME_NORMAL_DAY_MULTIPLIER = 1.5`), not a literal in an expression.

Corrections happen on the timesheet. Payroll re-materialises and the derived
row is replaced — it is not editable in payroll, so payroll never becomes the
second place to key an operational fact.

## 7 · Leave → payroll

Unpaid leave is read from the leave TYPE, per approved request rather than as
one summed number, so the deduction can name the request and the approver
behind it. Paid leave does not reduce pay. Each unpaid request materialises its
own input row carrying its own `sourceRecordId`.

## 8 · Staff claims

A full workflow, not a shortcut: `staff_claims` with attachments and an event
log; submit → decide → settle or cancel; history endpoint; a claims screen with
tabs and counts read from an unfiltered query so the tab you are on cannot
change the totals.

Approval requires **both** an amount and a route, and the approver may not be
the claimant. The route is the double-payment control: a `PAYROLL`-routed claim
is materialised into the run and its `payrollInputEntryId` is a UNIQUE foreign
key, so a claim can reach exactly one payslip; a `FINANCE`-routed claim is
refused by the payroll materialiser and settled separately. Two database check
constraints enforce route consistency and the presence of an approved amount.

## 9 · Medical and staff benefits

The benefit ledger stays a benefit ledger. It is not payroll income, it does not
appear on a payslip, and it lives under HR rather than in the monthly payroll
navigation. Unchanged by this stage other than remaining out of the journey.

## 10 · Doctor incentives

Read from the incentive run at `APPROVED` or `PAID` only, materialised with the
run's approver and the earned period. **Payroll does not recalculate them** —
it reads the figure the incentive module already approved, and a correction is
made there.

## 11 · Locum doctors

`EmployeeProfile.engagement` separates `EMPLOYEE` from `CONTRACTOR`; the
migration reads existing `employment_type = 'LOCUM'` rows as contractors, which
is what the seeded data and the clinic's own spreadsheet already meant (they
carry `epf_applicable = false`).

An employed locum is paid through payroll with full statutory treatment. A
non-employee locum is a `locum_sessions` row and a professional-fee payable —
`locum_sessions_never_payroll` is a database check constraint, and the payroll
employee query carries `engagement: 'EMPLOYEE'` so a contractor cannot be swept
in. `LocumService.record` refuses a non-contractor outright. Contractors appear
on the run as an INFO row naming them, so they are visibly excluded rather than
silently absent.

**Named gap:** the Finance posting for a locum payable is not implemented. The
service documents this rather than pretending the payable is settled.

## 12 · Payroll Home

One question — is this month done? — and one button. Three cards: what needs
attention, employee setup, what is feeding the month. It works with **no run
at all**, because "nothing has been started for September" is the state a clinic
opens the page in most often.

**One** concise, non-dismissible provisional indicator, in one line, with a link
to what is outstanding. The old warning walls are gone and did not come back.

## 13 · Step 1 — Employees

Who is included, who joined, who left, whose setup is not finished, and why —
each with a link to fix it. Contractors are named beneath as excluded.

## 14 · Step 2 — Attendance and leave

Days worked, approved and unapproved overtime, missing punches, unpaid leave
days with the requests behind them. Everything corrected upstream.

## 15 · Step 3 — Earnings

Salary earned, allowances, overtime, incentives, claims and other. Every row
opens to show where each figure came from: the source, the record, the reason
and the earned period. On the seeded run the columns sum to the strip and the
strip sums to the table total, checked by hand against the screenshot.

## 16 · Step 4 — Deductions

Statutory, monthly tax and anything the clinic is recovering. PCB shows
**"Not entered"** in amber where it is missing, never RM0.00, above a line
saying plainly that Kuwick does not work monthly tax out. **PCB manual entry is
temporary and for UAT**; it is labelled as entered by hand on the payslip.

## 17 · Step 5 — Review

The primary owner control screen. Three numbers, then everything standing in
the way, each as WHAT / WHY / WHAT TO DO with one action. Exception codes never
appear: a unit test with 13 forbidden regexes asserts the copy says everything
in the owner's words and never the engine's. All totals derive from the same
canonical dataset; no display-only arithmetic exists on the screen.

## 18 · Step 6 — Approve

What is being signed off, what finalising does, and what is not available yet
and why. Not finalisable from a phone. Blockers come from one `approvalGate`.

## 19 · Maker/checker (§4)

Three modes, per tenant, enforced server-side and recorded on every approval:
**one approval from anybody**, **one approval from somebody other than the
person who ran it**, or **two approvals from two different people, neither of
them the person who ran it**. The rule is written on screen as a sentence about
how the clinic works, never as a mode name.

One pure function decides, and both the server and the screen ask it, so the
Approve button is never offered where the server would refuse it. Under
two-approval the first approval locks nothing, takes no snapshot, and is not
called a finalisation anywhere. `UNIQUE (payroll_run_id, staff_id)` makes two
approvals two people.

The previously invisible owner exemption is now a named setting, defaulting to
on so no clinic's rule changes by upgrading, with every approval that uses it
marked in its own column.

**What the permission model cannot support, said on the settings screen:**
`hr.payroll.approve` is carried by the OWNER role alone — it is not
individually grantable and a custom role cannot hold it. So every approver is
an account holder, and with the exemption on, the second and third rules cannot
change who may approve anything. The screen computes that and warns. Also
named: nobody is notified that a run is waiting, the rule does not vary by
amount, it governs the payroll run only, and two approvals means two people
rather than two levels.

## 20 · All branches / scope resolver (§5) — **STOPPED AND REPORTED**

The referenced `ADMIN_SCOPE_ARCHITECTURE_AUDIT` **did not exist** anywhere in
the repository or its git history. It has been written from the code:
`docs/ADMIN_SCOPE_ARCHITECTURE_AUDIT.md`.

What it found:

* Two branch-scope systems mean **opposite things by the same column**.
  `Staff.clinicId = null` means "works across the whole tenant" in ~15 admin
  service files and "authorised for nothing" in ~6 clinical ones. The schema
  comment and `clinical-authorization.ts` state the two readings explicitly and
  contradict each other.
* `assertBranchScope` — the guard that reads canonical — has **zero callers**
  outside its own file. Both its guard clauses fail open and it can only ever
  compare against one branch id.
* **16 call sites across 13 files** take a branch id from the caller and pass it
  into Prisma unchecked, including two payroll write paths.
* **Three services have no authorisation call of any kind** — `reports`,
  `hr/attendance`, `inventory/stock` — and pipe `clinicId` from the URL into a
  query.

Per the instruction — *"If this requires a management-wide risky refactor: STOP
that subtask and report the implementation plan rather than partially fixing
services"* — **this subtask is stopped.** The document carries a six-phase plan,
each phase independently shippable and revertable, and notes that phase 3
(closing the three unauthorised services) is a real security fix that depends
on none of the others and should ship first if only one is authorised.

Payroll's own reads are unchanged. Scoping payroll alone would make payroll
look safe while the same data stayed readable one screen away.

## 21 · Payment routing invariants (§8)

Every money-producing record has **one** route. Every `PayrollInputEntry`
carries source, `sourceRecordId`, employee, component, amount, earned period,
payment period, the upstream approval status, the approver's name, the actor
who created it and an audit trail.

Re-materialisation is **idempotent** by construction: `planMaterialisation`
computes create / update / remove / unchanged against an identity of
`componentCode::sourceRecordId`, and only derived sources are ever touched —
`MANUAL` rows are never removed by a recalculation. Two partial unique indexes
enforce the identity in the database, one for derived rows and one for manual
ones. A claim reaches exactly one payslip because `payrollInputEntryId` is a
UNIQUE foreign key. `linkClaimToInput` refuses a `FINANCE`-routed claim.

## 22 · Payroll outputs (§9)

Nothing is fabricated. No bank file, no statutory submission file, no
production payslip. Disabled functionality states truthfully why: *"Bank
payment file and statutory files are not available yet. They are generated once
the statutory rates have been checked. Kuwick will not produce a file it cannot
stand behind."* There is no fake submitted, paid, filed or approved-by-authority
status anywhere.

## 23 · Reports (§10)

Five reports, served from the same rows the run wrote:

1. **Payroll register** — every employee, every column, with the components
   behind each figure and where each came from.
2. **Cost to the clinic** — by branch and by legal employer; take-home pay is
   deliberately absent from its totals.
3. **Statutory totals** — per employer, the way a submission is made, with
   employers who cannot file named. Headed "not a submission".
4. **This month against last** — every movement is a subtraction, asserted by
   the engine's own `checkVariance`; leavers are named rather than absent.
5. **Claims and reimbursements** — the one route each was paid by, and whether
   it has been settled.

Every row carries a link to the canonical source record. **Nothing recomputes**:
the register's totals ARE the run's totals, asserted by an e2e test, and the
column totals are computed by the API so the report and the table cannot drift.
A statutory figure the engine could not work out stays null and reads "Not
worked out", never RM0.00.

Three reports the specification names are listed as unavailable with the reason
each cannot exist yet.

## 24 · Data-consistency invariants (§12)

`checkPayrollInvariants` asserts seven propositions on **every** calculation and
throws rather than write a run whose figures contradict each other: gross minus
deductions equals net per employee; gross plus employer contributions equals
employer cost per employee; the four run totals equal the sums of the rows; and
the headcount equals the number of payslips.

`checkMembership` asserts that everybody considered is either paid or explained
by a recorded exclusion, and that nobody is both. `checkVariance` asserts that
a displayed movement is current minus previous.

Membership is computed once and reused by every step, so step 1 and step 5
cannot disagree about who is in the month. Blockers come from one canonical
`approvalGate` reading exception ROWS. No arithmetic is duplicated in React —
the payroll journey and every report are served pre-computed.

## 25 · Duplicate-payment protections

* One route per approved claim, enforced by a check constraint.
* `payrollInputEntryId` UNIQUE — one claim, one payslip line.
* Two partial unique indexes on `payroll_input_entries` — one materialised row
  per source record per period, and one manual row per component per period.
* `locum_sessions_never_payroll` — a contractor's session cannot be routed to a
  payslip.
* `UNIQUE (payroll_run_id, staff_id)` on approvals — one person cannot be two
  approvers.
* Re-materialisation is idempotent and never touches `MANUAL` rows.

## 26 · Responsive (§11)

Desktop full. Tablet full where practical (Review and Employees captured at
1024×1366). Mobile is status, review, attention, lookup and simple resolution:
cards stack, numbers stay large, and no desktop table is shrunk onto a phone.
**Payroll cannot be finalised from mobile** — `Grid.useBreakpoint()` gates it,
and the screen says why in a sentence about evidence rather than about screen
size.

## 27 · Tests and CI

| Check | Result |
|---|---|
| Migrations, applied as owner | 113 applied, none pending |
| API typecheck | clean |
| Web typecheck | clean |
| API unit (jest) | **2,393 passed** / 113 suites |
| Web unit (vitest) | **1,681 passed** / 95 files |
| PostgreSQL integration, `kuwick_app` non-superuser NOBYPASSRLS | **216 passed** / 20 suites |
| Golden-path E2E (payroll journey, approval modes, reports) | included above, green |

`kuwick_app` verified: `rolsuper = f`, `rolbypassrls = f`.

New suites this stage: `payroll-approval-modes.e2e-spec.ts` (12),
`payroll-reports.e2e-spec.ts` (8), `payroll-approval-rule.spec.ts` (17), plus
invariant, materialisation, salary-resolution and journey guards.

## 28 · Visual UAT

**28 screenshots of the running application**, not artboards, in
`docs/payroll-stage25-uat/`, from the seeded synthetic tenant *Klinik Contoh
(UAT)*:

Desktop (1680×1050): Payroll Home; the six steps; the earnings drill-down;
employee list; employee workspace Overview, Salary, Claims and Payroll; claims;
locum sessions; payroll settings; the approval rule; the five reports;
timesheet. Tablet (1024×1366): Review, Employees. Mobile (390×844): Home,
Review, Claims.

### Visual defects found by human review, and fixed

1. **The payroll register's rows did not add up.** A RM4,200 salary beside a
   RM4,064.52 gross with the unpaid day off screen; a RM9,500 salary beside a
   RM9,760 gross with the incentive off screen. Both numbers individually right,
   both rows wrong. Every earning the gross contains now has a column, every
   column foots from the API, and an e2e test asserts the row identity.
2. **A row of green ticks over a run that could not be paid.** The stepper
   ticked every step behind the current one. A tick now means settled; a step
   holding a blocker is marked as needing attention, from the same exception
   rows the Review screen lists.
3. **"0 of 8 ready" beside "Bank account 8/8".** Readiness counted the monthly
   tax figure, which nobody has on the first of the month because Kuwick does
   not work PCB out. Readiness is now the three standing facts; the tax figure
   keeps its own line as this month's data entry.
4. **"Administrati / on"** — the hub header hyphenated its title mid-word at
   390px. The row wraps now and the title never hyphenates.

Two smaller ones: the settings choices and their switch now share one reading
measure, and the shot harness was selecting the report picker by position and
photographing the same report five times.

---

## Remaining gaps

* **Branch scope (§5)** — stopped and reported, per instruction. Six-phase plan
  in `docs/ADMIN_SCOPE_ARCHITECTURE_AUDIT.md`. Three services still have no
  authorisation call at all; that is a live security finding.
* **Approval modes cannot bite under today's permissions.** `hr.payroll.approve`
  is owner-only and not delegable, so with the owner exemption on, MAKER_CHECKER
  behaves as STANDARD. Reported on the settings screen and above.
* **Locum Finance posting** — a contractor payable is recorded but not posted to
  Finance.
* **Three specification reports not built** — statutory reconciliation, payment
  reconciliation, payroll history. Each listed on screen with its reason.
* **PCB manual entry is a UAT measure**, not a product decision.
* **No bank file, no statutory files, no production payslips.**

## Statutory confirmations

* **No statutory formula was changed.** `apps/api/src/workforce/statutory.ts`
  is untouched since `ed90c5b`.
* **No EPF, SOCSO, EIS or HRD value was altered.** No rate file appears in the
  diff.
* **No PCB formula was implemented or guessed.** `computePcb` still returns
  `null` for anybody inside PCB, with `PCB_NOT_IMPLEMENTED` as its note.
* **No statutory source was marked VERIFIED.** No verification status was
  upgraded anywhere.
* **Stage 3 statutory engines have not been started.** No engine file exists in
  the diff.

## Production-readiness verdict

**NOT production-ready, and correctly not claiming to be.**

The foundation is sound: salary is canonical and effective-dated, upstream
facts are materialised once with provenance and cannot be re-keyed, employees
and contractors are separated by a WHERE clause and two database constraints, a
claim can reach exactly one payslip, the run asserts its own arithmetic and
refuses to write figures that contradict each other, and the owner journey is
six steps in the owner's own words.

What stands between this and live payroll is unchanged and unhidden: the EPF,
SOCSO and EIS tables have not been checked against KWSP's and PERKESO's own
published schedules, monthly tax is not calculated at all, and no bank or
statutory file is produced. Every screen says so. A clinic could run this month
end-to-end as a working figure today; it could not pay staff or file a return,
and Kuwick refuses to pretend otherwise.

The branch-scope finding is the one item that should be read as urgent
independently of payroll.
