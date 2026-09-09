# HR / Payroll frontend rebuild — the audit, before any of it is rewritten

## The finding that decides the shape of this pass

**Every figure the target experience asks the screen to show already exists in the API.**

This is not a backend pass. It is not a schema pass. Four reads already return, in the shape the
redesign wants:

| What the redesign needs | Where it already comes from |
| --- | --- |
| The payroll grid — one row per employee, one column per kind of money | `GET /workforce/payroll/runs/:id` → `lines[]` |
| Row lineage — *"OT RM320, 8 approved hours, source: Attendance"* | `GET /workforce/payroll/inputs?period&staffId` → `source`, `label`, `amount`, `reason` |
| Per-employee readiness — *"Payroll setup 5 of 7"*, and the hard gate | `GET /workforce/payroll/readiness` → `employees[].readiness.items[]` with `label`, `done`, `blocking` |
| The setup journey's company step | the same read → `employers[].missing[]` |

`PayrollLine` carries `basicSalary`, `allowances`, `overtimePay`, `incentives`, `bonus`, `grossPay`,
`unpaidLeaveDeduction`, `otherDeductions`, `epfEmployee/Employer`, `socsoEmployee/Employer`,
`eisEmployee/Employer`, `lindungEmployee`, `hrdLevy`, `pcb`, `netPay`, `employerCost`, plus
`workedDays`, `unpaidDays`, `overtimeHours` and a `breakdown` JSON. That is the brief's column list
almost exactly, and it has been there all along.

So the owner's question — *"why is payroll harder to understand than an Excel payroll sheet?"* — has a
precise answer: **the numbers were never the problem. The screens never put them in one place.** The
engine computes a payroll register; the UI made the owner reassemble it from six screens.

The readiness builder's own labels are already plain English — "Legal employer", "Salary", "Rest day",
"Bank account", "Monthly tax (PCB) information", "EPF, SOCSO and EIS", "Date of birth", "Pay history
for the year". Nobody has to invent a vocabulary; one exists and the UI has not been showing it.

**Consequence for change discipline.** There is no reason to touch the payroll engine, the statutory
registry, the effective-dated tables, RLS, or the canonical roster — and this pass does not. Where a
read is genuinely missing something the UI needs, it is added as a field on an existing endpoint and
recorded here.

## Navigation — before

Twelve items in one row, which is the fragmentation the owner is complaining about:

```
Today · Employees · Timesheets · Leave · Claims · Roster · Payroll ·
Doctor incentives · Locum sessions · Staff benefits · Reports · Payroll settings
```

Three of those are configuration (Staff benefits, Payroll settings, and most of Reports), two are
one domain split in half (Timesheets and Roster), and two more are pay inputs that read as
destinations (Doctor incentives, Locum sessions).

## Navigation — after

Six, matching how somebody thinks about the work rather than how the domain is modelled:

```
Overview · People · Schedule & Attendance · Leave & Claims · Payroll · Settings
```

| New group | Absorbs | Old route |
| --- | --- | --- |
| Overview | Today | `/admin/hr` |
| People | Employees, employee workspace | `/admin/hr/employees`, `/admin/hr/employees/:staffId` |
| Schedule & Attendance | Roster + Timesheets | `/admin/hr/roster`, `/admin/hr/attendance` |
| Leave & Claims | Leave + Claims | `/admin/hr/leave`, `/admin/hr/claims` |
| Payroll | Payroll, incentives, locum, reports | `/admin/hr/payroll*`, `/admin/hr/incentives`, `/admin/hr/locum`, `/admin/hr/reports` |
| Settings | Payroll settings, benefits, employers, access | `/admin/hr/settings`, `/admin/hr/benefits`, `/admin/hr/employers`, `/admin/hr/access` |

**No route is deleted.** Every existing URL stays mounted or redirects into the group that now owns
it, because links to them exist in the guide, in payroll exception remedies, and in people's
bookmarks.

## What is actually being rebuilt

39 components, 11,420 lines, live under `apps/web/src/admin/hr/`. The heavy ones are
`PayrollReportsPage` (1,356), `PayrollRunPage` (1,095), `PayrollPage` (676) and
`EmployeeWorkspacePage` (585) — and their weight is the symptom, not the disease: each one grew a
section every time a domain concept needed somewhere to live.

The rebuild reuses the services, hooks and routes underneath and changes what the screen puts in
front of the owner. Where a page is replaced, the old one stays mounted at its old URL until the new
one demonstrably covers it.
