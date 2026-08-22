# Final visual pass — the 14 owner-named surfaces

Captured from the production build (`vite build` + `vite preview`) over the
seeded QA world, after the presentation-only pass that makes the two approved
mockups the design rather than the inspiration. Backend, availability engine,
RBAC, RLS, booking/reschedule logic, reminders and payment honesty are
untouched; web tsc, 1600 vitest tests, the build and the 8-spec appointment
e2e (including the Asia/Kuala_Lumpur twin) are green on this exact code.

Each shot below names the mockup panel it answers to and the honest,
owner-approved deviations that remain.

| # | Shot | Mockup panel | Matches | Deliberate deviations |
|---|------|--------------|---------|----------------------|
| 1 | `01-calendar-month.png` | Clinic 1 — Month | White canvas, provider-wash chips w/ 3px identity bar, navy today circle, uppercase weekday micro-headers, teal “+ n more”, status summary bar closing the canvas, top-right counts legend | Week starts Sunday (locale + range logic — changing week-start is not presentation); QA data concentrates in the RC week |
| 2 | `02-calendar-week.png` | Clinic 2 — Week | Separated pastel cards (provider wash + edge) w/ time, patient, service, 16px doctor avatar; gaps between cards; navy today pill header; rose now-line + gutter time pill; status summary bar | Sat/Sun “No appointments” captions not rendered (rbc has no per-column empty state); density on Sun/Mon is the QA overlap fixture working as designed |
| 3 | `03-calendar-providers.png` | Clinic 3 — Provider view | Left provider rail (avatar + name + count, selection highlighted), white day-schedule cards, right mini month calendar driving the same anchor, Provider summary (appointments, booked value from the server, in clinic, completed, no-show) | Utilisation renders only when the provider has rostered WORKING minutes that day (none on this date); one provider exists in the QA world; “Any available doctor” rail row not added (it is a booking concept, not a filter) |
| 4 | `04-appointment-list.png` | Clinic 4 — Appointment list | Status counts as tab badges, patient avatars, provider avatars, status chips, ink Check-in buttons, uppercase headers, filter row, hover, one-line services | The §46 money strip (booked value vs realised) and extra operational columns (Payment / Reminder / Source / WhatsApp) are kept — data the owner ordered preserved |
| 5 | `05-checkin-drawer.png` | Clinic 5 — Check-in drawer | Identity rail: avatar, name, phone · age (from recorded DOB), appointment icon rows, source + booking ref; grouped patient details w/ permission-gated Edit; Visit, Payer, Payment; ink Confirm & add to queue | No “Returning patient” badge or last-visit line — no such field exists on this payload and nothing is invented; no tab chrome — both Patient and Visit groups stay visible because Confirm commits both; Allergies/Important-info fields don’t exist on the patient model |
| 6 | `06-new-appointment.png` | Patient stepper language, module edition | Numbered stepper chips (✓ done teal / active navy), selected-patient card w/ teal edge + avatar + IC/phone + Change, service decision cards | — |
| 7 | `07-reminder-centre.png` | Clinic 7 — Reminder Centre | Summary tiles + worklist columns time · patient · appointment · type · channel · action; Send / Send early actions; “Sent by hand” language | Tiles are Due now / Later today / Next 7 days / Sent·7 days — each derived from the real lists; no “Overdue” tile (the due list *is* everything at-or-past its moment) and no invented counts. This capture shows the Sent tab; Due/Upcoming are legitimately 0 because prior sessions already sent this week’s reminders |
| 8 | `08-patient-service.png` | Patient 1 — Choose service | Stepper chips, premium service cards (duration chip, genuine price/from-price, description, info sheet) | No stock photos (none uploaded — the card takes one when the clinic adds it); no ratings, by decision |
| 9 | `09-patient-doctor.png` | Patient 2 — Choose doctor | Teal ⚡ fastest banner, Any-available card leading, Calendly-style rows: shared tinted avatar, right-aligned “Next available” + chevron | No specialty/experience/languages/ratings — no data source, nothing faked |
| 10 | `10-patient-date.png` | Patient 3 — Choose date | Airline month: green/amber/grey filled circles, blue selected, legend, fastest-available bar naming the real doctor | — |
| 11 | `11-patient-time.png` | Patient 4 — Choose time | Morning/Afternoon/Evening groups, selection-blue chip, “you selected” reveal card w/ the assigned doctor’s avatar + name (any-doctor reveals here, before confirmation) | — |
| 12 | `12-patient-review.png` | Patient 6 — Review & pay | Labelled Appointment summary rows (Service/Doctor/Date/Time/Duration/Clinic/For) + Payment summary | No payment-method buttons: nothing charges online, and the card says “the clinic collects payment when you arrive” |
| 13 | `13-patient-confirmation.png` | Patient 7 — Confirmation | One wallet-style gradient card: headline on the gradient, white QR ticket (clinic, booking ref, service, doctor, date, time, location), 2×2 actions Manage / Add to calendar / Directions / WhatsApp us | No “Add to Apple Wallet” — no pass-signing certificates exist |
| 14 | `14-patient-reschedule.png` | Patient — Reschedule flow | The SAME AvailabilityCalendar component and slot-chip classes as booking: fastest bar, colour-coded dates, “Current appointment” ring in the legend, blue selection | — |
