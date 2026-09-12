# HR Slate, Piece 3b — Settings

Desktop, **1440 wide at 2×**, page height per screen — the width the mockups
in `docs/design/hr-slate/` were rendered at, so a result can be put beside
its mockup without scaling either. Synthetic `admin-uat` tenant, demo
employees only.

Regenerate with the dev servers running (the script signs in, presses *Mark
as checked* once if it is offered, then shoots the eight pages):

```
OUT=docs/screenshots/hr-slate-3b node apps/web/shot-hr-slate-3b.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-settings-statutory.png \
  docs/screenshots/hr-slate-3b/02-statutory-rates.png \
  docs/screenshots/hr-slate-3b/02-statutory-rates--side-by-side.png "Statutory rates"
```

| # | File | What it shows |
|---|---|---|
| 02 | `02-statutory-rates--side-by-side.png` | **The acceptance evidence.** Left: `slate-settings-statutory.png`, the mockup. Right: the new Statutory rates page — the clinic's check in the head, the four panels, the per-employer HRD block. |
| 02 | `02-statutory-rates.png` | The result on its own, full height. |
| 01 | `01-settings-landing.png` | The landing after the check: *Statutory rates checked* is Done with who and when, *One to go* is the SOCSO employer number. |
| 03 | `03-payroll-items.png` | Per-row switches. Every demo row is a system item, so its treatment switches are disabled and only *In use* is live. |
| 04 | `04-company-statutory.png` | The employer table on the kit's table; *Could it file?* with what is missing. |
| 05 | `05-payroll-policies.png` | The three approval sentences, the self-approval switch, the inert-rule notice, the pay bases, the links to the other homes. |
| 06 | `06-attendance-leave-policies.png` | `AttendanceRulesPanel` restyled in place. |
| 07 | `07-public-holidays.png` | Empty for 2026 in the demo tenant, with the notice that says what that means. |
| 08 | `08-opening-balances.png` | The import form on the kit. |

The Payroll items popover (effective month + reason) does not appear in a
static shot: it opens on a live, non-system switch, and every demo row is a
system item. It is exercised by the page's code path against the server rule
described in `docs/HR_RESTRUCTURE_PIECE3B.md` §3.

## What the container cannot show

As in 3a: Inter and Inter Tight do not load through this container's proxy,
so every result renders in Chromium's fallback sans; the mockup PNGs were
rendered with the faces, which is why their headings sit tighter.
