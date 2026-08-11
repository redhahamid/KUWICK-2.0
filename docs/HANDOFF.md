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
| Last green | **1104 frontend / 1193 backend**, both typechecks clean |
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

## Next session starts here

**Finish the GUARDRAIL** (see its section below — phase 1 of the golden path
is green, the rest of the flow is the next unit), then A1.

Still-open canvas items from the retired queue, now A2 content:

- **C6 anthropometry** — paeds centiles from DOB + Wt/Ht. A basic chart view.
- **C8 `.shortcut` expansion** — today it is a Dropdown of hardcoded entries in
  `ClinicalNotesTab` (`SMART_ABBREVIATIONS`). Needs: typed ".urti" expansion in
  the editor, Tab hopping blanks, and a Settings-backed table seeded with the
  common ones.
- **C9 attachments in the notes card** — today `ClinicalImageStrip` +
  `VisitAttachmentsPanel` sit outside it. Needs drag-drop, type tags
  (photo|lab|letter) and a real viewer, reusing the existing attachment infra.

Also outstanding, and worth doing early since the catalogues are now real: the
canvas diagnosis search and medication search still read the OLD placeholder
surfaces. The data is seeded; the UI is not yet pointed at it.

Boundary table (re-run it after ANY permission change):
`cd apps/api && KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/task1-boundary-check.ts`
(needs the API running and the role fixtures seeded).

## D1 — the note editor was not typeable (fixed)

Root cause: the Canvas decided who may author a doctor's narrative from the
ROLE alone; the server decides it from the role **or** a verified medical
registration with signing enabled (`canAuthorNarrative`). A credentialed
OWNER_ADMIN was allowed by the server and refused by the browser. On a visit
with no notes that refusal meant no implicit draft opened, which made the
editor read-only, which swallowed keystrokes silently.

Fix: the server publishes `canAuthorNarrative` on the session and the Canvas
renders it. One source of truth. Absent on an old session = fall back to the
role, never "no".

Dev logins: `amira.rahman@` (DOCTOR_RESIDENT, credentialed — can author),
`owner.admin@` (OWNER_ADMIN, **no** medical registration — correctly cannot).
If a real clinic's owner is also the GP, set their registration and signing
flags; that is data, not code.

## Task 1 — roles & permissions — **DONE**

Owner-approved and closed. Proven by 1193 backend tests, 1104 frontend tests,
and an 11-case boundary table run as REAL MUTATIONS against a live server
(`apps/api/prisma/task1-boundary-check.ts`, 11/11 as specified).

**Additive, not destructive.** `staff.role` is untouched. The fallbacks in the
policy module apply only to staff with NO explicit assignment; an explicit
assignment always wins outright.

### The model

`apps/api/src/core/permissions.ts` is the single answer. Four system roles —
DOCTOR, CLINICAL_STAFF, ADMINISTRATOR (= **front counter**), OWNER — held in
any combination, effective permissions are the union. OWNER alone carries zero
clinical ability. `note.sign` additionally requires all eight credential
fields (`isCredentialedClinician`), which is a superset of the six signing
fields plus an active MEDICAL_DOCTOR identity.

Individual grants: `staff_permission_grants`, additive-only, closed list
(`billing.corrections`, `dispense.perform`), `reason` mandatory. `note.sign` is
deliberately not grantable — a signing capability without a medical
registration behind it is not a permission anybody can give.

### Migration mapping (owner decision: option 1, no fifth role)

| legacy role | resolves to |
|---|---|
| `OWNER_ADMIN` | OWNER + ADMINISTRATOR, **+ DOCTOR when credentialed** |
| `DOCTOR_RESIDENT` / `DOCTOR_LOCUM` | DOCTOR |
| `FRONT_DESK_CLINICAL_STAFF` | CLINICAL_STAFF + ADMINISTRATOR |
| `FINANCE_STAFF` | permissions `billing.counter`, `billing.corrections` |
| `HR_STAFF` | nothing |
| `STOCK_STAFF` | permission `dispense.perform` |
| `PANEL_STAFF` | permission `billing.counter` |
| `PATIENT_PORTAL` | nothing |

The four back-office roles map to permission SUBSETS in code
(`LEGACY_ROLE_PERMISSIONS`), never to a system role: routing them through
ADMINISTRATOR would have handed a finance, HR or stock clerk the queue. No
fifth role was invented because the people it would describe do not exist —
zero accounts hold HR_STAFF, STOCK_STAFF or PANEL_STAFF.

**Intentional losses, on record:**
- FINANCE loses `COMPLETE_TICKET` and visit completion (D-079/D-087). Closing
  a visit asserts dispensing and payment are done — a counter fact.
- A **non-clinical** legacy OWNER_ADMIN loses `HOLD_CONSULTATION`. Owner alone
  is not clinical; an owner who is also the GP keeps it via DOCTOR.

**Intentional widenings, on record:** STOCK_STAFF gains dispensing (refused
today); PANEL_STAFF gains the counter till (no billing action today). Zero
accounts hold either.

**Checked, not assumed:** HR_STAFF appears in neither the queue nor the
billing matrix in 1.0, and patient demographics were **never role-gated at
all** — so `patient.demographics.write` is a NEW gate for every role, not a
narrowing of HR's. It is not yet enforced on any endpoint (Section P work).

**DOCTOR holds `billing.counter`** (owner decision): the night-shift doctor
raises the invoice and takes payment when the counter is minimal. No doctor
holds `billing.corrections`.

### Enforcement — fully wired

Every matrix now names a permission and asks the policy module:
`queue-authorization.ts` (`QUEUE_PERMISSION`), the billing half of
`clinical-authorization.ts` (`BILLING_PERMISSION`), and the visit-completion
gate (one exported `mayCompleteVisit`, imported by the queue board so the
board cannot offer a button the server refuses). The seven clinical predicates
delegate. The browser reads `permissions[]` from the session instead of
computing its own billing answer.

Refusal wording is "Your **account** is not permitted to …" — since a
capability can be granted to a person without changing their role, blaming the
role would tell staff something no longer true.

### Fixtures

`KUWICK_ALLOW_FIXTURES=yes npx tsx prisma/seed-role-fixtures.ts` — Dr A
(DOCTOR+OWNER, credentialed, MMC 90001), Dr B (DOCTOR, credentialed, MMC
90002), Ms X (CLINICAL_STAFF), Ms Y (ADMINISTRATOR). Password `DevLocal!2026`.

A defect was found and fixed here while running the boundary table: the
seeder wrote six of the eight credential fields and printed "credentialed",
leaving `professionalType` at its NON_CLINICAL default — so the two doctors it
advertised as able to sign could not sign, and both shared one registration
number. Corrected; Dr B now signs live (case 11).

### Task 1 leftovers (small, not blocking)

- Settings › Users & roles CRUD UI, with the individual-grant UI for
  `billing.corrections` / `dispense.perform` and `wouldRemoveLastOwner` wired
  in. **This is Task 2 work** and is where it will land.
- `canEditDraft` still holds its own logic; `DOCTOR_ROLES` / `CLINICAL_ROLES`
  in `clinical-authorization.ts` are the last local tables — delete each as
  its final reader migrates.

## SCOPE CHANGE — the work order is superseded

The consolidated work order (Tasks 1–7) is **retired**. The master prompt
replaces it with three workstreams, built in this order:

**GUARDRAIL** (first, once) → **A1** fix-sweep → **A2** finish the canvas →
**A3** premium polish + platform → **B-shell + B1** → **C1** → **B2** →
**C2** → **C3** → **B3** → parked items last or never.

- **A — medical record dashboard** (premium, error-free)
- **B — reporting & analysis** (reads 1.0's data, in data-availability order)
- **C — appointments** (clinic-side, patient PWA, reminders)

Task 1 (roles & permissions) is done and flows into Workstream A. The old task
numbering is retired; Task 2.5's parked feedback below survives as content and
lands inside A3.

**Decision points — the only stops:** applying the legacy role mapping to
production accounts · SST / e-Invoice / messaging-gateway credentials ·
anything requiring a 1.0 behaviour change.

## GUARDRAIL — Playwright golden path in CI

**Why it exists:** to end the recurring medical-record breakage. Every
regression this project has shipped was invisible to the unit suites.
**Rule: red = fix before the next unit. Never disable a step to get green.**

### Done

- **`.github/workflows/ci.yml`** — there was NO CI in this repo before this.
  Two jobs: `unit` (postgres, migrate, both typechecks, both unit suites,
  ~2 min) and `e2e` (build both apps, seed, start real servers, drive the real
  UI). Migrations run in both — a migration that will not apply to an empty
  database is a defect, and `unit` is the cheapest place to find out.
- **`playwright.config.ts`** — `@playwright/test` 1.62.1, serial, one worker,
  1680×1000. Starts NO servers itself (a failed start belongs in a build log,
  not a test timeout). Locally set `CHROME_PATH=/opt/pw-browsers/chromium`;
  this container must never run `playwright install`.
- **`apps/api/prisma/seed-e2e.ts`** — runs AFTER `seed-staging-uat.ts` (the
  only script that boots an EMPTY database). Guarantees a doctor who can
  actually sign, J06.9, an all-day consultation tariff, and one medication in
  stock. Proven from empty against a scratch database.
- **`e2e/golden-path.spec.ts`** — **phase 1 GREEN**: register at the front
  counter → queue as Walk-in (W) → Call → Arrived → the patient is in the
  Consultation tab. Asserted against the queue itself, not against a modal
  closing.
- **`e2e/support/app.ts`** — accounts, login, `chooseRadio`, `describeControls`.

### Next unit — the rest of the golden path

Remaining steps to add to the single test, in order: vitals + live BMI · type
a note and prove the autosave persisted · diagnosis J06.9 · add the seeded
medication · complete through the checkpoint · dispense (assert a
`stock_movements` row) · invoice carries a consult line AND a med line ·
payment · COMPLETED · history rail shows Dx/Rx. Then the **OTC (C) variant**
asserting NO consultation line.

### Selector knowledge (expensive to rediscover — read this first)

- **This antd version renders `.ant-select-content`, NOT `.ant-select-selector`.**
  Click the `.ant-select` wrapper to open a dropdown; options are
  `.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option`,
  rendered in a PORTAL at the end of `<body>` (never inside the drawer).
- Options usually arrive from a query AFTER the drawer opens, so open-and-choose
  must be retried as a unit (`expect(...).toPass()`), and only click to open
  when the dropdown is not already open — clicking an OPEN antd Select closes it.
- antd button-style radios hide the real `<input type=radio>`; click the label
  text (`chooseRadio`).
- **Queue tabs are TABLES** (`getByRole('row')`); only the Overview tab uses
  `.ant-list-item` cards.
- **`Call` only announces — `Arrived` is what starts the consultation.** Call
  stamps `calledAt` and leaves the ticket WAITING. A spec that asserts only on
  Call passes while nothing moved.
- Canvas = `/patients/:patientId?visitId=:visitId`. The **Record View** column
  switches the right panel: Clinical Notes · Orders & Services · Diagnosis ·
  Medications · Documents · Invoices. Click the section name to switch.
  Diagnosis: `input[placeholder="Search diagnosis"]` + `Add`. Medications:
  unit `e.g. ml, tablet`, frequency `e.g. BD`, `+ Add to Prescription`.
  Live BMI carries `data-testid="live-bmi"`.
- Register + queue in one flow: `/queue` → **Add to Queue** → drawer
  "Add Patient to Queue" → radio **New Patient** → Name / ID Number →
  **Register & Continue** → drawer "Add <name> to Daily Queue" → Doctor select,
  Queue Type radio, **Add to Queue**.

### Running it locally

```
pg_ctlcluster 16 main start
cd apps/api && npx prisma migrate deploy
KUWICK_STAGING_SEED=yes STAGING_SEED_PASSWORD='DevLocal!2026' npx tsx prisma/seed-staging-uat.ts
npx tsx prisma/seed-e2e.ts
# API against the E2E world, web as usual:
DATABASE_URL="postgresql://kuwick_dev:devpass@127.0.0.1:5432/kuwick_e2e?schema=public" npm run start:dev
cd ../web && npm run dev
CHROME_PATH=/opt/pw-browsers/chromium E2E_PASSWORD='DevLocal!2026' npx playwright test
```

## A2 FEATURE — PATIENT ALERTS (owner spec, not started)

Slotted into **Workstream A2**, alongside the allergy quick-record work: they
share the header area and the same interaction pattern.

**Persistent per-patient flags visible to the whole team. Structured, not
free-text-only.** They are STANDING FACTS about a person, which is what makes
them different from everything else on the canvas.

### Model

`patient_alerts(patient_id, type, label, note?, active, created_by, created_at,
deactivated_by, deactivated_at)`, `type ∈ MEDICAL | ACCESSIBILITY |
COMMUNICATION | ADMINISTRATIVE`. **Deactivate, never delete — audited.**

### Predefined library

Seeded, and the clinic can add/edit it in **Settings › CLINICAL › Patient
alerts**:

| type | seeded entries |
|---|---|
| MEDICAL | DM · HPT · On Warfarin/Anticoagulant · Pregnant · Asthma · G6PD |
| ACCESSIBILITY | OKU · Wheelchair · Fall risk · Needs assistance |
| COMMUNICATION | Hearing impairment · Language: Mandarin/Tamil/Other · Deaf/Mute |
| ADMINISTRATIVE | VIP/Special handling · Payment note |

Custom = pick a type + free-text label (+ optional note). A predefined pick may
also carry a note.

### Who

| | MEDICAL | ACCESSIBILITY | COMMUNICATION | ADMINISTRATIVE |
|---|---|---|---|---|
| DOCTOR | ✓ | ✓ | ✓ | ✓ |
| CLINICAL_STAFF | ✓ | ✓ | ✓ | ✓ |
| ADMINISTRATOR | — | ✓ | ✓ | ✓ |

Add and deactivate both follow this table. Server-side, through the policy
module — this needs a **new permission split**, since one permission cannot
express "all types except MEDICAL". Expected shape: `patient.alert.write` (the
three non-clinical types) and `patient.alert.medical.write`, with DOCTOR and
CLINICAL_STAFF holding both. To be confirmed when built.

### Where they show — type-aware placement, not one noisy pile

- **Canvas patient header** — compact chips beside the allergy chip (icon +
  label: ♿ OKU · DM · Pregnant), overflow as a `+N` popover. Clicking any chip
  opens the manage popover, which is also where **[+ Add Alert]** lives — the
  same pattern as allergy quick-record.
- **Medications card** — only the MEDICAL alerts that bear on prescribing
  (Pregnant, On Warfarin, G6PD) join the allergy strip: ONE amber strip,
  allergy text first, then these labels.
- **Queue views (board + monitor call)** — ACCESSIBILITY + COMMUNICATION chips
  on the row. Front desk needs to know about a wheelchair or a language
  *before* calling the patient, which is the whole point of putting them there
  and nowhere else.
- **Patient profile slide-over** — the full list with notes; manage here too.
- **Completion checkpoint** — NO change. Alerts are standing facts, not
  per-visit warnings.
- **Flow view header** — the same compact chips, shared component.

### Two constraints to hold while building this

1. **Alerts never replace or merge into the allergy system.** The allergy
   chip, strip and checkpoint behaviour stay exactly as built.
2. The merged medications strip must not start implying a cross-check.
   Standing rule is unchanged: nothing red, nothing blocking, no per-add
   popups, and "Kuwick does not cross-check medicines against allergies. Only
   you can." stays. Adding "Pregnant · On Warfarin" beside the allergy text
   makes the strip say more, and it must not make it sound like the system is
   checking anything.

### Tests

Role boundaries on add and deactivate · type-aware placement (Pregnant appears
in the meds strip, OKU appears on the queue row, VIP appears in neither) ·
audit rows on deactivate · header overflow.

## Task 2.5 — PARKED FEEDBACK (do after Task 2, alongside/before Section P)

Owner-reviewed on staging. Not started. Task 1 is now done; re-place these
inside the new workstreams when the master prompt lands.

**1. Top nav polish** — refine, do not redesign. Within the existing kw2
language: active item gets a subtle raised pill (soft white/10% fill + the
blue underline already there), hover states with a gentle transition, tighter
letter-spacing per the mockup, consistent 8px-grid padding, clinic-switcher
pill and avatar cluster on one baseline, small band shadow from the existing
shadow token. Keep navy `#101632` and the item order. Before/after screenshot.

**2. Patients module reskin** — still 1.0-styled; apply kw2.
- Table → kw2 card container, 10px radii, kw2 borders/tokens, compact rows,
  hover highlight, sticky header. Search styled like the canvas inputs.
  "+ Add Patient" as a kw2 primary.
- Row actions: "Add to Daily Queue" text button → icon button + tooltip; add
  an ✎ opening **the same slide-over built in Section P2**. One component,
  two entry points — do NOT fork a second edit form.
- **Delete is wrong today.** Rules: a patient with ANY visit history can never
  be hard-deleted — the action becomes **Archive** (soft-delete, hidden from
  lists/search, restorable, audited). A patient with ZERO visits (a
  mis-registration) may be deleted by OWNER or ADMINISTRATOR only, with a
  confirm. Enforced server-side through the policy module via new
  `patient.archive` / `patient.delete` permissions. Archived patients reachable
  behind a filter; OWNER-restorable.
- Columns: keep Name / Identifier / Phone / Gender, add **Age** (derived) and
  **Last visit** — the two things front desk actually scans for.

**3. Canvas demographic/allergy editing** — no change to the plan; this is
Task 3 (P1 chip popover + P2 slide-over). Flow's expand/edit is verified
working; Canvas reaches parity through P2 using the same form component.

## Standing rules

- Nothing red, blocking, or "interaction detected" anywhere in allergy UI.
- No per-add allergy popups — the strip is persistent and non-dismissable.
- Every visible control works or is explicitly disabled with a truthful tooltip.
- Appointment button: disabled stub, tooltip "Coming soon" (built separately).
- Approved deviations: 12px clinical font floor, scoped tokens, Dispensary nav
  item, greyed e-Invoice LHDN, sub-1600 responsive clamps.
- Do not "improve" the approved design without asking.
