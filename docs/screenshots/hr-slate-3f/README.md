# HR Slate, Piece 3f — Reports

Desktop at 1440 (2×), signed in as the demo owner. Synthetic tenant, demo
employees only.

Regenerate with the dev servers running and a world seeded:

```
OUT=docs/screenshots/hr-slate-3f node apps/web/shot-hr-slate-3f.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-reports.png \
  docs/screenshots/hr-slate-3f/01-reports.png \
  docs/screenshots/hr-slate-3f/01-reports--side-by-side.png "Reports"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-reports--side-by-side.png` | **Acceptance evidence.** Left: `slate-reports.png`. Right: the shelf — the payroll month, Payroll reports, Government reports, Payslips, Everything else and Not available yet. |
| 01 | `01-reports.png` | The result on its own. |
| 02 | `02-report-open.png` | A report opened from the shelf (`?report=PAYROLL_REGISTER`): the kit's crumb and page head, the run picker, and the register itself. |

## Which world these were taken on

Both shots are the **HR UAT world** (`seed-hr-uat.ts`), where June, July and
August have been run through the engine and paid, so the government rows and
the payslips are filled. On the base world (`seed-admin-uat.ts`) August is
calculated but not approved, and the same page correctly shows *A statutory
listing is made from an approved month* and an empty payslips panel — that is
the screen being honest, not a rendering fault.

## What the container cannot show

As in 3a–3g: Inter and Inter Tight do not load through this container's proxy,
so every result renders in Chromium's fallback sans; the mockup PNGs were
rendered with the faces. The mockup's invented figures (a 10-employee August,
three months, an EPF row reading *Ready*) differ from the demo world's own.
