# Piece 2 — the statutory treatment of a component

Desktop at 1440 (2×), signed in as the demo owner. Synthetic tenant, demo
employees only.

Regenerate with the dev servers running and the HR UAT world seeded:

```
OUT=docs/screenshots/hr-components node apps/web/shot-hr-components.mjs
# (run from the repository root, so OUT lands beside the other piece folders)
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-payroll-items.png` | The catalogue. Every switch is live, including on system presets — the rule this piece changed. Six rows carry **Your clinic · from 1 Jun 2026** with the clinic's own reason underneath; Director's fee and Overtime carry none, because they already matched what this clinic wanted. The **Unchecked** chip still says no flag here has been checked against an authority. |
| 02 | `02-when-and-why.png` | A preset's switch, which used to be drawn disabled. It does not save on its own: it asks which month the change takes effect from, and why, and says that months already priced keep the old treatment. |
| 03 | `03-history.png` | Every version of one component. `1 Jun 2026 onwards · In force` names what changed (*PCB off*) and who decided it — *Set by Dr Aisyah Rahman … Reimbursement of travel actually incurred, not pay.* The version below it, `1 Jan – 31 May 2026`, still says *Seeded by Kuwick. Not checked against any authority.* The two kinds of fact are never blurred. |
| 04 | `04-add-an-item.png` | A component the clinic makes itself. Everything starts off except PCB — pay is taxable unless something says otherwise, and a form that pre-ticked EPF would be Kuwick guessing at a clinic's policy and calling it a default. |

## What this world proves

The demo tenant's three payroll months were priced **after** these decisions
and under them. Dr Meera Kaur's June: gross RM10,400 including RM900 of
allowances, basic RM9,500 — and EPF employee RM1,045, which is 11% of 9,500,
not of 10,400. Under Kuwick's seeded treatment it would have been RM1,144.

## What the container cannot show

As in every earlier piece: Inter and Inter Tight do not load through this
container's proxy, so the result renders in Chromium's fallback sans.
