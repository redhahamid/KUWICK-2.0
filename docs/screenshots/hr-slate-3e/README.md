# HR Slate, Piece 3e — Attendance, Leave and Claims

Desktop at 1440 (2×), signed in as the demo owner on the `admin-uat` world
after `seed-admin-uat.ts`. Synthetic tenant, demo employees only.

Regenerate with the dev servers running and the world seeded:

```
cd apps/api && KUWICK_ADMIN_UAT_SEED=yes ADMIN_UAT_RESET_URL=<owner url> npx tsx prisma/seed-admin-uat.ts
OUT=docs/screenshots/hr-slate-3e node apps/web/shot-hr-slate-3e.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-attendance.png \
  docs/screenshots/hr-slate-3e/01-attendance.png \
  docs/screenshots/hr-slate-3e/01-attendance--side-by-side.png "Attendance"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-leave.png \
  docs/screenshots/hr-slate-3e/02-leave.png \
  docs/screenshots/hr-slate-3e/02-leave--side-by-side.png "Leave"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-claims.png \
  docs/screenshots/hr-slate-3e/03-claims.png \
  docs/screenshots/hr-slate-3e/03-claims--side-by-side.png "Claims"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-attendance--side-by-side.png` | **Acceptance evidence.** Left: `slate-attendance.png`. Right: the day sheet — four figures, the four tabs, the day pager, everybody who was expected, the selfie beside each punch, the result, the hours, the overtime and its approval, and the rules in force along the bottom. |
| 01 | `01-attendance.png` | The result on its own. |
| 02 | `02-leave--side-by-side.png` | **Acceptance evidence.** Left: `slate-leave.png`. Right: Leave — waiting, away today, away next week, unpaid days; Requests with the status filter; who decided each and when. |
| 02 | `02-leave.png` | The result on its own. |
| 03 | `03-claims--side-by-side.png` | **Acceptance evidence.** Left: `slate-claims.png`. Right: Claims — waiting and what they add up to, approved and unpaid, paid this year, the benefit used; the status and month filters; receipts, amounts and where each stands. |
| 03 | `03-claims.png` | The result on its own. |
| 04 | `04-leave-review.png` | The decision drawer on Leave: type, dates, applied, reason, balance after, who else is away, the timeline, and what it does to payroll. |
| 05 | `05-claims-review.png` | The decision drawer on Claims: the claim, what it was priced from, the receipt, the timeline, how much to approve, from where, and the note. |
| 06 | `06-attendance-month.png` | The fourth tab: the month per person, with approved and pending overtime as two columns. |

## What the container cannot show

As in 3a–3g: Inter and Inter Tight do not load through this container's proxy,
so every result renders in Chromium's fallback sans; the mockup PNGs were
rendered with the faces. The demo world's own figures differ from the
mockup's invented ones — a different number of employees, different claims —
which is data, not a divergence in the screen.
