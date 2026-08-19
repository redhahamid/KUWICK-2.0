# Appointment & Scheduling — Architecture Audit (Checkpoint A)

Baseline: branch `claude/kuwick-2-0-session-opener-bfumia` at `e590270`,
working tree clean, one commit unmerged to `origin/master` (`f7df6e0`).
Nothing was modified to produce this report.

---

## 1. What already exists and should be REUSED

| Concern | Existing asset | Verdict |
|---|---|---|
| Availability computation | `SlotAvailabilityService.findAvailability` — one server-side path, six constraints, named refusal reasons | **Reuse as the engine's core.** Already the single source; extend it, do not replace it. |
| Booking validation | `AppointmentBookingValidator` — asks the engine, never re-derives rules | **Reuse.** This is the "one path" the spec asks for and it is already right. |
| Clinic timezone | `Clinic.timezone` + `appointment/time.util.ts` (`zonedWallClockToInstant`, `clinicDayBounds`) | **Reuse.** §41 is already satisfied server-side. |
| Provider identity | `Staff` (+ `StaffRoleAssignment`, `ProfessionalType`, `StaffProfessionalAudit`) | **Reuse.** No new provider entity. |
| Service master | `ServiceCatalog` (+ the booking columns added in piece 1) | **Reuse.** Already extends rather than duplicates. |
| Patient | `Patient` (+ `PatientIdentityChange`) | **Reuse.** |
| Visit / Queue | `Visit`, `QueueTicket`, `QueueType.APPOINTMENT`, `VisitWorkflowEvent`, `VisitCompletionService` | **Reuse.** `Appointment.visitId` link landed in piece 3. |
| Roster storage | `DoctorSchedule`, `ScheduleException` | **Reuse the tables**; the UX and the shift model need rework (see §3). |
| Provider↔service | `DoctorServiceQualification` | **Keep the junction, retire the page.** |
| Permissions | `apps/api/src/core/permissions.ts` — mature, granular, role→permission | **Reuse the mechanism.** Appointments currently define **zero** permissions. |
| Audit | Per-domain append-only tables (`VisitWorkflowEvent` ×8 writers, `PatientIdentityChange`, `ClinicalNoteRevision`, `DataCorrection`) | **Reuse the pattern**, not the unused generic `AuditLog`. |
| Billing | `Invoice` / `InvoiceLine`, payment on the invoice (`paidAt`, `paymentMethod`, `patientPaidAmount`) | **Reuse.** There is no separate `Payment` model. |

---

## 2. DUPLICATED CONCEPTS — the important findings

### 2.1 Two roster UIs that actively destroy each other's data ⚠ HIGH
- `/management/operation/doctor-schedules` (`DoctorSchedulesPage`, in the MAIN nav as "Schedules") — adds individual rows with `effectiveFrom`/`effectiveTo`.
- `/settings/scheduling/provider-availability` (`ProviderAvailabilityPage`, piece 1) — **`deleteMany` then recreate the whole week**.

Same table, two mental models. Saving in Provider Availability **silently deletes** rows the Schedules page created, including their effective-dating. This is a live data-loss bug, not merely an IA problem.

### 2.2 Closed dates exist twice ⚠
- `PublicHoliday` — tenant-wide, `date` + `name`, owned by the HR module, **has a live service**.
- `ClinicClosedDate` — branch-scoped, `date` + `reason` + author, added in piece 1.

Both answer "is the clinic shut". Branch scope is the correct grain (HR's is tenant-wide), but two tables is the duplication the brief forbids.

### 2.3 Approved leave does not reach the availability engine ⚠ HIGH — correctness
`LeaveRequest` (with `LeaveStatus`, approver, date range) is live in HR. The availability engine consults **neither** `LeaveRequest` **nor** `PublicHoliday` — verified by grep, zero references. **A doctor on approved leave is still offered for booking**, and staff must re-enter the same absence as a `ScheduleException`.

### 2.4 A third payment location
Piece 2 added `Appointment.bookingFeeAmount/PaidAt/Reference`. Money already lives on `Invoice`. §28 requires the deposit to be applicable to the clinic invoice — the link does not exist yet.

### 2.5 Reminder state vs the unused notification log
Piece 2 added `Appointment.reminderSentAt/ByStaffId`. `NotificationLog` (channel, recipient, status, sentAt, payload) exists with **zero writers**. §29–§30 need a log with multiple reminders per appointment; the single column cannot express it.

---

## 3. SCHEMA GAPS against the specification

| # | Gap | Evidence |
|---|---|---|
| G1 | **Overnight shifts impossible.** `DoctorSchedule` is `dayOfWeek` + `startTime`/`endTime` as `@db.Time`. A 23:00→09:00 shift yields `end < start`; the engine's loop `cursor + durationMs <= window.end` never executes → zero slots. §11/§44.3 fail. | schema + `slot-availability.service.ts:258` |
| G2 | **Multiple shifts per day impossible.** `ScheduleException` is `@@unique([tenant, staff, clinic, date])` — one row per date, one window. §11 requires split AM/PM. | schema |
| G3 | **No roster/shift concept.** No shift types (OFF / leave / blocked / locum), no monthly matrix, no roster-linked vs fixed-weekly mode. §10–§12. | absent |
| G4 | **Lifecycle mismatch.** Enum is `REQUESTED, CONFIRMED, REMINDED, ARRIVED, IN_QUEUE, COMPLETED, RESCHEDULED, CANCELLED, NO_SHOW`. Spec wants `CHECKED_IN` and `WAITLIST`; `REMINDED` is a status where it should be a fact; `RESCHEDULED` is a terminal state where it should be `CANCELLED` + reason + link. §6. | schema |
| G5 | **No reschedule linkage in the spec's shape.** `rescheduledFromId` exists but the old row becomes `RESCHEDULED`, not `CANCELLED(reason=RESCHEDULED)`. No `replacementAppointmentId` semantics. §6. | schema |
| G6 | **No status history.** No table records previous→new state, actor, reason, source. §6/§40. | absent |
| G7 | **No appointment permissions.** Endpoints are gated by `requireActor` only — **any authenticated staff member can book, cancel or no-show**, including STOCK_STAFF and FINANCE_STAFF. §39. | `permissions.ts`, `appointment.service.ts` |
| G8 | **No audit rows for appointments.** §40. | absent |
| G9 | **`AppointmentSource` has 2 values** (`ONLINE_PORTAL`, `FRONT_DESK`); §33 wants ~10 plus referral/UTM metadata. | schema |
| G10 | **No buffers, no max-advance-booking, no per-service bookable hours.** Service has duration, interval, concurrent limit, requiresApproval. §16 also needs buffer before/after, max advance, optional online-booking hours. | schema |
| G11 | **No public booking surface, no patient identity matching, no tokenised self-management.** §23–§25, §34. | absent |
| G12 | **No custom booking form, no instructions.** §26–§27. | absent |
| G13 | **No recurring series, no waitlist.** §35–§36. | absent |
| G14 | **No concurrency guarantee.** The validator re-checks availability but there is no transaction/lock/constraint making two simultaneous bookings of a capacity-1 slot impossible, and no idempotency key. §20. | `appointment-booking-validator.service.ts` |
| G15 | **Capacity is per doctor+service only** (`SlotCapacityConfig.dailyCapacity` + `ServiceCatalog.concurrentLimit`). No resource/room capacity despite `Room` existing. §18. | schema |

---

## 4. MIGRATION REQUIREMENTS (no data deleted)

1. **Roster model** — new `ProviderShift` (staff, clinic, **start/end as instants or date+time+crossesMidnight**, shift type, source) replacing the day-of-week/time-only model. Backfill from `DoctorSchedule` by expanding the weekly pattern forward over the booking horizon. Keep `DoctorSchedule` as the *fixed-weekly* mode (§10B) — it is exactly that already.
2. **Closed dates** — keep `ClinicClosedDate` as the branch-grain truth; make `PublicHoliday` a tenant-level *template* that seeds it, or read both in the engine. Do not drop either table.
3. **Leave** — read approved `LeaveRequest` in the engine. No schema change; a join and a rule.
4. **Lifecycle** — add `CHECKED_IN`, `WAITLIST`. Migrate `RESCHEDULED` rows to `CANCELLED` + `cancellationReason = RESCHEDULED` in a data migration that preserves `rescheduledFromId`. Retire `REMINDED` as a *status* only after the notification log carries the fact.
5. **New tables** — `AppointmentStatusHistory`, `AppointmentSeries`, `WaitlistEntry`, `BookingFormField`/`BookingAnswer`, `AppointmentCommunication` (or use `NotificationLog` with an entity link).
6. **Permissions** — additive rows in `permissions.ts`; no migration.

---

## 5. ROUTES AFFECTED

Retired as user-facing: `/settings/scheduling/doctor-service-mapping`, `/settings/scheduling/slot-capacity`, and one of the two roster pages.
Reworked: `/appointments` (Calendar default), `/settings/scheduling/*` → Appointment-module tabs.
New: public booking (`/:clinicSlug`, `/:clinicSlug/:serviceSlug`), tokenised manage-booking.
Backend junctions stay; only their presentation moves.

---

## 6. COMPATIBILITY RISKS

- **R1 — the roster rewrite is the riskiest step.** `DoctorSchedule` is read by the engine, the calendar's working-hours shading, and both roster pages. Sequencing must be: new model → engine reads both → UI moves → old writer retired.
- **R2 — lifecycle migration touches the dashboard's tab/stat definitions** (`TAB_STATUSES`) and the e2e assertions.
- **R3 — adding permissions to previously ungated endpoints will break callers** that relied on any-staff access, including the golden-path e2e (front desk books and arrives).
- **R4 — `/management/operation/doctor-schedules` is in the MAIN nav**; removing it changes muscle memory and must redirect, not 404.
- **R5 — piece 3 is unmerged and CI's e2e is stalled on infrastructure.** This work should not stack on an unverified base; land or resolve `e590270` first.

---

## 7. PROPOSED FINAL ARCHITECTURE

**Module IA** — `Appointments` with tabs: **Calendar | List | Roster & Availability | Services | Booking Page**, plus a Settings action. No user-facing "Doctor-Service Mapping" or "Slot Capacity".

**One roster.** `Appointments → Roster & Availability` and the main-nav Schedules entry render the *same* monthly matrix over the *same* data. Two provider modes: ROSTER-LINKED (default) and FIXED WEEKLY (`DoctorSchedule`).

**Availability engine** stays the single server-side authority, extended to intersect: branch rules → provider mode → roster/weekly → **approved leave** → **closed dates (branch + holiday)** → service eligibility → service bookable hours → duration/interval/buffers → notice/horizon → existing appointments → capacity → resources. Every caller (staff, public, patient app) uses it.

**Appointment is not a Visit.** Check-in creates/attaches the Visit and the type-A queue ticket and records both ids; visit completion completes the appointment. Both landed in piece 3 and stay.

**Audit** follows the house pattern: an append-only `AppointmentStatusHistory` beside the row, in the same transaction as the change — as `VisitWorkflowEvent` does.

---

## 8. RECOMMENDED SEQUENCE

Checkpoint B should be **domain model + availability engine + tests only**, in this order:
1. Leave + closed dates into the engine (**correctness bug, small, immediately valuable**).
2. Shift model with overnight/multi-shift support, engine reads it, `DoctorSchedule` kept as fixed-weekly.
3. Lifecycle + status history + permissions.
4. Buffers, max-advance, per-service hours.
5. Concurrency guarantee + idempotency.

Only then Checkpoint C (Calendar/List).
