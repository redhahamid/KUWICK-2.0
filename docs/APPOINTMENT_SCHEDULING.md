# Appointments & Scheduling — how it works

The reference for the module the redesign produced. Written for the next
person to change it, so every rule that is not obvious says why it is that way.

---

## 1. One engine, one path

`SlotAvailabilityService.findAvailability` is the only thing in this system
that answers "when is this bookable". Every surface asks it: the front desk,
the calendar, the canvas follow-up card, the public booking page, and a patient
moving their own appointment. `AppointmentBookingValidator` does not re-derive
any rule — it asks the engine for the day's slots and checks the requested time
is one of them.

That is a hard constraint, not a preference. A second implementation of "is
this free" is how a screen offers a slot the server then refuses, and how a
clinic gets double-booked by two surfaces that each believed themselves.

### The precedence (§27), first refusal wins

| # | Question | Source | Refusal |
|---|---|---|---|
| 1 | Is the building shut? | `ClinicClosedDate` | `CLINIC_CLOSED` |
| 2 | Public holiday this branch observes? | `PublicHoliday` + `ClinicBookingSettings.observePublicHolidays` | `PUBLIC_HOLIDAY` |
| 3 | Is the service bookable? | `ServiceCatalog.bookable/active` | `SERVICE_NOT_BOOKABLE` |
| 4 | Is the provider on approved leave? | `LeaveRequest` (APPROVED) | `ON_LEAVE` |
| 5 | Off / blocked that day? | `ProviderShift`, `ScheduleException` | `PROVIDER_BLOCKED` |
| 6 | Rostered at all? | `ProviderShift` \| `DoctorSchedule` | `NOT_ROSTERED` |
| 7 | May they perform it? | `DoctorServiceQualification` | `NOT_QUALIFIED` |
| 8 | Inside the service's own hours? | `ServiceBookableHour` | `OUTSIDE_SERVICE_HOURS` |
| 9 | Inside the branch's booking band? | `ClinicBookingSettings` | `OUTSIDE_BOOKING_WINDOW` |
| 10 | Duration + interval + buffers | `ServiceCatalog`, `SlotCapacityConfig` | — |
| 11 | Notice and horizon | service overrides branch | `TOO_LATE_TO_BOOK`, `TOO_FAR_AHEAD` |
| 12 | Existing bookings and capacity | `Appointment`, `concurrentLimit`, `dailyCapacity` | `FULLY_BOOKED` |

Every comparison happens in the clinic's wall clock, converted through
`Clinic.timezone`. See the block comment in `time.util.ts` for why a UTC test
runner hid an eight-hour error for weeks.

**Duration, interval and buffer are three different numbers.** The duration is
how long the appointment runs; the interval is how often one may start; the
buffers are turnover nobody else may occupy. A 45-minute service on a 30-minute
interval offers 09:00, 09:30, 10:00 — and every candidate still needs 45 free
minutes plus its buffers behind it.

---

## 2. Two scheduling modes, one roster

`Staff.appointmentScheduleMode` decides which model a provider's availability
comes from. A clinic maintains ONE of them, never both.

- **`ROSTER_LINKED`** — `ProviderShift` rows are the truth. Two INSTANTS per
  shift, so 23:00→09:00 crosses midnight, a month end and a DST boundary with
  no special case; many rows per date, so a split 08:00–15:00 / 20:00–23:00 day
  is two rows; and `shiftType` records WHY somebody is absent (OFF, LEAVE,
  BLOCKED) instead of an empty cell meaning four things.
- **`FIXED_WEEKLY`** — a standing `DoctorSchedule` pattern, which is what most
  single-doctor clinics have. It now reads an inverted time pair as an
  overnight shift too, and consults the previous weekday so last night's shift
  is still offered this morning.

`ProviderShift.bookableStartsAt/EndsAt` narrows appointment hours INSIDE a
shift (§19) without duplicating the roster.

### What was fixed here

The weekly form used to `deleteMany` every `DoctorSchedule` row for the pair —
including the effective-dated rows the separate Schedules page created. Saving
one screen silently destroyed the other's data. Rows already in force are now
END-DATED to yesterday; rows that had not taken effect are replaced. Pinned by
`roster-history-is-not-destroyed.spec.ts`.

---

## 3. Leave and closures are read, never re-entered

`LeaveRequest` is HR's. The engine reads approved leave directly, and the
roster matrix shows it as a fact it does not own. Before this, the engine had
never heard of leave: a doctor on approved annual leave was still offered for
booking unless somebody typed the absence a second time as a schedule
exception.

`PublicHoliday` (tenant-wide, HR's national calendar) and `ClinicClosedDate`
(this branch's own decision) are **different concepts**, not duplicates. A
branch opts into the national calendar with
`ClinicBookingSettings.observePublicHolidays`, which defaults FALSE so no
migration ever shut a diary nobody asked to shut.

---

## 4. Lifecycle

```
REQUESTED ──accept──► CONFIRMED ──arrive──► ARRIVED ──check in──► CHECKED_IN ──visit completes──► COMPLETED
    │                     │                    │
    └──reject───────► CANCELLED ◄──cancel──────┘
                          ▲
CONFIRMED ──no-show──► NO_SHOW
```

- **ARRIVED** is a person at the desk. **CHECKED_IN** asserts a visit and a
  type-A queue ticket exist and are linked. They are separate so a busy counter
  can say "they're here" without committing to the clinical record.
- **Rescheduling preserves history**: the original becomes `CANCELLED` with
  `cancellationReason = RESCHEDULED` and the replacement points back at it. It
  is never deleted, and there is no terminal `RESCHEDULED` status any more —
  that lost the fact that the patient did not cancel, they moved.
- **WAITLIST** appears in the enum but is not a lifecycle state anything writes:
  a waitlist entry is its own record (`WaitlistEntry`) because it has a date
  RANGE and no time.
- `REMINDED`, `RESCHEDULED` and `IN_QUEUE` are **deprecated**. Nothing writes
  them; they remain so no historical row becomes unreadable.

`REQUESTED` occupies its slot. Two people cannot each be told they might get
the last 10:00; rejecting one releases it.

---

## 5. History and audit

`AppointmentEvent` is append-only — RLS, plus BEFORE DELETE and BEFORE TRUNCATE
triggers that fire for every role including a superuser. Every state change
writes one **in the same transaction as the change**, with the actor's name
snapshotted beside their id.

One table rather than a status-history table plus an audit table: "the provider
was changed" and "the status became CANCELLED" are the same kind of fact about
the same row, and splitting them is how one of the two ends up not written.

---

## 6. Permissions

Ten named permissions: `appointment.view`, `.create`, `.edit`, `.reschedule`,
`.cancel`, `.check_in`, `.no_show`, `.override`, `.configure`,
`.manage_roster`.

| Role | Holds |
|---|---|
| ADMINISTRATOR (front counter) | view, create, edit, reschedule, cancel, check_in, no_show |
| CLINICAL_STAFF | the same seven |
| DOCTOR | view, create, edit, reschedule, cancel, no_show — **not** check_in |
| OWNER | all ten |
| finance / stock / HR / panel | **none** |

`appointment.override` and `appointment.manage_roster` are individually
grantable, so a practice manager who is not an owner can hold them by name.

**An override is a permission plus a reason plus a named rule.** A `force` flag
from a browser is a request, never an authorisation, and no override can bypass
approved leave, a closed branch, or an unqualified provider — those are facts
about the world, not scheduling conventions.

---

## 7. Concurrency and idempotency

Two sorted advisory locks — `(clinic, provider, clinic-date)` and
`(clinic, service, clinic-date)` — are taken **before** the availability check,
so a second racer re-reads a diary that already contains the first booking.
Sorted because two transactions grabbing the same pair in opposite orders is
the textbook deadlock. The `appointments_no_overlap` EXCLUDE constraint remains
underneath as the database's own refusal.

`Appointment.idempotencyKey` (unique per tenant, partial index) makes a retried
POST return the booking it already made.

---

## 8. Public booking

`/book/:slug` and `/book/:slug/:serviceSlug`, unauthenticated and NOT unscoped.

The bootstrap — "whose clinic is this?" — cannot go through a policy that
scopes by tenant, so `clinic_booking_pages` carries a second RLS policy
allowing ACTIVE rows to be read without tenant context. That table holds no
patient data; that is why it is separate from the appointments it leads to.
From that answer on, the resolved tenant is pushed into the request context and
every read and write goes through ordinary RLS.

**Identity matching** (§33) is deliberately conservative:

| Outcome | When |
|---|---|
| `MATCHED_IDENTIFIER` | the IC or passport matches exactly |
| `MATCHED_PHONE_AND_NAME` | no identifier, but phone AND name both match exactly one record |
| `CREATED_NEW` | an identifier was given and matched nothing |
| `NEEDS_REVIEW` | anything less — a new record, flagged for staff reconciliation |

Merging two people is a clinical safety incident; a duplicate is an afternoon's
tidying. Nothing in any response says which branch ran, so the page is not an
IC-enumeration oracle.

**Manage my booking** is `/book/:slug/manage/:token`. The slug is load-bearing:
appointments are behind RLS, so a bare token cannot be looked up without a
tenant to scope by. Rescheduling issues a NEW token, so a forwarded SMS link
cannot move the appointment twice.

---

## 9. Money

Appointment status and payment status are separate (§36). A paid booking fee is
applied to the clinic invoice when it is raised — recorded as an amount the
patient has already paid, and linked on the APPOINTMENT so it can never be
applied twice.

The List's two figures mean different things: **Booked value** is what the
diary is worth if it all happens (booking fees snapshotted, service prices
live); **Realised revenue** reads the INVOICES on the visits those appointments
became. Reading the price list twice and calling the second reading "realised"
would be a forecast wearing an actual's name.

---

## 10. Communications

**Kuwick has no message gateway.** There is no WhatsApp Business integration,
no SMS provider and no mail transport in this repository, and nothing here
pretends otherwise. The channel that works today is a receptionist pressing
"WhatsApp patient", a `wa.me` link opening on their own phone, and them sending
it — recorded as `MANUAL`, a first-class status.

`AppointmentCommunication` is shaped for the gateway that does not exist yet
(queued / sent / failed / provider message id) so adding one is a writer
against this log rather than a second log. `AppointmentReminderRule` holds zero,
one or many offsets per clinic or per service, and
`/appointment-communications/due` is the counter's worklist.

---

## 11. Deliberately not built

- **Automatic waitlist notification.** The matching query exists and returns
  the list in the clinic's own order. Texting the top of it is a judgement —
  the 4pm that suits a retiree does not suit a parent — and a system that got
  it wrong often enough would be turned off. The architecture supports it; the
  decision to send is not this release's.
- **Desktop drag-and-drop.** `react-big-calendar`'s DnD addon does not survive
  this project's production bundle (`(0, addon.default) is not a function`) and,
  because the router mounts at the root, blanks the entire application.
  Pick-up-and-place is the baseline §48 asks for, works identically on a
  tablet, and goes through the same server-side reschedule endpoint.
- **A patient app surface.** The domain and the engine are ready for it (§47);
  no mobile client exists to consume them.
