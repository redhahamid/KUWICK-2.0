# HR / Workforce — both personas, photographed

Every screen this pass touched, on the widths that matter, walked against the seeded synthetic clinic
(Klinik Contoh (UAT) — synthetic identities only, augmented by `augment-hr-uat.ts`).

**Two products, two audiences.** *My Kuwick* is what an ordinary member of staff gets and is designed for a
phone: clocking in at the door, photographing a receipt in a car park, checking next week's shift on a bus.
The Administration screens are the manager's side and are shot at iPad and desktop only — photographing an
enterprise table at 390px would be evidence of nothing.

The walk is also a smoke test — `prisma/my-kuwick-shots.ts` fails any route that renders an error boundary
or a near-empty body, reports every browser console error, and refuses to skip a frame silently: a journey
it cannot reach is listed as a problem rather than quietly omitted. On the run that produced these frames:
no dead screens, no console errors, no unreachable journeys.

**Two rules the walk follows, so the frames are evidence rather than accident.** Every manager frame is shot
from the hub's default "All branches", so one screen's answer to *which branch?* cannot silently re-filter
the next screen's figures. And the roster — the one board that genuinely needs a branch — is shot at the
branch with the most people on it, chosen by asking each in turn rather than by naming one: the frame exists
to show that the roster holds the WHOLE workforce, and a two-person branch technically shows that while
reading like an empty product.

**Six real defects were found by looking at these frames and fixed before this run.** Each is held by a test
named in its entry, so none of them can come back quietly:

- **The employee page scrolled sideways at 390px.** The clock button and the third "waiting on" tile were
  clipped by the right edge. Bare `1fr` grid tracks are min-content-floored, so a two-word label refused to
  wrap and pushed its tile off-screen. `e2e/my-kuwick.spec.ts` now holds this at 360, 390, 834 and 1440.
- **Shift times rendered in the browser's timezone, not the clinic's.** A Malaysian 09:00–17:00 shift read
  as `01:00 – 09:00` in a UTC browser. The product has one answer to this — `clinicTime.ts` — whose own
  comment says it is "called once, from the session, at app boot"; nothing called it, so every screen had
  been running on the Asia/Kuala_Lumpur default. It is set from the server now.
- **HR Today white-screened** when the web bundle ran against an API build that predated a field:
  `data?.notClockedIn.length` guards `data` and not the field. Corrected in seven places.
- **HR ▸ Roster was a dead end on arrival.** The Admin hub opens on "All branches" and a roster is one
  branch's board, so the default landing was a blank page reading "Choose a branch to see its roster" — an
  instruction whose only control sits in the hub header, above the tabs, where somebody staring at an empty
  board is not looking. The screen now asks the question where the person is looking and offers the branches
  as buttons. Held by `e2e/hr-workforce.spec.ts` › *the branch question is answerable where it is asked*.
- **The roster opened with today half-hidden.** The board auto-scrolls to today's column, computing the
  scroll from `offsetLeft` — which, for a `th` inside a static table, is measured from `<body>`. The hub's
  32px inset was therefore counted twice and today's column opened a third of its width *underneath* the
  sticky provider rail: the one date a manager came to look at was the one partly obscured. Measured at
  190.5px against a rail ending at 223px; now 223.5px, flush. Two live rects and a relative nudge replace the
  arithmetic. Held by `e2e/hr-workforce.spec.ts` › *opens with today fully visible*.
- **The attendance policy had no screen at all.** A clinic could be *told* its grace period and overtime
  minimum were its own to set — the guide said so — while the only way to set them was an HTTP request. The
  API had been there since Phase C; the panel had not. **HR ▸ Payroll settings ▸ Attendance rules** is that
  screen, with a group default, per-branch overrides, a tag saying whose rules are in force, and a box for
  why. Held by `e2e/hr-workforce.spec.ts` › *the clinic can set its own attendance rules*.

**Where the required screens are.** Part 18 of the brief names nineteen; several are behind a button rather
than a URL, and the walk opens them: the Add Employee wizard (`hr-add-employee`), one person's own page
(`hr-employee-detail`), a timesheet row opened day-by-day (`hr-attendance-detail`), and one payroll run at
its review step (`hr-payroll-run`). "Roster weekly" is the standing-pattern editor at the foot of
`hr-roster` — it renders because one doctor in this world is on `FIXED_WEEKLY` rather than the monthly board.

| Frame | Persona | Viewport | What it shows |
| --- | --- | --- | --- |
| `01-my-home-phone.png` | Employee | iPhone 390×844 | My Kuwick — the home screen: clock in, today, what is waiting |
| `02-my-schedule-phone.png` | Employee | iPhone 390×844 | My Kuwick — my shifts, read from the one canonical roster |
| `03-my-attendance-phone.png` | Employee | iPhone 390×844 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `04-my-leave-phone.png` | Employee | iPhone 390×844 | My Kuwick — my leave and its decisions |
| `05-my-claims-phone.png` | Employee | iPhone 390×844 | My Kuwick — my claims, with where the money is in plain words |
| `06-my-payslips-phone.png` | Employee | iPhone 390×844 | My Kuwick — my payslips, approved months only |
| `07-my-profile-phone.png` | Employee | iPhone 390×844 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `08-my-leave-request-phone.png` | Employee | iPhone 390×844 | My Kuwick — the leave request drawer on a phone |
| `09-my-claim-new-phone.png` | Employee | iPhone 390×844 | My Kuwick — the claim form, with the receipt camera button |
| `10-my-home-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — the home screen: clock in, today, what is waiting |
| `11-my-schedule-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — my shifts, read from the one canonical roster |
| `12-my-attendance-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `13-my-leave-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — my leave and its decisions |
| `14-my-claims-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — my claims, with where the money is in plain words |
| `15-my-payslips-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — my payslips, approved months only |
| `16-my-profile-ipad.png` | Employee | iPad portrait 834×1112 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `17-hr-today-ipad.png` | Owner / manager | iPad portrait 834×1112 | HR Today — who is on, who is not, and every count that opens the work |
| `18-hr-employees-ipad.png` | Owner / manager | iPad portrait 834×1112 | Employees — the directory, with Add Employee and the incomplete-profile queue |
| `19-hr-roster-ipad.png` | Owner / manager | iPad portrait 834×1112 | Roster — the whole workforce, filtered by what kind of work they do |
| `20-hr-attendance-ipad.png` | Owner / manager | iPad portrait 834×1112 | Timesheets — and the attendance fixes staff have asked for |
| `21-hr-leave-ipad.png` | Owner / manager | iPad portrait 834×1112 | Leave — waiting, approved, refused |
| `22-hr-claims-ipad.png` | Owner / manager | iPad portrait 834×1112 | Claims — and the route decision that decides how each is paid |
| `23-hr-payroll-ipad.png` | Owner / manager | iPad portrait 834×1112 | Payroll — the month and what it needs before anybody is paid |
| `24-hr-add-employee-ipad.png` | Owner / manager | iPad portrait 834×1112 | Add Employee — the guided wizard, opened from the directory |
| `25-hr-employee-detail-ipad.png` | Owner / manager | iPad portrait 834×1112 | One employee — account, employment and clinical credential on one page |
| `26-hr-attendance-detail-ipad.png` | Owner / manager | iPad portrait 834×1112 | Timesheets — one person opened, day by day, with the exceptions named |
| `27-hr-payroll-run-ipad.png` | Owner / manager | iPad portrait 834×1112 | Payroll — one run opened at the employee review step |
| `28-hr-payroll-settings-ipad.png` | Owner / manager | iPad portrait 834×1112 | Payroll settings — the setup checklist, the attendance rules, and what stays outside Kuwick |
| `29-my-home-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — the home screen: clock in, today, what is waiting |
| `30-my-schedule-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — my shifts, read from the one canonical roster |
| `31-my-attendance-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `32-my-leave-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — my leave and its decisions |
| `33-my-claims-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — my claims, with where the money is in plain words |
| `34-my-payslips-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — my payslips, approved months only |
| `35-my-profile-ipad-landscape.png` | Employee | iPad landscape 1024×768 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `36-hr-today-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | HR Today — who is on, who is not, and every count that opens the work |
| `37-hr-employees-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Employees — the directory, with Add Employee and the incomplete-profile queue |
| `38-hr-roster-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Roster — the whole workforce, filtered by what kind of work they do |
| `39-hr-attendance-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Timesheets — and the attendance fixes staff have asked for |
| `40-hr-leave-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Leave — waiting, approved, refused |
| `41-hr-claims-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Claims — and the route decision that decides how each is paid |
| `42-hr-payroll-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Payroll — the month and what it needs before anybody is paid |
| `43-hr-add-employee-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Add Employee — the guided wizard, opened from the directory |
| `44-hr-employee-detail-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | One employee — account, employment and clinical credential on one page |
| `45-hr-attendance-detail-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Timesheets — one person opened, day by day, with the exceptions named |
| `46-hr-payroll-run-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Payroll — one run opened at the employee review step |
| `47-hr-payroll-settings-ipad-landscape.png` | Owner / manager | iPad landscape 1024×768 | Payroll settings — the setup checklist, the attendance rules, and what stays outside Kuwick |
| `48-my-home-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — the home screen: clock in, today, what is waiting |
| `49-my-schedule-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — my shifts, read from the one canonical roster |
| `50-my-attendance-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — what the clock recorded, and how to ask for a fix |
| `51-my-leave-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — my leave and its decisions |
| `52-my-claims-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — my claims, with where the money is in plain words |
| `53-my-payslips-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — my payslips, approved months only |
| `54-my-profile-desktop.png` | Employee | Desktop 1440×900 | My Kuwick — who Kuwick thinks I am, and no salary on it |
| `55-hr-today-desktop.png` | Owner / manager | Desktop 1440×900 | HR Today — who is on, who is not, and every count that opens the work |
| `56-hr-employees-desktop.png` | Owner / manager | Desktop 1440×900 | Employees — the directory, with Add Employee and the incomplete-profile queue |
| `57-hr-roster-desktop.png` | Owner / manager | Desktop 1440×900 | Roster — the whole workforce, filtered by what kind of work they do |
| `58-hr-attendance-desktop.png` | Owner / manager | Desktop 1440×900 | Timesheets — and the attendance fixes staff have asked for |
| `59-hr-leave-desktop.png` | Owner / manager | Desktop 1440×900 | Leave — waiting, approved, refused |
| `60-hr-claims-desktop.png` | Owner / manager | Desktop 1440×900 | Claims — and the route decision that decides how each is paid |
| `61-hr-payroll-desktop.png` | Owner / manager | Desktop 1440×900 | Payroll — the month and what it needs before anybody is paid |
| `62-hr-add-employee-desktop.png` | Owner / manager | Desktop 1440×900 | Add Employee — the guided wizard, opened from the directory |
| `63-hr-employee-detail-desktop.png` | Owner / manager | Desktop 1440×900 | One employee — account, employment and clinical credential on one page |
| `64-hr-attendance-detail-desktop.png` | Owner / manager | Desktop 1440×900 | Timesheets — one person opened, day by day, with the exceptions named |
| `65-hr-payroll-run-desktop.png` | Owner / manager | Desktop 1440×900 | Payroll — one run opened at the employee review step |
| `66-hr-payroll-settings-desktop.png` | Owner / manager | Desktop 1440×900 | Payroll settings — the setup checklist, the attendance rules, and what stays outside Kuwick |
