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
| Last green | **1105 frontend / 1178 backend**, both typechecks clean |
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

Queue order from the standing prompt: **Q4 (patient profile editing)** is next.
Q1 is partially done — what remains inside it:

- **C6 anthropometry** — paeds centiles from DOB + Wt/Ht. A basic chart view.
- **C8 `.shortcut` expansion** — today it is a Dropdown of hardcoded entries in
  `ClinicalNotesTab` (`SMART_ABBREVIATIONS`). Needs: typed ".urti" expansion in
  the editor, Tab hopping blanks, and a Settings-backed table seeded with the
  common ones.
- **C9 attachments in the notes card** — today `ClinicalImageStrip` +
  `VisitAttachmentsPanel` sit outside it. Needs drag-drop, type tags
  (photo|lab|letter) and a real viewer, reusing the existing attachment infra.

Also outstanding and worth doing early in Q6/Q7, since the catalogues are now
real: the canvas diagnosis search and medication search still read the OLD
placeholder surfaces. The data is seeded; the UI is not yet pointed at it.

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

## Task 1 — roles & permissions (in progress)

Done: `SystemRole` enum + `staff_role_assignments` (RLS, attributed grants),
the central policy module `apps/api/src/core/permissions.ts` (37 tests), and
the session now publishes `permissions[]` + `roles[]`.

**Additive, not destructive.** `staff.role` is untouched. `LEGACY_ROLE_FALLBACK`
in the policy module maps each legacy role to capability roles and applies
only to staff with NO explicit assignment. An explicit assignment always wins.

**Enforcement wiring — IN PROGRESS. Task 1 is NOT done until this finishes.**

Migrated so far (they delegate to the policy module and hold no role list of
their own): `canAuthorNarrative`, `canAuthorStaffRemark`,
`canRecordObservations`, `canModifyDiagnosis`, `canVoidClinicalRecord`,
`canClinicallyAuthoriseDocument`, `canIssueAdministrativeDocument`. The actor now carries its capability roles
(`ActingStaff.assignedRoles`, loaded by `requireActor` /
`requireClinicalAuthor`), so predicates read them without every call site
changing.

Still holding local role lists, migrate next, one at a time, suites green
after each:
- `clinical-authorization.ts`: `canEditDraft`. `DOCTOR_ROLES` and
  `CLINICAL_ROLES` at the top of the file are the remaining local tables —
  delete each as its last reader migrates.

**BILLING + QUEUE: the permissions are BUILT, the wiring is BLOCKED on one
mapping question.** Owner approved per-action billing (`billing.counter` /
`billing.corrections`, the latter individually grantable) and the queue split
(`queue.consultationFlow` on DOCTOR + ADMINISTRATOR). Both permissions exist,
are granted, and are tested (59 tests in `permissions.spec.ts`). Individual
grants exist end to end: `staff_permission_grants`, additive-only, closed list
(`billing.corrections`, `dispense.perform`), `reason` mandatory.

Wiring `canPerformQueueAction` and `canPerformBilling` onto them was attempted
and REVERTED, because the suite proved it changes real behaviour:

| broke | why |
|---|---|
| `FINANCE_STAFF cannot addToQueue / call / arrived / moveToDispensary / cancel` | FINANCE → ADMINISTRATOR, and ADMINISTRATOR carries `queue.consultationFlow` |
| `HR_STAFF cannot call`, `STOCK_STAFF cannot addToQueue / complete` | same |
| `DOCTOR_LOCUM may create / addLine` (invoices) | DOCTOR has no `billing.counter`, but doctors can raise invoices today |

Root cause: **ADMINISTRATOR spans four legacy roles with materially different
queue and billing rights** — OWNER_ADMIN, FRONT_DESK, FINANCE, HR/STOCK/PANEL.
Front desk and owner-admin run the queue; finance, HR and stock do not. No
grant can fix it because grants are additive and this needs a subtraction.

Two ways forward, both the owner's call:
1. **Narrow the fallback.** Map FINANCE/HR/STOCK/PANEL to a narrower set than
   full ADMINISTRATOR — i.e. accept that ADMINISTRATOR means "front counter"
   and give the back-office roles only what they had. Cheapest, no new role.
2. **A fifth role** (e.g. BACK_OFFICE) for finance/HR/stock/panel, leaving
   ADMINISTRATOR as the counter role. Cleaner conceptually, more to build.

Until one is chosen, `queue-authorization.ts` and the billing half of
`clinical-authorization.ts` keep their own matrices and are correct.
`DOCTOR_ROLES` / `CLINICAL_ROLES` stay until then.

**TASK 1 IS NOT DONE.** Everything else in it is: schema, policy module,
session payload, seven clinical predicates delegating, fixtures, individual
grants.

## Task 2.5 — PARKED FEEDBACK (do after Task 2, alongside/before Section P)

Owner-reviewed on staging. Not started; do not interrupt Task 1 for it.

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
