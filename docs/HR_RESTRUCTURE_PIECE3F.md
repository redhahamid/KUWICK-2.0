# HR restructure — Piece 3f: Reports

The shelf a clinic hands to the accountant, the bank and the authorities, on
the kit and shell from 3a, after `reports.html`. No Prisma schema change and
no new report: everything on the page is served by the API already, and the
piece is about making the whole shelf visible at once and honest about what
each row actually produces. `[D]` marks what was read in the code or the
database, `[A]` marks an assumption.

## 1. What changed

| Screen | Route | State after 3f |
|---|---|---|
| Reports | `/admin/hr/reports` | Rebuilt on `reports.html`: the payroll month across the top, then **Payroll reports**, **Government reports**, **Payslips**, **Everything else** and **Not available yet** — each a row that says what it is, where it stands and the way in. |
| A chosen report | `/admin/hr/reports?report=…&run=…` | The same report views as before, now inside the kit's page with the kit's crumb and toolbar. The deep link is unchanged. |

The report renderers themselves — the register, the employer cost, the
statutory totals, the comparison, claims, history, PCB, year-to-date,
overtime, unpaid leave, incentives, exceptions and payment status — are
untouched: their tables still draw with the product-wide table component.
`[A]` The mockup draws the shelf, not the thirteen tables behind it, and
repainting them is a bigger piece than this one; the chrome around them is
Slate so arriving from the shelf does not feel like leaving HR.

## 2. The month is the subject

The mockup's `Jul | Aug 2026 | Sep` is the clinic's last three payroll runs,
newest on the right, and everything under it belongs to the month chosen:
the payroll reports, what each authority is owed, and the payslips. `[D]`
A statutory listing and a payslip both come from the **approved** snapshot,
so the government and payslip panels say plainly that they fill once the
month is approved rather than showing an empty table.

## 3. Government reports, said honestly

`[D]` Kuwick prepares each scheme's rows from the approved snapshot and
serves them as a **CSV listing**, which is not KWSP's, PERKESO's or LHDN's own
file format. The product deliberately does not generate an authority's file
and does not file anything: a person uploads at the portal and records what
the portal issued, which is what `payroll_statutory_submissions` holds.

So each row here offers what exists — the listing as CSV, and *Record filing*,
which opens the run where the filing is recorded — and the panel says in one
sentence that Kuwick never files. Where the mockup promises *CSV · PDF* or
*TXT · PDF*, the result offers CSV. Writing an i-Akaun or an e-PCB text file
would be a new feature and a filing format is not something to guess at.

| Mockup row | Result |
|---|---|
| EPF — Borang A · CSV · PDF | EPF — KWSP i-Akaun · CSV listing · Record filing |
| SOCSO & EIS — Borang 8A · TXT · PDF | SOCSO and EIS as two rows, each a CSV listing (the API keeps them as two schemes, because they are two contributions) |
| PCB — CP39 · TXT | PCB / MTD — LHDN e-PCB · CSV listing · Record filing |
| HRD levy · Not registered | The row appears when the run has an HRD scheme; the clinic's registration lives on the employer record |
| EA forms · Jan 2027 | The same, with *Year to date* as the way to see what an EA will carry |
| Borang E · Mar 2027 | The same, named and dated, with nothing to click |

Each row's state is the run's own: *Ready*, *N employees unanswered* when the
engine could not work a figure out, or *Filed 3 Sep · <reference>* once
somebody has recorded the filing.

## 4. Payslips

The month's payslips from the approved snapshot: search, gross, net, whether
the payslip is itemised line by line or totals only, and the PDF. **Download
all** is the same authorised download repeated — `[D]` there is no bulk
endpoint, and adding one would put a second door on the document the audit
trail already watches, so the button walks the list and each PDF leaves
through the route that records who took it and when. It reports how many were
downloaded if one fails.

**Email all is not there.** `[D]` The product has no mail sender for payroll,
and an employee already has every payslip in their own portal the day the
month is paid. The panel says so rather than offering a button that would
have to invent a transport.

## 5. Everything else

`[D]` The API's catalogue serves thirteen reports; the mockup names three.
The rest are listed under *Everything else* in the same row style with their
scope, so nothing that works became unreachable, and the screens that are not
report endpoints (payslips, the attendance sheet, leave balances, the
benefits register) keep their honest label and link. *Not available yet*
keeps the API's own two absences and the reason for each.

## 6. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| *PDF · Excel* on the payroll summary | *Open*, then the report's own export | `[D]` The register is served as data; the page does not build spreadsheets. |
| *Bank payment listing · CSV* | *Open the run* | `[D]` The listing is prepared in the run's Pay step, where preparing it and recording the payment are one act. A second door would be a second listing. |
| Authority file formats (TXT) | CSV listings | §3. |
| *Email all* | Absent, with the reason on the panel | §4. |
| Three panels only | Two more: *Everything else* and *Not available yet* | The catalogue is bigger than the mockup; hiding ten working reports to match a drawing would remove capability. |
| *3 changes* on the comparison row | *Against the month before* | `[D]` The count comes from the comparison itself, which is a second query per row; the row says what the report is instead of paying for a figure nobody reads there. |

## 7. Tests

| Where | What |
|---|---|
| `src/admin/hr/payrollJourney.test.tsx` | Unchanged and still passing: the month-on-month movement is the API's subtraction, never two numbers subtracted on screen. |
| `e2e/hr-navigation.spec.ts` | Unchanged: Reports is its own rail entry and its page loads under that entry. |

## 8. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 131 suites, 2,768 tests, green |
| API e2e | `npm run test:api:e2e` | 41 suites, 470 tests, green |
| Web unit | `cd apps/web && npx vitest run` | 100 files, 1,728 tests, green |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 102 tests: 98 passed, 3 skipped, 1 failed — `canvas-appointment.spec.ts:40`, pre-existing since Piece 1 and identical on master |

Screenshots: `docs/screenshots/hr-slate-3f/` (the shelf beside its mockup, and
a report opened from it).
