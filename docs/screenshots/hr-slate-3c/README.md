# HR Slate, Piece 3c — Employees

Desktop, **1440 wide at 2×**, page height per screen — the width the mockups
in `docs/design/hr-slate/` were rendered at, so a result can be put beside
its mockup without scaling either. Synthetic `admin-uat` tenant, demo
employees only; the three recurring items on Dr Meera Kaur were added
through the new endpoint so the record shows what the mockup shows.

Regenerate with the dev servers running:

```
OUT=docs/screenshots/hr-slate-3c node apps/web/shot-hr-slate-3c.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-employees.png \
  docs/screenshots/hr-slate-3c/01-employees.png \
  docs/screenshots/hr-slate-3c/01-employees--side-by-side.png "Employees"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-employee-record.png \
  docs/screenshots/hr-slate-3c/02-employee-record.png \
  docs/screenshots/hr-slate-3c/02-employee-record--side-by-side.png "Employee record"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-employees--side-by-side.png` | **Acceptance evidence.** Left: `slate-employees.png`. Right: the directory — four figures, the four dots, the Record chip, Edit + ⋯. |
| 01 | `01-employees.png` | The result on its own. |
| 02 | `02-employee-record--side-by-side.png` | **Acceptance evidence.** Left: `slate-employee-record.png`. Right: the record on Employment & salary — the dated salary, the recurring items, the employment block. |
| 02 | `02-employee-record.png` | The result on its own, full height, with the *This year* block under the employment terms. |
| 03 | `03-employee-profile.png` | Profile: personal, account, what is on record. |
| 04 | `04-employee-statutory.png` | Statutory: reference numbers, the standing with the EPF employee share, the EPF basis, TP1/TP3. |
| 05 | `05-employee-bank.png` | Bank: the bank and whether an account is on file. |
| 06 | `06-medical-benefits.png` | Medical benefits as the second tab of Employees. |

## What the container cannot show

As in 3a: Inter and Inter Tight do not load through this container's proxy,
so every result renders in Chromium's fallback sans; the mockup PNGs were
rendered with the faces.
