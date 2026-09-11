# HR restructure — Piece 1: navigation, routes, Settings

One rail of seven, one address per screen, and the dead code that the old
shape was keeping alive removed. No Prisma schema change, no new feature, no
staging database touched.

## 1. The rail

Seven entries. Six are work; Settings sits apart at the foot of the rail
because it is set up once and then rarely opened.

| # | Entry | Lands on | Also lights for |
|---|---|---|---|
| 1 | Employees | `/admin/hr/employees` | `/admin/hr/benefits` |
| 2 | Payroll | `/admin/hr/payroll` | `/admin/hr/incentives`, `/admin/hr/locum` |
| 3 | Attendance | `/admin/hr/attendance` | — |
| 4 | Leave | `/admin/hr/leave` | — |
| 5 | Claims | `/admin/hr/claims` | — |
| 6 | Reports | `/admin/hr/reports` | — |
| — | Settings | `/admin/hr/settings` | — |

Clicking the **HR** module tab and typing **`/admin/hr`** both land on
Payroll. They used to disagree: the tab went to the first rail entry while
the URL redirected, so the same intention produced two different screens
depending on how it was expressed. A unit guard now pins them together.

`Overview` is gone from the rail. The screen itself is not gone — it is at
`/admin/hr/today`, reached by link, and titled **Today**.

Moving it there exposed two defects in the shell, both now fixed:

- **An unclaimed route belonged to Operation.** The shell decided which module
  a screen belongs to by looking for a nav entry that owns it. When nothing
  owned the route the lookup compared `undefined` with `undefined` — the
  active path against the settings path of a module that has no Settings
  button — and said *true*, so the first such module, Operation, claimed every
  unclaimed route in the product. `/admin/hr/today` rendered under Operation's
  tabs with Operation's submenu, while its own title said Today.
- **A route with no nav entry had no module at all.** With that fixed, the
  module is decided by the address: a route under `/admin/hr/` is HR whether
  or not a rail entry points at it, and the rail simply lights nothing.

`ADMIN_ROUTES` in the browser walk carried a `module` field for every screen
and never asserted it. It does now.

## 2. Every HR address

### Screens (22)

| Route | Renders |
|---|---|
| `/admin/hr/today` | HrOverviewPage |
| `/admin/hr/employees` | EmployeesPage |
| `/admin/hr/employees/new` | AddEmployeePage |
| `/admin/hr/employees/:staffId` | EmployeeWorkspacePage |
| `/admin/hr/attendance` | TimesheetPage |
| `/admin/hr/attendance/roster` | AdminRosterPage |
| `/admin/hr/leave` | LeavePage |
| `/admin/hr/claims` | ClaimsPage |
| `/admin/hr/payroll` | PayrollMonthPage |
| `/admin/hr/payroll/history` | PayrollHistoryPage |
| `/admin/hr/payroll/:id` | PayrollRunPage |
| `/admin/hr/incentives` | IncentivesPage |
| `/admin/hr/benefits` | BenefitsPage |
| `/admin/hr/locum` | LocumPage |
| `/admin/hr/reports` | PayrollReportsPage |
| `/admin/hr/settings` | HrSettingsPage |
| `/admin/hr/settings/company` | LegalEmployersPage |
| `/admin/hr/settings/payroll-items` | PayrollItemsPage |
| `/admin/hr/settings/payroll` | PayrollSettingsPage |
| `/admin/hr/settings/attendance-leave` | AttendanceSettingsPage |
| `/admin/hr/settings/public-holidays` | PublicHolidaysPage |
| `/admin/hr/settings/opening-balances` | YtdOpeningImportPage |

### Old addresses that still resolve (21)

| Old | Now |
|---|---|
| `/admin/hr` | `/admin/hr/payroll` |
| `/admin/hr/people` | `/admin/hr/employees` |
| `/admin/hr/people/new` | `/admin/hr/employees/new` |
| `/admin/hr/time` | `/admin/hr/attendance` |
| `/admin/hr/time/roster` | `/admin/hr/attendance/roster` |
| `/admin/hr/time/leave` | `/admin/hr/leave` |
| `/admin/hr/time/claims` | `/admin/hr/claims` |
| `/admin/hr/schedule` | `/admin/hr/attendance/roster` |
| `/admin/hr/roster` | `/admin/hr/attendance/roster` |
| `/admin/hr/requests` | `/admin/hr/leave` |
| `/admin/hr/payroll/readiness` | `/admin/hr/payroll` |
| `/admin/hr/payroll/all` | `/admin/hr/payroll/history` |
| `/admin/hr/employers` | `/admin/hr/settings/company` |
| `/admin/hr/settings/attendance` | `/admin/hr/settings/attendance-leave` |
| `/admin/hr/payroll/ytd-opening` | `/admin/hr/settings/opening-balances` |
| `/admin/hr/access` | `/settings/organisation/roles` |
| `/management/hr/staff` | `/admin/hr/employees` |
| `/management/hr/attendance` | `/admin/hr/attendance` |
| `/management/hr/leave-requests` | `/admin/hr/leave` |
| `/settings/hr/public-holidays` | `/admin/hr/settings/public-holidays` |
| `/management/hr/public-holidays` | `/admin/hr/settings/public-holidays` |

These are a single-hop client-side replace, not an HTTP 301: the product is a
single-page app served from one HTML document, so the server never sees the
path. A bookmark, a link in the user guide and a payroll exception remedy all
keep working; the address bar ends on the canonical URL.

Redirects are for the past. No screen in the product links at one — a unit
guard fails the build if one appears.

## 3. Settings

One landing with six cards, each a thing that is decided once:

1. **Company & statutory** — the entity that employs, files and pays.
2. **Payroll items** — what the clinic can pay or deduct, and what each counts towards.
3. **Payroll policies** — who may approve, what counts as pay, how overtime and unpaid leave are priced.
4. **Attendance & leave policies** — the grace period, what counts as a full day, entitlement.
5. **Public holidays** — the days the clinic is closed, which attendance and leave both read.
6. **Opening balances** — year-to-date figures for a clinic joining part-way through a tax year.

**Payroll items** is a screen that did not exist. The seventeen pay components
have been in the engine since it was built, and the only thing the product
said about them was the sentence "17 pay components are configured". A clinic
could not see which of its allowances were EPF-liable without reading a seed
file. The screen lists them with EPF · SOCSO · EIS · PCB · HRD · Pro-rated as
separate columns, because an allowance can be EPF-liable and PCB-exempt and a
single "taxable" tick cannot say that.

The product-wide Settings area no longer carries an **HR & Attendance**
category. It duplicated entries that now have one home under HR.

## 4. Deleted

Seven files, none of them reachable:

| File | Why |
|---|---|
| `PayrollPage.tsx` | No route reached it after the month workspace replaced it. |
| `PayrollVariancePanel.tsx` | The variance reading moved into Reports. |
| `PayrollSnapshotPanel.tsx` | The snapshot verdict is the API's answer, shown on the run. |
| `ExceptionSeverity.tsx` | The second exception store it rendered is gone. |
| `payrollExceptionSource.test.tsx` | Its four guarantees moved into `payrollJourney.test.tsx`. |
| `snapshotVerdict.test.tsx` | Already covered end to end on the API side. |
| `hr/StaffPage.tsx` | The Management-era staff list; `/management/hr/staff` redirects. |

## 5. Guards

`apps/web/src/admin/hr/hrRoutes.test.tsx` is new and holds six:

1. Every `/admin/hr/...` link in the product resolves to a mounted route, and a
   link written as a **constant** must land on a **constant** route — a link
   may only fill a `:param` if it interpolates one.
2. No screen links at an address that only redirects.
3. Clicking the HR tab and typing `/admin/hr` land in the same place.
4. Every rail entry points at a screen, never at a redirect.
5. No label in the HR directory *is* one of People, Time, Workforce, Hub,
   Overview, Command Centre or Journey. The rule is about names, not English:
   "What you pay people" is a sentence and stays.
6. The rail reads Employees · Payroll · Attendance · Leave · Claims · Reports
   · Settings.

And in the browser walk: every screen in the five modules shows its OWN module
as the active tab.

Guard 1 exists because of a link that did not resolve. `/admin/hr/payroll/locum`
was on the contractor panel of the employee record; there is no such route, so
it fell through to `/admin/hr/payroll/:id` and asked the server for a payroll
run whose id was the word "locum". Nothing caught it, because a `<Link>` target
is a string until somebody clicks it.

## 6. Words

Two labels inside HR were one of the banned seven and are not any more:

| Was | Is | Where |
|---|---|---|
| HR Overview | Today | the page at `/admin/hr/today` |
| Overview | Summary | the first tab of the employee record |

The employee record belongs to Piece 3; only the one word changed here, so
that guard 5 above holds today rather than after the next Piece. `?tab=overview`
still resolves — the key and its links are untouched.

`Overview` survives in Operation and Finance, where the ban does not reach.

## 7. Not in this Piece

`/admin/hr/incentives`, `/admin/hr/benefits` and `/admin/hr/locum` are still
their own screens. They become tabs of Employees and Payroll in Pieces 3 and 4.
The per-row switches on Payroll items — EPF, SOCSO, EIS, PCB, HRD, Prorate, OT
base, unpaid-leave base, recurring, reimbursement, editable in place — are
Piece 2.
