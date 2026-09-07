# HR / Workforce — the canonical flows

How a fact travels from the person who creates it to the payslip it ends up on, and which record owns it
at each step. Written so that a question like *"where does approved overtime actually come from?"* has one
answer, and so that nobody adds a second table for something that already has one.

The rule underneath all three flows: **each fact has exactly one home, and every other screen reads it.**
Where two records could hold the same fact, they eventually disagree, and the disagreement surfaces on
somebody's pay.

---

## 1 · Employee → roster → attendance → payroll

```
    Staff              EmployeeProfile          EmployeeSalary
  (who they are)     (their employment)     (what they are paid, dated)
        │                    │                        │
        └────────────────────┴────────────────────────┘
                             │
                      ProviderShift          ← THE ONE ROSTER
                   (the whole workforce)        two instants, so overnight
                             │                  and split days need no case
                             │
              ┌──────────────┴──────────────┐
              │                             │
      Appointment availability      AttendanceRecord
    (bookable providers ONLY)     (clock in / clock out)
                                            │
                                    computeAttendance
                                  + the clinic's AttendancePolicy
                                            │
                    ┌───────────────────────┼───────────────────────┐
                    │                       │                       │
              late / short            extra time            AttendanceCorrectionRequest
            (an EXCEPTION,       (a CANDIDATE, not         (the employee asks; a
             never a silent        overtime)                manager decides)
             deduction)                │                       │
                                       │                       │
                                 approveOvertime          decideCorrection
                                       │                       │
                                       └───────────┬───────────┘
                                                   │
                                          PayrollInputEntry
                                        (source = ATTENDANCE)
                                                   │
                                             PayrollLine
```

**Three things this flow refuses to do.**

- **Attendance never invents its expected shift.** `scheduledStart`/`scheduledEnd` are read from the roster
  by `shiftDate` — the roster's own clinic-local date — and written onto the record. Attendance never writes
  back to the roster.
- **Extra time is not overtime.** `computeAttendance` produces a *candidate*, shaped by the clinic's own
  minimum and rounding; `overtimeApproved` is a separate act by a different person. Unapproved extra time is
  reported and not paid.
- **Short time is not a deduction.** A 16:30 finish on a 17:00 shift is an exception a manager resolves —
  approved early release, half-day leave, unpaid time, a correction. The system cannot know which, and
  guessing costs somebody real money.

**The day a punch belongs to is the clinic's day, not UTC's.** Malaysia is UTC+8, so for a third of every
day the two disagree: a 07:00 clock-in in Kuala Lumpur is 23:00 UTC the day before. Everything here resolves
through `clinicDateKey`.

**One roster, and one branch of it at a time.** `ProviderShift` is a single table across the group, but the
board is people against dates *at a place*: two branches cannot be drawn as one matrix without inventing a
person who works at both simultaneously. So the roster screen asks which branch before it draws, and asks it
on the board itself with the branches as buttons — not by leaving a blank page and an instruction pointing at
a control in the hub header. Everything else in HR reads across the whole scope; the roster is the one screen
where "all branches" is a question rather than an answer.

---

## 2 · Employee claim → decision → paid exactly once

```
        Employee (My Kuwick)                     Manager (HR ▸ Claims)
               │                                          │
        POST /me/claims                            decide(approve, route)
      + receipt attachment                                │
               │                          ┌───────────────┴───────────────┐
               ▼                          ▼                               ▼
          StaffClaim              route = PAYROLL                 route = FINANCE
       status SUBMITTED                    │                               │
                                   PayrollInputEntry              supplier payment
                                  (source = CLAIM)                 + financeReference
                                           │                               │
                                    payrollInputEntryId              payoutStatus PAID
                                     ── UNIQUE ──
                                           │
                                      PayrollLine
```

**The double-payment guard is two guards, and it is worth being exact about which does what.**

- A claim carries ONE link, because `payrollInputEntryId` is a single column. `@unique` on it adds the other
  direction: no two claims may point at the same payroll input row. That half is the database's, and it
  holds against any code path, including one written next year that forgets to check.
- A claim already bound to July's input cannot be pulled into August's. That half is the SERVICE's
  (`linkClaimToInput`), because it is a comparison between two ids rather than a constraint on one, and it
  refuses with a sentence a clinic manager can act on rather than a constraint violation.

Both are held by `payroll-synthetic-month.e2e-spec.ts` › *paid exactly once*, which reproduces the actual
double payment: move a paid claim's period forward, calculate the next month, and watch it be refused.

The route decision is recorded on the claim itself, and claims are collected for payroll by
`paymentRoute: 'PAYROLL'` — so a claim reimbursed by Finance is never even a candidate, has no payroll input
entry, and cannot acquire one.

**Claims are bound during CALCULATE, not by the `inputs/materialise` endpoint** — that endpoint carries
incentives. Worth knowing before looking for the link in the wrong place.

**The employee never sees the routing.** `whereTheMoneyIs` turns it into a sentence — *"Paid with your
salary"*, *"The clinic will reimburse you separately"* — because nobody photographing a receipt in a car park
should have to learn what a payroll input entry is.

---

## 3 · Leave → approval → roster, attendance and payroll

```
        Employee (My Kuwick)                 Manager (HR ▸ Leave)
               │                                     │
        POST /me/leave                        approve / reject
               │                                     │
               ▼                                     ▼
                        LeaveRequest  ← THE ONE RECORD OF AN ABSENCE
                              │
        ┌─────────────────────┼─────────────────────┬──────────────────────┐
        ▼                     ▼                     ▼                      ▼
  Roster cell          Attendance board     Appointment availability   Payroll
 (READ, never          ("on leave" is not   (an absent provider is     (UNPAID types
  copied into a         "not clocked in")    not bookable)              become a
  shift row)                                                            deduction)
```

**Approved leave is read in four places and stored in one.** The roster shows it in the cell and does
*not* copy it into a `ProviderShift` row — two records of the same absence is how they come to disagree. The
`LEAVE` shift type exists for the different case: an absence the roster knows about that HR has no request
for.

**Unpaid leave is the one leave type that reaches money.** It becomes an `UNPAID_LEAVE` payroll input at the
policy's daily rate. It is on the employee's own request form for exactly that reason — it is the type
somebody genuinely needs to be able to ask for, and the form says what it costs before they send it.

---

## 4 · Who may do what

| Act | Authorised by |
| --- | --- |
| See my own schedule, attendance, leave, claims, payslip | **Identity.** Every `/me` route resolves the actor and takes no staff id. There is deliberately no `hr.self.view` permission — a permission is something an owner can withhold, and nobody should be able to withhold somebody's own attendance record from them. |
| Clock myself in or out | Identity. Turning up for work is not administration. |
| Clock somebody else in | `hr.attendance.manage` |
| Ask for a correction to my own punch | Identity, plus an ownership check because the record id comes from the caller |
| Decide a correction | `hr.attendance.manage`, and never your own request |
| Approve overtime | `hr.attendance.manage`, and never your own |
| Add an employee | `hr.employee.manage` |
| Give that employee a login | `users.manage` — an HR clerk may hire; handing over the keys is the owner's act |
| Approve a claim and choose its route | `hr.payroll.approve`, and never your own claim |
| Read or write salary | `hr.salary.view` / payroll access, separate from `hr.view` |
| Run or approve payroll | `hr.payroll.run` / `hr.payroll.approve`, neither individually grantable |

A doctor's job title grants none of these. Clinical capability and management capability are separate axes,
and `uat-owner-management-access.e2e-spec.ts` holds that line: `OWNER_ADMIN` opens all six Management
domains, `DOCTOR_RESIDENT` is refused every one of them.

**Underneath all of it, the database refuses too.** Permissions decide what the application offers; row-level
security decides what Postgres will hand over at all. `rls-enforcement.e2e-spec.ts` now sweeps *every* table
carrying a tenant column — 156 of them, the two this pass added included — and fails if any has RLS
un-enabled, un-**forced**, or enabled with no policy behind it. FORCE is the half that matters: without it the
table's owner bypasses every policy, and migrations run as the owner. The sweep also asserts its own
population is large, because the first version of it asked for Prisma's field name rather than the mapped
column, matched nothing, and passed green while proving nothing.

---

## 5 · What this pass changed outside HR, and why

Two small changes in other domains. Both are data-safety fixes rather than features, and both were found by
tests written for this pass rather than by reading.

**`prisma/seed-staging-uat.ts` — every lookup now names its own tenant.** The seed opens its transaction with
`app.bypass_tenant_scope = true`, which it needs because the `tenants` table is FORCE RLS against its own id
and the very first insert cannot see itself otherwise. The bypass cuts both ways: with it on, a query that
does not name a tenant searches *every* tenant. `const existing = await tx.clinic.findFirst({ select: { id:
true } })` therefore adopted **another tenant's clinic** on any database that already held one, and the seed
wrote its entire synthetic world — patients, stock, staff, panel, queue — into somebody else's clinic while
leaving its own tenant with no clinic at all. Invisible in CI, where the database starts empty and this seed
runs first; certain on a developer machine, a shared UAT box, or any re-seed. All thirteen lookups in the
file now carry `tenantId: TENANT_ID`.

This is the same defect the HR augmentation had, found the same way, and it is worth naming as a class: **a
script that turns on the bypass has taken responsibility for scoping every query it then makes.**

**`prisma/seed-admin-uat.ts` — its reset list now covers the two tables this pass added.** That seed rebuilds
its own tenant and refuses to run if its ordered delete list does not cover every tenant-scoped table — a
guard whose own error message says it "fails the second time it is run, and only then". Adding
`attendance_policies` and `attendance_correction_requests` without adding them there would have broken the
next person to re-seed, days later, with no obvious cause. Correction requests point at the attendance record
they ask to change, so they are deleted first.

Nothing else outside HR was touched.
