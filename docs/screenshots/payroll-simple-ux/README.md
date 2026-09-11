# Payroll Simple UX — visual UAT pack

Twenty-four individual screenshots, captured from the running product at five
viewports against the synthetic admin UAT tenant (`seed-admin-uat.ts`). Every
name is invented, every account is `.invalid`, every figure is made up.

**No collages.** Each file is one screen at one width. A collage is a picture of
a picture, and it hides exactly the density and alignment problems these exist
to find.

Regenerate with the API and web dev servers running against the seeded database:

```bash
OUT=docs/screenshots/payroll-simple-ux node apps/web/shot-payroll.mjs
```

The month shown is **August 2026**: 10 employees in the run, 7 ready, 3 blocked
(one 60+ employee whose elected EPF share the Third Schedule cannot price, two
without a tax profile), 2 warnings, and one person — Wan Azman — with no salary
on record and therefore no row at all. An eleventh employee and one contractor
locum sit outside this run by design.

## Desktop — 1512 × 960

| # | File | What it shows |
|---|---|---|
| 1 | `01-desktop-payroll-register.png` | `HR → Payroll` opens **on the month**. Header figures, four stages, and the register with grouped Earnings / Deductions / Result bands. The totals row foots: 55250.00 − 496.78 + 882.00 + 203.12 + 1360.00 = 57198.34 gross, net 50055.94, matching the header exactly. |
| 2 | `02-desktop-employee-drawer.png` | One person's payslip over the register, which stays put behind it. Earnings · Deductions · Statutory · Result, net pinned to the bottom. |
| 3 | `03-desktop-add-earning.png` | The compact editor — type, amount, earned-in, note — inside the section it adds to. |
| 4 | `04-desktop-register-blocker.png` | A blocked row: the chip and its Fix sit beside the person, in the pinned Employee column. |
| 5 | `05-desktop-register-warning.png` | Review's counts, which partition the run rather than inviting arithmetic that fails. |
| 6 | `06-desktop-review.png` | Blockers named with the consequence and the remedy; the register is **not** repeated. |
| 7 | `07-desktop-approve.png` | The sentence being agreed to, the five figures, the checks, and a button that says why it is locked. |
| 8 | `08-desktop-finalise.png` | Before approval: one compact line and the way forward — not a screen of white. |
| 9 | `09-desktop-history.png` | History as a secondary screen reached from beside the month picker. |
| 10 | `10-desktop-historical-month.png` | A month opened from history — the same register, read-only. |
| 11 | `11-desktop-hr-overview.png` | HR Overview. |
| 12 | `12-desktop-employees.png` | Employees, with Medical benefits as its second view. |
| — | `12b-desktop-column-chooser.png` | The Columns menu: split a grouped column, or add one. |

## Laptop — 1280 × 800

| # | File | What it shows |
|---|---|---|
| 13b | `13b-laptop-payroll-register.png` | Employee and Net Pay survive; the middle columns scroll. |

## iPad landscape — 1180 × 820

| # | File | What it shows |
|---|---|---|
| 13 | `13-ipad-landscape-register.png` | Register, horizontally scrollable, both key columns pinned. |
| 14 | `14-ipad-landscape-drawer.png` | Drawer over the register. |
| 15 | `15-ipad-landscape-review.png` | Review. |

## iPad portrait — 820 × 1180

| # | File | What it shows |
|---|---|---|
| 16 | `16-ipad-portrait-register.png` | Condensed column set — Basic, Unpaid leave, Additional, Gross, EPF, PCB, Net. |
| 17 | `17-ipad-portrait-review.png` | Review. |

## Mobile — 390 × 844

| # | File | What it shows |
|---|---|---|
| 18 | `18-mobile-payroll-month.png` | The month header and stages at phone width. |
| 19 | `19-mobile-employee-cards.png` | **Cards, not a squeezed spreadsheet.** One per person: gross, deductions, net, status. |
| 20 | `20-mobile-employee-details.png` | The drawer on a phone. |
| 21 | `21-mobile-review.png` | Review. |
| 22 | `22-mobile-finalise.png` | Finalise. |
