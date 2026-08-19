# V2 enterprise visual redesign — §53 self-review of the final 29

Captured 2026-08-19 against the seeded Klinik Hijraa-shaped week (26 Aug 2026),
through the real UI at 1440×1000 (admin, public desktop) and 390×844 (public
mobile), device scale 2. Every screenshot was reviewed against the 12 points of
§53: layout composition, spacing rhythm, typographic hierarchy, colour
discipline (identity vs status vs action), status language, information
density, truncation, empty/edge states, touch-target size on mobile, header
economy, consistency with the token system, and honesty (nothing staged that
the product does not do).

## Verdicts

| # | Screenshot | Verdict | Notes |
|---|---|---|---|
| 01 | admin-calendar-day-busy | PASS | Single header row; density modes visible: SHORT `08:00 Siti`, STANDARD 2–3 lines, EXPANDED `10:00 – 11:00` + 4 lines; no-overlap columns; released booking struck through, never hidden. |
| 02 | admin-calendar-week | PASS | Compact `09:00 Siti` chips only; provider colour on the left edge only. |
| 03 | admin-calendar-month | PASS | Planning view: one-line entries + honest `+17 more`; header band surface-2. |
| 04 | admin-calendar-providers | PASS | Person-shaped column headers (identity-coloured initials); EXPANDED cards inside provider columns. |
| 05 | admin-drawer-upcoming | PASS | §21 quick actions (Patient record / WhatsApp / Call); BOOKING / PATIENT MESSAGE / INSTRUCTIONS sections; one primary (Check in). |
| 06 | admin-drawer-checked-in | PASS (recaptured) | First capture showed the seeded queue ticket CANCELLED (stale QA data from an earlier hygiene sweep, not a product defect); data restored to WAITING and re-shot. Queue banner `A009 Waiting · Visit #V-000103` outranks everything; footer is Open visit. |
| 07 | admin-new-appointment-patient | PASS | One question on screen: search + recent patients. Never a giant empty drawer. |
| 08 | admin-new-appointment-provider | PASS | Service decision-cards (duration · price · deposit); `⚡ Any available doctor · Fastest appointment` leads and is teal-selected. |
| 09 | admin-new-appointment-time | PASS | Morning/Afternoon/Evening groups, provider name on each slot under "Any"; 5 · REVIEW card before booking. |
| 10 | admin-list | PASS | Unchanged premium worklist: strong patient cell, one primary + •••, quiet stat strip. |
| 11 | admin-roster-month | PASS | Planning board: taller rows, `08:00–13:00`, `22:00→06:00 +1`, OFF grey, Leave violet (§5), Locum blue. |
| 12 | admin-roster-cell-editor | PASS | Chip click opens the compact editor; the orphaned-appointments promise is stated in the modal. |
| 13 | admin-fixed-weekly-collapsed | PASS | Identity avatar + one-line summary (`6 days a week · split shifts`) + Edit. |
| 14 | admin-services-list | PASS | Premium rows: name+category, engine words in the columns, provider chips, `Nobody` refusal in red pair. |
| 15 | admin-service-scheduling | PASS | Clinic language: "Appointment length", "New appointment may start every", "Online booking notice", "Bookable up to". |
| 16 | admin-booking-page-general | PASS | LIVE status strip answers "is it on, where is it" before any tab. |
| 17 | admin-booking-page-sharing | PASS | Link, QR download, WhatsApp share text. |
| 18 | public-desktop-service | PASS | Compact identity row; "What would you like to book?"; decision cards with price/deposit/approval chips. |
| 19 | public-desktop-provider | PASS | Hints from the live engine on Any + per-doctor tiles. |
| 20 | public-desktop-time | PASS | Date chips never truncate; slot grid grouped by daypart. |
| 21 | public-desktop-confirmation | PASS | Real booking through the real engine; manage link + .ics. |
| 22 | public-mobile-service | PASS | 390px: full-width cards, compact hero, `Step 1 of 5` + progress sliver (§35 stepper gone). |
| 23 | public-mobile-provider | PASS | `⚡ Any available doctor · Fastest appointment · Tomorrow · 08:30`; per-doctor "Next available" hints; hints honestly absent where the engine has nothing in 48h. |
| 24 | public-mobile-time-available | PASS | Chips `TODAY 19 Aug / THU 20 Aug …` full words; big touch-target slot grid. |
| 25 | public-mobile-no-availability | PASS | Reason in patient words ("That is too soon"), then the page went and FOUND `Next available: Thu, 20 Aug · 38 times free` through the same engine. |
| 26 | public-mobile-details | PASS | Calm form, required-ness from the clinic's own settings. |
| 27 | public-mobile-review | PASS | §42: date/time large, service, doctor, patient, phone — checked before anything is sent. The 22:45 slot also evidences the Late night daypart working end-to-end. |
| 28 | public-mobile-confirmation | PASS | Confirmed card + NEED HELP section; no invented address/phone — the public read model has neither, so the section stays compact rather than fake (§43). |
| 29 | public-mobile-manage | PASS | Same card language as the confirmation; restrained outline-danger Cancel; explain-not-disable copy when nothing can change. |

## Defects found by this review, and what was done

1. **06 first capture showed `A009 Cancelled`** — stale QA data (an earlier
   e2e hygiene sweep had cancelled the seeded ticket), not a product defect.
   Data corrected (ticket back to WAITING — an UPDATE, nothing deleted) and
   the shot recaptured.
2. **No second defect required a code change.** Minor observations accepted
   deliberately: hint labels use the clinic's 24-hour clock (`Tomorrow ·
   08:30`) for consistency with every other time on the page, rather than the
   brief's example "8:30 PM"; provider hints appear only when the engine has
   something within 48 hours, because a deeper probe per doctor would hammer
   the availability endpoint from a public page.

## Standing deviations (documented, deliberate)

- Structural navy stays `#184a6b` and teal `#0f766e` (D-105) — the anchors
  every existing screen already uses; the V2 reference hexes would be a
  whole-product change, out of this module's scope.
- The optional collapsible provider rail on wide screens (§17–20 "optional")
  was not built; the Providers view keeps per-column min-width with a pinned
  hour gutter past four columns, which solves the same problem.
- The current-time gutter pill renders only when "now" is inside the visible
  grid of the day being viewed — on the seeded 26 Aug screenshots it is
  correctly absent (that day is not today).
