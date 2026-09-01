# Kuwick HR & Payroll — commercial product UX redesign

**Status: proposal. No code written. Awaiting owner approval.**

Mockups: [design canvas](https://claude.ai/code/artifact/ff27a0c6-c2fe-41cf-95a5-aac3ad702c9a) —
18 artboards over four pages. Working files in `.design/hr-payroll/`.

The Stage 1 + 2 backend stands. Nothing in this proposal removes a guard, a
snapshot, an exception severity or a verification state. What changes is who has
to look at them.

---

## The diagnosis, in one line

The current screens expose the **implementation model** — exceptions,
snapshots, verification statuses, liability matrices — where the user carries a
**task model**: *it is the end of the month and I need to pay five people.*

Everything below follows from putting the task model on the surface and leaving
the implementation model underneath, reachable, unchanged.

---

## A. HR information architecture

### HR — daily work (8 items)

| Item | Was | Note |
|---|---|---|
| Overview | Today | Broadened: who is in, what is blocked, where payroll stands |
| Employees | Employees | |
| Attendance | Timesheets | Absorbs **Roster** as a tab — roster → attendance → overtime is one chain |
| Leave | Leave | |
| **Claims** | *(none)* | **New.** Staff reimbursements that feed payroll |
| Payroll | Payroll | Now a guided workflow, not a table |
| Doctor incentives | Doctor incentives | |
| **Reports** | *(none)* | **New.** Payroll, statutory, headcount, cost |

### HR settings — reached from a gear beside the nav, never inside it

Payroll setup (guided checklist) · Company & statutory registration *(was Legal
employers)* · Bank & payment · Payroll policy · Pay components · Statutory rates ·
Opening balances · Import from your old system · Who can do what *(was Roles &
access)* · Leave & benefit schemes

### What leaves the daily navigation

| What | Today | Proposed | Why |
|---|---|---|---|
| Legal employers | HR nav | HR settings | Set once at go-live |
| Pay components matrix | HR nav | HR settings | 16 components × 12 flags is specialist work |
| Roles & access | HR nav | HR settings | Permissions are administration |
| Staff benefits | HR nav | HR settings + employee tab | Scheme setup is config; usage belongs on the person |
| Roster | HR nav | Attendance tab | One chain, not three menu items |
| Statutory rate tables | Payroll banners | HR settings | Verification is a setup fact, not a monthly one |
| Snapshot mechanics | Payroll run page | Finished period → History | Answers a question asked after the fact |
| Exception catalogue | Payroll run page | *nowhere* — reworded | Engine stays; the owner reads plain words |

Two doors, deliberately: **the owner** presses Run payroll once a month and
never sees a component or a rate table; **the accountant or Kuwick specialist**
works the settings checklist at go-live and then leaves.

---

## B. Payroll information architecture

```
Payroll
├── Payroll home              this month's state + history + what needs attention
├── Run payroll               the guided monthly journey
│   ├── 1 Employees
│   ├── 2 Attendance & leave
│   ├── 3 Earnings
│   ├── 4 Deductions
│   ├── 5 Review              ← the owner screen
│   └── 6 Approve & finalise
└── Finished period           payslips · bank file · exports · history
```

No technical table is the front door.

---

## C. Monthly payroll journey

| Step | The question it answers | What is hidden |
|---|---|---|
| Home | Is this month done? | Rate tables, verification state, snapshots, every technical banner |
| 1 Employees | Who am I paying? | Employment-type internals, legal-employer ids |
| 2 Attendance & leave | What did they work? | Punch rows, the ORP formula |
| 3 Earnings | What do they earn? | Component codes, liability flags, proration basis |
| 4 Deductions | What comes off? | Statutory band tables, age-rule internals |
| 5 Review | Is this right? | Severity taxonomy, override semantics, variance thresholds |
| 6 Approve | What am I signing? | Snapshot versions and hashes, the gate object |

**Review is the screen this redesign is for.** Three large numbers — take-home
pay, employees, cost to the clinic — then **Needs attention**, where every item
says what happened, why it matters and what to do, each with one button that
opens the right place inline.

> **Nurul Hidayah — monthly tax is missing**
> Her payslip would show more take-home pay than she is really owed, and the
> clinic would pay LHDN too little for September.
> **What to do:** Enter her PCB figure, or record her as not paying PCB.  `[Enter PCB]`

Words the owner never learns: `BLOCKING` → *Must fix before finishing* ·
`WARNING · overridable` → *Worth a look* · `PROVISIONAL` → *Not ready for live
payroll* · `Snapshot v2 · hash 29744ae2` → *Finalised again on 1 Sep* ·
`PCB_MISSING` → *Monthly tax is missing* · `includeInOrpBase` → *Counts towards
the overtime rate*.

---

## D. Employee journey

A workspace, not a database inspector. Header carries the person, their role,
status, branch **and legal employer**. Eight tabs: Overview · Employment ·
Salary · Attendance · Leave · Claims · Payroll · Documents.

Two things are made visually obvious:

**Payroll setup — 4 of 5 done**, as a progress bar and a checklist with one
`[Complete setup]` button.

**Salary** as periods, never as effective-dated rows:

```
Current salary     RM3,200 / month     Effective 5 Mar 2026
Upcoming change    RM3,600 / month     From 1 Oct 2026
```

---

## E. Settings journey

A six-step **Payroll setup** checklist is the landing page, showing 4 of 6 done
and naming the one thing standing between the clinic and live payroll: *check
the statutory rates against KWSP and PERKESO*. The full component matrix lives
one click deeper, for authorised advanced users.

---

## F–H. Mockup inventory

**Desktop (10)** Payroll home · Step 1 Employees · Step 2 Attendance & leave ·
Step 3 Earnings · Step 4 Deductions · Step 5 Review · Step 6 Approve ·
Employee profile · Employee salary · HR settings

**Tablet (2)** Payroll review · Employee profile — full processing, not a
cut-down view

**Mobile (4)** Payroll home · Needs attention · Employee · Payroll review

**Architecture (2)** Information architecture · Where the figures come from

Each carries a note stating primary user, primary job, primary CTA, what is
deliberately hidden and what is available by drill-down. All data synthetic.

---

## I. Statutory safety, without the wall

One line, everywhere it is needed:

> ⚠ **Payroll statutory setup is not yet production-ready.** This environment
> must not be used to pay staff or file a return.  `[View details]`

The full explanation moves into the details panel and into HR settings. The
gate is **not** weakened: `Finalise` stays locked while blockers stand, and a
finalised run against unverified rates never shows a plain green `APPROVED` —
it reads `APPROVED · PROVISIONAL` in amber.

---

## J. Mapping to Stage 1 + 2 backend

### Reused as-is

| Screen | Backend |
|---|---|
| Payroll home | `GET /payroll/runs` — the row-derived exception gate already returns `total / blocking / warnings` |
| Step 1 Employees | `GET /workforce/employees`, `employee_profiles.legalEmployerId` |
| Step 2 Attendance | `attendance_records`, `totalTimesheet()`, `UNAPPROVED_OVERTIME` / `MISSING_PUNCH` |
| Step 3 Earnings | `payroll_lines.breakdown` (already carries every component), `payroll_input_entries` |
| Step 4 Deductions | `computePayslip`, statutory rule sets, PCB input path |
| Step 5 Review | `GET /runs/:id/exceptions` + `approvalGate()` + `GET /runs/:id/variance` |
| Step 6 Approve | `approve()`, `acknowledgeStatutoryGap`, `payroll_snapshots` |
| Employee salary | `GET/POST /employees/:id/salary`, `resolveSalaryForPeriod` |
| HR settings | `legal_employers`, `pay_components`, `payroll_policies`, statutory register |

The exception engine, severities, override semantics, snapshot hashing, diffing
and the approval gate all stay. Only their **presentation** changes.

### UI gaps (no API needed)

1. Payroll home — no landing page exists; today the module opens on a table.
2. The six-step run — the state machine exists; the journey does not.
3. Employee workspace — the drawer becomes a page with tabs.
4. HR settings area and its setup checklist.
5. Human-language mapping layer for exception codes.
6. Reports.

### API gaps

| Gap | Note |
|---|---|
| **Staff claims** | No module. Payroll inputs can carry the money; approval workflow and a claims screen do not exist. |
| **Employee write form** | `useUpsertEmployee` has no caller and no form — basic salary and bank details cannot be edited in the product at all. |
| **Effective-dated salary is not read by payroll** | `calculate()` reads `employee_profiles.basic_salary`; `resolveSalaryForPeriod` is only called by the resolve endpoint. **The salary screen and the payroll engine currently disagree.** |
| **Payroll home aggregate** | One call for period state + attention counts + feeds, rather than five. |
| **New joiners / leavers** | Derivable from `startDate` / `endDate`; not exposed. |
| **Payslip + bank file** | Behind the statutory gate by design. |
| **Reports** | No endpoints. |
| **Finance posting** | Employer cost is computed; nothing posts it to Finance. |
| **Maker/checker** | Self-approval is refused; a configurable second approver does not exist. |
| `payroll_snapshots.reason` | Schema field with no writer. |
| **"All branches" resolves to the actor's own clinic** | `params.clinicId ?? actor.clinicId` in 14 services. Owner decision. |

---

## Remaining product decisions

1. **Claims** — build a staff claims module, or keep reimbursements as manual payroll inputs?
2. **Salary source of truth** — wire `calculate()` to the effective-dated table? Changes every payslip.
3. **Employee form** — build the missing write form, or keep employee data import-only?
4. **Staff benefits** — settings + employee tab, or keep a nav item?
5. **Reports** — which five reports matter first?
6. **Maker/checker** — configurable per clinic, or off until asked for?
7. **Mobile approval** — the mockups keep `Finalise` desktop/tablet-only. Confirm.
8. **Branch scope** — should "All branches" mean all branches?
9. **Rollout** — behind a flag beside the current screens, or a clean replacement?

---

## Not in scope, and unchanged

No statutory calculation was written or modified. No rate set is marked
verified. No migration. Nothing merged. The production gate stands exactly where
it stood: **not ready for live Malaysian payroll.**
