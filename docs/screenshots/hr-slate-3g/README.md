# HR Slate, Piece 3g — the employee portal

Desktop at 1440 (2×), page height per screen, then two phone shots at 390.
Signed in as the demo resident doctor on the `admin-uat` world after
`seed-hr-uat.ts` — three months paid through the engine, her leave, claims
and benefit as the mockups tell the story. Synthetic tenant, demo employees
only.

Regenerate with the dev servers running and the world seeded:

```
cd apps/api && KUWICK_ADMIN_UAT_SEED=yes ADMIN_UAT_RESET_URL=<owner url> npx tsx prisma/seed-hr-uat.ts
OUT=docs/screenshots/hr-slate-3g node apps/web/shot-hr-slate-3g.mjs
UAT_EMAIL=resident@admin-uat.kuwick.invalid OUT=docs/screenshots/hr-slate-3g node apps/web/shot-hr-slate-3g2.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-portal-home.png \
  docs/screenshots/hr-slate-3g/01-portal-home.png \
  docs/screenshots/hr-slate-3g/01-portal-home--side-by-side.png "Portal home"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-portal-leave.png \
  docs/screenshots/hr-slate-3g/02-portal-leave.png \
  docs/screenshots/hr-slate-3g/02-portal-leave--side-by-side.png "Portal leave"
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/slate-portal-claims.png \
  docs/screenshots/hr-slate-3g/03-portal-claims.png \
  docs/screenshots/hr-slate-3g/03-portal-claims--side-by-side.png "Portal claims"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-portal-home--side-by-side.png` | **Acceptance evidence.** Left: `slate-portal-home.png`. Right: Home — the greeting and today's shift, Clock in, the last paid month with its PDF, the leave left, the claims waiting, the last three payslips, the quick actions, what happened lately. |
| 01 | `01-portal-home.png` | The result on its own. |
| 02 | `02-portal-leave--side-by-side.png` | **Acceptance evidence.** Left: `slate-portal-leave.png`. Right: Apply for leave with the dates typed — the server's preview of the days and the balance after — beside the balances and the requests. |
| 02 | `02-portal-leave.png` | The result on its own. |
| 03 | `03-portal-claims--side-by-side.png` | **Acceptance evidence.** Left: `slate-portal-claims.png`. Right: Submit a claim — mileage priced from the distance, the receipt required — beside the claims and the medical benefit. |
| 03 | `03-portal-claims.png` | The result on its own. |
| 04 | `04-portal-payslips.png` | Payslips: every paid month, the lines and the PDF. |
| 05 | `05-portal-attendance.png` | Attendance: the month's punches against the roster, the clock button, the roster. |
| 06 | `06-portal-profile.png` | Profile, read-only; the bank account changed through HR. |
| 07 | `07-portal-home-phone.png` | Home at 390 wide: the pills fill the row, the button is thumb-sized. |
| 08 | `08-portal-leave-phone.png` | Leave at 390 wide: one column. |
| 09 | `09-portal-clock-consent.png` | Second half. Clock in, the first time: *A photo with each punch* — what the photo is for, *Not now, clock without a photo*, *I agree*. |
| 10 | `10-portal-clock-camera.png` | The camera drawer (Chromium's fake camera pattern stands in for the front camera), *Skip the photo*, *Take photo and clock in*. |
| 11 | `11-portal-attendance-proof.png` | Attendance after the punch: the selfie thumbnail beside the clock-in time. A punch outside the branch's radius would carry a gold *Outside clinic · N m away* chip. |
| 12 | `12-portal-leave-mc.png` | Medical leave: the MC zone reads *required* and the button waits for the file. |
| 13 | `13-settings-geofence-claims.png` | Settings › Attendance & leave policies: the branch's point and radius under the attendance rules, and the Claims panel (mileage rate, receipt required). Shown for the group default; Central's seeded geofence appears with *Rules for: Contoh Central*. |

The second script tells the browser it is 25 m from the seed's placeholder
point and uses Chromium's fake camera; the punch it makes and the file it
uploads were removed from the world afterwards.

## What the container cannot show

As in 3a–3d: Inter and Inter Tight do not load through this container's
proxy, so every result renders in Chromium's fallback sans; the mockup PNGs
were rendered with the faces. The date fields are the browser's own control
and render in its locale (here en-US); the mockup writes *Mon 21 Sep 2026*.
