# Kuwick 2.0 Canvas — session handoff

Branch: `clinical-workspace-c2-canvas-ux`. Never merge C2 or touch `origin/master`.

## How to resume

```bash
git fetch origin clinical-workspace-c2-canvas-ux && git merge --ff-only origin/clinical-workspace-c2-canvas-ux
pg_ctlcluster 16 main start          # container resets stop it
cd apps/api && npx prisma generate   # stale client after a reset
npx prisma migrate status            # must say "up to date"
```

Suites: `cd apps/web && npx vitest run` · `cd apps/api && npx jest --silent`.
Typechecks: `npx tsc --noEmit -p tsconfig.json` in each app.

Dev: API `:3000`, web `:5173`. All credentials `DevLocal!2026`,
owner `owner.admin@smoke-test-clinic.test`.

Parity shots: `cd apps/api && npx tsx prisma/kw2-parity-shots-2b.ts`
(1600px **container**, not viewport — the script measures and prints it).

## Baseline

| | |
|---|---|
| Last green | **1097 frontend / 1138 backend**, both typechecks clean |
| Migrations | 63, no drift |
| Last commit | see `git log` |

## Checklist state

| Item | Status |
|---|---|
| A1 reviewed ✓ control | **done** (`a0fab26`) |
| A2 persistent allergy strip | **done** |
| A3 completion checkpoint | **done** — one dialog, both sections, warnings recorded on the completion event |
| B4 hover preview | **done** (`532df16`) |
| B5 Hold / Resume | **done** (`5c9af27`) |
| C6 inline vitals + live BMI | **done** |
| C6 anthropometry / paeds centiles | not started |
| C7 autosave pill, Save & sign, language | **already existed** — verified |
| C8 Dictate honestly disabled | **done** |
| C8 `.shortcut` expansion from Settings | not started — today it is a dropdown of hardcoded entries |
| C9 attachments inside the notes card | not started — today a separate strip + panel |
| Q2 retire documentation-pending banner | **done** — now a checkpoint section |
| Q3 seed data | **done** — 162 diagnoses, 229 medications, idempotent |
| D10 diagnosis | not started — catalogue is real now, the canvas UI is not |
| E11–E14 orders | not started |
| F15–F18 medications | not started |
| G19 documents | not started |
| H20–H21 invoice + complete | not started |
| I22–I23 polish | not started |

## Gotchas that have cost real time

- **The container resets.** Push after every unit; a pushed commit is the only safe state.
- `tsx`/esbuild `keepNames` injects a `__name` helper that does not exist inside
  `page.evaluate` — **no inner function declarations** in Playwright evaluate bodies.
- jsdom reports `clientWidth: 0` for every element and has no `ResizeObserver`.
- antd `AutoComplete` filters server results client-side by option `value`;
  `filterOption={false}` is required.
- `&& echo OK` after a piped command reports success even when the command failed.
  Use `; echo "rc=$?"`.
- `prisma format` reflows the schema, so edit anchors go stale. Print the model
  text first, assert every anchor, then write.
- Visit query keys are `['visits','patient',patientId]` and `['visits',id]` —
  **not** `['visit',id]`. Invalidating the wrong one leaves the Canvas header
  disagreeing with the queue.
- `useCompleteVisit` still invalidates `['visit', visitId]`, which matches
  nothing. Pre-existing, unrelated to C2 — worth fixing when H21 is built.

## Seeding

```bash
cd apps/api
npx tsx prisma/seed-clinic-catalogues.ts --tenant aaaaaaaa-0000-4000-8000-000000000001
```

Idempotent — a second run inserts 0 and updates everything. Never deletes:
a medicine dropped from a later export stays, because prescriptions reference
it. Stock is SET, not added, so re-running does not multiply the shelf.

Source files: `apps/api/prisma/seed-data/*.csv`. Parsing rules and their
reasoning live in `apps/api/src/inventory/seed-import.ts` (29 tests).

Known real-data quirk: the diagnosis list carries two ICD-10 codes under the
name "Sebaceous cyst" (L72.9 and L72.3). `diagnosis_catalog` uniques on NAME
and the custom-diagnosis upsert depends on that, so the later row keeps the
code it already carries in its name — "Sebaceous cyst (L72.3)". The run
prints every row it does this to.

## Standing rules

- Nothing red, blocking, or "interaction detected" anywhere in allergy UI.
- No per-add allergy popups — the strip is persistent and non-dismissable.
- Every visible control works or is explicitly disabled with a truthful tooltip.
- Appointment button: disabled stub, tooltip "Coming soon" (built separately).
- Approved deviations: 12px clinical font floor, scoped tokens, Dispensary nav
  item, greyed e-Invoice LHDN, sub-1600 responsive clamps.
- Do not "improve" the approved design without asking.
