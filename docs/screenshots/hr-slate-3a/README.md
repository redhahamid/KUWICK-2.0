# HR Slate, Piece 3a — kit and shell

Desktop, **1440×960 at 2×** — the size the mockups in `docs/design/hr-slate/`
were rendered at, so a result can be put beside its mockup without scaling
either. Synthetic `admin-uat` tenant, demo employees only.

Regenerate with the dev servers running:

```
OUT=docs/screenshots/hr-slate-3a node apps/web/shot-hr-slate-3a.mjs
node apps/web/compose-side-by-side.mjs docs/design/hr-slate/kuwick-hr-settings-slate.png \
  docs/screenshots/hr-slate-3a/01-settings-landing.png \
  docs/screenshots/hr-slate-3a/01-settings-landing--side-by-side.png "Settings landing"
```

| # | File | What it shows |
|---|---|---|
| 01 | `01-settings-landing--side-by-side.png` | **The acceptance evidence.** Left: `kuwick-hr-settings-slate.png`, the mockup. Right: the Settings landing on the Slate kit inside the Slate shell. |
| 01 | `01-settings-landing.png` | The result on its own. |
| 02 | `02-payroll-old-kit-in-slate-shell.png` | The same shell around a screen still on the old kit — the "two looks" accepted for the transition, shown rather than described. Payroll moves to Slate in 3d. |
| 03 | `03-operation-untouched.png` | Not HR. The navy header, the white sub-header and the module row are exactly as they were; nothing in Slate reaches this page. |

## What the container cannot show

The kit's faces, Inter and Inter Tight, are loaded from Google Fonts by an
`@import` at the top of `slate.css`. This container's outbound proxy resets
that request (`net::ERR_CONNECTION_RESET`, verified with `document.fonts`), so
every result here renders in Chromium's fallback sans. A browser with
internet access loads the faces; the mockup PNGs were rendered by one that
did, which is why their headings sit tighter than the results'.
