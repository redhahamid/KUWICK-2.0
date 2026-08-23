# Final visual convergence — MOCKUP vs FINAL IMPLEMENTATION

Captured from the production build (`vite build` + `vite preview`) over the
seeded QA world, after the convergence pass the owner approved on
2026-08-23. Backend, availability engine, RBAC, RLS, booking/reschedule
logic, reminders and payment honesty are untouched; the API was not modified
at all. Green on this exact code: web typecheck, **1600/1600** web unit
tests, production build, and the appointment **e2e 8/8** including the
Asia/Kuala_Lumpur timezone twin.

## The table

| # | Surface / shot | Mockup panel | What now matches | Remaining deviation & why |
|---|---|---|---|---|
| 1 | `01-calendar-month.png` | Clinic 1 | Calm white canvas, provider-wash chips with 3px identity bar, navy today circle, uppercase weekday micro-headers, teal “+ n more”, status-summary bar closing the canvas, dot-legend counts top right | Month stays **Sunday-first** — the owner's decision, and the mockup's own month panel draws it that way |
| 2 | `02-calendar-week.png` | Clinic 2 | **Monday → Sunday** (“17 Aug – 23 Aug”), separated pastel cards per doctor with time / patient / service / 16px doctor avatar, whitespace between cards, navy today pill, rose now-line + gutter time pill, status bar | No per-column “No appointments” caption — react-big-calendar has no per-column empty state; the column simply reads empty |
| 3 | `03-calendar-providers.png` | Clinic 3 | Left provider rail (avatar + name + count, selection highlighted), white day-schedule cards, right mini-month driving the same anchor, Provider summary (appointments, booked value from the server, in clinic, completed, no-show) | Utilisation renders only when that provider has rostered WORKING minutes that day; the QA world has one provider |
| 4 | `04-appointment-list.png` | Clinic 4 | Status counts as tab badges, patient + provider avatars, status chips, ink Check-in buttons, uppercase headers, filter row, hover | Keeps the §46 money strip and the Payment / Reminder / Source / WhatsApp columns — operational data the owner ordered preserved |
| 5 | `05-checkin-drawer.png` `05b-checkin-visit-info.png` | Clinic 5 | **Patient Details \| Visit Info tabs, Patient Details default.** Identity rail: avatar, name, phone · age, **Returning · n visits · last date**, allergy line, appointment icon rows, source + ref. Patient tab: grouped record + **Allergies** and **Important information**; Visit tab: attending doctor, branch, remarks, payer, payment; ink Confirm & add to queue | Clinical context is **read-only** — allergies/alerts are recorded by clinical staff on the patient record, and nothing is copied into the demographic model |
| 6 | `06-new-appointment.png` | Patient stepper, module edition | Numbered stepper chips, selected-patient card with teal edge + avatar + IC/phone + Change, service decision cards | — |
| 7 | `07-reminder-centre.png` | Clinic 7 | Summary tiles + worklist columns time · patient · appointment · type · channel · action, Send / Send early, “Sent by hand” | Tiles are Due now / Later today / Next 7 days / Sent·7 days — each derived from the real lists. No “Overdue”/“Failed” tile and no “Send all”: no delivery tracking and no bulk send exist, and a person presses Send in WhatsApp |
| 8 | `08-appointment-detail.png` | Clinic 8 | **Appointment #REF header + status chip**, patient identity block, booking facts left, **Activity timeline right**, action footer: ink Register / Check in, Reschedule, more-actions “…” | Reference is Kuwick's own 8-character booking reference (the code the clinic and patient already quote), not the mockup's invented `APT-240826-0012` format |
| 9 | `09-patient-service.png` | Patient 1 | Premium service cards: duration, genuine price / from-price, description, info sheet — **photo when the clinic has uploaded one, calm monogram tile when it has not** | No stock clinical photography; no ratings (no review system exists) |
| 10 | `10-patient-doctor.png` | Patient 2 | Teal ⚡ fastest banner, Any-available card leading, Calendly-style rows: shared tinted avatar, right-aligned Next available + chevron | No specialty / experience / languages / ratings — no data source |
| 11 | `11-patient-date.png` | Patient 3 | Airline month: green / amber / grey filled circles, blue selected, legend, fastest-available bar naming the real doctor | — |
| 12 | `12-patient-time.png` | Patient 4 | Morning / Afternoon / Evening groups, selection-blue chip, “you selected” card revealing the assigned doctor with avatar | — |
| 13 | `13-patient-review.png` | Patient 6 | Labelled Appointment summary rows (Service / Doctor / Date / Time / Duration / Clinic / For) + Payment summary | No FPX / card / eWallet buttons — nothing charges online; the card says the clinic collects on arrival |
| 14 | `14-patient-confirmation.png` | Patient 7 | One wallet-style gradient card: headline on the gradient, white QR ticket (clinic, booking ref, service, doctor, date, time, location), 2×2 action grid | No “Add to Apple Wallet” — no pass-signing certificates exist |
| 15 | `15-communication-centre.png` `15b-communication-reminders.png` | Clinic 6 | **Internal dark sub-navigation** — Overview, Templates, Reminders with Confirmation / Reminder / Reschedule / Cancellation / No-show nested, Broadcast marked **SOON** and disabled — template editor, language switch, variable chips, **WhatsApp-style green preview bubble**, reminder-rule timing controls | Nested entries preselect **real template keys in the same store** — no second configuration store was created. **No-show** has no template in the message store, so that entry says so rather than opening an editor that writes nowhere; **Broadcast** is genuinely unbuilt |
| 16 | `16-patient-reschedule.png` | Patient reschedule strip | The SAME AvailabilityCalendar component and slot-chip classes as booking: fastest bar, colour-coded dates, “Current appointment” ring, blue selection | — |

## Standing honest omissions (owner-approved, layout kept future-ready)

Star ratings / reviews · doctor specialty, experience, languages · FPX / card /
eWallet payment UI · Apple Wallet pass. Each has a place in the composition it
would occupy, so adding a real capability later is a data change, not a
redesign.

## What changed structurally in this pass

- **Week view Monday-first** via a week-only localizer instance. dayjs's global
  week start is untouched, so reports, roster and payroll boundaries are
  unaffected — see `calendar-localizer.ts` for the measurement behind that.
- **Check-in clinical context** reads the canonical stores that already own the
  facts (`GET /patients/:id/alerts`, `GET /visits?patientId=`) — no schema
  change, no duplication, no new endpoint.
- **Appointment detail panel** recomposed into reference header + identity +
  facts + timeline + action footer.
- **Communication Centre** wrapped in the mockup's console shell around the
  existing editor, mutations and stores.


---

# Convergence pass 2 — what changed, and what still differs

Second convergence pass on the owner's visual-specification review. Presentation
only; the API, schema, RBAC, availability engine, booking/reschedule logic,
timezone handling, clinical data ownership and the message stores are untouched.

## The blocker: unreadable slivers — solved

react-big-calendar divides a column between everything that overlaps, so a
09:00 with six concurrent bookings became six ~25px fragments. Concurrency is
now CAPPED per column — 2 cards in a week column, 3 in the wider day and
provider columns — and everything past the cap becomes the mockup's own
**"+N more"** tile, which opens a list of the hidden bookings with their real
times, one click from each to its appointment. Every appointment keeps its true
start and end; availability, booking and conflict rules never see this
function (`capConcurrency` in `calendar-events.ts` is pure geometry). A card
that shares a band also unstacks its first line, so a narrowed card reads
"08:00 / Hakim bin Jamaludin" over two lines instead of "08:00 Hak…".

## Surface by surface

| Surface | Now matching the mockup | Remaining difference & why |
|---|---|---|
| **Week** | Monday–Sunday, calm canvas, subtle grid, time gutter, navy today pill, rose now-line, separated pastel cards with time / patient / service / doctor, whitespace between cards, **empty columns say "No appointments"**, capped overlap, status footer | Column widths are the browser's, not the mockup's fixed canvas, so a 2-up band shows time over name rather than side by side |
| **Month** | White canvas, compact chips with doctor colour + left edge, time + patient, "+ N more", right-aligned dates, navy today, taller rows (104px) | Sunday-first by the owner's decision |
| **Providers** | **One integrated canvas** — rail, schedule and right panel divided by hairlines inside a single frame, not three floating boxes; avatar + name + count; clean day cards; mini month; provider summary with real metrics | Utilisation shows only when that provider has rostered WORKING minutes; the QA world has one provider |
| **Check-in drawer** | Larger identity area, name/age/phone hierarchy, returning + last visit, allergy visibility, appointment icon rows with dividers, **two-column patient record**, rail runs the drawer's full height | Fewer fields than the mockup's form because the demographic model has fewer; allergies stay read-only from the clinical store |
| **Appointment detail** | Reference header + status chip, identity block, patient-record shortcut, **Service / Doctor / Date / Time / Duration / Source / Created / Created by / Payment / Reminder**, activity column with a minimum height so a one-entry booking still reads composed, action bar | "Created by" is the earliest recorded event's actor — the only true source for it |
| **Communication Centre** | **Workspace, not a settings page**: compact header with wording state + Save, three columns (controls · composer · preview), variable chips, Template/Preview switch, **realistic WhatsApp phone preview**, character count, honesty as one line rather than a banner | No delivery ticks in the preview — nothing observes delivery |
| **Reminder Centre** | Five stat tiles including a **truthful Overdue** (still unsent more than a day after its moment, derived from the same rows), structured worklist, WhatsApp action visible | No "Failed" tile and no bulk send: nothing in Kuwick observes delivery, and each send is a person pressing Send |
