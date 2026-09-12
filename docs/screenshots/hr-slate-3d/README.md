# HR Slate, Piece 3d — Payroll

Desktop at 2×, page height per screen. `payroll.html` was rendered at
**1720 wide** — the one mockup wider than the others — so the grid is shot at
1720 to sit beside it without scaling either; everything else is 1440, as in
3a–3c. Synthetic `admin-uat` tenant, demo employees only.

The payslip is the PDF the API serves (`03-payslip.pdf`), rendered to PNG by
Chromium's own viewer — no PDF library in this container.

Regenerate with the dev servers running. The payslip needs an approved run,
which the seeded August is not (three blockers, on purpose): the two PCB
figures were entered and the leaver's record closed before approving it for
this pack, then the world was re-seeded.

```
OUT=docs/screenshots/hr-slate-3d PERIOD=2026-08 node apps/web/shot-hr-slate-3d.mjs
curl -H "authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/workforce/payroll/runs/<runId>/payslips/<staffId>/pdf \
  -o docs/screenshots/hr-slate-3d/03-payslip.pdf
node apps/web/shot-payslip-pdf.mjs docs/screenshots/hr-slate-3d/03-payslip.pdf docs/screenshots/hr-slate-3d/03-payslip.png
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-payroll.png \
  docs/screenshots/hr-slate-3d/01b-payroll-editing.png \
  docs/screenshots/hr-slate-3d/01-payroll--side-by-side.png "Payroll"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-employee-payroll.png \
  docs/screenshots/hr-slate-3d/02-employee-payroll.png \
  docs/screenshots/hr-slate-3d/02-employee-payroll--side-by-side.png "Employee payroll"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-payslip.png \
  docs/screenshots/hr-slate-3d/03-payslip.png \
  docs/screenshots/hr-slate-3d/03-payslip--side-by-side.png "Payslip"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-payroll--side-by-side.png` | **Acceptance evidence.** Left: `slate-payroll.png`. Right: the month on Prepare with one row in edit — four figures, the four stages, the grid, the footer that names who is blocked. |
| 01 | `01b-payroll-editing.png` | The result on its own, before approval: Dr Meera Kaur's row in edit, OT h and Unpaid d grey with Fix links. |
| 01 | `01-payroll.png` | The same month after approval: Approved chip, every stage ticked but Pay, nothing blocked. |
| 02 | `02-employee-payroll--side-by-side.png` | **Acceptance evidence.** Left: `slate-employee-payroll.png`. Right: one person's month — earnings and deductions with source tags, the net, employer contributions, what fed the month, year to date, adjust. |
| 02 | `02-employee-payroll.png` | The result on its own. |
| 03 | `03-payslip--side-by-side.png` | **Acceptance evidence.** Left: `slate-payslip.png`. Right: the PDF the API serves for the approved August, rendered to PNG. |
| 03 | `03-payslip.png`, `03-payslip.pdf` | The PDF itself, and its render. |
| 03 | `03-payroll-review.png` | Review: blockers, warnings, what the month comes to. |
| 04 | `04-payroll-approve.png` | Approve: the statement, the checks, the one button and why it is locked. |
| 05 | `05-payroll-pay.png` | Pay, after approval: payslips, the payment listing, the statutory figures. |
| 00 | `00-settings-payroll-policies.png` | Settings › Payroll policies with the §6 rule sets — the gold floor notice naming who a clinic rate would underpay. |
| 00 | `00b-settings-rule-set-editor.png` | The rule set editor: mode, group, the four amounts, the Act's floor stated for RM4,000. |

## What the container cannot show

As in 3a–3c: Inter and Inter Tight do not load through this container's
proxy, so every result renders in Chromium's fallback sans; the mockup PNGs
were rendered with the faces. The PDF uses Helvetica throughout, which is
what pdfkit ships.
