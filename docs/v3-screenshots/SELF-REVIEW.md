# V3 presentation recomposition — self-review of the 22-shot acceptance set

Captured 2026-08-20 against the seeded Klinik Hijraa-shaped week (busy
Wednesday 26 Aug 2026), through the real UI at 1440×900 (admin) and 390×844
(patient), device scale 2. Every appointment, slot, hint and confirmation in
these images came through the real availability engine against the local
database — nothing is staged. The container's "today" is Thu 20 Aug 2026,
which is why the calendar shots navigate to the seeded week and the roster
board highlights the 20th.

## The A–L gate, answered per shot set

| Gate | Verdict | Evidence |
|---|---|---|
| A. Still default Ant Design? | **No.** | Raised canvas on tinted page; ink-navy primaries and dark-filled view switcher; uppercase table headers; stat band with semantic dots; chip language everywhere. AntD still renders the controls, but themed and composed, not stock. |
| B. Still default React Big Calendar? | **No.** | 01–04: custom day headers (small-caps DOW + date numeral, today in a filled ink circle), white event cards with 3px provider edges and status dots, working-hours shading, teal now-line with clinic-clock pill, hairline grid, no rbc all-day row, sticky gutter past four provider columns. The library survives only as geometry. |
| C. Visually flat? | **No.** | Three layers everywhere: tinted page → raised white canvas → cards/bands (filter bar, stat band, booking summary, phone preview). Shadows are one step, not decoration. |
| D. Excessive dead space? | **No.** | Day view opens on the first booking (07:00 for an 08:00 diary — one hour of runway, not eight of midnight); the roster board auto-scrolls to today/first shift; unrostered hours read as shape, not blankness; the all-day dead band is gone. |
| E. Obvious primary action? | **Yes.** | One dark "+ New appointment" in the module masthead on every surface; one primary per drawer footer (Check in / Book appointment); one primary per row in the List; teal Continue/Confirm on the patient flow. |
| F. Receptionist scan in 2–3 s? | **Yes.** | 01: the day's shape (shaded vs white), who and when per card, live counts at the filter bar's end. 11: time-first worklist rows with one Check in each. 12: who is working, when, at a glance. |
| G. Patient/provider/time hierarchy clear? | **Yes.** | Cards: time (ink, tabular) → patient (heaviest) → service/provider (quiet). List: When → Patient → Service → Provider → Status. Drawer: person → 25px time → service/provider. |
| H. Bad truncation? | **None found.** | ≤15-min cards render one whole line (dot · time · first name) instead of clipped stacks; 30-min cards carry exactly two lines; summary money uses whole ringgit ("RM 120") so nothing ellipsises mid-number; date chips keep full words ("TODAY 20 Aug"). Long doctor names ellipsise at word level in headers with the full name in the drawer/tooltip — accepted. |
| I. Status readable without colour? | **Yes.** | Every chip keeps its word (D-105 unchanged); calendar dots are a preview of the chip, never a replacement — the word is in the drawer, the list and the tooltip; released bookings are struck through, not colour-coded away. |
| J. Dense but calm? | **Yes.** | 12 bookings across 6 providers in 01/04 read in one pass; the filter bar holds six controls and five live counts in one quiet band; the roster compresses 31 days × shift states without shouting. |
| K. Patient flow trustworthy on mobile? | **Yes.** | 17–22: identity card, compact progress, big touch targets (44px+), teal-filled selected states, engine-honest "Next available" hints, a review step before anything is sent, a confirmation card with manage/calendar actions, and a manage page in the same language with an outline-danger Cancel. |
| L. One coherent Kuwick system? | **Yes.** | Same status words and tones as Queue/Dispensary (KuwickStatusTag untouched), same top nav, same clinic clock everywhere, same identity palette on avatars/edges/dots across calendar, list, roster, services and flow. |

## What each shot evidences

01 day (busy, opens on the work, shading) · 02 week (compact chips, per-day
working hours, today header) · 03 month (today marker, honest "+ 16 more",
weekend tint) · 04 providers (person headers, per-column availability) ·
05 drawer (booking said big, quick actions, one primary) · 06 drawer
checked-in (queue banner outranks all) · 07–10 the flow (collapsed summaries
with Change, decision cards, hinted doctors, grouped slots with provider
under time, review card) · 11 list (stat band, time-first work items) ·
12 roster (auto-scrolled board: day/split/overnight "22:00→06:00 +1",
OFF/Leave/Blocked/Locum, weekly-templates panel) · 13 cell editor ·
14 services (6 rows, provider chips with identity dots, price + display
mode) · 15 service editor (clinic language, one save) · 16 booking-page
split builder (LIVE strip, grouped config, sticky phone preview fed by the
form) · 17–22 patient flow through confirmation and manage.

## Defects found by this review, and what was done

1. **15/30-minute cards clipped text** in the first capture — the structured
   card rendered more lines than the slot's pixels hold. `cardModel` tiers
   now match the grid (1 line ≤15, 2 lines ≤30, 3 ≤45, 4 above); re-shot.
2. **rbc's all-day row** left a dead band under the headers — removed.
3. **The flow's quick-set Segmented** always painted "Today" selected even
   when the date came from the picker — replaced with plain quick-set
   buttons; summaries also stopped ellipsising money mid-number.
4. **antd Avatar squeezed two-letter initials into "A…"** at 26px in the
   List — replaced with the same plain avatar span the calendar headers use.
5. **Fresh-database seed defects** (test data, not product): the QA seed
   hardcoded a clinic uuid from its author's machine (FK violation on any
   other database) and only `updateMany`'d a booking page that never exists
   on a fresh database (so `/book/uat-clinic` 404'd). It now resolves the
   clinic at runtime and upserts the page. A BLOCKED shift was added so the
   board shows every shift state (§12 dataset).

## Standing notes, stated plainly

- **The engine, lifecycle, security and API are untouched.** Every change is
  presentation-side: components, scoped CSS (`appointment-v3.css` replaces
  the V2 appointment styles that lived in index.css), two nested antd theme
  layers, and two pure presentation helpers (card tiers, status dot colour).
  The one scroll behaviour change is viewport position only.
- **The V2 spec-pinned behaviours hold**: released bookings stay visible and
  struck through; Booked value and Realised revenue remain two figures with
  two sources; the drawer's dead primaries stay absent, not disabled;
  end-dating still governs weekly patterns; manage tokens and public
  security posture unchanged. All pinned suites pass.
- **Module palette vs global anchors**: inside the appointment module the V3
  hexes lead (#0B1736 / #132447 / #0F6B78 as scoped `--apt-*` tokens and a
  nested theme); the app shell, KuwickStatusTag pairs and clinical screens
  keep the existing global tokens, exactly as the brief's "do not blindly
  change the global palette" instructs.
- **"New service" is a door, not a second form** — it navigates to the
  clinic's one catalogue (Settings ▸ Clinical ▸ Services), because a second
  creation path is how two lists drift apart.
- **LOCUM roster blocks carry the word, times in the tooltip** — D-105's
  status language kept over the brief's time-first example for that one
  state.
- **Test-data interplay worth knowing**: `seed-density-fixtures.ts` (the e2e
  world) rebrands the booking page to "UAT Clinic"; re-run
  `premerge-qa-seed.ts` after it when the Klinik Hijraa branding should be
  on screen. CI's ordering is unaffected.
- **Admin on a phone** is usable (stat band wraps, toolbars stack, the board
  scrolls) but is not a mobile management app — per the brief's own bar.
