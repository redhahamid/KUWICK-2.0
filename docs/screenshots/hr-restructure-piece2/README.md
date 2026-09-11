# HR restructure, Piece 2 — Settings

Desktop, 1440×900 at 2× device pixel ratio, against the synthetic `admin-uat`
tenant. Demo employees only — no real staff, patient or payroll data appears
anywhere in this pack.

Regenerate with the dev servers running:

```
OUT=docs/screenshots/hr-restructure-piece2 node apps/web/shot-hr-settings.mjs
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-settings-landing.png` | The landing: **4 of 5**, an Open button on every required step, Bank payment file marked **Optional** and out of the count, and the six cards. Taken in a 1440×1500 window because the Admin frame scrolls its own content area. |
| 02 | `02-company-statutory.png` | **Company & statutory** — the page the card of that name opens. The pay-component table that used to sit under the employer's numbers is gone; a sentence points at Payroll items. |
| 03 | `03-payroll-items.png` | **Payroll items**, now carrying everything the employer page carried: the scheme flags, OT base, unpaid-leave base, and whether a human has checked each flag. |
| 04 | `04-payroll-policies.png` | **Payroll policies** — approval rule and pay rules only. The employer table and the attendance editor are sentences with links now. |
| 05 | `05-attendance-leave-policies.png` | **Attendance & leave policies** — the one place the attendance rules are edited. |
| 06 | `06-public-holidays.png` | **Public holidays** on `AdminShell`: sentence-case title, subtitle, search, an empty state that explains itself, and **+ Add holiday**. |
| 07 | `07-opening-balances.png` | **Opening balances**. |
