# HR restructure — Piece 2: Settings

Six cards, six pages, and each page calls itself what the card called it. One
place to edit each thing. No Prisma schema change, no new feature, no colour,
font, spacing or component changed — the design kit is its own piece of work.

## 1. The card and the page agree

| Card | Opened a page headed | Now |
|---|---|---|
| Company & statutory | Legal employers | **Company & statutory** |
| Payroll policies | Payroll rules | **Payroll policies** |
| Attendance & leave policies | Attendance rules | **Attendance & leave policies** |
| Payroll items | Payroll items | unchanged |
| Public holidays | Public Holidays | **Public holidays** |
| Opening balances | Opening balances | unchanged |

A unit guard now reads the six cards out of `HrSettingsPage`, follows each
`to` through `App.tsx` to the component it mounts, and compares that
component's `AdminShell` title with the card's label. A rename on one side and
not the other fails the build, and the failure names the page.

## 2. One place to edit each thing

Three screens showed the same facts, and two of them could write.

- **The employer list** was on Payroll policies as well as on Company &
  statutory — a second table with its own "can it file?" verdict and its own
  Open button. It is one sentence and a link now.
- **The attendance rules editor** was rendered on Payroll policies AND on
  Attendance & leave policies. The same panel, the same save button, two
  addresses. It belongs to the card named after it; Payroll policies has a
  sentence saying payroll reads those rules and does not set them.
- **The seventeen pay components** were listed in full on the LEGAL EMPLOYERS
  page, under the company's EPF and SOCSO numbers — which is where the table
  landed when that was the only settings page there was, and nowhere anybody
  looking for an allowance would think to look. It has a card of its own.

Payroll items absorbed everything that table carried and nothing was dropped:
**OT base**, **Unpaid-leave base** and **Checked** joined the scheme columns,
the notice about unchecked flags moved with them, and the "Seed the
catalogue" button is on the page whose catalogue it seeds.

## 3. One-time setup

Three of the six rows had no button. "What you pay people" had nowhere to go,
because the pay components had no screen; they have one now. "Check the
statutory rates" told a clinic that payroll stays in test mode until somebody
checks the tables, without saying where the tables are — they are on Payroll
policies. Every required row opens somewhere.

**Bank payment file is not a step.** No bank's format is on record, so it is
an item nobody at this clinic can ever tick, and it sat in a denominator
making a finished setup read *5 of 6*. It stays visible, because "can Kuwick
write my bank file?" deserves an answer, but marked **Optional** and outside
the count. The checklist reads **x of 5**, and so does the Setup complete
figure above it.

The row numbers follow the required steps, 1 to 5; the optional row carries a
dot rather than a "6" that nothing counts.

## 4. Public holidays wears the Admin frame

It was written for Clinic Settings, in that area's own `PageHeader` frame, and
it was the only thing in a category called "HR & Attendance" there — so a
manager looking for HR settings could land on a page with one link on it while
the other five HR settings sat somewhere else. Piece 1 removed that category
and redirected its URL. Piece 2 moves the file to `admin/hr/` and puts it on
`AdminShell` with `DataTable`, like the other five: sentence-case title, a
subtitle, search, an empty state that says what an empty calendar means, and
**+ Add holiday** in the product's own button idiom.

The browser spec no longer needs a shell-agnostic navigation helper, because
there is no longer a second shell in HR.

## 5. Not in this Piece

- **The per-row switches on Payroll items** — EPF · SOCSO · EIS · PCB · HRD ·
  Prorate · OT base · Unpaid-leave base · Recurring · Reimbursement, editable
  without opening a drawer. Its own piece, after the design kit.
- **Colour, type, spacing and components.** Untouched on purpose.
- **Leave entitlement.** The card is named "Attendance & leave policies" and
  the page behind it sets attendance rules only. `GET /workforce/leave/policies`
  exists and nothing in Settings renders it, so the card's description now
  promises only what the page delivers. Giving leave policies a screen is a
  feature, not a label.
