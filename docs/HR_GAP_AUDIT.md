# HR gap audit: roster, QR attendance, overtime/locum, leave, claims, medical benefit

14 October 2026, against master `f720dbe`. Read-only audit; nothing was changed.

Tags: `[D]` observed in the code or schema; `[A]` an assumption or a reading of
the law that the code does not settle. Every figure in the brief is treated as
the first clinic's example and becomes a clinic setting with a default.

Status: **Exists** works as asked; **Partly** something is there but short of
the requirement; **Missing** nothing usable.

---

## Summary

| Section | Exists | Partly | Missing |
|---|---|---|---|
| A. Roster | 0 | 4 | 5 |
| B. QR attendance | 1 | 3 | 5 |
| C. Weekly hours → OT / locum → payroll | 1 | 5 | 8 |
| D. Leave | 0 | 5 | 2 |
| E. Claims | 1 | 3 | 0 |
| F. Medical benefit | 0 | 3 | 3 |

The biggest gaps `[D]`:

1. There are no shift templates. A shift is a free start/end time on one table
   (`ProviderShift`), with no break, night flag or colour.
2. There is no QR attendance at all. Clock-in is one button in My Kuwick with
   a selfie and GPS.
3. Overtime is worked out **day by day** against the rostered end of each
   shift and needs a manager's approval per day. Nothing works by the **week**,
   and doctors have no locum-hours or per-night-shift pay.
4. Leave types are a fixed list of five (`LeaveType` enum). There are no
   service tiers, accrual, tags, replacement days or per-branch holidays.
5. Claims have one mileage rate and one receipt switch for the whole clinic,
   and approvals do not go to the supervisor.
6. The medical benefit can be read but not set up, and the counter bill
   cannot be charged to it.

---

## A. Roster

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| A1 | Shift templates per staff group: name, start, end, rest break, crosses midnight, night/day, colour | **Missing** | Roster → *Edit shift* (`ShiftEditorModal`) takes a free start/end; "crosses midnight" is worked out from end ≤ start | No template model. No break, night flag or colour. The "Weekly templates" panel is a per-doctor weekly pattern (`DoctorSchedule`), not reusable shifts |
| A2 | Branch opening hours, 24h or not | **Partly** | Settings → Scheduling → Booking rules (`ClinicBookingSettings.calendarDisplayMode`, display open/close) | That is the appointment diary's display band. Roster and attendance do not read it |
| A3 | Week start day, default Monday | **Missing** | none | No setting anywhere. The roster shades Saturday/Sunday as weekend (`RosterPage.tsx:388,467`) |
| A4 | Monthly doctor roster | **Partly** | HR → Attendance → Roster (`/admin/hr/attendance/roster`): month grid, people × dates, with a Doctors filter | Shared grid, not a doctor view with doctor shifts |
| A5 | Weekly staff roster | **Missing** | none | Month only |
| A6 | Combined "on duty today" | **Partly** | HR → Today (`/admin/hr/today`, `GET /workforce/today`) | One branch at a time; OFF / LEAVE / BLOCKED rows are counted as "scheduled" (`attendance-record.service.ts:735`) |
| A7 | External locum slot with the locum's name | **Partly** | Shift type `LOCUM` exists | A locum must be a Staff row (`staffId` required). No free-text external name |
| A8 | Published roster visible in My Kuwick | **Partly** | My Kuwick → Attendance → Roster panel (`GET /me/schedule`) | No draft/published state: a shift shows the moment it is saved |
| A9 | Separate edit permissions, staff roster vs doctor roster | **Missing** | one permission, `appointment.manage_roster` | No split |

## B. QR attendance

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| B1 | Kiosk per branch, QR changing every 30 s | **Missing** | none (`AttendanceSource.QR` enum value only) | No kiosk screen or route |
| B2 | Scan with own phone in My Kuwick | **Missing** | My Kuwick → Attendance: one *Clock in* button, selfie + GPS (`clock.tsx`) | No scanner |
| B3 | Old or screenshot QR fails | **Missing** | none | No signed, time-bound token |
| B4 | Optional WiFi and/or GPS radius | **Partly** | Settings → Attendance & leave → Attendance rules: GPS point + radius (default 150 m) | GPS only flags, never refuses; no WiFi check |
| B5 | Scans matched to shifts, incl. night across midnight and breaks | **Partly** | `attendance-hours.ts`, `attendance-record.service.ts` | Overnight clock-out closes yesterday within shift end + 60 min (fixed). Only the first shift of a day is matched; OFF/LEAVE rows are matched as shifts; no rostered break |
| B6 | Paid-hours rule (a) roster confirmed by scans [default], (b) scans capped at roster + approved OT, (c) actual scans | **Missing** | pay is always worked minutes from punches; excess after shift end is OT only if approved | No (a)/(b)/(c) setting. "Not OT unless approved" already holds |
| B7 | HR sees exceptions only: late, left early, missed scan, scan without shift | **Partly** | HR → Attendance (Timesheet) shows all rows with counts; LATE, SHORT_TIME, MISSING_PUNCH, ABSENT_WITH_SHIFT, UNSCHEDULED are computed | No exceptions-only view |
| B8 | Corrections requested in My Kuwick, supervisor approves | **Exists** | My Kuwick → Attendance → *Ask for a fix*; HR → Attendance → *Corrections* | Approver is anyone with `hr.attendance.manage`, not the person's supervisor (same gap as E3) |
| B9 | PIN fallback at kiosk, flagged | **Missing** | HR can clock someone in (source MANUAL) | No PIN |

## C. Weekly hours → overtime / locum → payroll

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| C1 | Weekly normal hours, default 45 = 6 × 7.5 | **Missing** | Settings → Payroll policies: `overtimeHoursPerDay` 7.5 and `overtimeDays` 26 (daily) | `MAX_HOURS_PER_WEEK = 45` is a constant used only by an uncalled check |
| C2 | Public holiday in the week reduces it by one day's hours | **Missing** | none | No weekly figure to reduce |
| C3 | Part week prorated per day | **Missing** | part-month **salary** proration only (`proration.ts`) | Not for hours |
| C4 | A week across two months belongs to the month it ends in (setting) | **Missing** | days grouped by calendar month | No week grouping |
| C5 | Staff: hours above weekly normal = OT at clinic rate (default 1.5×) | **Partly** | rate is a setting (`PayrollPolicy.overtimeMultiplier`, or a fixed hourly amount) | Measured **daily** against the rostered shift end, and each day needs approval |
| C6 | OT only for staff under the Act's wage threshold (default RM4,000) | **Partly** | `overtimeScope` + per-person `overtimeContractPolicy` | RM4,000 is a constant (`employment-act.ts:63`) |
| C7 | Public holiday hours at a per-holiday multiplier | **Partly** | Settings → Public holidays: *Mark festive*; rule set has an ordinary and a festive multiplier | One rate per kind, not per holiday; the worked day itself is fixed at 2 days' wages |
| C8 | Rest-day work per the Act | **Exists** | `restDayEntitlement`, `restDayMultiplier` setting, per-person rest day | none |
| C9 | Doctors: day hours above weekly normal = locum hours at the doctor's hourly rate (default RM45, per doctor) | **Missing** | `EmployeeProfile.hourlyRate` exists but nothing reads it; `LocumSession` is for contractors and goes to Finance | No locum-hours calculation for employed doctors |
| C10 | Doctor night shifts outside the weekly normal; paid per night shift (default RM350 per 10 h) | **Missing** | `NIGHT_INCENTIVE` pay item, typed by hand | No night flag on shifts, no per-shift rate |
| C11 | Doctor public holiday hours at the normal locum rate (default 1×) | **Missing** | doctor rule set has flat amounts only | none |
| C12 | Results become next month's payroll items, earned-in = month worked | **Partly** | overtime, rest-day and holiday days already become items with `earnedPeriod`; OVERTIME pays a month in arrears | No locum-fee or night-shift items; grouped by month, not week |
| C13 | Week-by-week working on the person's payroll page | **Missing** | Payroll → person page shows one line per kind ("Overtime — 6.5 h") | No weekly breakdown |
| C14 | No manual OT forms | **Partly** | no employee OT form exists | Each day's extra time needs a manager's *Approve OT* on the Timesheet |

How a doctor is told apart from staff today `[D]`: by account role
(`workforceCategoryOf`, `workforce-category.ts:35`), not by job title.

## D. Leave

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| D1 | Clinic-defined types: paid/unpaid, document needed, yearly cap, eligibility (tag, employment type, after probation), carry-forward cap + expiry, paid out on leaving | **Partly** | `LeavePolicy` + `LeavePolicyEntitlement` (days, paid, attachment, carry-forward days, pay-out on exit). Settings → Attendance & leave → Leave policy edits only pay-out on exit | Fixed type list; no eligibility rules; no carry-forward expiry or year-end rollover; payroll deducts only type UNPAID, ignoring the *paid* flag; no screen assigns a policy to a person |
| D2 | Annual leave by years of service; first-year accrual (1 day per 37 days worked, max 10) | **Missing** | one `daysPerYear` per type; join-year calendar proration | No tiers, no accrual |
| D3 | Special leave by job-title tag | **Missing** | none | none |
| D4 | Clinic-defined job titles with tags | **Partly** | Employees → *Job titles* (`JobTitlesDrawer`) | No tags |
| D5 | Holiday calendar per branch/state; per holiday: OT multiplier or replacement day (with expiry) | **Partly** | Settings → Public holidays (tenant-wide, ordinary/festive) | One calendar per clinic group; no per-holiday choice; no replacement days |
| D6 | Default editable types: Annual, MC, Hospitalisation, Unpaid, Compassionate, Emergency, Maternity, Paternity, Quarantine, Replacement | **Partly** | Annual, Medical, Emergency, Unpaid, Other | Six missing; none editable |
| D7 | Import opening balances (taken this year) | **Partly** | `POST /workforce/leave/balances/adjust`, one row at a time | No screen calls it; no CSV; no "taken before go-live" field |

## E. Claims

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| E1 | Claim types with rules (mileage per vehicle, km cap per day, toll/parking with receipt) | **Partly** | Settings → Claims: one mileage rate (default RM0.60/km) | Fixed category list; no per-vehicle rate; no daily km cap |
| E2 | Receipt required per type | **Partly** | one clinic-wide switch | Not per type |
| E3 | Submit in My Kuwick, supervisor approves | **Partly** | My Kuwick → Claims; HR → Claims → decide (`hr.claim.approve`, no self-approval) | Not routed to the supervisor (`managerStaffId` exists but is not used) |
| E4 | Paid on the claim pay date through payroll, not taxable | **Exists** | approved PAYROLL claims become `CLAIM_REIMBURSEMENT` lines, untaxed, pay day 15th (editable) | The catalogue marks the tax treatment as not yet verified |

## F. Medical benefit

| ID | Requirement | Status | Where today | Gap |
|---|---|---|---|---|
| F1 | Yearly limit, prorated monthly for new staff | **Partly** | HR → Benefits and My Kuwick → Benefits show the balance | No way to set a limit (only seed data); no clinic default; no proration |
| F2 | Eligible dependants | **Partly** | `StaffBenefitMember.relationship` free text | No fixed list; no way to add members |
| F3 | Excluded groups (probation, contract, intern) | **Missing** | none | none |
| F4 | Alerts at set remaining levels | **Missing** | none | none |
| F5 | No carry forward | **Partly** | accounts are per year | No yearly setup or explicit rule |
| F6 | Counter bill charged to the benefit, with the doctor's approval | **Missing** | `StaffBenefitUsage.invoiceId` exists, nothing writes it; billing knows only cash and panel | No benefit payer in billing; no approval record |

---

## Values fixed in code today `[D]`

Each should be a clinic setting with a default:

| Value | Where |
|---|---|
| Weekly maximum 45 h | `statutory/employment-act.ts:163` (unused) |
| OT wage threshold RM4,000 | `statutory/employment-act.ts:63` |
| Holiday worked = 2 days' wages | `employment-act.ts:367`, `overtime-pricing.ts:637` |
| Night clock-out window, shift end + 60 min | `attendance-record.service.ts:114` |
| New shift 09:00–17:00 | `ShiftEditorModal.tsx:65`, `FixedWeeklyEditor.tsx:89` |
| Weekend = Saturday/Sunday | `appointment/roster/RosterPage.tsx:388,467` |
| Sunday closed | `admin/hr/LeaveCalendar.tsx:52,78` |
| Leave types | `schema.prisma:1198` enum; `me/MyLeavePage.tsx:11` |
| Only UNPAID leave is deducted | `payroll.service.ts:1680` |
| Claim categories | `schema.prisma:9071` enum; `me/claim-form.ts:6` |
| Leave and benefit year = calendar year | `leave.service.ts:223`, `benefit.service.ts:33` |
| Public holidays per clinic group, not per branch | `schema.prisma:1289` |

---

## Where the brief meets the code or the law: decisions to confirm

1. **Weekly OT vs the Act's daily OT** `[A]`. The Employment Act counts as
   overtime any work beyond the *normal hours of work* agreed for a day
   (s.60A(3)), within 8 hours a day and 45 a week (s.60A(1)). A weekly-only
   count can pay less than the Act for a covered employee who works a long
   day in a short week. **Proposal:** weekly is the clinic's method, as asked;
   for staff covered by the Act, a day's hours beyond the contracted daily
   hours are also checked and whichever is higher is paid, shown in the
   week's working. A setting can turn the daily check off for staff not
   covered.
2. **Holiday multiplier floor** `[A]`. For covered staff the Act sets 2 days'
   wages for a worked holiday and 3× for its overtime (s.60D(3)). A
   per-holiday multiplier below that would underpay. **Proposal:** the
   multiplier is per holiday as asked, refused below the Act's rate for
   covered staff; doctors (not covered as asked) can be 1×.
3. **"No manual OT forms" with "not OT unless approved"** `[D]`. Today every
   day's extra time needs *Approve OT*. **Proposal:** under paid-hours rule
   (a), the roster is the approval: hours rostered above the weekly normal are
   OT without a form; only hours beyond the roster still need approval, as
   (b) says.
4. **Doctor vs staff** `[D]`: today by account role. **Proposal:** keep that,
   and let each shift template belong to a group (doctors / staff) so a
   clinic can roster a medical assistant on staff shifts whatever their role.
5. **External locum on the roster** `[D]`: a locum must be a Staff row today.
   **Proposal:** a roster slot can carry a free-text locum name; the payable
   stays out of payroll, as the brief says.
6. **Claims tax** `[D]`: the catalogue itself marks "not taxable" as
   unverified. Unchanged until a tax adviser confirms; flagged, not decided.

---

## Proposed build order (small batches; migrations on staging first)

| Batch | Section | Content |
|---|---|---|
| A1 | Roster | Shift templates per group (break, night, colour, crosses midnight), week start, branch opening hours |
| A2 | Roster | Weekly staff view, monthly doctor view, on-duty-today across branches, roster from templates |
| A3 | Roster | Draft/published roster, external locum name, staff/doctor roster permissions |
| B1 | QR | Rotating signed QR, kiosk screen, scan in My Kuwick, replay refusal, PIN fallback |
| B2 | QR | WiFi/GPS options, shift matching (night, breaks, split shifts), paid-hours rule (a)/(b)/(c), exceptions view |
| C1 | Hours | Weekly normal hours, holiday reduction, part-week, week-to-month rule; staff weekly OT |
| C2 | Hours | Doctor locum hours, night-shift pay, holiday multipliers per holiday, payroll items + weekly working |
| D1–D3 | Leave | Leave types, eligibility and tags, service tiers and accrual, replacement days, per-branch holidays, opening-balance import |
| E1 | Claims | Claim types and rules, supervisor routing |
| F1–F2 | Benefit | Benefit setup and alerts; charging a counter bill to the benefit with approval |
