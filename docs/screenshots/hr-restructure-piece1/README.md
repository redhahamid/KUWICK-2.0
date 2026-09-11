# HR restructure, Piece 1 — navigation, routes, Settings

Desktop, 1440×900 at 2× device pixel ratio, against the synthetic
`admin-uat` tenant. Demo employees only — no real staff, patient or payroll
data appears anywhere in this pack.

Regenerate with the dev servers running:

```
OUT=docs/screenshots/hr-restructure-piece1 node apps/web/shot-hr-nav.mjs
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-employees.png` | Employees — first entry in the rail of seven. |
| 02 | `02-payroll.png` | Payroll, August 2026 — where HR now opens, from the tab and from `/admin/hr`. |
| 03 | `03-attendance.png` | Attendance, Timesheet tab. |
| 04 | `04-attendance-roster.png` | Attendance, Roster tab — the roster is a tab, not a rail entry. One branch is picked, because a roster belongs to one branch. |
| 05 | `05-leave.png` | Leave. |
| 06 | `06-claims.png` | Claims. |
| 07 | `07-reports.png` | Reports. |
| 08 | `08-settings.png` | Settings landing — the six one-time-setup cards. Taken in a 1440×1500 window: the Admin frame scrolls its own content area, so the cards sit below a 900px fold. |
| 09 | `09-settings-company.png` | Company & statutory. |
| 10 | `10-settings-payroll-items.png` | Payroll items — the seventeen pay components, with what each counts towards. New screen. |
| 11 | `11-settings-payroll-policies.png` | Payroll policies. |
| 12 | `12-settings-attendance-leave.png` | Attendance & leave policies. |
| 13 | `13-settings-public-holidays.png` | Public holidays — empty in this tenant; nothing has been entered for 2026. |
| 14 | `14-settings-opening-balances.png` | Opening balances. |
| 15 | `15-today-off-rail.png` | Today at `/admin/hr/today` — off the rail, still inside HR's own chrome. |
