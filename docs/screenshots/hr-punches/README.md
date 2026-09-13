# Piece 1 — punches

Desktop at 1440 (2×), signed in as the demo owner on the `admin-uat` world
after `seed-admin-uat.ts`. Synthetic tenant, demo employees only.

Regenerate with the dev servers running and the world seeded:

```
cd apps/api && KUWICK_ADMIN_UAT_SEED=yes ADMIN_UAT_RESET_URL=<owner url> npx tsx prisma/seed-admin-uat.ts
CHROME_PATH=/opt/pw-browsers/chromium OUT=docs/screenshots/hr-punches node apps/web/shot-hr-punches.mjs
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-timesheet-punches.png` | The day sheet. Nurul Hidayah worked `09:02–13:01 · 14:12–18:03` with **away 1 h 11 m** under it — two pairs, and the gap stated with its length and no judgement. Hours 7.8, not the 9.0 that first-punch-to-last reported |
| 02 | `02-fix-drawer.png` | The Fix drawer on that four-punch day: the punches numbered in order, each with **Wrong** as a text link, **+ Add a punch**, and `Hours after your change 7.8 h → 7.8 h` |
| 03 | `03-marked-wrong.png` | **The guarantee.** Punch 2 marked wrong: struck through, greyed, labelled `marked wrong`. The preview reads `7.8 h → 3.9 h · incomplete` and names the hanging punch — never a bare smaller number |
| 04 | `04-monthly-summary.png` | Finding 12: every figure on the Monthly summary opens the month behind it |

## What the container cannot show

As in 3a–3g: Inter and Inter Tight do not load through this container's proxy,
so every result renders in Chromium's fallback sans.
