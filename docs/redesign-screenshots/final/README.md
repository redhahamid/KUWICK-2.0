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


---

# Convergence pass 3 — the calendar stops being a styled library

The owner's verdict on pass 2: still visibly the underlying calendar library
with styling on top. This pass replaces the PRESENTATION layer rather than
restyling it. The engine is untouched: availability, booking/conflict, roster
rules, the timezone/axis correctness, appointment lifecycle, reschedule rules,
schema, RBAC, clinical ownership and the message stores are all unchanged, and
no API contract moved.

## What was actually replaced

| Was | Is |
|---|---|
| rbc's event box painted with our CSS | **`CalendarEventCard.tsx`** — a Kuwick component. The library keeps only geometry (where a card sits, how tall, which column); everything inside the box is ours |
| Card = time + name, borders, white | Card = provider avatar · time in the doctor's own colour · **patient name as the loudest element** · service · doctor · status chip, on the provider's pastel ground with a 3px identity edge, rounded, soft-shadowed |
| Half-hour gutter labels ("7:00 AM", "7:30 AM") | **Hour-only display** ("8 AM", "9 AM") — every label stays fully qualified in the DOM so the axis pin still reads and orders all of them |
| Heavy grid rules everywhere | Hairline hour lines, invisible half-hour rules, quiet column separators |
| Now-line drawn over the cards, striking through names | The whole event layer is lifted above the indicator — **"now" is context, never damage** |
| Density guessed | Density from the booking's own **duration**: 15 min = one line side by side, 30 min = time+name+service, longer = all lines |
| Month rows = coloured strips | Pastel chips with identity edge, time + name, 92px rows so six weeks fit uncut, navy today |
| Provider rail truncating "Dr UAT Doctor (Sy…" | 246px rail, names wrap to two lines |

## The ten surfaces, and the mockup panel each answers to

| # | Screenshot | Mockup panel |
|---|---|---|
| 1 | `01-calendar-month.png` | Clinic **Panel 1** — Month |
| 2 | `02-calendar-week.png` | Clinic **Panel 2** — Week |
| 3 | `03-calendar-day.png` | Clinic **Panel 3** (centre column card style, single-provider day) |
| 4 | `04-calendar-providers.png` | Clinic **Panel 3** — Provider view |
| 5 | `05-appointment-list.png` | Clinic **Panel 4** — Appointment list |
| 6 | `06-checkin-patient-details.png` | Clinic **Panel 5** — Check-in, Patient Details tab |
| 7 | `07-checkin-visit-info.png` | Clinic **Panel 5** — Check-in, Visit Info tab |
| 8 | `08-appointment-detail.png` | Clinic **Panel 8** — Appointment detail |
| 9 | `09-communication-centre.png` | Clinic **Panel 6** — Communication Centre |
| 10 | `10-reminder-centre.png` | Clinic **Panel 7** — Reminder Centre |

Patient-journey shots (`patient-*.png`) answer to the patient mockup's panels
1–7 and its reschedule strip, unchanged in this pass.

## Remaining visual differences, and why

- **Overlap** — the mockup never draws six concurrent bookings. Where the real
  world does, concurrency is capped and the rest becomes a designed "+N more"
  tile that opens the hidden bookings with their true times.
- **Month is Sunday-first** — the owner's decision; the mockup's own month
  panel is Sunday-first too.
- **Card photos are initials** — no provider photograph exists in the record;
  the avatar is the shared tinted-initials component used everywhere else.
- **Cancelled bookings stay on the grid struck through** — a deliberate
  standing rule (an appointment is never silently removed) that the mockup has
  no example of.
- **No delivery ticks, no "Failed" tile, no bulk send, no ratings, no
  specialty/experience/languages, no payment methods, no Apple Wallet** — the
  standing honesty rules; each keeps its place in the layout for the day the
  capability is real.

---

# PREMIUM CLINICAL OPERATIONS PASS — the approved design decisions, implemented

Captured from the production build over the seeded QA world after the owner
approved the design audit and issued fourteen locked decisions on 2026-08-23.
Green on this exact code: web typecheck, **1600/1600** web unit tests, API
typecheck, **2014/2014** API unit tests, **73/73** API integration tests, and
the appointment **e2e 8/8** including both axis walks and the
Asia/Kuala_Lumpur timezone twin.

## The wall of blue: what it actually was

Three compounding causes, all in the presentation layer, all fixed:

1. **`.kw-evcard { background: var(--ev-wash) }` with no per-view override.**
   The provider's wash was painted full-bleed in every view. A week column is
   ~180px, so it read as a tint; a Day card is ~1,300px, so the identical rule
   became a 1,300px band of colour.
2. **A six-entry hash palette, of which three were blue-family.** Six doctors
   into six slots land all-distinct about 1.5% of the time, so in a real
   clinic two or three providers shared a colour — and roughly half of all
   providers landed in blue before any collision.
3. **`Staff.calendarColor` was fetched and thrown away.** The column existed,
   was migrated, and was seeded with curated colours; the web app overrode
   every one of them with the hash.

## Per-view colour budget (decision 2)

| View | Provider colour spends |
|---|---|
| Day / Providers | 3px identity edge + 26px pastel gutter holding the avatar. **White body, always.** |
| Week | The same, plus a ~4.5% wash on the body. Predominantly neutral. |
| Month | The 20px chip may take the pastel outright — there is no body to flood. |

## The shots

| # | Shot | Mockup panel | What it demonstrates |
|---|---|---|---|
| 1 | `01-calendar-month.png` | Clinic 1 | Capacity view, not a compressed week: navy today pill, **“24 appointments”** per cell from real data, two representative chips with **live bookings ranked ahead of cancelled**, and **“+22 more · 9 cancelled”**. Six weeks fit. Sunday-first. |
| 2 | `02-calendar-week.png` | Clinic 2 | Monday→Sunday. Patient name is the strongest text and is never truncated for a badge; time · service beneath; provider edge + faint tint; status is a dot at this width. |
| 3 | `03-calendar-day.png` | Clinic 3 (day schedule) | The execution workspace. Reads left to right: gutter avatar → time → **patient** → service → doctor → state. White bodies. A 30-minute booking is a row, not a banner. |
| 4 | `04-calendar-providers.png` | Clinic 3 | Single-provider workspace: rail (six doctors, each on their own persisted colour), emerald column, mini month, Provider summary **with the utilisation bar** (31%) from the unchanged calculation. |
| 5 | `05-appointment-list.png` | Clinic 4 | Structure unchanged. No-show demoted to secondary type and shown with its denominator: **“NO-SHOW 60% · 3 of 5 attendable”**. |
| 6 | `06-checkin-patient-details.png` | Clinic 5 | Compacted reception rail: name + returning line, **NRIC / Mobile / DOB · age / Sex**, a SAFETY block (allergies + standing alerts, visible from both tabs), APPOINTMENT, and VISIT mirrored live from the form. |
| 7 | `07-checkin-visit-info.png` | Clinic 5 | Visit Info tab; the rail stays put, so safety is never behind a tab. |
| 8 | `08-appointment-detail.png` | Clinic 8 | Three grouped fact lists — Appointment / Booking / Payment & reminder — laid out two-up, with the Activity timeline beside them. Grouping and alignment, no cards added to fill space. |
| 9 | `09-communication-centre.png` | Clinic 6 | Unchanged IA, as instructed. Honesty banner intact. |
| 10 | `10-reminder-centre.png` | Clinic 7 | Unchanged IA. No invented “Failed” state. |
| 11 | `11-busy-day.png` | — | **The deliberately busy state.** Wednesday 26 August, twenty bookings, six providers: indigo, emerald, sky, rose, teal, violet — all distinguishable, all white-bodied. Long Malay, Chinese and Indian names render whole. |
| 11b | `11b-busy-providers.png` | — | The same day across six provider columns. Rail → column header → card edge all carry the same persisted colour. |
| 11c | `11c-busy-week.png` | — | The busy week, showing the ~4.5% tint holding up across a mixed-provider column. |

## Provider identity colour — persisted, not hashed

`Staff.calendarColor` (already migrated, no schema change) is now the
authority. Resolution order: **stored colour → curated deterministic fallback
for rows written before the column was filled in.** Creating a provider
assigns the tenant's next unused curated colour and persists it, so a clinic's
first seven providers are guaranteed distinct — which a hash cannot promise.
The colour is editable from the existing Staff editor through an eight-swatch
picker (no colour well), and the server validates writes against the same
eight values, so the rule survives any client.

| Colour | Accent | Pastel | Text |
|---|---|---|---|
| Teal | `#0F6B78` | `#E7F3F4` | `#0B535D` |
| Emerald | `#2F8B57` | `#E8F4ED` | `#24693F` |
| Sky *(the only blue)* | `#2E7BC4` | `#E8F1FA` | `#235F99` |
| Indigo | `#4A57C4` | `#ECEEFB` | `#3A45A5` |
| Violet | `#7A4FBF` | `#F2ECFB` | `#62409A` |
| Rose | `#B4506B` | `#FBECEF` | `#8F3F55` |
| Amber | `#A96A12` | `#FBF1E2` | `#8A560F` |
| Slate *(neutral / locum)* | `#55627A` | `#EEF0F4` | `#414D63` |

## Honest deviations from the brief

- **The booking reference stays `#6F18AB6D`.** The mockup's
  `APT-240826-0012` needs a stored dated sequence and a per-clinic counter.
  Inventing one client-side would be a number that means nothing.
- **The status word appears only when the card is ≥260px wide.** A ~90px
  badge inside a 178px week column is 90px the patient's name does not get.
  The dot, the tooltip, the List and the drawer all still carry the state.
- **No capacity or “busy” band in Month.** The clinic has never stated a
  daily capacity, so the appointment count is the only truthful workload
  figure available. It is enough.
- **Six or more provider columns still scroll horizontally** (hour gutter
  pinned, right edge faded). Columns dropped from 250px to 220px so a
  five-doctor clinic fits at 1440–1600px; squeezing six into the viewport
  would cost the readability this pass exists to protect.
