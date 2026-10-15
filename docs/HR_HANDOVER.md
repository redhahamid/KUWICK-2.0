# HR handover

One page per HR module: what it does, where the code lives, the main tables,
and how to change a rule. Written 15 October 2026 for the developer who
maintains Kuwick HR after the fast-track build.

Every rule below is a clinic setting with a default. Nothing about one clinic
(45 hours, RM45 an hour, RM350 a night, 50 km a day) is written into code.
`api` means `apps/api/src`, `web` means `apps/web/src`.

Common patterns you will see everywhere:

- **Services** use `withAdminTx(rawPrisma, '<permission>', (tx, actor) => …)`
  for writes and `requirePermission` / `requireScope` for reads. Every write
  records an audit row with `recordAudit` (actions listed in
  `api/finance/admin-audit.ts`).
- **Tables** are tenant-scoped with Postgres row-level security. A new table
  needs `ENABLE`/`FORCE ROW LEVEL SECURITY`, a `tenant_isolation` policy and a
  `GRANT` to `kuwick_app` in its migration, and must be added to the reset list
  in `api/prisma/seed-admin-uat.ts`.
- **Migrations** run on staging with the *Migrate only* workflow before a
  change reaches master.

---

## 1. Roster

**What it does.** The month or week of shifts for one branch: every employee
of the branch who is employed in the period (from the HR employee record,
login or not), doctors and staff, plus external locums by name. A month is a
draft until published; My Kuwick shows only published months. Edited in
**HR → Roster**; Appointments shows it read-only.

**Code.**
- API: `api/appointment/provider-shift.service.ts` (`matrix`, `week`,
  `publish`, `create`, locum slots), `api/workforce/shift-template.service.ts`,
  `api/workforce/roster-permission.ts` (who may edit which half),
  `api/workforce/workforce-category.ts` (doctor or staff).
- Web: `web/appointment/roster/RosterPage.tsx` (the board; `readOnly` in
  Appointments), `web/admin/hr/RosterPage.tsx` (HR wrapper),
  `web/admin/hr/ShiftSettingsPage.tsx` (shift templates, week start, opening
  hours).

**Tables.** `provider_shifts`, `shift_templates`, `roster_publications`,
`roster_locum_slots`, `attendance_policies` (week start, opening hours),
`staff.staff_group` (doctor or staff on the employee record).

**Change a rule.**
- Who is on the board: the `staff.findMany` in `matrix()`.
- Who may edit: permissions `roster.manage_staff`, `roster.manage_doctors`,
  `appointment.manage_roster` (whole roster), granted in Settings → Roles.
- Shift times, breaks, night flag, night pay: Settings → Attendance & leave →
  Shifts (no code change).

---

## 2. QR attendance

**What it does.** A kiosk screen shows a QR code that changes every 30 seconds
(setting). Staff scan it in My Kuwick to clock in and out; a 4–6 digit PIN at
the kiosk is the fallback and is always flagged. Each branch chooses what
happens away from the clinic: Off, Flag (default) or Refuse; the clinic WiFi
(IP addresses) or GPS radius count as "at the clinic". Timesheet → *Exceptions
only* lists missed scans, late, left early, scans without a shift, PIN and
away-from-clinic.

**Code.** `api/workforce/attendance-qr.ts` (signed rotating code, IP check),
`api/workforce/attendance-record.service.ts` (`clock`, `kiosk`, `kioskPin`),
`api/workforce/attendance-policy.ts` (the settings and their defaults).
Web: `web/admin/hr/AttendanceKioskPage.tsx`, `web/me/ScanClock.tsx`,
`web/admin/hr/AttendanceRulesPanel.tsx`, `web/admin/hr/TimesheetPage.tsx`.

**Tables.** `attendance_records`, `attendance_punches`, `attendance_policies`
(`qr_rotate_seconds`, `location_mode`, `clinic_networks`, `paid_hours_rule`),
`staff.attendance_pin_hash`.

**Change a rule.** All in Settings → Attendance & leave → attendance rules.
The grace period for a slow phone is `QR_GRACE_SECONDS` in
`attendance-qr.ts`; the PIN lock-out (5 tries in 15 minutes) is in
`kioskPin()`.

---

## 3. Overtime and locum, week by week

**What it does.** For each person, the weeks that ended last month are worked
out from the roster and attendance and paid in this month's payroll, labelled
"earned in" last month. A week that crosses two months belongs to the month it
ends in. The published roster is the approval; only time past the roster needs
a manager's approval on the Timesheet.
- **Staff:** overtime by the rule set's basis: *Employment Act* (past the
  normal day, then past the weekly normal), *Weekly only* (with a warning when
  it pays less than the Act), or *Shift-work averaging, s.60C* (3-week cycle,
  warning past 12 hours a day). A public holiday takes one normal day off the
  week; a part week is cut to the days employed.
- **Doctors:** day hours past the weekly normal are locum hours at the
  doctor's own rate (else the rule set's); public holiday hours at the
  holiday's multiplier (1× unless set); night shifts paid apart, per shift or
  per hour (per doctor, else per night template).
- The payroll person page shows the week-by-week working.

**Code.** `api/workforce/weekly-hours.ts` (pure arithmetic, read this first),
`api/workforce/weekly-pay.ts` (loads roster + attendance, stores weeks, makes
payroll items), the "WEEK BY WEEK" block in `api/workforce/payroll.service.ts`.
Holiday multipliers in `api/workforce/overtime-pricing.ts`; the RM4,000 limit
in `api/statutory/employment-act.ts` (`overtimeScope`).
Web: `web/admin/hr/PayrollSettingsPage.tsx` (rule set),
`web/admin/hr/WeekByWeek.tsx`, `web/admin/hr/EmployeeEditDrawer.tsx` (doctor
rates), `web/admin/hr/PublicHolidaysPage.tsx` (per-holiday multiplier).

**Tables.** `work_weeks` (one row per person per week, with the full working
as JSON; payroll items point at it), `payroll_policies` (`overtime_basis`,
`weekly_normal_hours`, `overtime_wage_ceiling`, `locum_hourly_rate`),
`employee_profiles` (`locum_rate`, `night_pay_mode`, `night_rate`),
`shift_templates` (`night_pay_mode`, `night_rate`), `public_holidays.multiplier`,
`payroll_input_entries` (components `OVERTIME`, `LOCUM_FEE`, `NIGHT_INCENTIVE`).

**Change a rule.**
- Basis, weekly hours, wage limit (can only be raised), doctors' default locum
  rate: Settings → Payroll → rule set. A rule set with no basis keeps the old
  day-by-day approval.
- How a day's hours are counted (roster after scan-in / scans capped at roster
  / scans): the paid-hours rule in attendance settings; code in `paidMinutes()`
  in `weekly-pay.ts`.
- The 3-week cycle start is fixed by week number (`cycleOf` in
  `weekly-hours.ts`).

---

## 4. Leave (basic)

**What it does.** The clinic's own leave types: paid or unpaid, days a year,
document needed, carry-forward cap. Statutory types (annual, sick,
hospitalisation, maternity, paternity) never give less than the Employment
Act for the person's years of service. Staff apply in My Kuwick; a manager
approves; unpaid types come off pay in the payroll month. Opening balances
(leave taken before Kuwick, days carried in) are imported from a CSV on the
Leave page.

**Code.** `api/hr/leave-types.ts` (defaults and Act floors),
`api/hr/leave-type.service.ts`, `api/workforce/leave.service.ts` (balances,
`importOpeningBalances`), `api/me/me.service.ts` (`requestLeave`),
`api/workforce/payroll.service.ts` (`unpaidCodes`).
Web: `web/admin/hr/LeaveTypesPanel.tsx`, `web/admin/hr/OpeningBalancesImport.tsx`,
`web/admin/hr/LeavePage.tsx`, `web/me/MyLeavePage.tsx`.

**Tables.** `leave_types`, `leave_requests`, `leave_balances`
(`entitled_days` null = from the type), `leave_policies`,
`leave_policy_entitlements` (a policy assigned to a person overrides the
type's days). `leave_type` columns are text codes.

**Change a rule.** Types and their figures: Settings → Attendance & leave →
Leave types. The Act floors: `FLOORS` in `api/hr/leave-types.ts` (change only
when the law changes). Deferred: service-year tables beyond the Act's,
first-year accrual, replacement days, automatic year-end carry forward (see
`docs/HR_BACKLOG.md`).

---

## 5. Claims (basic)

**What it does.** The clinic's own claim types. A type claimed by the km is
priced by Kuwick (km × rate) and paid up to its daily km cap; the claim says
how many km were not paid and why. Other types are an amount from the receipt.
Each type says whether a receipt is needed. Approved claims routed to payroll
are paid on the claim pay date. Tax treatment stays "to confirm with your tax
adviser".

**Code.** `api/workforce/claim-types.ts` (defaults, `claimTypeFor`),
`api/workforce/claim-pricing.ts` (price and cap), `api/workforce/claim-policy.service.ts`
(type settings), `api/workforce/staff-claim.service.ts` (HR entry, decide,
settle), `api/me/me.service.ts` (`submitClaim`).
Web: `web/admin/hr/ClaimTypesPanel.tsx`, `web/me/MyClaimsPage.tsx`,
`web/admin/hr/ClaimsPage.tsx`, `web/me/claim-form.ts`.

**Tables.** `claim_types`, `staff_claims` (`category` is a text code,
`unpaid_note`), `claim_policies` (default mileage rate and receipt switch used
until the clinic edits its types), `staff_claim_attachments`.

**Change a rule.** Settings → Attendance & leave → Claim types. The pay date
of claims: Settings → Payroll items (`CLAIM_REIMBURSEMENT`).

---

## 6. Medical benefit (minimal)

**What it does.** A yearly limit per person from the clinic's settings; a
joiner gets the whole months left ÷ 12 × the limit, and the joining month
counts if they joined on or before the clinic's cut-off day. HR opens the
year's accounts with one button, enters uses by hand, and sees who is running
low (the clinic's alert percentage) or overdrawn. My Kuwick shows the balance.

**Code.** `api/workforce/benefit-allowance.ts` (pro-rating and alert),
`api/workforce/benefit.service.ts` (policy, `setUpYear`, `addUsage`, list).
Web: `web/admin/hr/BenefitsView.tsx`, `web/admin/hr/BenefitSetup.tsx`.

**Tables.** `benefit_policies`, `staff_benefit_accounts` (one per person per
year; edit the allowance there for an exception), `staff_benefit_usages`,
`staff_benefit_members`.

**Change a rule.** HR → Employees → Benefits → *Benefit settings*. Deferred:
charging a counter bill to the benefit (`staff_benefit_usages.invoice_id`
exists for it).

---

## 7. Year-end forms (Borang EA and Borang E)

**What it does.** Reports → *EA forms* opens *Year-end forms*: a check list of
anything missing (tax number, IC or passport, the employer's LHDN E number,
months kept only as totals), one Borang EA page per employee with *Download
all*, and the Borang E totals per employer with the employee list (C.P.8D) as
CSV. Only approved months count; months not yet approved are named.

**Code.** `api/workforce/ea-form.ts` (boxes, default box per item, the
year's split — read this first), `api/workforce/ea-form.service.ts` (reads the
year-to-date record and each approved month's frozen item lines),
`api/workforce/ea-form-pdf.ts` (the page). The page is the auditor's template
`docs/templates/EA_Pin2017_1.xlsx` (C.P.8A, Malay): `api/scripts/ea-template-to-layout.py`
turns it into `api/workforce/ea-layout/cp8a-pin2017.ts` (column widths, row
heights, merged boxes, borders, shading, wording) and the PDF draws exactly
that, writing figures into the boxes listed in `eaFields()`. A newer LHDN
revision: run the script on the new spreadsheet, check `eaFields()` cells,
and change the **Form version** on the Year-end forms page (stored in
`global_settings`, key `hr.eaForm.versionLabel`). Web: `web/admin/hr/EaFormsPage.tsx`;
the box per item on `web/admin/hr/PayrollItemsPage.tsx`.

**Tables.** `employee_ytd` (tax, zakat, EPF, SOCSO and EIS totals),
`payroll_snapshots` (item lines per approved month), `pay_components.ea_field`
(the box; empty = Kuwick's suggestion), `employee_profiles` (tax, IC, EPF,
SOCSO numbers, children), `legal_employers.lhdn_employer_no` and `.phone`
(printed as "No. Telefon Majikan").

**Change a rule.** Which box an item goes in: Payroll items → the item → *EA
form box* (no code change). The suggestion for an item with no box:
`defaultEaBox` in `ea-form.ts`.

---

## 8. My Kuwick (staff on their phones)

**What it does.** Home (clock in by QR scan or GPS, latest payslip, leave
left, quick actions), Attendance (my published roster, the month's punches,
"Ask for a fix", kiosk PIN), Leave (balances first, apply, cancel while
waiting), Claims (photo of the receipt, withdraw while waiting, medical
benefit balance), Payslips, Profile (contact details the person edits; a new
bank account is a request HR approves with a proof photo). Built for 390px.

**Code.** `web/me/*` (one page per tab; `MyDetailsForms.tsx` for contact and
bank), `api/me/me.service.ts` (everything is "the person holding the token";
no endpoint takes a staffId), `api/workforce/bank-change.service.ts` (HR's
side), `web/admin/hr/BankChangesNotice.tsx` (the notice on Employees).

**Tables.** `bank_change_requests` (PENDING / APPROVED / REJECTED /
CANCELLED; approving copies the account onto `employee_profiles`),
`staff_files` (kind `BANK_PROOF` for the photo), plus the leave, claim and
attendance tables above. A cancelled pending leave request is deleted (it
never counted); a withdrawn claim is kept as CANCELLED.

**Change a rule.** Who approves a bank change: `hr.employee.manage`, never
the person themselves (`bank-change.service.ts`). Home and Attendance show
published roster months only.

---

## 9. Help and the user guides

**What it does.** A **Help** button on every HR page (`/admin/hr/help`) and in
the My Kuwick top bar (`/my/help`), showing the owner/HR guide or the staff
guide in Bahasa Melayu (default) or English.

**Code.** The guides are plain files in `docs/guides/*.md`, imported into the
web app as text (`web/help/guides.ts`) and drawn by a small renderer
(`web/help/Markdown.tsx`: headings, numbered steps, the "You see" line under
a step, bullets, bold). Edit the `.md` file; the app shows it on the next build.

---

## 10. Payroll (for orientation)

The run lives in `api/workforce/payroll.service.ts` (`calculate`). Upstream
facts become reviewable rows in `payroll_input_entries` through
`api/workforce/payroll-materialisation.ts`; weekly hours, unpaid leave, claims
and incentives all arrive this way, each pointing at the record behind it.
Statutory rates are in `api/statutory/`. Progress and decisions are logged in
`docs/HR_PROGRESS.md` and `docs/HR_DECISIONS.md`.

## 11. Outside data Kuwick uses

| Data | Source | Where |
|---|---|---|
| Malaysian postcode → town and state (Add employee, Edit employee) | Open package `malaysia-postcodes` 3.0.0, ISC licence, built from github.com/AsyrafHussin/malaysia-postcodes (2,929 postcodes). Update by bumping the package version. | `apps/web/src/admin/hr/postcode.ts` |
| Public holidays 2026, federal and by state | Published 2026 calendars, cross-checked; dates where sources differ are marked "check". To be replaced by a centrally maintained official list (see HR_BACKLOG). | `apps/api/src/hr/holiday-presets.ts` |

