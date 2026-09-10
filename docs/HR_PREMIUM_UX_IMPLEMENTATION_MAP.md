# HR premium UX — the forensic map, written before anything is rewritten

## What this pass is, in one line

The HR module's problem is not missing capability. It is that the screens are shaped like the domain
model instead of like the work, so an owner has to understand the architecture before they can pay
anybody. This is an information-architecture and frontend pass over an engine that stays where it is.

## The finding that constrains every decision below

**Nearly every figure the target screens need is already served.** Four reads carry it:

| The redesign needs | Already returned by |
| --- | --- |
| The payroll register — a row per employee, a column per kind of money | `GET /workforce/payroll/runs/:id` → `lines[]` |
| Row lineage — *"overtime RM98.48, 8 approved hours, from Attendance"* | `GET /workforce/payroll/inputs?period&staffId` → `source`, `label`, `amount`, `reason` |
| Per-employee readiness, named rather than scored | `GET /workforce/payroll/readiness` → `employees[].readiness.items[]` (`label`, `done`, `severity`) |
| Whether the employing company can file | the same read → `employers[].missing[]` |

`PayrollLine` has carried basic, allowances, overtime, incentives, bonus, gross, unpaid leave, other
deductions, EPF, SOCSO, EIS, LINDUNG, PCB, net and employer cost since the engine was built. The
register is a rendering problem, not a data problem.

**So no endpoint is being added for the register, the drawer, the review page or the readiness
states.** Where something genuinely is missing, it is named in the Risk column and added as a field on
an existing read, never a parallel one.

## Target information architecture

Six primary destinations, with settings deliberately outside them:

```
HR
  Overview          what is happening today, and what needs me
  People            who works here, and can we pay them
  Time & Leave      Attendance · Roster · Leave · Claims
  Payroll           Register · Incentives · Locum/contractor · History
  Medical Benefits  entitlement and use
  Reports           the report library
  ────────────────
  Settings          company, pay components, rules, approval, benefits, YTD, exports
```

The twelve-item row disappears. Three of the twelve were configuration, two were one subject cut in
half (Roster and Attendance both answer "was somebody meant to work, and did they?"), and two were
payroll INPUTS standing in the navigation as if they were destinations.

## Route by route

Every row below is either already true or is this pass's work. `Redirect` means the URL keeps
resolving — links to these live in the user guide, in payroll exception remedies, and in bookmarks.

| Old route | Component | Backend it reads | Canonical source | New home | Action | Risk |
| --- | --- | --- | --- | --- | --- | --- |
| `/admin/hr` | `HrOverviewPage` | `workforce/today`, `payroll/readiness` | `AttendanceRecord`, `ProviderShift`, `LeaveRequest` | **Overview** | Rework in place | Low |
| `/admin/hr/employees` | — | — | — | `/admin/hr/people` | Redirect (done) | None |
| `/admin/hr/people` | `EmployeesPage` | `workforce/employees`, `payroll/readiness` | `Staff` + `EmployeeProfile` | **People** | Rework in place | Low |
| `/admin/hr/employees/:staffId` | `EmployeeWorkspacePage` | `workforce/employees/:id` | same | **People** ▸ profile | Retab to 6 | Medium — 9 panels to re-home |
| `/admin/hr/attendance` | `TimesheetPage` | `attendance/timesheet`, `attendance/corrections` | `AttendanceRecord` | **Time & Leave** ▸ Attendance | Move under section | Low |
| `/admin/hr/roster`, `/admin/hr/schedule` | `AdminRosterPage` → canonical `RosterPage` | `provider-shifts/month` | `ProviderShift` — the ONE roster | **Time & Leave** ▸ Roster | Move; drop the banner | Low |
| `/admin/hr/leave`, `/admin/hr/requests` | `LeavePage` | `leave-requests` | `LeaveRequest` | **Time & Leave** ▸ Leave | Move; add Calendar/Balances | Low |
| `/admin/hr/claims` | `ClaimsPage` | `workforce/claims` | `StaffClaim` | **Time & Leave** ▸ Claims | Move | Low |
| `/admin/hr/payroll` | `PayrollHomePage` | `payroll/home`, `payroll/readiness` | `PayrollRun` | **Payroll** | Rework | Low |
| `/admin/hr/payroll/:id` | `PayrollRunPage` | `payroll/journey/:id`, `payroll/runs/:id` | `PayrollRun` + `PayrollLine` | **Payroll** ▸ register/review/approve/finalise | Major rework | **High** — the centre of the pass |
| `/admin/hr/payroll/all` | `PayrollPage` | `payroll/runs` | same | **Payroll** ▸ History | Keep mounted | Low |
| `/admin/hr/payroll/readiness` | `PayrollReadinessPage` | `payroll/readiness` | same | **Payroll** (reached from the gate) | Keep | Low |
| `/admin/hr/payroll/ytd-opening` | `YtdOpeningImportPage` | `payroll/ytd-opening` | `EmployeeYtd` | **Settings** ▸ Opening balances | Move | Low |
| `/admin/hr/incentives` | `IncentivesPage` | `incentives/*` | `IncentiveRun`, `IncentiveResult` | **Payroll** ▸ Incentives | Move under Payroll | Medium — must still materialise once |
| `/admin/hr/locum` | `LocumPage` | `locum/*` | `LocumSession` | **Payroll** ▸ Locum/contractor | Move; employee vs contractor made explicit | **High** — statutory treatment must not follow the word "locum" |
| `/admin/hr/benefits` | `BenefitsPage` | `workforce/benefits` | `StaffBenefitAccount` | **Medical Benefits** | Promote to primary | Medium — write paths must stay real |
| `/admin/hr/reports` | `PayrollReportsPage` (1,356 lines, 16 hooks) | 16 report reads | the run's own rows | **Reports** | Rebuild as a card library | Medium — must not imply unbuilt exports work |
| `/admin/hr/settings` | `PayrollSettingsPage` | components, policy, statutory | catalogue | **Settings** landing | Split into cards | Low |
| `/admin/hr/employers` | `LegalEmployersPage` | `legal-employers` | `LegalEmployer` | **Settings** ▸ Company & statutory | Move | Low |
| `/admin/hr/access` | `RolesSettingsPage` | roles | `Role`, grants | **Settings** ▸ Approval & access | Move | Low |

## What must not move, whatever the screens do

- **One roster.** `ProviderShift` is written by exactly one component. Appointment availability reads
  the same table. Two screens once wrote it with opposite models and saving one deleted the other's rows.
- **One attendance source**, resolved on the clinic's day, not UTC's.
- **A claim is paid once**, by one route: `StaffClaim.payrollInputEntryId` is unique, and the service
  refuses to re-bind a claim already bound elsewhere.
- **An incentive materialises exactly once** into payroll.
- **Contractor is not employee payroll.** Engagement decides statutory treatment; the word "locum"
  never does.
- **Approved payroll is frozen** — snapshot hash, immutability trigger, reopen semantics.
- **The employer-selected EPF basis stays advisory**, never silently blocking, and the assessment
  stays visible beside it.
- **Approval identity, non-delegable permission, audit.** Every decision takes its actor from the
  session. (One place did not, until this pass: leave approval read the approver out of the request
  body, unchecked and unaudited. Fixed and covered by six e2e tests.)

## Risks this pass carries, and how each is held

| Risk | Held by |
| --- | --- |
| The register's totals not lining up with their columns | A unit test asserting one summary cell per column and the net total under "Net pay" — this defect shipped once already |
| A payroll figure differing between register, drawer, review and snapshot | All four read the same `lines[]`; nothing recomputes locally |
| Old deep links breaking | Redirects plus `HubItem.covers`; the Admin walk asserts canonical paths |
| Incentive or claim reaching payroll twice | Existing unique constraint and service guard, both already covered by e2e |
| A screen implying an export is submitted | Reports label unsupported outputs plainly; nothing says "submitted" without an acknowledgement |

---

# What was actually built

Written after the pass, against the twelve-screen reference sheet. Screenshots:
`docs/screenshots/hr-premium-final/`. Screen-by-screen verdicts:
`docs/HR_PREMIUM_VISUAL_UAT.md`.

## The prediction held

**No endpoint was added for the register, the drawer, the review page or the
readiness states.** `GET /workforce/payroll/runs/:id`, `/payroll/journey/:id`,
`/payroll/readiness` and `/payroll/inputs` carried every figure the redesign
needed, as the map said they would.

**One read was added, and it is a bulk form of one that already existed.**
`GET /workforce/leave/balances?clinicId&year` serves the Leave screen's
Balances view. It exists because the alternative was the web calling
`leave/balances/:staffId` once per employee — a permission check and three
queries per person to draw a table. It reads the three underlying things once
and runs the SAME per-person computation (`LeaveService.balanceRow`, extracted
from `balancesFor` for exactly this reason), so a balance here cannot disagree
with the one on somebody's own record. It writes nothing and invents no
entitlement rule.

## Shared primitives — the thing that makes six sections one product

Every HR screen is now assembled from these rather than styled independently:

| Primitive | What it decides once |
| --- | --- |
| `components/Person.tsx` | Identity: avatar, deterministic per-person tint, name over one contextual line |
| `components/Chip.tsx` | One status vocabulary — ok · attention · blocked · info · neutral |
| `components/Panel.tsx` | The workspace card, definition lists, list rows, empty states |
| `components/FilterBar.tsx` | Period / branch / status / action, in the same place on every screen |
| `components/StageBar.tsx` | Numbered stages — payroll's four and Add Employee's four |
| `components/DetailDrawer.tsx` | The right-hand drawer, its sections, line items and pinned footer |
| `components/ReadinessList.tsx` | Payroll readiness as sentences, never a bare score |

Plus one decision in CSS: inside `.kw-admin`, antd's own `Tag` adopts the chip
palette, so the dozen supporting panels that still use it are the same object
as a `StatusChip` without twelve more edits.

## Deviations from the reference, and why

| Reference asks for | What was built | Why |
| --- | --- | --- |
| Photo upload on Add Employee | The generated avatar, with a line saying photographs are not stored | There is no photo column and no file store. A control that loses the file is worse than an honest absence. |
| "Zakat where applicable" in the payroll drawer | The Zakat line appears only when that person has one | Zakat is an ordinary `DEDUCTION` pay component, not a column on `PayrollLine`. A permanent "Zakat 0.00" row would be a claim about a deduction nobody made. |
| "Scheduled" on the Attendance summary | The figure when a branch is chosen; "—" plus the reason when it is not | A roster is drawn for one branch at a time. A number that silently meant one branch would be worse than a dash. |
| Stage names 1–4 | Payroll Details · Review · Approve · Finalise, exactly | No conflict with the domain, so the reference's own words won. |
| Documents tab | Which identity and statutory documents have been sighted, and a plain statement that copies are not held | Same reason as the photo. An empty list reads as "nothing uploaded". |

## What moved rather than disappeared

| Was | Is now |
| --- | --- |
| Twelve exception counter tiles on Overview | Named rows in Needs Attention, each opening the work |
| Nine employee-profile tabs | Six; Salary + Tax + Payroll history became **Pay**, Leave + Claims became **Leave & Claims** |
| Five-step Add Employee drawer | Four-stage page; "Access" became a switch under Employment |
| Earnings and Deductions steps in a payroll run | The register's columns and the employee drawer's three sections |
| Row expansion on the register | A right-hand drawer, so the register stays put behind it |
| The Settings wall | A landing with the one-time checklist and six areas, each on its own page |
| The "One roster" banner | Gone. It explained the data model to somebody rostering a Tuesday. |
| A `Select` of thirteen reports | A card library with category chips |
