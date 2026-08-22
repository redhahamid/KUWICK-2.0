# Kuwick Appointments — Owner & Staff Guide

*A guide for the people who run the clinic: the owner, the manager, the front
desk and the doctors. It explains how to set the appointment system up, how to
run it every day, and what your patients see. It is not a technical document —
nothing here needs a developer.*

*A screenshot tour of every screen named here lives in
[`docs/rc-final-screenshots/`](rc-final-screenshots/) — see the appendix at
the end of this guide.*

---

## Part A — Setting up, once (Owner or Manager)

Do these in order. The **setup checklist** on the Appointments calendar tracks
the same steps and links to each screen; it disappears by itself once the four
core steps are done.

### A1. Check your branch details

**Clinic Settings → Organisation & Branches**

Make sure each branch has its **phone number** filled in. That number is
offered to patients inside WhatsApp messages ("Need help? Call us at …") — if
it is blank, that sentence is simply left out of messages rather than printed
half-empty.

### A2. Booking rules — when this branch takes bookings

**Clinic Settings → Appointments & Scheduling → Branch Booking Rules**

- **Booking window** — the first and last session times. A doctor rostered
  outside these hours is not offered inside them: the window narrows a
  roster, it never widens one. A 24-hour branch leaves both blank.
- **Minimum notice** — how much warning a booking needs. Zero means a patient
  can book for right now.
- **Calendar display** — how the staff diary *looks*: Standard hours (with
  breathing room around your open/close times) or a full 24-hour axis for
  branches that work overnight. This only changes the diary's shape — it
  never hides bookings, and it never changes what can be booked.
- **Closed dates** — public holidays and shutdowns. Patients cannot book
  these days regardless of the roster.

### A3. Services — what can be booked

**Appointments → Services**

For each service you want patients (or the front desk) to book:

- Switch **Bookable** on. Nothing is bookable until you say so.
- Give it a **patient-friendly description** and, if you like, a **photo** —
  both appear on your public booking page. Photos are uploaded straight from
  this screen (JPG, PNG or WebP, up to 2 MB).
- Set the **duration**, and a **booking fee / deposit** if you take one. The
  fee is *recorded* against the booking and collected at the counter — Kuwick
  does not take online payments.
- Tick **Requires approval** if a human should confirm each request before it
  becomes a booking (these land on the List's **Requests** tab).
- Under **Providers**, choose who can perform it. A service with no providers
  cannot be booked by patients.
- Under **Scheduling**, set the slot interval and how many can run at once if
  the room, not the doctor, is the constraint.

### A4. Roster — who is working

**Appointments → Roster & Availability**

The roster answers one question: **who is working, when**. Availability for
booking is worked out from it (narrowed by the booking window and any leave),
and the calendar's shape is *not* taken from it — so an overnight shift never
scrambles the diary.

- Branches on a **weekly plan** set repeating hours per doctor; branches on
  **dated shifts** roster specific dates (including overnight shifts that end
  the next morning). Switching modes is effective-dated: the past is never
  rewritten.
- **Leave** taken through HR shows here and removes availability by itself.
- A doctor can be bookable for a *narrower* window than their shift when they
  do paperwork rounds at the edges of the day.

### A5. The public booking page — your patient-facing front door

**Appointments → Booking Page**

- **Design** — the name patients see, your logo (uploaded, or a URL under
  Advanced), the page language (English or Bahasa Malaysia) and a welcome
  line.
- **Patient details** — which details the page insists on (phone, email,
  NRIC). Name is always required. The page never reveals whether somebody is
  already your patient — matching happens quietly on the server.
- **Appointment Changes** — how patients may reschedule or cancel:
  - **Not allowed** — the page tells them to ring you.
  - **Request clinic approval** *(recommended)* — the patient asks; the
    booking stands untouched until you approve or decline.
  - **Allow instantly** — the patient changes it themselves.
  Also set the **cutoff** (e.g. "requests close 4 hours before") — after it,
  the page shows your phone number instead of buttons.
- **Sharing** — the public link, a printable poster and a QR code you can
  download and put on the counter.
- The **Active** switch turns the whole page on or off.

### A6. Messages and reminders — what Kuwick says to patients

**Clinic Settings → Appointments & Scheduling → Communication & Reminders**

- **Message templates** — nine messages (booking confirmation, request
  received, approved, reminder, reschedule/cancellation flows), each in
  English **and** Bahasa Malaysia. Edit the wording, tap placeholders like
  `{patient_name}` to insert facts, and watch the **live preview** fill in a
  sample appointment. *Reset to default* brings back the built-in wording.
  A fact that is missing (no phone on file, no booking link) removes its
  whole line from the message — you will never send "call us at ." to a
  patient.
- **Reminder rules** — when to nudge patients: 2 days, 1 day, 4 hours,
  2 hours, 1 hour before, or any custom timing. These rules build the
  **Reminders due** worklist on the appointment List.

**Be clear about what is automatic:** WhatsApp automation is **not
connected**. Kuwick prepares every message from your templates, but a person
presses the button, and the message goes from their own WhatsApp. Kuwick
records that the message window was *opened* — it will only ever claim
"Sent" or "Delivered" if a messaging provider that can confirm delivery is
connected in the future.

---

## Part B — The front desk, daily

### B1. Reading the day

**Appointments → Calendar** is the diary. Day, Week, Month and Providers
views; the axis holds the same shape whoever is rostered (it comes from the
branch's display settings, never from shifts). Bookings that fall outside the
displayed hours are announced on a notice with a one-tap **Show full 24
hours**. Cards get denser as slots get shorter but always lead with the time
and the patient's full name.

**Appointments → List** is the worklist: **Upcoming / Requests / In clinic /
Completed / No-shows / Cancelled / To be scheduled / Waitlist** tabs, with
filters for doctor, service, source and a patient search. The stats bar
always describes the rows you are looking at — when filters are on it says
**Filtered results**.

### B2. New bookings and requests

- **New appointment** (top right, every tab) books for a patient at the
  counter or on the phone.
- Online bookings for services marked *Requires approval* appear in
  **Requests** — open one and **Accept** or **Decline** it.
- The **bell** in the header collects what happened — new online bookings,
  requests, completions — with a toast for anything that arrives while you
  are working. **View appointment** jumps straight to the right drawer.

### B3. When the patient arrives

Open the appointment and press **Register / Check in**. The registration
drawer shows everything on one screen before anything is created:

- the appointment and the patient's record;
- **Payer** — Self-pay, or a Panel with the panel organisation and limit;
- the **attending doctor** (defaults to the booked provider — change it if
  someone else is seeing them; the booking itself keeps its original
  provider);
- the presenting complaint (pre-filled from the patient's own note).

**Confirm & add to queue** creates the visit and the queue ticket together
and shows the ticket number. Until that press, nothing has been created.

**Mark arrived** (in the ••• menu) is lighter: it records only that the
patient is at the desk — registration and the queue still happen at
Register / Check in.

### B4. Messaging patients

Anywhere you see **WhatsApp patient** (the appointment drawer) or the
WhatsApp button on a List row:

1. pick the message type (reminder, confirmation, and so on),
2. pick the language,
3. read — and tweak, if you like — the prefilled message,
4. **Open WhatsApp** and press send on your device.

The appointment's history then shows *WhatsApp opened*, with your name and
the time. **Reminders due** (on the List) is the same thing driven by the
clinic's reminder rules: it lists everybody whose reminder time has passed,
and each **Send** clears the row.

### B5. Changes and cancellations

- Staff reschedule from the drawer or List; the old time stays in the
  appointment's history ("Moved from …").
- If the clinic requires approval for patient changes, a patient's request
  appears as a banner in the appointment drawer with the reason and, for
  reschedules, the current time next to the requested one. **Approve** makes
  the change through the normal engine — if the requested slot has been taken
  meanwhile, Kuwick refuses and the request stays open for you to **Decline…**
  with a note (your note is shown to the patient word for word, so a
  suggested alternative — "we could do 15:30, ring us" — works well).
- **Mark as no-show** releases the slot and counts in the no-show rate.
- Every step of every appointment is kept in its **Activity** timeline —
  nothing is ever silently deleted.

---

## Part C — What your patients see

- Your public page walks them through **six steps** — service, provider (or
  *Any available*), **date**, **time**, their details, review — with a
  progress marker, and finishes with a **wallet-style confirmation card**:
  a scannable QR of their manage link, the booking reference, the
  when-and-where, add-to-calendar, directions (when your branch address is
  set), a WhatsApp-us button (when your phone is set) and the **private
  manage link**.
- The **date step is a colour-coded month**: green days have room, amber
  days have a few times left, grey days are full, closed days are simply
  not offered — and a *Fastest available* banner names the first free slot
  and its doctor. Nobody taps dates blind. The same calendar appears when a
  patient reschedules, with their current appointment marked.
- Picking a time always **names the real doctor** before anything is
  confirmed — the *Any available* path included.
- The review step says the price and any deposit plainly, and says that
  **payment is collected at the clinic — nothing is charged online**.
- Tapping a service's ⓘ shows its photo, price, deposit and description
  before they commit.
- **There are no star ratings or review counts anywhere on the page — by
  decision, not omission.** Kuwick has no patient review system yet, and
  the page will never show an invented number. If a review system is added
  later it must only count **verified completed visits, one review per
  completed appointment, moderated** — until then the cards carry facts:
  duration, price, description, and each doctor's next available time.
- The **manage link** shows their booking and — depending on your policy —
  lets them change or cancel it instantly, or send you a request with a
  reason. While a request is pending the page says plainly: *"Your
  appointment stays as booked until the clinic decides."* Your decision (and
  your note, if you declined) appears the next time they open the link.
- After the cutoff you set, the page shows your phone number instead of
  change buttons.
- The page never exposes staff who are not providers, and never reveals
  whether a phone number or IC already belongs to a patient of yours.

---

## Part D — What the owner watches

- **The List's stats bar** — upcoming, in clinic, completed, no-shows (with
  the rate), cancellations, and booking-fee money: expected vs collected.
  Filter by doctor, service or source and the numbers follow, labelled
  *Filtered results*.
- **Sources** — every booking records where it came from (front desk, online,
  walk-in), so you can see what your booking page is bringing in.
- **Requests and change requests** — the Requests tab and the drawer banners
  show what is waiting on a human decision.
- **The bell** keeps a per-person inbox of what happened, per branch.
- **Activity timelines** on each appointment are the audit trail: who did
  what, when, in plain words.
- Multi-branch clinics switch branch at the top of the module; every number
  and list follows the selected branch.

---

## Part E — When something looks wrong

**"A patient says they can't find a slot."**
In order: is the **service bookable** with at least one **provider**? Is the
doctor **rostered** that day (and not on leave)? Is the day a **closed
date**? Is the time outside the **booking window** or inside the **minimum
notice**? Each of these is a deliberate rule — the page only offers what all
of them allow.

**"The calendar shows strange hours."**
That is the branch's **Calendar display** setting (Booking Rules screen) —
Standard hours around your open/close, or the full 24-hour axis. It is not
taken from the roster, so one overnight shift cannot reshape the diary.

**"No reminder was sent."**
Kuwick never sends by itself — there is no WhatsApp gateway connected.
Reminder rules build the **Reminders due** list on the appointment List; a
person works through it. If the list is empty, check the rules on the
Communication & Reminders screen.

**"The booking page is down."**
Check the **Active** switch on Appointments → Booking Page. When it is off,
the public link and the patients' manage links are off with it.

**"An image won't upload."**
Images must be JPG, PNG or WebP and at most 2 MB. Anything else is refused
with a message saying so.

**"A patient asked to change their booking and nothing happened."**
If your policy is *Request clinic approval*, the request is waiting in the
appointment's drawer — the booking deliberately does not move until somebody
approves it.

**"A staff member can't press something."**
Buttons they may not use are disabled with an explanation of what permission
is missing. Roles are deliberate: the front desk runs the diary but does not
change clinic policy; configuration screens belong to the owner or manager.

**"Two receptionists answered the same request."**
They cannot — the first decision wins, the second is told it was already
decided.

---

*Kuwick Appointments claims nothing it cannot do: there is no WhatsApp
automation, no SMS or email sending, and no online payment collection. What
it does instead is keep every message, every decision and every change in
one place, in your clinic's own words.*

---

## Appendix — screenshot tour

Captured from the release-candidate build over a populated staging clinic
(`docs/rc-final-screenshots/`). Admin screens at desktop width (the diary also
at iPad landscape); the patient pages at mobile 390 px (the first and the
date/time steps also at iPad landscape).

**The clinic side**

| # | Screen | File |
|---|--------|------|
| 1 | Calendar — Day | `admin-01-calendar-day.png` (iPad: `admin-01b-calendar-day-ipad.png`) |
| 2 | Calendar — Week | `admin-02-calendar-week.png` |
| 3 | Calendar — Providers | `admin-03-calendar-providers.png` |
| 4 | One service filtered, chips + filtered KPIs | `admin-04-service-filter.png` |
| 5 | Appointment List with its stats bar | `admin-05-list.png` |
| 6 | Appointment drawer (checked-in, queue ticket) | `admin-06-appointment-drawer.png` |
| 7 | Activity timeline — request → approve → move → arrive | `admin-07-activity-timeline.png` |
| 8 | Register / Check-in review | `admin-08-register-checkin.png` |
| 9 | Payer — Panel with the panel catalogue | `admin-09-payer-panel.png` |
| 10 | Confirm & add to queue (ticket toast) | `admin-10-added-to-queue.png` |
| 11 | Notification Centre | `admin-11-notification-centre.png` |
| 12 | A new online booking toasting live | `admin-12-new-booking-toast.png` |
| 13 | Roster | `admin-13-roster.png` |
| 14 | Scheduling-mode timeline | `admin-14-scheduling-mode-timeline.png` |
| 15 | Online booking settings | `admin-15-online-booking-settings.png` |
| 16 | Communication & Reminders | `admin-16-communication-settings.png` |
| 17 | Setup checklist | `admin-17-setup-checklist.png` |

**The patient side**

| # | Step | File |
|---|------|------|
| 18 | Service selection | `public-18-service-selection.png` (iPad: `public-18b-service-selection-ipad.png`) |
| 19 | Service detail | `public-19-service-detail.png` |
| 20 | Doctor selection | `public-20-doctor-selection.png` |
| 21 | Date & time, grouped | `public-21-date-time.png` (iPad: `public-21b-date-time-ipad.png`) |
| 22 | Patient details | `public-22-patient-details.png` |
| 23 | Review | `public-23-review.png` |
| 24 | Confirmation with the manage link | `public-24-confirmation.png` |
| 25 | Manage booking | `public-25-manage-booking.png` |
| 26 | Reschedule request with reason | `public-26-reschedule-request.png` |
| 27 | Cancellation request with reason | `public-27-cancellation-request.png` |

### Axis acceptance (RC fix)

`docs/rc-final-screenshots/axis-acceptance/` — captured on a browser set to
Asia/Kuala_Lumpur after the diary-axis fix: the 24-hour axis (00:00 → 24:00,
48 rows) on Day/Week/iPad with a 23:00 booking on its own date and the 00:30
booking at the top of the NEXT date's canvas, and the standard 09:00–17:00
branch rendering a stable 08:00 → 18:00 band on every date and view.
