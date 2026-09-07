# My Kuwick — the staff-facing surface, photographed

Every screen an ordinary member of staff can reach, on the three widths that matter, walked against the
seeded synthetic clinic (Klinik Contoh (UAT) — synthetic identities only).

**Phone first**, because that is where this is used: somebody clocking in at the door, photographing a
receipt in a car park, checking next week's shift on a bus. The iPad and desktop frames are the same
screens with the navigation moved from the bottom of the phone to the side.

The walk is also a smoke test — `prisma/my-kuwick-shots.ts` fails any route that renders an error boundary
or a near-empty body and reports every browser console error. On the run that produced these frames: no
dead screens and no console errors.

**Two real defects were found by looking at the first run of these frames and fixed before these were
taken:**

- **The page scrolled sideways at 390px.** The clock button and the third "waiting on" tile were clipped
  by the right edge. A phone screen that slides when a thumb brushes it reads as broken even when every
  figure on it is right. `e2e/my-kuwick.spec.ts` now holds this at 360, 390, 834 and 1440.
- **Shift times rendered in the browser's timezone, not the clinic's.** A Malaysian 09:00–17:00 shift read
  as `01:00 – 09:00` in a UTC browser. The product has one answer to this — `clinicTime.ts` — whose own
  comment says it is "called once, from the session, at app boot"; nothing in the app actually called it,
  so every screen had been running on the Asia/Kuala_Lumpur default. It is now set from the server.

| Frame | Viewport | What it shows |
| --- | --- | --- |
| `01-my-home-phone.png` | iPhone 390×844 | My Kuwick — the home screen: clock in, today, what is waiting |
| `02-my-schedule-phone.png` | iPhone 390×844 | My Kuwick — my shifts, read from the one canonical roster |
| `03-my-attendance-phone.png` | iPhone 390×844 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `04-my-leave-phone.png` | iPhone 390×844 | My Kuwick — my leave and its decisions |
| `05-my-claims-phone.png` | iPhone 390×844 | My Kuwick — my claims, with where the money is in plain words |
| `06-my-payslips-phone.png` | iPhone 390×844 | My Kuwick — my payslips, approved months only |
| `07-my-profile-phone.png` | iPhone 390×844 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `08-my-leave-request-phone.png` | iPhone 390×844 | My Kuwick — the leave request drawer on a phone |
| `09-my-claim-new-phone.png` | iPhone 390×844 | My Kuwick — the claim form, with the receipt camera button |
| `10-my-home-ipad.png` | iPad portrait 834×1112 | My Kuwick — the home screen: clock in, today, what is waiting |
| `11-my-schedule-ipad.png` | iPad portrait 834×1112 | My Kuwick — my shifts, read from the one canonical roster |
| `12-my-attendance-ipad.png` | iPad portrait 834×1112 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `13-my-leave-ipad.png` | iPad portrait 834×1112 | My Kuwick — my leave and its decisions |
| `14-my-claims-ipad.png` | iPad portrait 834×1112 | My Kuwick — my claims, with where the money is in plain words |
| `15-my-payslips-ipad.png` | iPad portrait 834×1112 | My Kuwick — my payslips, approved months only |
| `16-my-profile-ipad.png` | iPad portrait 834×1112 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `17-my-home-desktop.png` | Desktop 1440×900 | My Kuwick — the home screen: clock in, today, what is waiting |
| `18-my-schedule-desktop.png` | Desktop 1440×900 | My Kuwick — my shifts, read from the one canonical roster |
| `19-my-attendance-desktop.png` | Desktop 1440×900 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `20-my-leave-desktop.png` | Desktop 1440×900 | My Kuwick — my leave and its decisions |
| `21-my-claims-desktop.png` | Desktop 1440×900 | My Kuwick — my claims, with where the money is in plain words |
| `22-my-payslips-desktop.png` | Desktop 1440×900 | My Kuwick — my payslips, approved months only |
| `23-my-profile-desktop.png` | Desktop 1440×900 | My Kuwick — who Kuwick thinks I am, and no salary on it |
