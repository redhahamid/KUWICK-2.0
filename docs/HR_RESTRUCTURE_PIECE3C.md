# HR restructure — Piece 3c: Employees on Slate

The directory and the employee record on the kit and shell from 3a, after
`employees.html` and `employee-record.html`. Recurring items — the model
`EmployeeRecurringItem` had been in the schema with nothing reading or
writing it — get their first service, endpoints and screen. No Prisma schema
change, no migration. `[D]` marks what was read in the code or the database,
`[A]` marks an assumption.

## 1. What moved, and what is new

| Screen | Route | State after 3c |
|---|---|---|
| Employees | `/admin/hr/employees` | Rebuilt on `employees.html`: four figures, search + Active/Resigned/All, the four dots, the Record chip, Edit + ⋯. |
| Medical benefits | `/admin/hr/employees?view=benefits` | A view of Employees (the Piece 1 decision). `/admin/hr/benefits` redirects. |
| Employee record | `/admin/hr/employees/:staffId` | Rebuilt on `employee-record.html`: four tabs — Profile · Employment & salary · Statutory · Bank. |
| Add employee | `/admin/hr/employees/new` | Untouched: not in the 3c mockups. Still on the old kit inside the Slate shell — the accepted "two looks". |

### API, all additive

| Change | File | Why |
|---|---|---|
| `GET /workforce/employees` returns `epfNumberOnFile`, `socsoNumberOnFile`, `bankAccountOnFile`, `schemes {epf, socso, eis}` | `employee.service.ts` | The directory's four dots. `[D]` the numbers were on the profile and the applicability on the standing; neither was in the list DTO. `schemes` is the standing in force today, one row per employee in the same query; `null` when none is recorded. |
| `GET /workforce/employees/:id/record` → `leavePolicy.annualLeaveDays` | `employee.service.ts` | "16 days" beside the policy's name. `[D]` `LeavePolicyEntitlement.daysPerYear` for `ANNUAL`; the table has no service-length tiers, so the mockup's "(4+ years)" has nothing to read. |
| `GET/POST /workforce/employees/:id/recurring-items`, `PATCH …/:itemId`, `GET /workforce/recurring-item-choices` | `employee-recurring-item.service.ts` (new), `dto/recurring-item.dto.ts` (new) | The model's first use. See §3. |
| `employeeRecurringItem.created / updated / ended` | `finance/admin-audit.ts` | Three audit actions. |

## 2. The directory

**Four figures.** Active, with the split by employment type; joined this
year, with the names; records incomplete, with the commonest reason; and the
latest payroll run's gross with its month. `[D]` The last comes from
`GET /workforce/payroll/runs` — the newest period's `grossTotal` — and says
*not yet approved* when the run is only calculated, because a figure nobody
has approved is not yet "the monthly payroll".

**Four dots, two facts.** EPF, SOCSO and EIS read the statutory standing in
force today: does the scheme apply to this person. A red dot there is not a
defect — the mockup's contract worker with SOCSO and EIS red and a Complete
record is exactly right — and a grey one means no standing is recorded. The
Bank dot reads whether an account is on file, and a red one is a defect.
**Record** is the payroll gate's own checklist for this month: *Complete* when
no blocking item is outstanding, else the one thing missing in the gate's
words (*Bank missing*, *Salary missing*, *Tax info missing*), else *n
missing*. A person this page calls Complete is a person the run can pay.

**The row's second line keeps the clinical credential.** *Doctor, may sign*
or *Not a clinician* beside the position, because the browser guarantee from
the employee-master work (an account, an employment and a clinical
credential are three separate facts) reads it on the row. The mockup's line
is the position alone; reported in §6.

**Edit · ⋯.** Edit opens the record with the profile form already open;
⋯ offers View · Edit · Mark as resigned. There is no delete: a person who
was paid is a person the year's forms still name. *Mark as resigned* asks
for the last working day and a reason and posts `employmentStatus:
RESIGNED` with `endDate` and `endReason` to the endpoint the profile has
always been kept by — `[D]` no new endpoint. Somebody with no employment
record yet gets *Finish* instead of Edit, as before.

**Export** writes the filtered rows as CSV. `[D]` The kit's table dropped
the old export button in 3a on the grounds that no Slate mockup carried
one; `employees.html` does, so the directory has it back as a page action,
not a table control.

**Medical benefits** is the second tab in the panel: the clinic-wide table
of accounts, dependants and what is left, with its year and filter, and a
drawer per account. The same data and rules as the old page; the old
address redirects.

## 3. The record

**Head.** Avatar, the name as the page title, one line of facts (position ·
type · employee number · joined · branch), the record's state as a chip,
*Payslips*, and ⋯ (Edit record · Open timesheet · Open leave · Open claims ·
Mark as resigned).

**Four tabs from six.** Nothing was dropped; each panel moved to the tab a
person would look in first:

| Was | Now |
|---|---|
| Summary → Personal information, Employment, Payroll readiness, Salary information, Recent activity | Profile (personal, account), the head chip (readiness), Employment & salary (salary), — (recent activity: a feed assembled from the salary rows, claims and payroll history, each of which is on the record already; reported in §6) |
| Employment → terms, statutory numbers, standing | Employment & salary (terms), Statutory (numbers, standing) |
| Pay → salary, EPF basis, TP1/TP3, payroll history | Employment & salary (salary), Statutory (EPF basis, TP1/TP3), the Payslips drawer (history) |
| Attendance → this year's figures, recent days | Employment & salary, *This year* (figures, with *Timesheet* to the days) |
| Leave & Claims → policy, days on leave, claims table | Employment & salary, *This year* (policy, days, the claims count and total, with *Leave* and *Claims* to the rows) |
| Documents → what has been sighted, the note that files are not stored | Profile, *On record* |

**Salary** is the mockup's table: in force from with *Current* / *Upcoming*,
the figure, the reason, who changed it and when — `[D]` `recordedBy` and
`recordedAt` were already on `GET …/salary`. Closed rows are behind
*History*. *Change salary* is the existing form. `[D]` The API has no way to
amend or withdraw a recorded salary, so the mockup's *Edit* on the upcoming
row is not drawn: a wrong figure is corrected by recording the right one
from the same or a later date, which the server accepts as a replacement
from that day (reported in §6).

**Recurring items.** What a pay component carries for this person every
month: the item, the amount (a deduction printed negative), from, until, and
the EPF / SOCSO / PCB marks. `[D]` The marks are the COMPONENT'S flags read
from the catalogue, never stored on the item, so a catalogue change follows
through to every item. *Add recurring item* offers every component the run
does not derive itself (basic pay, overtime, PCB, unpaid leave and claim
reimbursements are refused with a sentence). The server's rules, in
`employee-recurring-item.service.ts`:

- one item per component per start date — the model's own unique key, said
  in words rather than as a database error;
- an item dated into a month an approved run has paid is refused, as a
  salary is;
- the amount of an item an approved run has already paid cannot change:
  end it and add a new one from the month that changes;
- ending an item inside a month already paid is refused; the end date has
  to be a month not yet approved;
- writing needs `hr.employee.manage` **and** `hr.payroll.view`, as a
  salary does; reading needs `hr.salary.view`.

`[D]` **The payroll run does not read recurring items yet.** No code in the
API reads `EmployeeRecurringItem`; the grid's default for other income and
other deductions is 3d's work, where the prompt puts it. Until 3d an item
is recorded, shown and audited, and the panel's own words ("paid every
month automatically") describe what 3d makes true. The branch is not on
master before 3g.

**Employment** is the mockup's key/value block — Type, Working days,
Position, Annual leave, Branch, Reports to, Confirmed, Status with *Mark as
resigned* — plus the facts the old tab carried that the mockup does not
draw: employed by, department, engagement, notes. *Working days* is derived:
`[D]` the rest day from the standing in force and the divisor from the
default pay rule set (`FIXED_DAYS`, 26) — "Mon – Sat, 26-day divisor"; with
no rest day recorded it says so.

**Statutory** holds the reference numbers (on file / missing, editable
write-only), the standing with *Record a change*, the EPF contribution basis
and the TP1/TP3 forms. The standing now shows and records **the employee's
EPF share, 11% or 9%** — `[D]` `EmployeeStatutoryClassification.epfEmployeeRate`
exists and the classification DTO already accepted it; no screen offered it.
`StatutoryStandingManager`, `EpfBasisPanel` and `EmployeeTaxPanel` are
restyled in place, not forked; their logic and the server's refusals are as
they were.

**Bank** shows the bank and whether an account is on file. The number is
never shown back; the form takes a replacement.

**Editing** is one drawer with four sections — profile, employment,
reference numbers, bank — each posting only its own fields to
`POST /workforce/employees/:id`. `[D]` The bank account and the three
reference numbers are write-only on that endpoint, as before.

## 4. Kit additions

`ui/who.ts` (initials that skip an honorific: *Dr Aisyah Rahman* is AR, as
the mockup draws it), `ui/csv.ts`, seven icons, and in `slate.css` the
scheme dots, row menus, the paired key/value grid, the ruled panel head and
the drawer form. All under `.kw-hrSlate`; the 3a isolation guards hold.

## 5. Tests

- `statutoryStanding.test.tsx` follows the facts into
  `StatutoryStandingManager` (a pure, exported section, as before) and
  counts ten *Not recorded* where it counted six: the EPF employee share,
  SOCSO and EIS applicability and the overtime-above-the-Act policy joined
  the facts. The guarantee — no readiness fallback shown as an answer — is
  the same.
- `employeeSalaryPanel.test.tsx` follows the button (*Change salary*) and
  the *Current* chip. Its guarantees (the amount goes as a string in the
  DTO's shape; three decimals are refused on the page) are the same.
- `hrRoutes.test.tsx` caught the one stale link to `/admin/hr/benefits`
  (from Reports) once that address became a redirect; the link now points
  at the view.
- `e2e/support/admin.ts`: the route walk's entry for `/admin/hr/benefits`
  expects the heading *Employees*, since that is the page it lands on.

## 6. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| Role line: the position alone (*Principal doctor · Owner*) | *Principal Doctor / Owner · Doctor, may sign*; *Stock Controller · Not a clinician* | The browser guarantee that the clinical credential is a fact on the row (Phase F). Kept, reported. |
| *Edit* on the upcoming salary row | Not drawn | `[D]` No amend/withdraw on the salary API. The form records a replacement from a date. |
| Annual leave *16 days (4+ years)* | *14 days · Standard — permanent staff* | `[D]` One entitlement per policy; no service-length tiers in the schema. |
| Employment block: 8 pairs | 12 pairs | Employed by, department, engagement and notes were on the old tab and are not dropped. |
| Head: *Record complete* | *Record complete* / *n things outstanding* / *Contractor, not on payroll* | The gate's checklist and the contractor case, which the mockup does not show. |
| No *Medical benefits* tab | Second tab in the Employees panel | The Piece 1 decision. |
| Recent activity feed (old Summary tab) | Not on the record | A view assembled from the salary rows, the claims and the payroll history, each of which is on the record in its own place. Reported rather than kept as a fifth block. |
| *Joined this year 2 — Wan Azman, Lim Wei Chen* | *0 — Nobody yet* | `[D]` The demo tenant's start dates are all 2024–2025. |

Six screens have no mockup PNG beyond the two (Profile, Statutory, Bank,
Medical benefits): built on the kit's patterns and shown as screenshots.

## 7. What the mockups want that the API did not have

| Wanted | Found | Done |
|---|---|---|
| Whether each scheme applies, on the list | `[D]` on the standing; not in the list DTO | Added, one query. |
| Reference numbers and bank on file, on the list | `[D]` on the profile; not in the list DTO | Added as booleans. |
| Annual leave days | `[D]` on the policy's entitlements; not in the record DTO | Added. |
| Recurring items | `[D]` model with no service | Service, endpoints, screen. |
| Salary changed-by | `[D]` already on the salary history | Used. |
| Amend an upcoming salary | Not on the API | Not built. Reported. |
| Leave entitlement by years of service | Not in the schema | Not built. Reported. |
| The employee's EPF share 9%/11% | `[D]` on the classification and its DTO; no screen | Offered and shown on the standing. |

## 8. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 127 suites, 2727 tests, green |
| API e2e | `cd apps/api && npx jest --config test/jest-e2e.json --runInBand` | 40 suites, 455 tests, green |
| Web unit | `cd apps/web && npx vitest run` | 99 files, 1714 tests, green (three HR tests followed the rebuilt screens, §5) |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | see below |

## 9. Not in this piece

The payroll run reading recurring items (3d). Add employee on the kit (not
in the mockups). Service-length tiers for leave entitlement (schema; not
asked). Amending a recorded salary (API; not asked).
