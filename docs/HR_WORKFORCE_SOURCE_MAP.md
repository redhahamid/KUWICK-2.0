# HR / Workforce — what already exists, and what is actually missing

Phase A of the HR/Workforce production pass. Written **before** any code changed, from the
repository at `aa0fa9d`, so that the work that follows extends what is here rather than
rebuilding it.

The headline: **the domain model is in far better shape than the user journey.** Most of what
the brief asks for structurally is already built and correct. What is missing is (a) an
employee-facing surface of any kind, (b) the roster's willingness to schedule anybody who is
not a doctor, and (c) clinic-configurable attendance policy. Three real defects are recorded
at the end.

---

## 1 · Identity — three concepts, correctly separate

| Concept | Table | What it means |
| --- | --- | --- |
| **Account** | `User` | An email and a password. May not exist: a staff record without a login is legitimate. |
| **Staff** | `Staff` | The person, their `role` (legacy job title), branch (`clinicId`), and their **clinical/professional** identity (`professionalType`, `medicalRegistrationNo`, `professionalActive`, `calendarColor`). |
| **Employment** | `EmployeeProfile` | `@unique` on `staffId`. Employment facts only: employee number, legal entity, department, position, dates, salary, bank, and the whole Malaysian statutory profile. |

This separation is right and is **kept**. A doctor is not automatically an employee; an
employee is not automatically a provider; a staff member is not automatically a login. What
the brief correctly identifies is that the separation is *invisible to the user* — there is no
screen that says "this staff record has no employment profile yet".

## 2 · The canonical roster — one, and already instant-based

`ProviderShift` is the only shift table. It stores **instants** (`startsAt`/`endsAt`), not
weekday + time, which means the three things the brief asks for already work at the model
level:

- **overnight shifts** — 23:00→07:00 is one row whose `endsAt` is the next day; nothing splits at midnight
- **two shifts in one day** — two rows, same `shiftDate`
- **why somebody is absent** — `shiftType` is WORKING / OFF / LEAVE / BLOCKED / LOCUM

`shiftDate` is the **clinic-local** date the shift *starts*, which is how a roster is read
aloud and how it is paid. `bookableStartsAt`/`bookableEndsAt` narrow appointment availability
*inside* a shift, so booking is a view of the roster rather than a second schedule.

`apps/web/src/admin/hr/RosterPage.tsx` is a 36-line wrapper that imports the appointment
module's `RosterPage`. There is no second roster and none will be built.

**The gap.** `provider-shift.service.ts:115` builds the monthly matrix from
`role: { in: [DOCTOR_RESIDENT, DOCTOR_LOCUM] }`. The table and `create()` accept any
`staffId`; only the *read* is doctors-only. A receptionist cannot be rostered through the UI.
The filter was added for a good reason (non-doctors rendered as empty weekly-availability rows,
which is noise), and the answer is to give non-providers a row that means something rather than
to hide them.

## 3 · Attendance — reconciles against the roster already

`AttendanceRecord` (`@@unique [tenantId, staffId, workDate]`) holds punches
(`clockInAt`/`clockOutAt`), the shift they were measured against
(`scheduledStart`/`scheduledEnd`, *read* from the roster and never written back), the derived
differences, and the correction trail (`originalClockInAt`, `correctedByStaffId`,
`correctionReason`).

`attendance-hours.ts::computeAttendance` is pure and instant-based, and already distinguishes
the states the brief asks for: ABSENT (no punches) is not MISSING_PUNCH (one punch) is not
PRESENT/LATE. Crucially it computes `excessMinutes` — minutes beyond the scheduled end — and
the service comments that **excess is not overtime until somebody approves it**
(`overtimeApproved` is a separate boolean with its own approver).

**The gaps.** `LATE_GRACE_MINUTES = 5` is a module constant, so every clinic in every tenant
has the same grace period; the brief requires this to be clinic policy. And there is no
concept of a short-time *exception* to resolve — `earlyOutMinutes` is computed and then
nothing consumes it.

## 4 · Leave — canonical, and already reaches both roster and payroll

`LeaveRequest` is read by the roster matrix (approved leave renders in the cell, and is
deliberately **not** copied into a shift row — "two records of the same absence is how they
come to disagree") and by payroll (`payroll.service.ts:1038`, unpaid types become
`UNPAID_LEAVE` input rows at a daily rate). Balances live in `leave-balance.ts`.

## 5 · Claims — the exactly-once guard is already in the schema

`StaffClaim` carries `paymentRoute` (payroll vs Finance), `payoutStatus`, and
`payrollInputEntryId String? @unique`. The uniqueness **is** the double-payment guard: one
claim can back at most one payroll input row, enforced by the database rather than by a
service remembering to check. `StaffClaimAttachment` holds receipts and
`StaffClaimEvent` the audit trail.

## 6 · Payroll — validated, and not to be rebuilt

Effective-dated salary, statutory classification and employer profile; a six-step journey; a
hashed snapshot; the owner-selected EPF contribution basis (advisory, never blocking — locked
product decision at `393ebb9`); the honesty ladder on payment; thirteen reports; the Finance
contract that serves only verified approved snapshots. `payroll-input.service.ts` is the one
door through which upstream facts become payable amounts.

---

## 7 · What is genuinely absent

**An employee-facing surface. Any at all.** There are no `/me` routes in the API and no
non-admin workforce routes in the web app. Every capability an employee needs — see my shift,
clock in, request leave, submit a claim, read my payslip — exists only behind
Administration ▸ HR, which requires `hr.view` and shows every other employee's data. An
ordinary staff member cannot use this product today.

There are also **no self-scoped permissions**, and there should not be: a self-service route is
authorised by *identity* (you are this staff member), not by a grant. Adding an `hr.self.view`
permission would be a grant that could be withheld from somebody for their own attendance.

## 8 · Three defects found during this audit

| # | Severity | Defect |
| --- | --- | --- |
| 1 | **Malaysia timezone — real** | `attendance-record.service.ts::utcDay` files a punch against the **UTC** date. Malaysia is UTC+8, so a 07:00 MYT clock-in is 23:00 UTC the day before and lands on the wrong `workDate`; the same shift's clock-out at 15:00 MYT lands on the right one, opening a second record with no clock-in. Every clinic opening before 08:00 is affected, and a 23:00→07:00 night shift is affected at both ends. |
| 2 | **Two attendance sources of truth** | `hr/attendance.service.ts` derives attendance from `Visit.checkInAt/checkOutAt` — patient traffic, not punches — and is still mounted at `GET /attendance` and rendered at `/management/hr/attendance`. `workforce/attendance-record.service.ts` reads real punches against the roster and is rendered at `/admin/hr/attendance`. Two screens, both labelled attendance, answering different questions from different tables. |
| 3 | Hardcoded policy | `LATE_GRACE_MINUTES = 5`, global to the deployment. Grace, OT threshold, rounding, break treatment and missing-punch handling are all clinic decisions and none of them is configurable. |

## 9 · The shape of the work that follows

Extend, in this order:

1. **Employee self-service** — new `/me/*` API authorised by identity, and a mobile-first web area. Nothing else in the brief matters if staff cannot reach the product.
2. **Roster workforce extension** — widen the matrix read, add a workforce-category filter, keep booking reading only providers.
3. **Attendance correctness and policy** — clinic-local day, one attendance source, configurable policy.
4. **Employee master** — a guided create, and a surface for staff with no employment profile.
5. **HR Today** — a command centre over the canonical roster and the real approval queues.
6. **Hybrid synthetic UAT data**, additive and idempotent, against the existing staging tenant.
