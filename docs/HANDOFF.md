# Kuwick 2.0 Canvas — session handoff

## Branches (owner decision, 2026-08-11 — supersedes "never touch master")

**`master` is canonical and is what deployment (Railway) tracks.** PR #1
(`clinical-workspace-c2-canvas-ux`) was merged once the golden path and CI
were genuinely green; that branch is retired — do not push to it again.

**ONE working branch off current master**, currently
`claude/kuwick-2-0-session-opener-bfumia`. Per-unit pushes go there and only
there (no dual-pushing). **Owner rule 2026-08-12: every unit that goes green in
Actions is merged into master in the same session** (PR or fast-forward),
and master must be green in Actions before the next unit begins — the owner
reviews on the deployed app, which tracks master.

As of 2026-08-13 this session merged four units to master (b0 attachments,
b1-0 medicine findability, the catalogue-findability guardrail, b1a
search-first prescribing), each after its own green Actions run.

## How to resume

A fresh container has NOTHING installed and NO database. Full sequence:

```bash
npm ci
pg_ctlcluster 16 main start
su postgres -c "psql -c \"CREATE ROLE kuwick_dev LOGIN PASSWORD 'devpass' SUPERUSER\""
su postgres -c "createdb -O kuwick_dev kuwick_dev"
su postgres -c "createdb -O kuwick_dev kuwick_test"
# apps/api/.env — only .env.example is committed. Use the CI values, and note
# the JWT names: JWT_ACCESS_SECRET / JWT_REFRESH_SECRET, never JWT_SECRET.
cd apps/api && npx prisma generate && npx prisma migrate deploy
npx prisma migrate status            # must say "up to date"

git fetch origin master claude/kuwick-2-0-session-opener-bfumia
git checkout claude/kuwick-2-0-session-opener-bfumia
git merge --ff-only origin/claude/kuwick-2-0-session-opener-bfumia
```

To run Playwright locally (worth it — it caught two real defects this
session that the unit suites could not see):

```bash
cd apps/api
KUWICK_ALLOW_FIXTURES=yes KUWICK_STAGING_SEED=yes STAGING_SEED_PASSWORD='DevLocal!2026' \
  npx tsx prisma/seed-staging-uat.ts
npx tsx prisma/seed-e2e.ts
cd ../.. && npm run seed:catalogues --workspace=apps/api
(cd apps/api && npm run build) && (cd apps/web && VITE_API_BASE_URL=http://localhost:3000 npm run build)
(cd apps/api && KUWICK_ALLOW_FIXTURES=yes nohup node dist/main >/tmp/api.log 2>&1 &)
(cd apps/web && nohup npx vite preview --port 5173 --strictPort >/tmp/web.log 2>&1 &)
node scripts/wait-for.mjs http://localhost:3000/health http://localhost:5173
# From the REPO ROOT — run it inside apps/web and Playwright collects the
# vitest files and dies with "No tests found".
CHROME_PATH=/opt/pw-browsers/chromium E2E_PASSWORD='DevLocal!2026' npx playwright test
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
| Last green | **1159 frontend / 1383 backend**, both typechecks clean |
| Golden path | **GREEN, both variants, front door to COMPLETED** |
| CI | **GREEN — including the e2e job, for the first time ever** (see below) |
| Migrations | 68, no drift |
| Last commit | see `git log` |

**A fresh container starts with NOTHING installed.** `npm ci`, then create
`apps/api/.env` (there is only a `.env.example`; use the CI values —
`kuwick_dev`/`devpass`, and the JWT names `JWT_ACCESS_SECRET` /
`JWT_REFRESH_SECRET`), then create the role and both databases:

```bash
npm ci
su postgres -c "psql -c \"CREATE ROLE kuwick_dev LOGIN PASSWORD 'devpass' SUPERUSER\""
su postgres -c "createdb -O kuwick_dev kuwick_dev"
su postgres -c "createdb -O kuwick_dev kuwick_test"
cd apps/api && npx prisma generate && npx prisma migrate deploy
```

**The FIRST `vitest run` in a fresh container reports failures the second run
does not.** A cold Vite transform cache pushes several jsdom specs past their
`findBy*` timeouts (238s of test time on run 1, ~110s after). Four "failures"
with no assertion message is that, not a regression — re-run before believing
it, and this is separate from the teardown flake noted above.

**CI's e2e job had NEVER passed.** Every run since the workflow was authored
failed at login: the workflow set `JWT_SECRET` while the API reads
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, so tokens signed with an undefined
secret threw, login 500'd, and every spec timed out at `/login` — while
`/health` (no auth) kept the wait step green. Local runs never showed it
because `.env` carries the real names. Fixed in ci.yml; local green is NOT
CI green — check the Actions tab after pushing, every time.

**THE TEARDOWN FLAKE IS FIXED (2026-08-16).** It is no longer a known flake and
should not be re-run past.

What it was: a full `vitest run` reported every test passing and then exited 1
on one unhandled `ReferenceError: window is not defined` at `react-dom` →
`performWorkOnRootViaSchedulerTask` → `Immediate.performWorkUntilDeadline`. The
file it blamed moved between runs (`prescriptionVocabulary`,
`patientProfileSlideOver`, `allergyQuickRecord`, `medicineSearchFirst`), which
is the tell that it belonged to none of them. It blocked the merge of `56243b5`
on CI #89.

What it actually was, measured by instrumenting `setImmediate` with the stack of
whatever scheduled each callback:

1. React takes an update AFTER the last `afterEach` has completed — it arrives
   on a microtask, past every hook a test file can register. That is why the
   2026-08-13 `setImmediate`-drain attempt failed, and why no hook-based drain
   could ever have been the answer.
2. React's work loop then hops across `setImmediate`, yielding every 5ms and
   re-scheduling itself, so one render can span three ticks. `setImmediate` is
   NODE's queue — process-global, unrelated to the jsdom window the work renders
   into. Vitest closes that window between files; the callback fires anyway and
   reads `window.event`.

The defect was (2): the scheduling primitive outlived the DOM it scheduled work
for. React binds that primitive once, at `scheduler` module init, preferring
`setImmediate`, then `MessageChannel`, then `setTimeout` — and in this
environment ALL THREE are Node's. jsdom 26 implements neither of the first two,
and vitest deliberately puts Node's timers on the global window so fake timers
work, so `window.setTimeout` is Node's as well. (The first version of this fix
routed through `window.setTimeout` and the race survived, on `listOnTimeout`
instead of `processImmediate` — worth knowing before assuming `window.x` is
jsdom's.)

The fix: `apps/web/src/test-scheduler-lifetime.ts`, a setup file listed BEFORE
`test-setup.ts` in `vitest.config.ts` (order matters — `test-setup.ts` imports
@testing-library/react, and the scheduler binds its host callback the moment
react-dom is imported). It gives React a `setImmediate` backed by the only timer
jsdom itself owns and cancels, `globalThis.jsdom.window.setTimeout`, then hands
Node's real one straight back so nothing else is affected. Work scheduled
against a document is now discarded with that document instead of running
against its corpse.

Nothing is suppressed: no error is caught, no unhandled rejection ignored, no
reporter silenced. React work still runs and still throws if genuinely broken,
and jsdom routes such a throw to the window error handler vitest already listens
on. Measured: red 4/4 full runs before, green 3/3 after (66 files, 1309 tests),
duration unchanged at ~91s.

Pinned by `apps/web/src/schedulerLifetime.test.tsx`, which fails if a React or
scheduler upgrade picks a different host callback, or if the setup-file order
regresses (verified: flipping the order fails the test).

**The alerts open UNDER THE CHIP now, not in a centred modal (2026-08-16).**
Owner's call from staging: "bila click kt allergy tu nice je pop up; yang alert
tu mcm complex pop up centre — blh follow mcm allergy tu?" FIX 1 had given the
alert chip its own view instead of the full profile, but made it a modal: the
canvas dimmed and a Close button appeared to answer "what is this patient
flagged for?", while the allergy chip beside it in the same band had always
opened a popover. Two adjacent chips, two behaviours.

- `apps/web/src/clinical/canvas/AlertsQuickView.tsx` — anchored popover,
  `bottomLeft`, 340px, `maxHeight: 60vh` with its own scroll so a long history
  cannot push the resolved rows off the viewport. Same shape as
  `AllergyQuickRecord`. No Phase B dismissal guard, and it does not need one:
  adding and resolving each commit on their own button, so there is no
  half-typed form a click-away could discard. Antd keeps the content mounted
  when hidden, which is kept deliberately — a doctor who clicks away mid-entry
  finds the half-typed alert still there.
- `AlertsPanel` gained `compact` — a LAYOUT FLAG ONLY (drops the
  `KuwickFormSection` chrome, stacks the type/label row, since antd reads the
  VIEWPORT breakpoint and would otherwise squeeze two columns into 340px).
  Every rule stays one implementation: nothing deleted, resolving stamps a
  second author, resolved rows visible, ALLERGY/MEDICAL honest-disabled.
- `PatientAlertsModal.tsx` DELETED, and `PatientDashboardPage` no longer holds
  `alertsOpen`. The header takes `canEditAlerts` / `canRecordMedicalAlert`
  instead of `onOpenAlerts`.
- The non-obvious risk, and the test for it: the Type dropdown renders in its
  OWN portal, outside the popover's DOM. A click there reading as a click
  *outside* would close the whole thing mid-entry and lose a typed label —
  something a modal cannot do and an anchored form can. Held by
  "choosing an alert type does not dismiss the form under the doctor" in
  `alertsQuickView.test.tsx`, which types a label, opens the dropdown, picks an
  option and asserts both the popover and the typed text survive.
- `e2e/patient-profile.spec.ts` closes it by clicking the chip again; there is
  no Close button to reach for.

**IC AND DATE OF BIRTH ARE CORRECTABLE (2026-08-16).** They were read-only,
which read as caution and worked as the opposite: a transposed digit taken at
registration could not be fixed, so the counter's only remaining move was a
SECOND patient record — splitting the very history the lock protected. Staging
carries an 11-digit IC and a date of birth of 05/05/2026 as proof.

Four things replace the lock, and none of them is "trust the user":

- **A permission, held by EVERY STAFF ROLE THAT SEES PATIENTS** — DOCTOR,
  CLINICAL_STAFF, ADMINISTRATOR, OWNER. It shipped restricted to owner and
  counter and the owner removed that restriction the same day (2026-08-16):
  in a small clinic whoever is holding the IC card is who needs to fix it, and
  sending them to find another account is how the second file gets created
  anyway. **The restriction was never the protection** — the three safeguards
  below are, and all three are unchanged.
  Back office (finance/HR/stock/panel) and the patient portal are still refused:
  they hold no system role at all. Web mirror:
  `core/patient-identity-access.ts`.

  Worth recording, because the owner's instruction was to "grant it to every
  role that already holds `patient.demographics.write`" and that would NOT have
  done it: `patient.demographics.write` is held by ADMINISTRATOR **alone**, and
  is enforced **nowhere** — no service checks it, so the patient-update route
  has never gated demographics. Following it literally would have been a no-op
  that also dropped OWNER. Implemented to the intent, and flagged.
- **A duplicate check with a sentence.** `@@unique([tenantId, identifierType,
  identifierValue])` already refused it, but as a 500 and a stack trace, which
  invites a retry with a different spelling. Now named: "X is already
  registered under this NRIC". Soft-deleted clashes get their own wording —
  they still hold the constraint, so "nothing found" would be a lie the save
  contradicts.
- **A confirmation naming what is attached.** `GET
  /patients/:id/identity-impact` returns visit/invoice/document counts, fetched
  at save time (three COUNTs are not worth running to read a phone number). It
  also states plainly that already-issued documents are not rewritten.
- **An append-only record.** New table `patient_identity_changes`, ONE ROW PER
  FIELD, with the author's name and role as SNAPSHOTS. Deliberately not
  `audit_logs`: that table is generic, has NO RLS at all, is written by nothing
  in the codebase, and names an actor by a nullable user id. This one is
  tenant-scoped, has no UPDATE or DELETE policy, and carries the BEFORE
  DELETE/TRUNCATE triggers from 20260813140000. Readable at
  `GET /patients/:id/identity-history`.

Two things worth knowing before touching this:

- **Nothing snapshots the IC.** Grepped: `identifier_value` exists only on
  `patients`. `Document.content` is a rendered string frozen at issue, and
  there is no e-Invoice/LHDN table yet (only a `patient.lhdn.write`
  permission). So "do not rewrite issued documents" holds by construction, not
  by a rule someone has to remember.
- **The identity path only triggers on a REAL change.** `identityDelta`
  compares by value, because the profile form posts every field it holds. A
  save that only moved a phone number must not demand the identity permission
  or write "IC changed from 900101145566 to 900101145566". Held by a test.
- The client-side IC rule validates only what CHANGES. Legacy records hold ICs
  with dashes; refusing to submit the form until a locked legacy value is
  "fixed" would block a phone-number correction on a field the account cannot
  touch — the same dead end.
- `Modal.confirm` renders into antd's own module-level root, which
  testing-library's cleanup never unmounts. A test file that opens one needs
  `Modal.destroyAll()` in an `afterEach`, or the NEXT test finds two of every
  button.

**ONE PLACE TO RECORD AN ALLERGY (2026-08-16).** `patients.allergies` is
DROPPED. Every allergy is an ALLERGY alert; "asked, none known" is a
NO_KNOWN_ALLERGY alert. The header quick-record chip STAYS — two clicks
mid-consult is what gets allergies recorded at all — only its destination
changed.

Migrations: `20260816140000_no_known_allergy_is_an_answer` (the enum value
alone, because PostgreSQL will not let a new enum value be USED in the
transaction that adds it) then `20260816150000_one_place_to_record_an_allergy`
(origin column, nullable author, CHECK, backfill, verification, drop).

**The owner's attribution decision.** `created_by_staff_id` is now NULLABLE, and
a CHECK permits the null ONLY when `origin = 'MIGRATED'`. Nothing in the API can
write MIGRATED — it is in no DTO and the service does not accept it — so the
exemption cannot spread. The rejected alternative was a system staff row, which
would have put a non-person into the table that HR screens, rosters, user lists
and every staff picker read. The migration TIMESTAMP is the migration's own and
the row says so: it records when Kuwick learned this, the only date anybody
knows.

**The backfill was verified on a scratch database before the drop**, because
this migration destroys its own source. Method worth repeating: `createdb`, move
the last migration folder aside, `migrate deploy`, insert fixtures, move it
back, `migrate deploy`. Verified: two entries → two ALLERGY alerts; `[]` →
NO_KNOWN_ALLERGY; `["  "]` → NO_KNOWN_ALLERGY (whitespace is not an allergy);
NULL → nothing (never asked stays never asked); an existing HUMAN alert with the
same label case-insensitively → no duplicate. The migration also REFUSES to drop
the column if any patient with a non-null array has no corresponding alert.

**RLS trap for any future data migration.** `patient_alerts` is under FORCE ROW
LEVEL SECURITY and its INSERT policy tests `current_setting('app.tenant_id')`,
which no migration sets — and FORCE applies to the table owner too. The backfill
does `ALTER TABLE ... NO FORCE ROW LEVEL SECURITY`, copies, then restores it.
Any migration inserting into an RLS table needs the same.

What changed in code:
- `allergyBannerState` / `allergyStripText` / `allergyWords` take alert LABELS
  plus an explicit `askedAndNoneKnown`, not a patient object. `NONE_KNOWN` now
  requires a POSITIVE record — an empty list is indistinguishable from nobody
  asking, and collapsing those two would have put "Allergy not asked" back on
  every patient who had already answered.
- `AllergyQuickRecord` writes alerts: new words POST, removed words PATCH to
  deactivate (resolve, never delete), an emptied box posts NO_KNOWN_ALLERGY, and
  recording an allergy retires a standing negative so the history reads as the
  sequence it was.
- `headerAllergyState(labels, askedAndNoneKnown)`, `PatientSummarySidebar`,
  `CopyRxModal` (fetches alerts itself now, so its row-level "possible match"
  and the strip cannot disagree), `EditPatientDrawer` (field removed),
  `doctor-completion.service` allergy checkpoint (reads active ALLERGY alerts,
  deliberately not NO_KNOWN_ALLERGY).
- `NO_KNOWN_ALLERGY` takes `patient.alert.medical.write` like ALLERGY. Letting
  the front counter write it would let the counter clear a do-not-prescribe
  warning.
- The display-layer dedup STAYS. Its old cause (the same drug in both stores) is
  gone, but two clinicians can still record the same allergy in different words.

**Known untidy:** `apps/api/prisma/kw2-shots-a.ts` and `kw2-parity-shots-2b.ts`
still PATCH `{ allergies }`. They are screenshot/parity dev tools, excluded from
tsconfig and not run by CI, and they need rewriting against the alerts API
before they will work again.

**PHASE F — DOCUMENTS CARD: DONE (2026-08-16).** The right column's last empty
space is filled, and the card is `sections/DocumentsRail.tsx` beside
Services/Orders/Medications.

- **Migration** `20260816180000_a_time_slip_is_not_a_certificate` adds
  `TIME_SLIP` and `CONSENT` to `DocumentType` plus a `hours DOUBLE PRECISION`
  column. Both enum values and the column are in ONE file safely: nothing there
  compares against or inserts a new value. The moment a later migration needs
  to (a CHECK, a backfill) it must be its own file.
- **`hours` exists because start/end are `@db.Date`.** An MC covers whole days
  and storing 00:00:00 against one would invite somebody to read a time out of
  it; a time slip is one date and a duration. Double precision rather than the
  DECIMAL used for money — half and quarter hours are exactly representable and
  nothing reconciles hours to the cent.
- **TIME_SLIP and CONSENT do NOT require clinical authorisation**, and that is
  the point of naming them as types. A slip attests attendance, which the
  counter witnessed and `document.issueAdministrative` already covers; a
  consent records the PATIENT's agreement, not the doctor's judgement.
  Everything else stays clinical.
- **MC gained a one-day / date-range toggle.** One day is the commonest MC a GP
  writes and the range picker made it two clicks on the same date, which is
  also how it got issued a day out. Stored identically (start === end), so only
  `describeDates` knows the difference.
- **Reused, not rewritten:** `CreateDocumentDrawer` (its per-type fields now
  cover the two new types), `DocumentPreviewDrawer`, `printTextDocument`,
  `useVoidDocument`. Remove on the card VOIDS — no delete anywhere.
- **The Create MC control at `PatientDashboardPage.tsx` visit band is STILL
  THERE**, deliberately. It goes in a follow-up once the card has been used on
  staging; removing it the same day would trade a duplicate for an outage.

**The viewport sweep caught a real defect this session, and it was piece 2's.**
`.kw2-chip-danger` (the allergy chip) never had a max-width or wrapping, which
did not matter while allergies were a short free-text field. Once every allergy
became an ALERT the chip started listing everything on record, and a patient
with several drug allergies pushed the header band past 1366px. Fixed the same
way as the alerts chip: wrap, do not ellipsise — the words are the patient's own
and a summarised allergy is a changed allergy. Note the two-class selector
`.kw2-chip.kw2-chip-danger`, needed because `.kw2-chip { white-space: nowrap }`
is declared later in `canvas.css` and wins on source order.

**PHASES G AND H — NOT STARTED.** Three session-sized packages arrived in one
message (F, G, H each said "this session only"); F is done, the other two are
untouched. Both specs verbatim from the owner:

*PHASE G — b4: invoice + bottom bar.* Invoice card in the canvas auto-pulling
every billable line already on the visit: medications (quantity × price),
orders/procedures, direct services, and the consultation charge. Consultation
auto-billed for every patient EXCEPT OTC (queue type C); queue types are OTC
(C), Emergency (E), Walk-in (W), Appointment (A). Doctor can apply an
invoice-level discount with the reason recorded. Bottom bar carrying the
running total and Complete Consultation. Editing any source line updates the
draft live. Tests: all sources auto-pull, OTC skips the consultation charge,
discount recorded with reason, live update on source changes, golden path green.
Starting points already in the tree: `invoice/InvoiceSummary.tsx`,
`invoice.service.ts` (note it already fixed the hardcoded `quantity = 1` bug),
`billing-worklist.ts`, `consultation-tariff.ts` (D-094 consultation auto-billing
is already modelled server-side — read it before building a second answer).

*PHASE H — appointment calendar in the canvas.* Compact next-appointment card
showing any existing upcoming booking; a KuwickModal picker (date, time slot,
doctor, service) honouring Settings → Appointments & Scheduling doctor-service
mapping and slot capacity; booking from here creates a REAL appointment visible
in the Appointments module — no second store. Tests: an appointment booked from
the canvas appears in the Appointments module, capacity and mapping respected,
golden path green. Starting point: `apps/api/src/appointment/`
(`slot-availability.service.ts` already exists and has its own spec).

*FINAL LAYOUT PASS (with Phase H).* Follow Option 4 "Compact Pro" in
`docs/design/kuwick2-canvas-final.pdf`. Right-hand column order: Direct Services
→ Orders/Procedures → Medications → Documents → Invoice, with the appointment
card and bottom bar. No large dead space at the bottom; every card shows a
sensible empty state on a first visit. NOTE: the current order is Services →
Orders → Medications → Documents, so only Invoice and the appointment card are
missing from that sequence.

**b4 PIECE 1 — RIGHT RAIL VERTICAL BUDGET (2026-08-16). Done. The one test it
left outstanding is closed by Piece A, at the end of this section.**

The problem was density, not item count. A medication row spent FOUR lines —
name+status, dose, "manual dose entered", "dispense from clinic" — so eight
medicines was thirty-two lines and an invoice had nowhere to go.

- **Medication rows are one line**: name · strength · status · dose·freq·Nd·qty.
  The calculation note, the resolved supply source and the remark moved to
  hover.
- **HOVER IS A `title` ATTRIBUTE, NOT A PORTAL TOOLTIP.** Deliberate: a portal
  renders nothing until a pointer is over it, so the wording would have left the
  DOM and the accessibility tree — that is removing information, not relocating
  it. A title stays findable by a screen reader and by a test (`getByTitle`).
- **UNRESOLVED supply never moves.** D-091: a NULL supply mode is an unmade
  decision and the state the completion checkpoint stops on. Resolved supply
  hides; unresolved stays on the row as a chip. Hiding a warning behind a hover
  is the failure this compaction must not cause.
- **Document rows are one line** too; issued-by moved to the same title
  treatment.
- **Empty cards collapse to one line** — count, wording and the add control on
  one row. **Done with CSS, not by moving the control in the tree.** The first
  attempt rendered the add box in the header while empty, which unmounted and
  remounted it the moment the first item loaded, dropping focus mid-word for
  anyone typing a drug name. The orders search tests caught it. If you touch
  `.kw-rail-panel-empty`, keep the control in one DOM position.
- **Disclosure threshold is 5 everywhere**, and the button reads "+N more" —
  the remainder collapses, never the list.
- **Sticky headers** stick to the PANEL, not the viewport, so each hands over to
  the next instead of accumulating. No card has an inner scroll region; none is
  collapsed by default; no tabs.
- **Create MC / Create Referral / More Documents removed from the visit band**
  (owner confirmed the Documents card works). The band's document SUMMARY stays
  — reporting what was issued is a different job from issuing.

**THE DENSITY MEASUREMENT IS BUILT AND RUNNING IN CI, AND ALL FOUR CASES ARE
GREEN.** It prints the budget on every run — that number, not a pass/fail, is
what Piece B was waiting for. (When this was written it reported one case
outstanding; Piece A closed it. The history is kept below because the layout
decision was made on those readings.)

WORKING:
- `apps/api/prisma/seed-density-fixtures.ts` — runs clean, idempotent. One
  patient (IC `880808088808`) and two visits: `V-DENSITY-TYPICAL` (4 med, 1
  order, 1 doc) and `V-DENSITY-HEAVY` (10/4/3). Each carries ONE prescription
  with `supplyMode: null` on purpose — the unresolved state Piece 1 refused to
  move to hover, so the warning-chip assertion has something to find. Needs
  `DATABASE_URL` passed explicitly (tsx does not load `.env`). **In CI now**,
  as its own step after "Seed the E2E world".
- It writes `e2e/.density-fixtures.json` (gitignored) with both URLs **and the
  counts it planted**. The spec navigates by URL rather than clicking the
  visits rail — a density measurement must fail when the RAIL is too tall, not
  when a click path moves — and waits on the counts, for the reason below.
- Every run PRINTS the budget, passing or failing: `RAIL BUDGET — TYPICAL at
  1920×1080: rail needs 583px, has 877px above the fold (294px to spare)`.
  (Three of four cases passed when this was written; all four do now.)

**THE "RAIL RENDERS NO ROWS FOR A DIRECTLY-OPENED VISIT" DIAGNOSIS WAS WRONG.**
Nothing is missing from the fixture — no queue ticket, no visit state, no
assignment. Compared in the database against a golden-path visit, the two
differ only in the ways the seed intends. The rail renders all six TYPICAL rows
and all twelve HEAVY ones. **The spec was measuring too early**: it waited for
`.kw-rail-panel` to be visible, and Piece 1's own empty-card rule means a panel
with nothing in it renders a full card — so a rail whose fetches have not
returned and a rail with no content are the same DOM to a selector. The wait is
on the panel headers printing the counts the SEED planted; a count cannot be
satisfied early, and it cannot be satisfied by the wrong visit (opening a
patient shows their most recent visit for a moment before `?visitId=` takes
effect, which is why the two fixtures have different counts).

**`.kw-rail-row` AND `.kw-rail-head` ARE NOT RIGHT-RAIL SELECTORS.** They also
match the DIAGNOSIS card, which is in the MIDDLE column under the note editor.
That card's position tracks the editor's height, not rail density — and it was
one of the two "card headers pushed off screen" in the first HEAVY reading. The
measurement scopes to `[data-testid="canvas-right"]` now.

**A DEFECT THE MEASUREMENT FOUND, now fixed** (`unresolvedSupplyFirst`,
`medicationSupplyPresentation.ts`): the disclosure threshold of 5 was
collapsing the unresolved-supply warning out of sight. On the ten-medication
fixture the unresolved row sat tenth in the server's order, inside "+5 more" —
the same warning one CLICK away, for exactly the reason D-091 refused to put it
one HOVER away. Rows with no supply decision are ordered first now; the
remainder still collapses, and the counts are unchanged. Locked by a web unit
test as well as the e2e case.

**HISTORICAL FROM HERE — `TYPICAL fits 1366×768` was the only `.fixme` left,
and it no longer exists: Piece A finished the three height fixes and the owner
replaced that assertion. The current state is at the end of this section
("PIECE A — DONE"). The readings below are kept because they are what the
decision was made on.** It was no longer a fixture problem; it was the
measurement working:

    rail starts at y=277   patient header band, then the documents strip
    rail needs    738px    Direct Services 78 (empty), Orders 120,
                           Medications 368, Documents 131, gaps
    rail has      491px    768 minus where it starts
    OVER BY       247px    Documents entirely below the fold, and two of the
                           four medications with it

Piece 1 compacted the ROWS and did not reach the per-card overhead: four cards
spend roughly 320px on headers and always-visible add controls for six rows of
content. Two of Piece 1's own rules also come apart at exactly 1366 and nowhere
else, because the rail is ~457px wide there and the controls wrap — an empty
card takes 78px instead of the one line it takes at 1920, and a medication row
with a longer name wraps to two. Closing 247px is a decision about what else
gives way (the header band, the allergy strip, the per-card add controls —
which Piece 1 deliberately keeps in one DOM position and on screen). That is the
owner's call, not a test fix, so the case stays `.fixme` and reports itself as
outstanding on every run.

**OWNER'S THREE FIXES APPLIED (2026-08-16). 247px → 237px. STILL OVER.**

Measured, not estimated — the case prints its own budget line every run:

    RAIL BUDGET — TYPICAL at 1366×768: rail needs 728px, has 491px (OVER by 237px)
    RAIL BUDGET — TYPICAL at 1920×1080: rail needs 645px, has 845px (200px spare)

What each fix actually bought:

1. **Folding the documents strip into the Documents card bought ZERO HEIGHT,
   and the measurement says so: the rail still starts at y=277.** The strip is
   a `kw-completion-group` sitting SIDE BY SIDE with the invoice group in the
   band's flex row — removing it made the band narrower, not shorter. The
   change is kept because it is still correct de-duplication (the card owns
   what the strip was reporting), but the y=277 line comes from the patient
   header band plus the completion band's own height, and neither moved.
   **Anyone attacking y=277 next must reduce the BAND'S HEIGHT, not its
   contents.**
2. + 3. The empty-card rule at 1366 and the shorter add controls bought the
   10px between 247 and 237. Both are real and both stay: an empty card is one
   line at 1366 again (the wording ellipsises, the control keeps its size), and
   the add controls are 26px without moving in the DOM — Piece 1's single
   position, which fixed the focus-loss bug, is untouched.

The allergy strip and the unresolved-supply warning chip were not touched, per
the owner's instruction: both are safety information.

`TYPICAL fits 1366×768` therefore STAYS `.fixme`, and the assertion was not
weakened — it still measures against the full 768. The remaining 237px is
another decision about what gives way above the rail.

**OWNER'S REVERSAL (2026-08-16): THE DOCUMENTS STRIP STAYS IN THE BAND.**
Reverted. It had been removed in `13e4aa5` on the reasoning that the Documents
card reports the same thing — and the measurement had already shown that removal
bought ZERO height (the strip sits side by side with the invoice group, so it
narrowed the band rather than shortening it). The owner's call is that it stays;
do not fold it into the card again. Also ruled OUT by the owner: a shared
rail-wide search box. Each card keeps its own add control — one box for
everything costs staff training the clinic is not paying.

**PIECE A — DONE (2026-08-16). 237px → 131px, and the 1366 assertion is
redefined and GREEN. No `.fixme` remains in the suite.**

    RAIL BUDGET — TYPICAL at 1366×768: rail needs 660px, has 529px (OVER by 131px)
    RAIL BUDGET — TYPICAL at 1920×1080: rail needs 583px, has 877px (294px spare)
    RAIL BUDGET — HEAVY   at 1366×768: rail needs 962px, has 529px (OVER by 433px)
    RAIL BUDGET — HEAVY   at 1920×1080: rail needs 854px, has 877px (23px spare)

The owner's three fixes, in their priority order, each measured:

1. **THE BAND'S HEIGHT — y=277 → y=239, and NOTHING was removed to get it.**
   The patient header band went 127px → 107px and the completion strip 50px →
   38px. Padding (10→6 and 8→4), the row gap between the band's two wrapped
   rows (10→6), the space below each (14→8, 8→4), the identity block's leading
   (antd's 1.57 at 12px spends 19px on a 12px line; 1.35 spends 16), and the
   ACTION-BUTTON ROW — every control in it, the Segmented layout switch
   included, is 26px instead of antd's 32. At 1366 the band wraps into two
   rows, so that row's height is the band's height twice over; sizing the
   buttons without the Segmented would have bought nothing, because the
   Segmented was the tallest thing in it. Every chip, the allergy strip and the
   alert chips stay exactly as they were, wrapping included, at the sizes they
   were.
2. **CARD HEADERS — 32px each → 22px, four cards.** The header's own sticky
   padding (2→0), the margin below it (6→2), a line-height, and the status tag,
   which was leaded to 19px for a 12px word (D-072's floor is on the FONT SIZE,
   and that is untouched). Nothing left the header: title, count, status chip
   and the empty-state wording are all still there.
3. **ADD CONTROLS — 26px → 24px, and one 40px defect found while doing it.**
   `MedicationsRail` rendered its row as a second `<div className="kw-rail-add">`
   INSIDE the one `RailPanel` already wraps every addControl in — so
   `.kw-rail-panel[data-panel='Medications'] .kw-rail-add` matched both, the
   outer div became the flex container, the inner one became a flex ITEM that
   shrank to 297px inside a 435px card, and the search box plus Copy Previous
   wrapped onto two rows for want of room that was there all along. 70px of add
   control at EVERY width, 1920 included. The inner div is `kw-rail-add-row`
   now: a class rename, so the control does not move — Piece 1's single DOM
   position, which fixed the focus-loss bug, is untouched.

**A FOURTH THING, FOUND BY MEASURING RATHER THAN SPECIFIED.** Piece 1's
empty-card rule was not merely "failing at 1366", it was self-inflicted: the
rule that ellipsised the empty-state WORDING squeezed the row, and the card
TITLE — which nothing protected — wrapped onto three lines. "Direct Services
(0)" was rendering 58px wide and 66px tall inside an 82px card. The title is
`min-width: min-content` now and is one line at every width. The card is 76px
at 1366, not 46: the wording plus a usable control genuinely need ~576px of a
457px rail, so the control takes a second row. **Nothing ellipsises anywhere on
that card.** An earlier attempt at this DID close it to 46px by clipping, and
the A0 viewport sweep caught it within the hour — that sweep rejects a hidden
overflow as firmly as a sideways scroll, which is why the honest number here is
131 and not 101. If the row is ever wanted on one line at 1366, the WORDING is
what has to get shorter, and that is a wording decision.

**THE 1366 ASSERTION, REDEFINED IN THE OPEN — the owner's order, not the
earlier one.** `TYPICAL fits 1366×768 with every card and row on screen` is
GONE, replaced by `TYPICAL at 1366×768 keeps the warning, Medications and all
four cards`, which asserts each of these separately:

  a. **NON-NEGOTIABLE.** Any row carrying the unresolved-supply warning chip is
     on screen at rest, or the rail auto-revealed it — that warning never
     requires a scroll to discover. This OUTRANKS (b), and the ordering is the
     correction the owner made: D-091 refused to put this warning behind a
     hover, `unresolvedSupplyFirst` refused to let the disclosure threshold
     collapse it into "+N more", and a fold is simply the third way to hide the
     same thing. The spec finds the row by its own DOM mark AND requires the
     chip inside it, because either alone could outlive the other.
  b. At rest, the Medications card header AND its first row are above the fold.
  c. No item text truncated at any width.
  d. No card lost — all four present, named, of real height, and reachable.
  e. At 1920 the full TYPICAL rail fits with no scrolling at all. Asserted on
     the RAIL'S OWN BOTTOM EDGE, not its lowest row: the rail ends below its
     last row, and Piece B's invoice card will end below that.

This is a narrowing of what is promised and a widening of what is checked. The
budget line still prints on every run, pass or fail, and is still measured
against the FULL 768 — Piece B's sticky bar has to fit inside that number,
never be subtracted from it first. The `rowCount > 0` guard stays first on
every case (the vacuous-pass trap below).

## THE INVENTORY PACKAGE — PIECE 1 DONE (2026-08-18). The list is the worklist.

**FOUR DECISIONS THE OWNER FIXED AT THE STEP-1 BOUNDARY, and they are not open:**

- **D1. "Dispensed whole" is STORED, never inferred from a 1.** `unitsPerPack`
  /`quantityPerStockUnit` = 1 PLUS `dispensedWholeAt` + `dispensedWholeByStaffId`
  — the same shape a MIGRATED allergy uses. A bare 1 is never enough.
- **D2. Panel pricing is stored ahead of billing logic**, and the screen must
  SAY so ("recorded — not yet used in billing") until a bill consumes it.
- **D3. Delete on an inventory row is DEACTIVATE.** Items are referenced by
  prescriptions and invoice lines. The active toggle is the control; there is
  no hard delete and no route for one.
- **D4. A clinic's CSV upload clears `defaultsFromSeed` on every row it
  touches**, so `seed:standard-rx` can never overwrite their curation. Tested
  explicitly: upload → re-run seeder → clinic values stand.

**WHAT PIECE 1 BUILT.**

- **`divisorFacts` (`apps/api/src/inventory/dispensing-divisor.ts`) is the ONE
  reader of the divisor.** Clinic over import (1E — only they know whether
  their strips hold 10 or 12); zero and negatives treated as not-stated rather
  than trusted; and the worklist rule in one function, because the list, the
  form and Piece 4's formula are three callers and three copies of it is three
  chances for the screen and the bill to disagree.
- **THE WORKLIST RULE, and the one number worth knowing:** a row needs
  attention when it has NO divisor, or when the divisor is 1 and nobody has
  declared the item dispensed whole. The second half applies to an
  IMPORT-parsed 1 as well — a pack string is not a person — and it costs
  **exactly one row** across the current 242-row catalogue. It is there for the
  curation pass, where the temptation is to clear 149 blanks by typing 1.
- **A CHECK CONSTRAINT holds the marker to a divisor of 1** (`items_dispensed_whole_means_one`).
  The API clears the marker on a divisor change; the constraint is what refuses
  the row if it ever stops doing so.
- **`GET /items/catalogue`** — the MANAGEMENT list, separate from the
  prescribing search on purpose (that one is bounded to 20 rows and carries no
  stock unit and no divisor). The `attention` filter is applied in JavaScript
  over `divisorFacts` rather than as a WHERE clause: a SQL encoding of
  "coalesce(qps, upp) IS NULL OR (= 1 AND whole IS NULL)" is the second
  implementation of the rule and the first to drift.
- **THE COUNT IS THE CLINIC'S TOTAL and does not move with the filters.** Over
  ACTIVE rows only — a deactivated item cannot be dispensed, so it is not
  outstanding work. The chip shows AT REST, before anybody opens the filter,
  because a count that appeared only once you went looking would let the
  149-row gap ship in silence.
- **`stock_units.name_ms`, and one derivation for both languages.** The balance
  reads "99 Strip / Papan". The stored unit is the FULL name ("TABLET PER
  STRIP") because that is what makes the divisor unambiguous; the container is
  taken off the end of it, and "TABLET PER PAPAN" yields "Papan" by exactly the
  rule that yields "Strip". No third column. A clinic-added unit with no
  translation renders the English alone — "Strip / " with nothing after the
  slash is worse than "Strip". All 13 SYSTEM units are seeded, and a spec
  asserts the map and the list stay in step.
- **`item_categories` is a REGISTRY, not a second copy of the fact.**
  `items.category` stays the truth on the row. Rename is ONE transaction over
  the registry row AND every item carrying the old string — renaming only the
  list leaves those items filed under a name no longer on it, and because the
  tabs union in-use strings the clinic would watch the old category reappear
  beside the new one. Delete is refused while items point at it and the refusal
  NAMES THE COUNT. `adopt` registers an imported string nobody owns, which is
  what makes it renameable at all.
- **`POST /stock/adjust` is the quick +/-, and deliberately NOT `quickAdd`.**
  That writes a StockBatch and a GOODS_RECEIVED movement — a receipt with no
  supplier, no batch and no expiry, polluting the near-expiry screen. Somebody
  tapping + because the shelf says 41 and the screen says 40 received nothing.
  ADJUSTMENT with a required reason is the entry that says so. Negative
  balances stay legal (D-020).

**A DEFECT FIXED ON THE WAY THROUGH:** the Items page held the entire
catalogue in memory purely so a click on a row could find the object behind it.
With the list as its own request that was the catalogue downloaded twice to
open one drawer; the drawer fetches its one item now (`useItem`).

**MEASURED:** 1520 API tests, 1466 web tests, both typechecks, both production
builds. Not run here: the e2e suite (no PostgreSQL in this container).

## INVENTORY PACKAGE — PIECE 2 DONE (2026-08-18). The divisor is writable.

**THE FINDING THAT EXPLAINS THE AUDIT'S ZERO.** Phase 1E built
`stockUnitId` and `quantityPerStockUnit`, and the audit found
`quantity_per_stock_unit` set on ZERO of 242 rows. The reason was not that
nobody curated: **neither field was in any DTO.** No screen and no endpoint
ever accepted them. The majority of the catalogue had no divisor for
`ceil(clinical ÷ divisor)` for want of two DTO properties.

- **D1'S WRITE PATH: the client sends a BOOLEAN, the server owns who and when.**
  A caller that could post `dispensedWholeAt` could backdate a clinical
  decision and sign somebody else's name to it. `withoutServerOwnedFields`
  strips the audit columns in the service as well as through the pipe's
  whitelist, because the guarantee is clinical and should not rest on an option
  configured in another file. Three rules, all tested: declaring sets the
  divisor to 1; withdrawing clears the marker and **leaves the divisor alone**
  (withdrawing a statement is not stating the real count, and blanking it would
  make a priced item unpriceable via a checkbox); and moving the divisor off 1
  clears the marker **even when the payload never mentions it**.
- **The existing-row read is CONDITIONAL** — only when the payload could
  disturb the pair. Every update paying for a lookup it does not use is a cost
  that shows up on an import, not on one form.
- **`withClearedDefaults` NOW COVERS `stockUnitId` AND `quantityPerStockUnit`.**
  The Phase 1G trap one section down, and it costs money rather than a dose:
  antd's `allowClear` returns `undefined`, `JSON.stringify` drops it, the API
  reads a missing key as "leave it alone" — so a clinic withdrawing a divisor
  would be told "saved" while the old number kept dividing their quantities.
  `dispensedWhole` is deliberately NOT in that list: it is a boolean the form
  always sends, and `false` IS the withdrawal.
- **THE STOCK UNIT IS NOW TENANCY-CHECKED like the other three FKs on the row.**
  FK triggers are not subject to RLS, so a cross-tenant id lands and reads back
  as nothing — and this is the id the divisor hangs off, so a silent failure
  there is a pricing failure.

**ON D2 — A PREMISE THE OWNER SHOULD RE-EXAMINE, flagged not overridden.**
D2 says panel pricing is stored ahead of billing logic and the screen must say
"recorded — not yet used in billing". **For ITEM overrides that is not true
today.** `resolveSourcedPrice` (D-093, the one pricing truth, called by both
`invoice.service.ts` and `invoice-draft.ts`) reads `PanelPriceOverride` for any
prescription line on a panel visit. A price set on this screen changes what a
panel patient is billed on the next invoice raised. Printing the caveat would
be a **false reassurance about money**, which is the failure D2 exists to
prevent — so the screen says the true thing: "Applies to invoices raised from
now on; lines already billed keep the price they were billed at." If the owner
wants the caveat, the thing to change is the BILLING path, not the sentence.

- **The panel table shows what is CHARGED, not only what is stored.** The
  effective price comes from `resolveContractualPrice` — the invoice line's own
  function — and the rule behind it is named in words (this panel's own price /
  cash + panel markup / cash price), with the markup's number beside it. An
  override box alone would leave the clinic to work out what a panel with a
  blanket markup and no override actually charges. **Clearing DELETES the
  override rather than storing zero** — zero is a real and different statement.

- **Stock Control is TWO things and the screen says so.** "Track batch &
  expiry" is a fact about the ITEM (defaults TRUE — a medicine whose expiry
  nobody was asked for expires while the near-expiry screen stays quiet). The
  low-stock level belongs to a BRANCH's shelf (`StockLevel` is keyed by clinic),
  so it has its own control, its own save, and it names the branch. One number
  that looked item-wide would leave every other branch with no reorder alert.

**DEFAULT DISPENSE QUANTITY — and a wrong turn worth recording.** The first
attempt made a stated quantity suppress the auto-compute entirely. It broke two
tests and deserved to: live recalculation is deliberate, most medicines state a
default, and where a course can be multiplied out the computed number IS the
better answer. **The real defect was narrower** — the clinic's own number
vanished without trace, set on this screen and silently replaced,
indistinguishable from never having been set. It is now NAMED under the
quantity box whenever the box shows something else, with a link to use it.
Offered, not applied. `quantityFromItem` holds it; the precedence is unchanged.

**INDICATION is now the clinic's own catalogue, as tags — and STILL TEXT.** A
prescription copies the indication at prescribe-time for historical stability,
so making the item's field a reference means making the prescription's one too
and back-filling every prescription ever written. **Renaming a preset does not
rewrite items that copied its label.** Same trade-off as the free-text dosage
trio, same reason; it belongs with whoever retires those columns' last reader.

**MEASURED:** 1538 API tests, 1491 web tests, both typechecks, both production
builds. Not run here: the e2e suite (no PostgreSQL in this container).

## INVENTORY PACKAGE — PIECE 3 DONE (2026-08-18). The onboarding path, and D4.

**`GET /items/csv-template` + `POST /items/csv-import`.** The file arrives as
TEXT in a JSON body rather than multipart: a few hundred rows of ASCII the
browser can read, and a multipart parser on this API for one screen would be a
dependency and an upload-size policy nobody asked for.

- **`DISPENSED_WHOLE` IS A VALUE THE QUANTITY COLUMN TAKES.** The spreadsheet
  is exactly where somebody fills 1 down a column of 128 rows. A bare 1 imports
  as a NUMBER and stays on the worklist; the word imports as a STATEMENT with
  an author and a date. The template's second example row is that case, because
  nobody would guess it from a header. Spellings accepted:
  `DISPENSED_WHOLE`, `dispensed whole`, `Dispensed-Whole`.
- **NOTHING IS WRITTEN WHILE ANYTHING IS WRONG.** A partially-imported file is
  the worst available outcome — the clinic cannot tell which rows landed, and
  the remedy (fix, re-upload) is safe anyway because rows match by NAME. So the
  whole file validates first and every problem reports at once, keyed to the
  line number the SPREADSHEET shows (header counted). One pass through the file
  instead of one round trip per mistake. The screen checks (`dryRun`) before it
  applies, and Apply is only enabled on a clean check.
- **A BLANK CELL MEANS "I did not fill this in", never "delete this".** In a
  200-row template most cells are blank; reading blank as a clear makes a
  partially-filled upload a bulk wipe. An unrecognised yes/no word is REFUSED
  rather than read as no — guessing there switches off expiry tracking on a
  medicine.
- **A MISSING DIVISOR IS COUNTED, NOT REFUSED.** Refusing would keep the
  medicine out of the catalogue entirely to protect a number already missing on
  149 rows. The row imports and the screen says how many landed on the worklist.
- **ONE CELL WRITES BOTH HOMES** for dose unit, frequency, duration and
  consumption method — the structured 1F reference AND the legacy free-text
  column beside it, both of which are still read (`defaultsFromItem` is the
  fallback path). Two columns meaning the same thing get filled inconsistently.
  **1F's `defaultQuantity` is deliberately NOT in the template**:
  `seed:standard-rx` sets it well and a second "how many to hand over" column
  beside Default Dispense Quantity is a trap.
- An unresolved name names the SETTING where it would be added. Two existing
  items with the same name make "update by name" ambiguous and are refused
  rather than edited at random.

**D4 IS TESTED AGAINST THE SEEDER'S ACTUAL PREDICATE, not a description of it.**
Every row the upload touches gets `defaultsFromSeed` cleared — **including rows
carrying no dosage instruction at all**, because the flag is the seeder's only
signal and whether a clinic's curation is protected must not depend on which
columns of the template they filled. The end-to-end claim (upload → re-run
`seed:standard-rx` → clinic values stand) is asserted by copying
`seed-standard-prescriptions.ts`'s `clinicEdited` rule into the test, so it
FAILS if the two ever stop agreeing. **Worth knowing:** that predicate is
`hasDefaults && !defaultsFromSeed`, so clearing the flag only protects a row
that also HAS 1F defaults — which is correct (a row with none has nothing for
the seeder to overwrite) but is the sentence to re-read if the rule ever moves.

**MEASURED:** 1586 API tests, 1500 web tests, both typechecks, both production
builds. Not run here: the e2e suite (no PostgreSQL in this container).

## INVENTORY PACKAGE — PIECE 4a DONE (2026-08-18). **A LIVE MONEY DEFECT.**

**`Item.sellPrice` IS THE PRICE OF A PACK, NOT A TABLET**, and the clinic's own
import settles it beyond argument once the rows are read beside their pack
strings:

| medicine | price | pack |
|---|---|---|
| C. OSELTAMIVIR 75MG (FLUHALT) | RM 155.00 | 10 BIJI / STRIP |
| C. CELECOXIB 200MG (RABIROX) | RM 26.00 | 10 BIJI / STRIP |
| KETOPROFEN PLASTER 30MG | RM 17.00 | 7 SHEETS / PACK |

RM155 is a COURSE of Tamiflu. A prescription's `quantity` is in DOSE UNITS
(dose × doses-per-day × days). **`amount = quantity × unitPrice` — what both
the draft and the real invoice did — bills that course at RM 1,550.00.** The
charge is `ceil(clinical ÷ divisor) × packPrice`.

- **CEIL, NEVER DOWN.** Not a rounding preference: down means handing over
  three strips and charging for two, on every partial pack, every time.
- **NO DIVISOR MEANS NO PRICE**, and never a fallback of 1 — that fallback IS
  the RM1,550 identity. In the DRAFT the line is listed, unpriced, uncounted,
  carrying the reason and the remedy (the D-091 shape). On a REAL INVOICE LINE
  it is REFUSED: a draft may show an incomplete total, but an invoice line is a
  charge somebody pays.
- **ONE conversion (`dispenseCalculation`), attached to `resolveSourcedPrice`**
  rather than left to each of the three callers. The only thing worse than the
  wrong number is two surfaces reaching different wrong numbers.
- **`notPricedCount` — the outstanding chip's number, moved to the SERVER.**
  The browser was patching `unpricedCount` by re-deriving undecided supplies
  from line states. That held until a THIRD such state arrived (no divisor), at
  which point the browser would have been maintaining its own list of "states
  that mean the total is incomplete" — a billing fact on the wrong side.
  NOT_CHARGEABLE is excluded deliberately: "this visit carries no consultation
  charge" is an answer, not a gap.
- **NO RETRO-PRICING, now including quantity.** A billed line is read, not
  re-priced and not re-quantified — a clinic curating the catalogue afterwards
  must not turn a charge already made into a tenth of itself.

**⚠ STOCK DEDUCTION HAD THE SAME BUG — FIXED IN PIECE 4c BELOW.**

**MEASURED:** 1619 API tests, 1501 web tests, both typechecks, both production
builds. Not run here: the e2e suite (no PostgreSQL in this container).

## INVENTORY PACKAGE — PIECE 4c DONE (2026-08-18). **THE SHELF IS COUNTED IN PACKS.**

Owner's decision, verbatim: *"apply dispenseCalculation to both paths. A
30-tablet prescription deducts 3 strips, not 30."*

`prescription.quantity` is DOSE UNITS; `stock_levels.quantity_on_hand` is STOCK
UNITS. Both dispensing paths decremented one straight into the other, so a
five-day course of a 10-per-strip antibiotic took **thirty strips** off a
drawer holding four — reported a shortage that was not one, and if the shortage
was acknowledged, left the balance at **-26**.

Fixed in **four** places, not the two the brief named:

| file | what changed |
|---|---|
| `prescription.service.ts` | `dispenseCalculation` before the claim; delta and decrement in stock units |
| `dispensary.service.ts` | same, plus the shortage comparison and its message |
| `dispensary-board.service.ts` | `stockStateFor({ required })` — **see below** |
| `schema.prisma` | the comment on `Prescription.quantity` said "stock units". Both paths believed it. |

**THE BOARD WAS THE THIRD PLACE AND IT WAS NOT OPTIONAL.** The dispensary
board is the screen the counter reads before pressing Dispense, and it compared
a shelf counted in strips against a course counted in tablets. Fixing only the
server would have left the board saying INSUFFICIENT on a full drawer while
the server dispensed happily — the screen and the server disagreeing, which is
the exact class of defect this package exists to end. Its old comment
("there is no unit-conversion model, so the comparison is only made where the
prescription's quantity IS a stock-unit quantity") described a world that
stopped being true when `dispenseCalculation` was written.

**NO DIVISOR REFUSES THE HAND-OVER.** Not a fallback of 1 — that guess is the
defect. `prescription.service.dispense` throws; the dispensary returns a soft
`FAILED` for that medicine and the rest of the batch still goes out. The
refusal runs BEFORE the atomic claim, so the prescription stays ORDERED rather
than marked dispensed with no stock moved.

The trade-off, stated plainly: **149 of the 242 staging medicines have no
divisor** and will now refuse to dispense until somebody states a pack size.
It is the same 149 that already refuse to PRICE (Piece 4a), so this adds no new
worklist — but it is a visible behaviour change at the counter. The alternative
(dispense, deduct nothing) was rejected because a wrong shelf balance is only
recoverable by counting the shelf, where a refusal is recoverable in the minute
it takes to type the pack size.

**THE LEDGER CARRIES BOTH FIGURES.** New migration
`20260818140000_the_ledger_says_how_many_left_the_shelf` adds
`stock_movements.clinical_quantity INTEGER` (nullable). `quantity_delta` is -3;
`clinical_quantity` is 30. The dispensary can answer "why did three strips
leave" without joining back to an item whose divisor may have been corrected
since.

**NOT BACKFILLED, AND THAT IS THE OWNER'S INSTRUCTION.** *"Do NOT retroactively
correct historical stock balances — wrong past deductions are a physical
stock-take's job, not a migration's."* Every pre-existing row carries a
dose-unit delta mislabelled as stock units; NULL `clinical_quantity` means
exactly "this row predates the conversion", which is true.

**WHICH TEST INVOICES TO IGNORE** — `npm run list:dose-priced-lines`
(`apps/api`, optional `-- --tenant <id>`). READ-ONLY: it lists medication
invoice lines still carrying `packPrice × clinicalQuantity` (the RM1,550
Tamiflu shape), with the correct figure beside each, and changes nothing.
Reissuing a printed document or rewriting a submitted e-Invoice is not a
script's decision.

**DOES STAGING NEED RE-SEEDING?** No. `clinical_quantity` is nullable and
deliberately unbackfilled — `prisma migrate deploy` is the whole of it. The
divisors are what needs filling, and that is entirely in-app: the NEEDS
ATTENTION worklist (Piece 1) lists all 149, and the edit form (Piece 2) sets
them. No seeder writes a divisor onto an existing item.

**MEASURED:** 1636 API tests (17 new), 1501 web tests, both typechecks. The
e2e golden path is safe — `seed-e2e.ts` gives its medicine
`quantityPerStockUnit: 1`, so its stock-movement assertion is unaffected.

## INVENTORY PACKAGE — PIECE 4b DONE (2026-08-18). **THE E2E SUITE RUNS HERE.**

**READ THIS FIRST — every "not run here: no PostgreSQL" note in this file is
out of date.** The container has PostgreSQL 16 installed but not started. The
whole guardrail runs locally:

```bash
pg_ctlcluster 16 main start                     # or service postgresql start
export DATABASE_URL="postgresql://kuwick_dev:devpass@127.0.0.1:5432/kuwick_dev?schema=public"
node scripts/provision-app-role.mjs
cd apps/api && npx prisma migrate deploy
KUWICK_STAGING_SEED=yes STAGING_SEED_PASSWORD='CiOnly!2026' npx tsx prisma/seed-staging-uat.ts
npx tsx prisma/seed-e2e.ts && npx tsx prisma/seed-density-fixtures.ts
npm run seed:catalogues && npm run seed:reference && npm run seed:standard-rx
# API as the APPLICATION role — RLS is inert as the owner:
DATABASE_URL="postgresql://kuwick_app:apppass@127.0.0.1:5432/kuwick_dev?schema=public" node dist/main &
cd ../web && npx vite preview --port 5173 --strictPort &
# and from the REPO ROOT:
CHROME_PATH=/opt/pw-browsers/chromium E2E_PASSWORD='CiOnly!2026' \
  NO_PROXY='localhost,127.0.0.1' npx playwright test
```
`NO_PROXY` matters — the agent proxy otherwise intercepts localhost.
**`seed-density-fixtures.ts` SKIPS visits that already exist**, so a fixture
change needs the old rows deleted first or it silently keeps the old ones.

**MEASURED, BEFORE AND AFTER.** At 1366×768 the right rail needed **792px
against 529px** above the fold: the invoice card and the tail of Medications
were reachable only by scrolling the whole consultation away. Now **523px in
537px, and the page does not scroll at all.**

**THE RULE THAT WAS REVERSED, AND WHY IT IS NOT A CONTRADICTION.**
`.kw-rail-head` carried "there is deliberately no inner scroll region on any
card: a scroller inside a rail beside a scrolling page hides clinical content
behind a gesture nobody makes." That is right about a scroller beside a
SCROLLING PAGE, and it stops applying the moment the page is fixed — the inner
scroller is then the only scroller there is. **Stacked (tablet/phone) is
exempt** and keeps its page scroll.

**THREE THINGS THE MEASUREMENTS CORRECTED** (all three would have shipped from
a reasoning-only pass):

1. Cards sharing the column with `flex: 1 1 0` measured well until the invoice
   detail opened: the invoice grew, every card above gave up 27px, Medications
   MOVED. Cards now sit at natural heights, capped, and the COLUMN scrolls.
2. `overflow: hidden` on the right column was set expecting an inner element to
   scroll. **Nothing did** — `.kw-clinical-rail` is the FLOW layout's wrapper
   and does not exist in the canvas; the five cards are direct children of
   `.kw-canvas2-right`. The effect was CLIPPED cards.
3. The last 16px of page scroll was **the body's default 8px vertical margin**,
   not the shell's height at all.

**THE STICKY HEADER IS GONE and that is the fix.** As a plain flex sibling of a
scrolling body the header is pinned by layout — nothing to stack, and a rect is
a rect. The invoice assertion had already been forced to work around a sticky
rect reporting a scroll as a reflow; the cause is removed.

**THE FIVE ASSERTIONS, RE-EXPRESSED.** (a) EVERY unresolved-supply row is
inside the rail's visible box at rest, with `railScrollTop === 0` asserted so
"at rest" means it — the fixture plants **TWO** now and the count comes from
the seed, because one row cannot express "all of them". (b)(c)(d) unchanged in
words. (e) "the whole rail fits 1080 unscrolled" is now **true by
construction** — the third vacuous-pass trap this file has met — so it becomes
"the page does not scroll, either direction" plus "the rail's content fits
without using its scroll at 1920×1080".

**TWO REGRESSIONS THE SUITE CAUGHT, both from earlier pieces of this session,
neither visible to any unit test:** Piece 1's Items→Inventory rename moved the
search box's aria-label, which `prescription-vocabulary.spec.ts` reached by;
and **Piece 4a's refusal stopped the golden path dead.**

**THE SEEDED MEDICINES ARE PRICED PER DOSE — the imported ones are priced per
PACK.** RM0.30 is one paracetamol tablet; RM155.00 against "10 BIJI / STRIP" is
a whole course. **The divisor is exactly what tells the two apart**, and a
seeded medicine with none could not be billed at all. The seeds state
`quantityPerStockUnit: 1` now, and deliberately do NOT mark it dispensed-whole:
nobody at the clinic has confirmed it, so those rows sit on the worklist where
they belong and still price.

**MEASURED:** whole e2e suite green (33 passed, 2 gated), route sweep clean on
all twelve routes, 1619 API tests, 1501 web tests, both typechecks, both builds.

## THE PRICING FIX — STEP 1, THE AUDIT. **THE DIVISOR IS MOSTLY NOT THERE.**

**Run it:** `cd apps/api && npx tsx prisma/pricing-divisor-audit.ts`.
Report-only — reads, writes one CSV, changes no row. Output:
`docs/seed-review/medicine-pricing-divisors.csv`, one row per medicine with
its price, pack string, stock unit, both candidate divisors, the EFFECTIVE
divisor and where it came from, and its dose unit.

**THE NUMBER THE SEQUENCING TURNS ON: 149 of 242 rows have no divisor at all
(61.6%).** Against the clinic's real imported shelf alone — Medication +
Vaccine, dropping the 13 demo/density fixture rows and the 4 "Item" rows
(arm slings, a tumbler) that are correctly not medicines — it is **132 of
225, 58.7%.** `ceil(clinical ÷ unitsPerPack)` would leave the majority of the
catalogue UNPRICED on the day it shipped.

| | rows | no divisor |
|---|---|---|
| Medication | 218 | 125 |
| Vaccine | 7 | 7 |
| Medicine (demo fixtures) | 7 | 7 |
| (no category — density fixtures) | 6 | 6 |
| Item (not medicines) | 4 | 4 |
| **total** | **242** | **149** |

**TWO COLUMNS COULD BE THE DIVISOR AND ONLY ONE IS POPULATED AT ALL.**
`units_per_pack` (parsed at import from the source's own pack string) is set
on 93 rows. `quantity_per_stock_unit` — b1 Phase 1E, the CLINIC'S number,
which is the one meant to WIN because only they know whether their strips
hold 10 or 12 — is set on **zero**, and `stock_unit_id` with it. Phase 1E
built the columns and the Settings screen; nobody has filled them in. The
audit prints both and applies clinic-over-import precedence, so the day
somebody curates, the number moves without the formula changing.

**ALMOST NOTHING IS RECOVERABLE BY PARSING HARDER, WHICH IS THE POINT.** Of
the 149 divisorless rows: **8** carry a count the regex missed
(`PLASTIC/6 SACHET` — `parseUnitsPerPack` anchors on a LEADING digit), **13**
have no pack string at all, and **128 name a container and no count** — BOX
(41), BOTTLE (35), AMP (14), TUBE (12), DOSE (8), BIJI (7), PEN (4), VIAL
(3), `-` (2). A better regex buys 8 rows. The other 141 need a human to state
a fact the spreadsheet never carried, and inventing 1 for them is exactly
what `parseUnitsPerPack` was written to refuse: a divisor of 1 does not fail
loudly, it silently bills a 5-day course as 40 boxes.

**SEQUENCING, PUT TO THE OWNER 2026-08-17 AT THE STEP-1 BOUNDARY.** The
instruction was to stop here and say so if most medicines had no divisor.
They do. Curation before formula.

**PIECE C — DONE (2026-08-17), AND THEN RE-LAID-OUT ON THE OWNER'S DECISION
THE SAME DAY. b4 IS COMPLETE. Read this section, not the Piece B one, for
where things are now.**

THE LAYOUT, AS IT STANDS:

- **RIGHT RAIL:** Direct Services → Orders / Procedures → Medications →
  Documents → **Invoice**. The invoice is the last CARD; the sticky bottom bar
  is gone.
- **HEADER BAND:** Complete Consultation, which is the one completion action
  on the page — `ConsultationFooter` in its one-line variant (renamed `bar` →
  `inline`), rendered into the header's `completionAction` slot.
- **BOTTOM LEFT:** a MONTH CALENDAR under the visits panel, with this
  patient's previous and next appointment named above it.

WHAT WAS BUILT, AND WHAT EACH THING COSTS:

- **`InvoiceRail` — the invoice as the last rail card.** Everything Piece B
  computed is unchanged and still the server's: the composed draft, the
  consultation charge from `consultation-tariff.ts`, a billed line read rather
  than re-priced, unpriced items listed unpriced and uncounted, the live
  update on any source change, the worded discount refusal. **144px at rest**
  — one row per group plus the total. It took three passes to get there
  (213 → 168 → 144): "N items" left the header, and the two sentences of
  explanation moved inside Details, which is also where the discount control
  now lives. Opening Details grows the card DOWNWARD and moves nothing above
  it — asserted against the Medications card's offset inside the rail,
  because `.kw-rail-head` is sticky and its rect reports a scroll as a reflow.
- **`CanvasAppointmentCalendar` — the month, bottom left.** Tapping a day
  opens the picker ON that day. Previous and next are named in place; a
  NO_SHOW is kept as the previous one ("they did not come last time" is the
  context that decides whether to book another) and a cancelled or rescheduled
  one is dropped. Days with something standing carry a dot. **267–304px**
  depending on whether anything is booked.
- **`BookFollowUpModal` — a `KuwickModal`, and NOT a second scheduler.** Slots
  come from `/availability` (`SlotAvailabilityService`: roster, minus schedule
  exceptions, minus booked time, cut by the clinic's slot length, capped at
  daily capacity). The booking is `POST /appointments`, which resolves every
  reference under the caller's tenant and then runs
  `AppointmentBookingValidator` — qualification, roster, overlap, capacity.
  Nothing about scheduling is decided in the canvas.
- **DOCTOR-SERVICE MAPPING NARROWS THE PICKER BEFORE IT IS SHOWN.** The
  service list is Settings → Appointments & Scheduling → Doctor-Service
  Mapping, filtered for the chosen doctor. A doctor with NO mapping is offered
  NOTHING and told where mappings are made — an empty mapping treated as "no
  filter" would offer the whole catalogue and every booking would die on a
  qualification nobody was shown. Both halves are asserted (the mapped service
  IS offered; a second catalogue service that is NOT mapped is not).
- **`source: FRONT_DESK`, deliberately.** The source decides the initial
  status: FRONT_DESK is CONFIRMED on the spot, ONLINE_PORTAL waits to be
  confirmed. A doctor booking a TCA with the patient in the room has done the
  confirming; REQUESTED would put a task on the front desk for an appointment
  nobody is waiting on.
- **AN EMPTY DIARY NAMES THE SETTING THAT DECIDES IT.** `/availability`
  returns `[]` for three different reasons and says which for none of them.
  The one that IS knowable is read from the configuration: no
  `SlotCapacityConfig` for this doctor/service/branch → "Settings →
  Appointments & Scheduling → Slot Capacity". Otherwise it says the day is
  full or unrostered.
- **A DEFECT FIXED ON THE WAY THROUGH: the header's Appointment button opened
  the NEW VISIT drawer.** A visit is a patient who is here; an appointment is
  a patient who is coming back. It opens the picker now — two entry points,
  one modal, mounted once.

**THE TWO STAGING FIXES (part 2).**

1. **THE MISSING CONSULTATION CHARGE — it was the second possibility, and it
   was costing RM35 a visit.** The staging visit was NOT OTC. The UAT clinic
   has the "General Consultation" service and its RM35 price and NO
   `ConsultationTariffRule` at all, because `seed-staging-uat.ts` never
   created one — and D-094 is explicit that a clinic with no active rule has
   consultation auto-billing OFF. So the worklist added no row, the draft
   carried no consultation line, and nothing said so. **Measured against a
   real database: rules inactive → RM38.25 and no CONSULTATION line; rule
   seeded → RM73.25 with "General Consultation RM 35.00".**
   Two fixes, because there were two faults: the staging seed creates the rule
   (ALL DAY — the spec prints 8AM–11PM and this tenant is a 24-hour clinic, so
   a band with a gap would turn every night consultation into a TARIFF_REVIEW
   blocker), and a visit whose branch has no tariff now gets a LISTED,
   unpriced, uncounted consultation line carrying the reason and where to fix
   it (`NOT_CONFIGURED`). No price is invented and nothing blocks.
   **If the owner sees this on the deployed app, the staging seed has not been
   re-run since — that is what adds the rule.**
2. **"1 item outstanding" told a doctor nothing.** Both facts are named now
   and both show when both are true: "N items not priced" (the total beside it
   is incomplete) and "N medicines to dispense" (priced, in the total, not yet
   handed over). The completion chip names its blockers too — "supply mode to
   confirm · procedure pending" rather than a count. And the unpriced chip now
   fires on the state it was built for: it read the server's `unpricedCount`,
   which counts COUNTED lines whose price failed, and an undecided supply
   (D-091) is unpriced and UNCOUNTED — so it stayed silent on exactly the case
   Piece B introduced it for.

A related defect the card exposed: a group with nothing counted printed
"RM 0.00", which reads as work the clinic gave away. It reads "No charge".

**THE FIVE ASSERTIONS ALL HOLD.** Nothing on the canvas is fixed to the
viewport any more, so they measure against the plain fold (768/1080) again,
and the spec guards that no fixed strip comes back. What changed in the spec
is (d)'s ROSTER — five cards, ending in Invoice — and the HEAVY head count
with it.

**MEASURED (this container, real database, whole Playwright suite green):**

| | rail needs | window |
|---|---|---|
| TYPICAL 1366×768 | 818px | 529px |
| TYPICAL 1920×1080 | 740px | 877px (**137px to spare**) |
| HEAVY 1920×1080 | 1012px | 877px (over by 135px, as designed) |

The appointment month at 1920×1080 ends at 926 of 1080 — the empty space the
brief pointed at. At 1366 and 1536 it is below the fold and reached by the
same scroll the rail already needs; the spec prints where it lands at each
width rather than papering over it, because the only way to make it fit those
screens is to shrink the visits panel, which the brief forbids.

**A TRAP THIS PIECE FELL INTO AND THE SPEC NOW CATCHES.** The month was first
docked with `position: sticky; bottom`. It passed both stated rules — the
visits panel kept its height and its position, the page got no taller — while
being DRAWN OVER the lower half of that panel, hiding two visits. A panel that
has not moved can still have been made unreadable. There is an assertion for
that now.

**WHAT THIS LEAVES READY FOR THE APPOINTMENTS MODULE (the owner's next
area):**

1. **The booking path is proven end to end through the UI.**
   `canvas-appointment.spec.ts` drives a real booking through `/availability`
   + `POST /appointments` and then reads it back out of `AppointmentsPage`,
   with that module's own Arrived and Reschedule actions on the row.
2. **The fixture seed carries a working scheduling backbone**
   (`seed-density-fixtures.ts`): a roster on all seven days, a slot capacity
   config (30-minute slots, 20 a day), one mapped service and one deliberately
   UNMAPPED service, handed to the spec through `.density-fixtures.json`. The
   helper that opens a density visit is in `e2e/support/density.ts`.
3. **`followUpPresentation.ts` holds the rules every appointment surface
   needs**: which statuses still stand, which are the previous and next
   appointment, which services a doctor may be booked for, and what to say
   when the diary is empty.
4. **The seed no longer accepts an OWNER_ADMIN as a doctor** —
   `StaffService.isActiveDoctor` counts only DOCTOR_RESIDENT and DOCTOR_LOCUM,
   so seeding a mapping against an owner would produce "Staff member is not an
   active doctor" from a screen that offered them.
5. **Two things the module should decide, flagged not decided.** (a) The
   canvas cannot cancel or reschedule — the month shows and books, nothing
   more. (b) Times are stored and compared in UTC and rendered in the
   browser's timezone, which is the convention `BookAppointmentDrawer` and
   `AppointmentsPage` already use and which the API's own comment calls a
   deliberate single-timezone simplification. One convention, three surfaces —
   worth confirming rather than discovering.

**ONE LAYOUT CLEANUP LEFT, DELIBERATELY NOT TAKEN.** The visit band under the
header (`VisitCompletionBar`) is now a DOCUMENTS summary beside a Documents
card and an INVOICE summary beside an invoice card — the duplication the
mockup's p.4 removed from the header, and its own comment says it goes the day
the Documents card lands. It was not retired because it still carries the only
route from the canvas to the billing surface ("Open Billing" / "Open
Invoice"). Retiring it is worth ~34px of the first screen and needs that route
re-homed first.

**PIECE B — DONE (2026-08-17). The invoice was the sticky bottom bar.**

**SUPERSEDED BY PIECE C ON THE OWNER'S DECISION, THE SAME DAY: the bar is gone
and the invoice is the last card in the right rail. Everything below about
WHAT the draft computes is still true and still the code; every sentence about
WHERE it renders is not.**

`consultation-tariff.ts` was read first and it already owned the rule, exactly
as suspected: `classifyVisit` maps an OTC queue ticket to `OTC_ONLY`,
`resolveConsultationState` returns `EXEMPT`, and `collectBillingWorklist` turns
that into a NOT_CHARGEABLE consultation row carrying the words "This kind of
visit carries no consultation charge." **There is no queue-type test anywhere
in Piece B's code** — not in the new server module, not in the bar. The OTC
answer arrives already decided and the bar prints the reason it was given.

WHAT WAS BUILT:

- **`invoice-draft.ts` + `invoice-draft.service.ts`, `GET
  /visits/:id/invoice-draft`.** A composition, not a new authority: the
  WORKLIST decides which sources are billable and in what state
  (`collectBillingWorklist`), `resolveSourcedPrice` prices them (the one
  pricing truth, D-093), and `calculateResponsibility` does the discount
  arithmetic in its CASH shape. Three existing owners, called; nothing
  re-derived.
- **A BILLED LINE IS READ, NOT RE-PRICED.** Once a source has an active
  invoice line, that line's stored quantity and unit price are the facts. A
  catalogue edit must never silently restate a charge already made — asserted
  (the fixture moves the price to 9.00 and the draft still reports 4.50).
- **WHAT COUNTS IN THE TOTAL**, and it is a judgement worth knowing: READY and
  AWAITING_DISPENSE count (ordered-but-undispensed clinic medication is
  chargeable work, and omitting it would understate every visit that has not
  reached the dispensary — i.e. all of them during the consultation).
  UNRESOLVED_SUPPLY is LISTED, UNPRICED and UNCOUNTED: a NULL supply mode is
  an unmade decision (D-091), and pricing it would answer for the doctor the
  question the rail refuses to answer. `unitPrice`/`amount` are NULL, never 0
  — RM 0.00 reads as free. The bar carries an "N items not priced yet" chip AT
  REST, because a total that quietly omits something is wrong by an unknown
  amount.
- **The bar.** `InvoiceBottomBar`, `position: fixed`, `--kw-invoice-bar-h:
  44px`. Running total on the left (the control that expands), Complete
  Consultation on the right. The breakdown is an OVERLAY at `bottom:
  var(--kw-invoice-bar-h)`, `max-height: 50vh`, so it takes no layout height
  and the rail does not move when it opens — asserted by measuring `railTop`
  and `railHeight` before, during and after.
- **ONE completion action, not two.** `ConsultationFooter` gained
  `variant="bar"`: a LAYOUT switch only, one component, one status query, one
  mutation, one confirmation dialog. The page no longer renders the panel
  variant at all. Nothing was dropped in the bar — blockers keep their count on
  the line and their full list plus review actions in a popover; a refusal
  keeps both its sentences. `canvasReachability.test.ts` was updated
  deliberately and now asserts BOTH that the page mounts the bar and that it
  does NOT mount a second `<ConsultationFooter>`.
- **Live update is an invalidation.** The draft is derived on every read, so
  `invoiceDraftKey` is invalidated by `usePrescriptions`, `useOrderServices`
  and `useBillingRefresh`. One exported key function rather than a string
  literal in four files.
- **`BillingWorklistItem.orderType` is now exposed** (STANDARD_SERVICE /
  TASK_ORDER). It was already selected by that query; the breakdown needs it to
  group Direct Services apart from Orders / Procedures the way the rail cards
  do, and a surface that has to re-fetch the order guesses from the description
  instead.

**TWO THINGS THE OWNER SHOULD DECIDE, both flagged rather than decided here:**

1. **"Doctor can apply a discount" COLLIDES WITH D-093 OWNER DECISION 5**,
   which is explicit in `clinical-authorization.ts`: `APPLY_DISCOUNT` is
   `billing.corrections`, and the comment says in so many words "Front desk and
   doctors are refused." The control was built and wired through the ONE
   existing path (`PATCH /visits/:id/invoice-draft/discount` → the visit's
   invoice → `InvoiceService.applyInvoiceDiscount`), so the permission, the
   mandatory reason, the actor, the timestamp, the ceiling check and the store
   are all the existing ones — no canvas-specific discount, no second store.
   **The GATE was not changed**: silently granting every doctor
   financial-correction powers is not a change to make inside a layout piece.
   Anyone holding `billing.corrections` gets the control today; a doctor who
   does not gets the server's own refusal, in the server's own words, which the
   bar renders as-is. If the owner means doctors to hold it, that is a one-line
   change to `BILLING_PERMISSION` and it is theirs to make.
2. **A discount needs an invoice to reduce, and the doctor's canvas often has
   none yet.** The endpoint refuses in words ("There is no open invoice for
   this visit yet…") and the expanded panel says so instead of offering a dead
   control. Raising the invoice from the canvas was considered and REJECTED:
   an invoice with lines pulled early flips worklist items to `billed`, and
   `pendingBillingWork` reads exactly that to decide where completion sends the
   patient. A bottom bar must not be able to route a patient away from the
   payment counter as a side effect of recording a discount.

**(SUPERSEDED BY PIECE C — there is no bar, so the assertions measure against
the plain fold again. Kept because the reasoning is why the spec still refuses
to measure the rail against anything but the full viewport.)**

**THE FIVE PIECE A ASSERTIONS NOW MEASURE AGAINST THE BAR'S TOP EDGE, AND THAT
IS A STRENGTHENING.** A row at y=760 is inside the viewport and behind a fixed
bar, which is not "on screen" in any sense a doctor would recognise. So (a),
(b) and (e) assert against `min(fold, barTop)`: every row that passed before
still passes, and rows the bar hides now fail. **The budget line is unchanged
and still prints against the FULL 768/1080** — measuring the rail against
viewport-minus-bar is the vacuous pass this file has already been burned by.
A second line prints the bar's measured height beside it. The failure message
on (a) names the remedy the owner set: shorten the BAR, not the assertion.

Two new e2e cases: the bar is slim at rest and its breakdown costs the rail
nothing, and a real seeded visit's own medications and orders reach the draft
(including the unresolved one, listed with its reason and uncounted).

**NOT RUN HERE: the e2e suite.** This container has no PostgreSQL, so
`canvas-viewport.spec.ts` was typechecked and listed (12 cases) but not
executed; CI runs it. Everything else is green and was run: 1482 API tests,
1387 web tests, both typechecks, both production builds. `npm run lint` is
broken repo-wide and was already — there is no `eslint.config.js` and ESLint 10
refuses `.eslintrc`; CI does not run it either.

**FOR THE MODULES AFTER THE CANVAS**, since the owner moves to Appointments and
then reports/analytics next, this work has already established:

- **Appointments**: `apps/api/src/appointment/slot-availability.service.ts`
  exists with its own spec, and Piece C is specified to book through it rather
  than build a second path — whatever the canvas card ends up doing, the
  Appointments module is the single store.
- **Reports/analytics**: three things are now queryable that were not.
  `Document.type` finally distinguishes TIME_SLIP and CONSENT, so "how many MCs
  / time slips did we issue" is a query rather than a string match on a title.
  `patient_identity_changes` is an append-only record of every IC/DOB
  correction with author and role snapshotted. `patient_alerts` now carries
  ALLERGY and NO_KNOWN_ALLERGY with an `origin` column, so "how many patients
  have been ASKED about allergies" is answerable — which it was not while the
  answer lived in a free-text array.

**A trap already hit, do not re-introduce it:** `TYPICAL fits 1920` PASSED with
zero rows, because the lowest row bottom of nothing is zero. Same class as
measuring the rail against viewport-minus-bar: an assertion that holds by
construction. Every case still guards on `rowCount > 0` first, and HEAVY now
also asserts the exact row count disclosure should leave. Keep both.

**b4 IS COMPLETE (Pieces 1, A, B and C).** The note below was written when
Pieces 2 and 3 were the names for what became B and C; it is kept because its
warning still stands and is still the reason the invoice is a bar.

**b4 PIECES 2 AND 3 — DONE as Pieces B and C.** Specs are in the owner's message and in
the Phase G/H entries above. Piece 2 note that matters: the invoice lives in the
STICKY BOTTOM BAR, not as a sixth card in the scrolling rail, and
`consultation-tariff.ts` (D-094) already answers "should this visit carry a
consultation charge" server-side — do not build a second answer.

## APPOINTMENTS PIECE 1 — DONE (2026-08-18). Settings: providers & bookable services.

**THE TIMEZONE CONVENTION, CONFIRMED AND WRITTEN DOWN — READ THIS FIRST.**
It was asked for, and confirming it turned up a live defect rather than a
tick-box.

    STORED   — `Appointment.scheduledStart/End` are REAL UTC INSTANTS.
    MATCHED  — roster, exception, closed-date and window comparisons happen in
               the CLINIC's wall clock, converted through `Clinic.timezone`.
    RENDERED — the CLINIC's wall clock, never the reader's.

What it was before: `combineDateAndTime` built slots with
`Date.UTC(y, m, d, 9, 0)`, so a 09:00 roster produced the instant **09:00Z —
5pm in Kuala Lumpur** — and the web rendered it back with bare `dayjs()`, the
browser's local zone. On a UTC test runner and a UTC CI box the wrong instant
renders back as the right wall clock and nothing looks amiss. **On a clinic
laptop in Malaysia the whole diary reads eight hours late.** The old
`clinicTime.ts` comment said no per-tenant timezone was stored; `Clinic.timezone`
has existed (default `Asia/Kuala_Lumpur`) and the consultation tariff has
converted through it since D-090. The appointment module was the outlier.

Now: `apps/api/src/appointment/time.util.ts` holds the conversion
(`zonedWallClockToInstant`, `combineInClinicZone`, `clinicDayBounds`,
`clinicDateKey`), and `apps/web/src/clinical/clinicTime.ts` renders through
`dayjs.tz` with the zone set once at boot by `useClinicTimeZoneSync`. The
reader's zone is the wrong answer even when it agrees: an owner checking the
diary from Jakarta must see the same 09:00 the front desk sees.

**⚠ EXISTING APPOINTMENT ROWS ARE NOT MIGRATED.** Anything booked before this
carries a wall-clock-as-UTC instant and is now 8 hours out. Staging test data
only, and NOT rewritten — the same reasoning as the stock deduction: guessing
which historical rows meant what is arithmetic nobody performed. Say the word
and it is a one-line UPDATE on staging.

**ONE PATH, AND IT IS NOW ACTUALLY ONE.** `AppointmentBookingValidator` used to
re-derive the roster, exception, overlap and daily cap from the same tables the
engine reads — the same rules, written twice, with its own `isWithinWindow`
comparing time-of-day through UTC getters. It now ASKS the engine and checks
the requested time is one of the slots it offered. Every constraint the engine
learns is enforced at booking the moment it is written, because there is
nothing left to keep in step. Deliberate consequence: **a booking must land ON
the grid** — a drag to 09:07 is refused with a reason, which is what piece 3
needs anyway.

**A CAPACITY FLAW THAT MADE THAT UNSOUND, FIXED.** `dailyCapacity` used to
`slice()` the offered list — cap 5, none booked, and the patient could only
pick the earliest slot. It is now a GATE: refuse when `booked >= capacity`,
otherwise offer every free slot.

**THE SIX CONSTRAINTS**, all server-side, in `findAvailability`, each returning
a NAMED reason so the front desk gets a sentence rather than an empty list:
`CLINIC_CLOSED`, `SERVICE_NOT_BOOKABLE`, `NOT_QUALIFIED`, `NOT_ROSTERED`,
`OUTSIDE_BOOKING_WINDOW`, `TOO_LATE_TO_BOOK`, `FULLY_BOOKED`.

**NEW TABLES** (`20260818160000_a_clinic_can_say_when_it_is_open`):
- `clinic_booking_settings` — first/last session (wall clock), minimum notice.
  One row per clinic, CHECK that the window is a window.
- `clinic_closed_dates` — the building shut, distinct from one doctor's leave,
  so "is the clinic open on the 24th" is answerable without knowing which
  doctors exist.
- `service_catalog` + `bookable` (defaults FALSE — nothing goes public by
  migration), `slot_interval_minutes`, `booking_fee`, `booking_description`,
  `booking_photo_url`, `requires_approval`, `concurrent_limit`.

**DURATION vs INTERVAL vs CONCURRENT — three different numbers.** Duration is
how long it runs; interval is how often one starts; concurrent limit is how
many rooms. A 30-minute service on a 15-minute interval offers 09:00/09:15/09:30
and lets them overlap up to the room count.

**SCREENS.** `/settings/scheduling/provider-availability` — doctor picker, all
seven days always visible (a day off says "Not working"; an absent row is
indistinguishable from one that failed to load), saved as ONE replace in one
transaction; plus date overrides on the same card set. `/settings/scheduling/booking-rules`
— window, notice, closed dates. Services & Procedures gains a **Booking**
column and its own drawer, deliberately separate from Edit: publishing a
service and repricing it are different acts by different people.

**Publishing a service with NO doctor mapped is refused**, naming Doctor-Service
Mapping. The failure it prevents is silent — the service appears publicly and
every doctor offers an empty date picker.

**MEASURED:** API 1692, web 1518, both typechecks. **NOT run here:** e2e (no
PostgreSQL in this container — see piece 4b for how to run it).

**FEEDS INTO REPORTS** (nothing built yet, but the columns are now there to
build from): no-show rate = `AppointmentStatus.NO_SHOW` over non-cancelled per
period; bookings per doctor = count by `staffId`; potential vs realised sales =
`booking_fee + ServiceCatalog.price` summed over BOOKED/ARRIVED versus what the
matching invoices actually collected. Piece 2's stats bar is the first consumer
and should compute these SERVER-side so the report and the bar cannot disagree.

**NEXT — PIECE 2**: clinic dashboard, list + stats bar + tabs + WhatsApp
deep-link reminder. `AppointmentStatus` already carries what the tabs need;
check whether a "reminder sent" column exists before building the action (it
does not — it is new).

## APPOINTMENTS PIECE 2 — DONE (2026-08-18). The clinic dashboard.

**ONE QUERY SOURCE, TWO CONSUMERS.** `appointment-dashboard.service.ts` holds
the five figures. The stats bar is simply the first thing to ask; the reports
module asks the same method. Built twice they would disagree the first time
either definition moved, and the disagreement would be found by an owner
comparing a screen to a report and trusting neither.

**THE DEFINITIONS, so a report does not re-invent them:**
- `upcoming` — CONFIRMED, REMINDED, ARRIVED, IN_QUEUE. **NOT REQUESTED**: a
  request is awaiting a decision, and counting it in both Upcoming and Requests
  would double it on the bar.
- `completed` / `cancelled` / `noShow` — their own statuses.
- `noShowRate` — noShow ÷ (completed + noShow). **Cancellations are not in the
  denominator**: a clinic that cancels a whole clinic day has not improved its
  no-show rate, and dividing by them says it has. NULL, never 0, when nothing
  was attendable — "no no-shows" and "no appointments" are different facts.
- `potentialSales` — booking fee (SNAPSHOT) + service price (LIVE), over live
  appointments only. Cancellations excluded, or the figure would grow whenever
  a clinic lost business; pending requests excluded, or it would fall whenever
  one was declined.
- `realisedSales` — the same sum over COMPLETED. Not on the bar; it is the
  other half of "potential vs realised" and costs one reduce.

**RESCHEDULED APPEARS IN NO TAB AND NO COUNT.** It marks the OLD row of a move
— the booking still exists at its new time as a different row. Filing it under
Cancelled would tell a clinic it lost a booking it still has.

**⚠ "TO BE SCHEDULED" IS AN INTERPRETATION, FLAGGED.** Kuwick has no
"booking with no slot yet" state — `scheduledStart` is NOT NULL — so the Yezza
tab cannot be reproduced literally. It is implemented as **live appointments
whose time has passed that nobody marked arrived, completed or no-show**: a
real worklist somebody must act on. Piece 4's call-back requests may be what
the tab should really hold. **Owner decision pending.**

**A REMINDER IS A THING SOMEBODY DID, NOT A STATUS.** `AppointmentStatus.REMINDED`
cannot say when or by whom, and is mutually exclusive with CONFIRMED — an
appointment that has been reminded AND confirmed can only hold one. New columns
`reminder_sent_at` / `reminder_sent_by_staff_id` carry the fact ON the row.
Never backfilled: no appointment booked before today has a reminder anybody can
name.

**WHATSAPP IS A DEEP LINK, NOT AN INTEGRATION.** `wa.me` opens on the staff
member's own phone. Kuwick sends nothing and therefore claims nothing about
delivery — pressing the button records only that somebody sent a message. The
link is opened FIRST and recorded second: marking a reminder sent for a popup
that was blocked is worse than no mark. Numbers normalise `012-345 6789` →
`60123456789`; a number that is neither local nor Malaysian is **not** given a
country code, because a wrong one sends a stranger somebody's appointment time.

**BOOKING FEE IS SNAPSHOT, SERVICE PRICE IS LIVE**, and the split is
deliberate: the fee is a commitment (a clinic raising it in March must not
change what a February booking asked for), the price is an estimate of future
revenue. `booking_fee_paid_at` exists and **nothing writes it yet** — piece 4
collects. Every row with a fee therefore reads UNPAID, which is true.

**THE DEFAULT PERIOD FOLLOWS THE TAB.** Upcoming → today..+30d; history tabs →
-30d..today. A month-to-date default shows an empty Completed tab on the 1st
and an empty Upcoming tab on the 30th. Once a person picks a period it is
theirs and tab changes stop overriding it.

**`AppointmentsPage.tsx` IS DELETED**, not left beside its replacement. Its
lifecycle actions moved onto the dashboard rows using the SHARED
`appointment-status.constants` guards rather than a third copy.

**MEASURED:** API 1717, web 1549, both typechecks. E2E updated for the rebuilt
page (search by name, separate Date/Time columns, clinic-zone assertion).

### The +8h correction — RAN AS A SCRIPT, AND THE DIRECTION WAS MINUS

Owner asked for "+8h". **It is MINUS eight.** A row holding 09:00Z was MEANT to
be 09:00 at the clinic, which is 01:00Z. Nothing hardcodes eight: the shift is
derived per row from that clinic's own `timezone`, so a clinic on UTC does not
move at all.

    npm run correct:appointment-instants           # dry run, prints every row
    npm run correct:appointment-instants -- --apply

APPOINTMENTS ONLY. Run-once, guarded by the new append-only `data_corrections`
table — a corrected row is indistinguishable from an uncorrected one, so a
second run would shift twice. The cutoff is read from `_prisma_migrations`
(piece 1's migration finish time), so nobody has to remember the deploy moment.

### Owner decisions recorded

- **Booking window is time-of-day** — confirmed correct. A separate **"book up
  to N days ahead" horizon is a PIECE 4 public-page rule**, deliberately NOT
  built yet. It belongs on `clinic_booking_settings` when it lands.
- **Unmapped-service refusal on publish** — keep.

### Feeds into reports

`AppointmentDashboardService.stats` already returns everything the reports
brief asks for: no-show rate, potential vs realised sales, and bookings per
doctor (pass `staffId`). The reports module should CALL it rather than write
its own aggregate.

**NEXT — PIECE 3**: the clinic calendar. Detail panel, day/week/month,
drag-and-drop reschedule. Note that the booking validator now refuses any time
that is not one of the engine's offered slots, so an invalid drop already has a
reason to show — see piece 1.

## APPOINTMENTS PIECE 3 — DONE (2026-08-19). The clinic calendar.

**STAGING CONSOLE COMMANDS NEED `--workspace=apps/api`.** Owner's note, recorded
so future prompts carry it:
`npm run correct:appointment-instants --workspace=apps/api -- --apply`.

**THE CORRECTION RAN AND FOUND NOTHING.** "No appointments predate the change"
— zero rows. Expected: staging had no appointments booked before piece 1's
migration. The `data_corrections` guard means re-running is safe either way.

**THE LINK THAT MADE THE LIFECYCLE POSSIBLE.** `appointments.visit_id`, unique
both ways, nullable (a walk-in has none). `arrived()` creates the type-A queue
ticket, `addToQueue` creates the VISIT under it, and that visit id is now
recorded. Two things were impossible without it:
- **Completing the consultation completes the appointment.** The only
  completion path is `completeVisit(visitId)`, which had no way back to the
  appointment. Appointments sat at ARRIVED forever and the Completed tab stayed
  empty however many patients were seen. Now done INSIDE the same transaction
  that closes the visit, `updateMany` so a walk-in doesn't throw, guarded on
  ARRIVED/IN_QUEUE so a re-completion can't drag a CANCELLED one to COMPLETED.
- **"Open record" opens the RIGHT visit** rather than the patient's most recent,
  which is the wrong one the moment they have two.

Also `cancelled_by_staff_id` + `cancelled_at`: the reason was already recorded,
the person is the half that matters when a patient rings back.

**`arrived()` HAD NO TEST AT ALL** before this piece, which is how it shipped
creating a ticket and losing the visit. `appointment-lifecycle.spec.ts` now
pins arrival, the type-A stream, the link, and the cancel attribution.

**⚠ DRAG-AND-DROP BECAME PICK-UP-AND-PLACE, AND THIS IS A DEVIATION FROM THE
BRIEF.** `react-big-calendar`'s drag-and-drop addon is CommonJS-only against an
ESM entry; its default export does not survive this project's production
bundle. It throws at render, and because the router mounts at the ROOT that
**blanks every page in the application**, not just the calendar. Three fixes
were tried and measured (namespace-import unwrap, the addon's inner module,
`commonjsOptions.transformMixedEsModules`) — all still `(X.default ?? X) is not
a function` in the built app.

So: select an appointment → **Move to another time** → click the target slot.
A banner says whose appointment is in hand and offers Cancel move. It is the
better interaction regardless — a drag is unusable from a keyboard, awkward on
the tablet the front desk uses, and offers no chance to change your mind — but
it is NOT what was asked for. **Owner decision: accept, or pay for the RBC
upgrade/replacement that would restore the drag.**

The move keeps the appointment's LENGTH and only moves its start; taking the
clicked slot's end would silently resize a 30-minute consultation to whatever
the grid is sliced at. Dropping into another doctor's column is refused in
words — reschedule does not express a change of provider.

**EVERY REFUSAL IS THE SERVER'S OWN SENTENCE.** The move and the slot booking
both go through the same reschedule/create endpoints the drawer uses, so the
same validator decides — capacity, roster, clinic window, service mapping — and
piece 1's named reasons surface verbatim.

**LAYOUT.** Mini-month + colour-coded provider checkboxes left, grid centre,
detail PANEL right (not the popover it replaces — a popover closes when you
look away, which is wrong for the thing you are working from). Day view is one
column per selected provider; the old separate "Provider" view is GONE, because
two modes for one view is a choice nobody wants and the plain day column
answered a question the week view answers better.

**THE CALENDAR WAS ORPHANED** when piece 2 retired `AppointmentsPage` — nothing
rendered it. The dashboard now carries a List/Calendar toggle. A screen nothing
links to may as well not exist, and only the e2e caught it.

**ROUND TRIP, BOTH DIRECTIONS, both in `canvas-appointment.spec.ts`:**
canvas → module (book a follow-up in the consultation, find it in the module)
and module → canvas (book in the module, find it on the consultation month).

**MEASURED:** API 1734, web (see the commit), e2e 34 passed / 2 skipped.

**NEXT — PIECE 4**: the public booking page. Note that `booking_fee_paid_at`
exists and nothing writes it yet; the "book up to N days ahead" horizon is
still deliberately unbuilt and belongs on `clinic_booking_settings`.

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
| C9 attachments inside the notes card | **done** — one component, one region, chip row (b0) |
| Q2 retire documentation-pending banner | **done** — now a checkpoint section |
| Q3 seed data | **done** — 162 diagnoses, 229 medications, idempotent |
| D10 diagnosis | not started — catalogue is real now, the canvas UI is not |
| E11–E14 orders | not started |
| F15–F18 medications | not started |
| G19 documents | not started |
| H20 invoice (canvas) | **done** — b4 Piece B: the sticky bottom bar, server-priced draft, discount through the existing invoice path |
| H21 complete | **done** — carried by the same bar (`ConsultationFooter variant="bar"`) |
| b4 Piece C appointment in the canvas | **done** — a MONTH CALENDAR bottom-left under the visits panel; books through `slot-availability.service.ts` and `POST /appointments`, so the Appointments module is the only store |
| b4 Piece C invoice in the right column | **done** — the last rail card (144px), sticky bar retired, Complete Consultation back in the header band |
| b4 Piece C consultation charge reaching the draft | **done** — staging had no `ConsultationTariffRule`; the seed creates one and a missing tariff is now stated on the card instead of silently omitted |
| I22–I23 polish | not started |

## Gotchas that have cost real time

- **A green guardrail can be testing an empty clinic.** Staging (and CI, and
  every local world) held exactly ONE diagnosis for weeks — J06.9, which
  `seed-e2e` plants for the golden path — because the 162/229 catalogues live
  in a SEPARATE seed nobody ran outside a dev box. Every suite was green; a
  doctor typing "urti" found the truth. CI now seeds the real catalogues,
  `/health` reports `catalogue{diagnoses,medications,ok,warning}`, the API
  logs `CLINICAL CATALOGUE NOT SEEDED` at boot, and the golden path searches
  a term it does NOT seed for itself. **Never assert only on data the spec
  planted.**
- **"Seeded" is not "findable".** The 162 diagnoses reached staging and the
  doctor's box still matched NOTHING: the seed tagged every imported row
  `CUSTOM` while every search surface defaults to `SUMMARIZE`, and the canvas
  rail HARDCODED that category with no way to change it. An empty antd
  AutoComplete renders silence, so the outage had no symptom to report. Fixed
  in three places — the seed writes and REPAIRS `SUMMARIZE` on re-run, the
  rail sends no category (the whole catalogue), and the field now says
  "No diagnosis matches …" / "could not be reached". A row count in /health
  CANNOT catch this class; assert findability where it lives.
- **STANDING RULE, hardened by the owner 2026-08-13 after the third instance:**
  **a catalogue is only searchable if EVERY surface queries the same source
  with the same fields — verify each surface independently; fixing one proves
  nothing about the other.**

  Three instances, and the third is what forced the wording. Diagnoses: one
  category written, another queried. Medicines: the server matched name and
  code while **Flow never asked the server at all**, filtering the catalogue
  client-side on the option's printed LABEL. Services: the server matched
  `name` alone — so a procedure could not be found by the code on its own order
  form — while the two client-filtering rails found it perfectly well, because
  their label reads "CODE — Name". **That last pair was broken in OPPOSITE
  directions, so a test of either surface would have certified the other.**

  What follows from it, in practice:
  - the searchable field list for each catalogue lives in ONE tested module —
    `item-search.ts`, `service-search.ts`, `diagnosis.service.ts:searchCatalog`
    — never re-derived in a `where` clause or a `filterOption`;
  - a client-side `filterOption` must match the same list as the server. Match
    on an explicit `searchText` field, never on the printed label: a label is a
    display decision and it silently governs findability;
  - **diagnoses are the shape to copy** — Canvas and Flow mount ONE
    `DiagnosisSearchField`, so the catalogue cannot drift between them. Two
    components onto one catalogue is the defect waiting to happen;
  - **CI enforces it**: `e2e/catalogue-findability.spec.ts` is a TABLE of
    catalogue × surface × a term matching a NON-name field (shortform, group
    tag, code). A term matching the name proves nothing — name matching has
    never been the thing that broke. **When you add a search box onto a
    catalogue, add a row.** A surface exposing only a slice of a catalogue
    (the services rail is STANDARD_SERVICE only) gets its own term rather than
    a term chosen to match everywhere, which would hide the thing being tested;
  - the guardrail needs data it can find, so `seed-e2e.ts` plants a coded,
    categorised standard service. A findability test against rows that carry no
    code is a test of an empty shelf.
- **A 229-item catalogue is not a 7-item one.** antd Selects virtualise, so
  "open the list and pick the row" silently stopped working once real data
  landed — the row is not in the DOM until you type. `openAndPick` types
  first, like a doctor would.

- **The deployed app is TWO Railway services** (kuwick-api + kuwick-web,
  docs/STAGING_DEPLOYMENT.md), originally created from the retired
  `clinical-workspace-c2-canvas-ux` branch. When "the owner can't see the
  work", check BOTH services' tracked branch — realigning one and not the
  other reproduces the symptom exactly. `/health` now answers with the
  deployed commit (`build` field), and the avatar menu shows "build <sha>".
- **A false pass hid a 403 for two phases**: the footer assertion
  `/completed/i` matched the refusal toast "The consultation could not be
  completed." Assert the success state's own words, never a substring the
  failure message also contains.

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
  disagreeing with the queue. This defect family shipped THREE times
  (hold/resume, `useCompleteVisit`, `useBillingRefresh`) — the last two are
  fixed now, but grep for `'visit',` before trusting any new invalidation.

## Credentialing — never hand-write these fields

`src/core/credentialing.ts` is the ONE definition of "credentialed clinician".
`credentialedClinicianFields()` writes all eight fields the rule needs;
`nonClinicalFields()` clears all eight. Every seed and fixture uses them.

The doctor-cannot-sign defect shipped TWICE (seed-role-fixtures, then
seed-staging-uat) because each seed re-derived the field list from memory and
each was missing two. `credentialing.spec.ts` now pins the helper to the
predicate in both directions — what it writes is sufficient, and every field
it writes is load-bearing. Do not add a ninth field, or a second definition.

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

## P0 #1 — CLOSED by the owner on staging (2026-08-13)

Diagnosis search works live. Re-running `seed:catalogues` repaired the 162 rows
(inserted 0, updated 162) and the owner confirmed "urti" → **J06.9** and
**A09** both recorded on a real visit. Nothing further is owed on it. The
lesson it left is above under "Seeded is not findable" and stands.

## b0 — THE ATTACHMENTS DEFECT: one component, one region — **DONE**

Reported: after uploading a file, "Attachments (N)" rendered TWICE, the
thumbnail was duplicated, and Hide/Upload sat over the note area.

**It was never a layout bug.** `ClinicalImageStrip` and
`VisitAttachmentsPanel` each rendered the visit's attachment list with its own
heading and its own Upload, and `PatientDashboardPage` mounted BOTH — the
strip's Upload button was also the expand toggle for the panel below it. Each
component was correct alone, and every test either of them had passed
throughout and would have kept passing. **A duplicate is invisible to a test
that renders one of the duplicates.**

Both components are deleted. `VisitAttachments.tsx` is the only one, and it
mounts in exactly ONE place — inside `ClinicalNotesTab`, below the editor and
above the save row, where the approved canvas puts it (PDF p.2) and where it
cannot reach the typing area. Flow and Canvas get the same region because
they now get the same mount; the page owns no attachments state at all.

The shape is the reference: `ATTACHMENTS (N)`, then a wrapping row of chips —
kind icon, filename, `view · ×` — with Upload and "or drag & drop"
right-aligned. No thumbnails; an image opens full size in the lightbox, which
is one click either way.

**The filing tag is STORED, not derived** (`visit_attachments.category`,
enum PHOTO | LAB | LETTER). The reference itself settles this:
`referral-hosp.jpg` is an image file and a LETTER, so no rule over the MIME
type can produce that screen. Upload SUGGESTS a kind from the file type and
records nobody for it — `categorySetBy` stays null until a person actually
files it, so "no human has classified this yet" stays answerable. Re-filing
goes through `PATCH …/attachments/:id/category`, records who and when, and
bumps `version`, so a stale browser cannot overwrite a newer decision.
LETTER is never guessed, because nothing in the bytes could guess it.

The migration backfills `category` from the MIME type, and it does so with
FORCE RLS lifted and put straight back, plus a `DO $$` block that proves the
rows moved — `visit_attachments` is `FORCE ROW LEVEL SECURITY`, so a bare
backfill UPDATE matches ZERO rows and reports success (the D-048 trap the
document-integrity migration already had to bracket).

Two things found while testing, both fixed and both in the reported family:
- a fully successful batch now CLEARS its progress list. The chip is the
  confirmation, and keeping `ear-left.png · Uploaded` under a chip that
  already says `ear-left.png` printed the filename twice. A batch with any
  failure keeps its list, because the reason has to stay readable.
- `canvasSpeed` test 17 asserted per-file reporting from the END state, which
  the clear-on-success rule removes. It now holds the second upload open and
  asserts the first reads "Uploaded" while the second is still going — which
  is what "each file reports its own result" actually means.

Pinned by: `attachmentsOneRegion.test.tsx` (rendered count, both layouts,
before AND after a real upload), `attachmentsSingleMount.test.ts` (the source
fact — exactly one mount, both old components gone, no page-level attachments
state, with a sanity case so a broken path cannot make it vacuous), and
`canvas-viewport.spec.ts` (the assembled page in Canvas AND Flow: upload a
real PNG, exactly one region, one label, one chip, and the region's box does
not overlap the editor's).

## b1-0 — THE MEDICINE BOX CAN FIND THE CLINIC'S OWN SHELF — **DONE**

The first slice of b1, and it is the diagnosis outage again one catalogue
across. **181 of this clinic's 236 medicines carry a Malay `groupTag`** —
BATUK, DEMAM, ANTIBIOTIK, ANALGESIA/TAHAN SAKIT, 42 groups in all — and
nothing looked at that column. Measured against the running server:

| typed | found before | found now |
|---|---|---|
| `batuk` | **0** | 9 |
| `demam` | **0** | 5 |
| `antibiotik` | **0** | 26 |

TWO surfaces were broken in two different ways, which is why fixing one would
have proved nothing:

- the **server** matched `name` and `code` only. Now `name`, `code`,
  `groupTag`, `sourceName` — one tested list (`item-search.ts`), deliberately
  NOT the sentence columns (`remark`/`instruction`/`indication` would put an
  antihistamine under every cough search).
- **Flow's** Select never asks the server at all: it loads the catalogue and
  filters client-side on the option's printed LABEL. A server fix alone leaves
  Flow exactly as broken. It now filters on the same four columns.

The search ROW also said the strength and nothing else, so "which of these do
we have, and what does it cost" meant leaving the consultation. It now reads
`GROUP · strength · RM 0.00 · N in stock · CASH ONLY`. Stock travels WITH the
item (`include: { stockLevels }`) rather than being annotated from a
whole-table fetch — the same mistake `findAll` was bounded to fix, one table
across. **"out of stock" and "stock unknown" are different sentences**; a
missing stock record is never rendered as zero.

**A design-system defect found on the way:** `KuwickSearchOption.detail` is
documented as "a quiet second line" and was folded into the `title` attribute
and nowhere else — a tooltip, which this project already ruled out for the
upload errors (unreachable on a touch screen, invisible to anyone scanning).
It renders as a real second line now (`optionLabelProp="text"` keeps the
closed field plain). Every KuwickSearchSelect gains this, including Add
Procedure.

Pinned by `item-search.spec.ts` (5), `prescribing.test.ts` 22–30 (the row's
wording, including the two different stock answers), and
`canvas-viewport.spec.ts` — "batuk" typed in **Canvas AND Flow**, asserting
the group, a money-shaped price and a stock phrase in the rendered option, plus
the component's own no-match sentence verbatim.

## b1a — SEARCH-FIRST PRESCRIBING — **DONE**

The rail's "Add Medication" button is gone. `MedicineSearchBox` is always
visible in the medications rail; choosing a result opens `AddMedicationModal`
with **the drug locked as the title** and its price + stock as the subtitle,
and the form no longer has a search field of its own. Copy Previous stays.

Three properties worth not losing:
- the **whole `Item`** travels from the box to the form, so the form opens
  filled with NO second request. `defaultsFromItem` is shared with the legacy
  search-inside-the-form path, so the two cannot disagree about what a prefill
  means, and the prefill still announces itself (`data-prefilled`).
- the form asks which medicine **exactly once**. It was asking twice; two boxes
  onto one decision is the attachments defect in a different costume.
- **"Add & Add Another" returns to the RAIL box** (`onAddAnother`), because
  that is where the next prescription starts. The alternative — a filled form
  left open on a drug already added — reads as unfinished work.

**A0's viewport sweep caught a real defect here, the second time in one
session.** The box rendered 118px wide at 1366 — too narrow to read a drug name
in, which is its whole job. `flex-wrap` alone changed nothing, exactly as it did
not for the Vitals card title: **a flex item shrinks to its minimum before its
row agrees to wrap.** `min-width: 180px` on `.kw-medicine-search` is what
refuses, so Copy Previous drops below the box on a narrow rail. If you touch
this layout, re-run the 1366 case — it is the width that finds these.

Four E2E specs drove the removed button and now drive the box; the
catalogue-findability table's Canvas medicine row clicks nothing first, which
is the property b1 exists for.

## b1 PHASE 1 — PRESCRIPTION REFERENCE DATA — **DATA LAYER DONE, UI NOT**

The owner's combined b1+b2 package has four phases. **Phase 1's data layer is
done and merged; everything else in that package is NOT started.** Read the
"what is left" list below before planning.

**DONE (merged, CI green):**
- migration `20260813120000_prescription_reference_catalogs` — five catalogues
  (`prescription_frequencies`, `dosage_units`, `consumption_methods`,
  `indication_presets`, `stock_units`), `CatalogOrigin` SYSTEM|CUSTOM,
  `DurationUnit` DAY|WEEK|MONTH, and on `items`: the seven 1F default columns,
  `defaults_from_seed`, `stock_unit_id`, `quantity_per_stock_unit`.
- seed data in `src/clinical/prescription-reference-seed.ts` (7/12/19/47/13,
  exactly the owner's lists) and `prisma/seed-reference-catalogs.ts`
  (`npm run seed:reference`), idempotent, repairing, wired into CI.
- `ReferenceCatalogService` + `/reference-catalogs/:catalog` — list, create
  CUSTOM, update CUSTOM, retire/restore. SYSTEM rows refused. 30 tests.

**THREE FINDINGS THAT MUST NOT BE RE-LEARNED:**

1. **RLS DOES NOT MAKE A TABLE APPEND-ONLY IN THIS ENVIRONMENT.** The pattern
   used by `patient_alerts` — omit the DELETE policy under FORCE RLS — was
   implemented here, then tested, and **a plain `DELETE` succeeded.** RLS is not
   applied to a superuser, and the role the app connects as IS a superuser both
   locally and in CI (the postgres image makes `POSTGRES_USER` one). `REVOKE`
   does not help, for the same reason it did not help `label_prints`.
   These five tables use **BEFORE DELETE and BEFORE TRUNCATE triggers**, which
   fire for every role; `TRUNCATE ... CASCADE` would otherwise walk past a
   delete trigger. Both verified as superuser.
   → **OPEN, FOR THE OWNER:** the append-only claims on `patient_alerts` and
   `label_prints` rest on RLS alone. They are probably not enforced in any
   environment we run. Not silently rewritten — it is a security-relevant
   decision whether to add triggers there too, or to provision a non-superuser
   application role (which would fix all of them at once and is the better fix).

2. **A spec in `src/` importing from `prisma/` moves the whole `dist` tree to
   `dist/src/`**, which breaks `node dist/main` — i.e. CI's entire e2e job.
   Seed data lives in `src/` and prisma scripts import from it, never the
   reverse. `seed-clinic-catalogues.ts` already did it that way.

3. The seeder does NOT take over a CUSTOM row holding a platform key (a clinic
   may have invented "QDS" first; relabelling it would change dispensed
   labels). That skip is REPORTED — a seed that says "repaired 6" when it meant
   7 lies by omission, which is how the diagnosis outage stayed invisible.

## PHASE 0 — THE APPEND-ONLY GUARANTEE — **PARTLY DONE, ONE STEP BLOCKED**

Owner decision 2026-08-13: non-superuser application role + triggers as defence
in depth. What landed, and the one thing that did not.

**DONE and verified against the running database:**
- migration `20260813140000_append_only_is_enforced_not_claimed` — BEFORE DELETE
  and BEFORE TRUNCATE triggers on `patient_alerts` and `label_prints`.
  Statement-level, so `DELETE ... WHERE false` is refused too.
- the false `COMMENT ON TABLE` claims on both tables replaced with the real
  three-layer mechanism, in the schema where a reader will find them.
- `assertNotSuperuser()` in `prisma.service.ts` + 7 tests: refuses SUPERUSER and
  BYPASSRLS, names the role and the fix, has a documented escape hatch, and asks
  postgres about `current_user` rather than a configured name.
- CI provisions `kuwick_app` (NOSUPERUSER NOBYPASSRLS) and grants it on the
  migrated schema. TRUNCATE deliberately not granted.
- `docs/STAGING_DEPLOYMENT.md` — the Railway role SQL, the DATABASE_URL change,
  and why migrations keep running as the owner.

Proven, all four: as `kuwick_app`, DELETE on both tables hits the trigger and
TRUNCATE is `permission denied`; as the SUPERUSER, the trigger still refuses.

**BLOCKED — the app cannot yet BOOT as a non-superuser.** Measured, not guessed:
`tenant-scoped-prisma.provider` extends the client with an `$allOperations` hook
that throws `Tenant context not set` for any query outside a request, and a
boot-time clinical-catalogue count goes through it. RLS bypass was hiding this;
the count only ever worked because the app was a superuser.

Consequences, recorded honestly:
- `assertNotSuperuser` is **written and tested but NOT called** — calling it from
  `onModuleInit` killed the process at boot for the same reason. The fix is a
  short-lived `pg` client from `DATABASE_URL` in `main.ts` before Nest starts
  (`PrismaPg` already brings `pg` in). **This is the only thing between here and
  connecting as `kuwick_app`.**
- CI's API still starts as the owner, with `KUWICK_ALLOW_SUPERUSER_DB=yes` set
  DELIBERATELY and commented as temporary — so the state is loud, not silent.
- **Until that is done, tenant isolation is still unenforced at runtime.** The
  triggers hold regardless of role; the RLS policies do not.

Order for the next session: fix the boot query → wire the assertion in `main.ts`
→ point `DATABASE_URL` at `kuwick_app` in CI → delete the flag.

## PHASE 0 — **COMPLETE.** Runtime tenant isolation is enforced.

As of `95e8a47` in CI, and in staging once the owner runs the switch runbook at
the end of `docs/STAGING_DEPLOYMENT.md`. Before this, every RLS policy in the
schema was inert in every environment we run.

- app connects as `kuwick_app` (NOSUPERUSER NOBYPASSRLS); `assertNotSuperuser`
  runs from `main.ts` BEFORE Nest and refuses to boot as anything else.
- `withSystemConnection()` — short-lived plain `pg`, no tenant context, system
  questions only. **Boot-time checks must never use request-scoped
  infrastructure**; the tenant-scoped client throwing outside a request is
  correct behaviour.
- BEFORE DELETE + BEFORE TRUNCATE triggers on `patient_alerts`, `label_prints`
  and the five reference catalogues. They fire for every role, superuser
  included.
- `scripts/provision-app-role.mjs` (node + `pg`, not psql) reads the flags back
  and refuses to report success if the role came out SUPERUSER or BYPASSRLS.

**TWO ROLES, TWO JOBS — the part that bites.** `start:prod` runs migrations and
then the app. `kuwick_app` deliberately has no CREATE on the schema, so
`prisma migrate deploy` as that role fails with `permission denied for schema
public` (measured). `apps/api/scripts/migrate-deploy.mjs` runs the migration
step under `MIGRATE_DATABASE_URL` (the owner) and falls back to `DATABASE_URL`
when it is unset — so local and CI are unchanged and need no new variable.
**Any deployed environment needs BOTH variables set.**

**Once RLS is real, a boot check cannot count tenant-scoped rows** — it gets a
confident ZERO, not an error. The catalogue check now asks whether the TABLES
exist (RLS cannot filter metadata) and the per-clinic count moved to the
authenticated session. `scripts/smoke-catalogue.mjs` signs in to ask it.

## PHASE 1G — **DONE.** Seed, both screens, and the E2E that proves them.

**DONE and merged:**
- `src/clinical/standard-prescription-seed.ts` + `prisma/seed-standard-prescriptions.ts`
  (`npm run seed:standard-rx`), wired into CI **after** the reference
  catalogues — these defaults are FKs into them, and seeding first writes nulls
  that look like "this medicine has no defaults".
- **226 of 236** medicines seeded: 81 CURATED (full regimen), 145 FORM-DERIVED
  (route + unit only). The 10 with nothing are arm slings, soaps, a spacer
  chamber, rinse bottles and a tumbler — correctly not medicines.
- `docs/seed-review/standard-prescriptions.csv` — one row per medicine, every
  field, the BASIS, and why anything was left blank. **The owner is a doctor;
  every row is a clinical claim and this is how it gets audited.**
- 91 tests, weighted toward restraint.

**THE RULE, which any future edit must keep:** an unrecognised drug gets NO
dose. Curated = the conventional adult regimen is unambiguous. Everything else
gets unit + route from the clinic's own naming prefixes and nothing more.
Paediatric syrups/suspensions get no dose amount — that is the calculator's.

**Reading the CSV found three gaps the summary counts hid**, which is the
argument for keeping it: `[PREORDER] ` defeated every anchored form rule (12
medicines with no route); the staging seed's plainly-named medicines matched
nothing, including the golden path's own `Paracetamol 500mg`; and "PLASTER" is
a patch. **Re-read the CSV after any change to the mapping.**

The seeder skips a clinic-edited row and NAMES it (`defaultsFromSeed` marks
what it wrote). Verified by hand-editing one and re-running.

**BOTH SCREENS ARE NOW BUILT.**

1. **Settings › Prescription Vocabulary** (`/settings/clinical/prescription-vocabulary`,
   `PrescriptionVocabularyPage.tsx`). One section per catalogue, all five,
   declared as data — the five differ only in their columns and the rules around
   them must not drift. A SYSTEM row renders **no controls at all** rather than
   three disabled ones, and says "Locked — add your own instead". Stock units'
   "Add custom" is disabled with the reason **printed on the page**, not in a
   tooltip: a tooltip does not exist on a phone.
2. **Inventory medicine form** — a "Standard Prescription (default)" section with
   the seven 1F fields, dropdowns fed from the catalogues **including retired
   entries**, so a medicine still pointing at a withdrawn row renders its NAME
   marked "(retired)" instead of a bare uuid.

**THREE DEFECTS FOUND BUILDING THEM, all invisible in a browser:**

- **`JSON.stringify` drops `undefined`.** antd's `allowClear` returns
  `undefined`, so clearing a default would have left the browser as "field not
  sent", which the API reads as "leave it alone". The doctor deletes a wrong
  dose, the form says saved, and the wrong dose is still there. `withClearedDefaults`
  sends an explicit `null` for those seven keys only — the rest of the medicine
  form still relies on `undefined` meaning "don't change this".
- **Nothing cleared `defaults_from_seed`.** The seeder's skip branch was
  therefore UNREACHABLE through the API: the next `seed:standard-rx` run would
  have reverted a doctor's correction without a word. `ItemService` now clears it
  whenever a payload touches any of the seven keys — presence of the KEY, not the
  value, because writing the same dose back is still a person saying "this is right".
- **A foreign key does not enforce tenant isolation.** PostgreSQL checks FKs
  through internal triggers that RLS does not apply to, so another clinic's
  frequency id would be ACCEPTED by the constraint and then read back as nothing
  — a form opening blank with no error anywhere. `assertStandardPrescriptionIsReal`
  refuses it, and refuses retired entries, naming every offending field at once.

**"Seeded is not findable", a fourth time.** The Items page showed ten of 236
medicines with no search, so the screen that edits a standard prescription could
not reach one. Added `useItemSearch` — server-side, so the Malay group tag is
matched too.

**Two fields on that form were both labelled "Duration."** The legacy free-text
trio (`doseDefault`/`frequencyDefault`/`durationDefault`) is what the prescribing
modal still reads until Phase 2, so it stays — but it now says "(free text)".
Delete those labels' suffix only when Phase 2 removes the columns' last reader.

`e2e/prescription-vocabulary.spec.ts` — 4 specs. It asserts the words the clinic
reads (the Malay label, the refusal sentence) and that paracetamol's seeded
defaults RESOLVE to names on screen, which is the half that silently fails if the
reference catalogues were not seeded first.

## PHASE A — **DONE, both surfaces.**

The prescription carries what its own LABEL has to say, as SNAPSHOTS —
`dose_unit_bm`, `frequency_bm`, `consumption_method` +
`consumption_instruction_bm`, `indication_bm`, `duration_value` +
`duration_unit`. Deliberately NOT foreign keys: correcting a catalogue row must
never rewrite a prescription already printed or dispensed. The browser sends
catalogue IDS ONLY; the server resolves the text and refuses cross-tenant and
retired ids before the write. `durationDays` stays canonical and is recomputed
server-side ("2 WEEK" = 14 days).

**BOTH prescribing surfaces are rewired** — `AddMedicationModal` (Canvas) and
`MedicationsTab` (Flow): unit / frequency / consumption-method dropdowns,
duration as number + DAY/WEEK/MONTH, indication combobox matching EITHER
language with free text still allowed, prefill from the medicine's 1F defaults,
quantity auto-compute that stops on a manual edit and SKIPS PRN/STAT.

**The label prints both halves** (`labelPrint.ts`): `2 Tablet (BIJI) TDS (Tiga
kali sehari) for 5 days`, with the consumption instruction FIRST among the
extras — it is the line that stops an oral suspension being used as ear drops.
Where a record has no Malay half it prints one half rather than `TDS ()`.

**Why Flow was missed the first time, and what now prevents it.** The golden
path prescribes through Flow, so the whole suite stayed green while every
prescription it wrote carried `frequency_bm` NULL — nothing failed because
nothing looked. The golden path now reads the prescription back over the API
and asserts `frequencyBm` is truthy. Verified in the database after a green
run: `unit "Tablet", dose_unit_bm "BIJI", frequency "TDS", frequency_bm "Tiga
kali sehari", consumption_instruction_bm "Ambil melalui mulut"`.

**Known flake (pre-existing, not Phase A):** `canvas: attachments render as
exactly ONE region` failed once in a full serial run and passed in isolation and
on a full re-run. Attachments are untouched by this work. CI retries once.

**Three things learned about testing antd 6 under jsdom** (all cost real time):
- `findByRole('option')` resolves to a node that is NOT the one carrying the
  click handler — clicking it does nothing, silently, and the test then asserts
  an unchanged value. Use `findByTitle`, scoped to the dropdown found via the
  combobox's `aria-controls` (the closed control carries the same title).
- `.ant-select-content` holds the PLACEHOLDER when nothing is chosen. Reading it
  back makes an empty dropdown look filled; check `-has-value` first.
- `userEvent.clear()` does not empty an `InputNumber`. "clear then type 3" gives
  13. Triple-click to select, then type.

## PHASE B — **DONE.** `useDismissableModal`, and every modal inherits it.

`apps/web/src/design-system/kuwick/useDismissableModal.ts`, exported from
`design-system/kuwick`. `KuwickModal` is wired onto it, so **every modal in the
app already has the guard** — the profile slide-over, orders, documents and
the rest reuse it by using `KuwickModal`, not by re-deriving the rule.

Escape, the X, Cancel and the backdrop all funnel through `requestClose`, so a
call site cannot wire three and quietly leave the fourth able to discard a
half-written prescription.

**THE BACKDROP IS DECIDED ON MOUSEDOWN, NOT CLICK.** A `click` fires on the
nearest common ancestor of press and release — so selecting text inside the
modal and letting go a few pixels outside lands a click on the mask, and antd's
own `maskClosable` would throw the form away because a doctor highlighted a
dose to re-read it. `maskClosable` is now `false` and the wrapper's own
mousedown/mouseup decide: a gesture closes only if it BOTH starts and ends on
the backdrop.

**Dirty means ASK on every route, including the backdrop.** It used to be inert
while dirty — safe, but it left a doctor clicking a dead area with nothing
explaining why. No route silently discards, and no route silently does nothing.

Asserted on the real prescribing modal as well as the shell: a guard is worth
nothing if a modal happens to pass `dirty={false}`, and that is a wiring
mistake no design-system test would catch.

**Local-only E2E flake, explained — not a regression.** `canvas: attachments
render as exactly ONE region` failed in two of three full local runs and passes
in isolation. Cause measured, not guessed: this container's database has
accumulated **48** attachments on one UAT visit across many suite runs, and the
spec expects exactly one. CI starts from an empty database every run, which is
why it has been green there throughout. The latent assumption — "this visit has
exactly one attachment" — only holds on a fresh database; worth making the spec
scope to its own upload if it ever needs to run against a long-lived database.

## PHASE D — **DONE.** Patient profile slide-over + alerts.

**Screens only — the API already existed.** `patient-alert.controller.ts` has
list / create / deactivate, with the author resolved from the SESSION, MEDICAL
alerts behind their own permission, and no DELETE route because the table has
no DELETE policy. None of that was re-derived in the browser.

- `PatientProfileSlideOver.tsx` — demographics, contact, IC/passport (read-only:
  it identifies the person across every visit, invoice and claim already
  written), payer read from the VISIT, alerts, visit summary. A `KuwickModal`,
  so Phase B's dismissal guard is inherited.
- The canvas identity strip is a real `<button>` that opens it, plus an alert
  indicator that is present whether or not there are alerts — one that appears
  only when something is wrong leaves its absence ambiguous between "nothing
  recorded" and "nobody looked".
- **CHRONIC CONDITIONS ARE ALERTS, not a new column.** A standing fact with an
  author and a timestamp is exactly what `patient_alerts` already is.
- Resolving stamps a second author and leaves the row VISIBLE. "Penicillin
  allergy, resolved by Dr X on the 3rd" is the record of a decision.
- `patientAlertPresentation.ts` mirrors the server's permission split in the
  SAFE direction: it can only hide or disable a control.

**FIVE surfaces said "Allergy not asked", and one of them was found by the
E2E.** The banner read `patient.allergies` alone, so recording "Penicillin
allergy" as a MEDICAL alert left every prescribing surface still asking a
question that had been answered. `allergyBannerState` now reads both sources;
the four `AllergyStrip` sites use `PatientAllergyStrip`, which loads them. The
FIFTH — the header chip `AllergyQuickRecord`, the one a doctor looks at first —
was missed by reasoning and caught only when the E2E asserted the banner after
recording an alert. **Assert the consequence, not the component.**

**Two traps worth knowing:**
- Making `AllergyStrip` fetch its own data broke every direct render and could
  THROW inside a prescribing screen. It is pure again; `PatientAllergyStrip`
  does the loading. A component whose job is to warn about allergies is the
  last one that should be able to break the page it warns on — the query
  guards shape as well as absence for the same reason.
- The quick-record popover seeded its draft from the COMBINED list, so opening
  it and pressing Save would have copied an alert's label into
  `patient.allergies` — the same allergy in two stores with no way to tell
  which a later edit meant. It seeds from the editable half only.

**Still true:** the `canvas: attachments` local flake (this container's
database holds 48+ attachments on one visit; CI starts empty).

## PHASE E — **DONE for the Canvas rail.** Orders/procedures, search-first.

**Data layer.** `order_services` gains `room_id`, `urgency` (ROUTINE/URGENT)
and `quantity`. The two order types ask for different things and the SERVER
decides which apply, keyed on the stored `orderType`, never on the name: a room
and an urgency describe work somebody carries out and are dropped for a
standard service; a quantity is what a standard service is billed by and a task
order is always 1, because three dressings are three orders each with their own
room and result. The room is validated against this clinic's ACTIVE rooms —
the FK cannot do it, since PostgreSQL checks FKs through internal triggers RLS
does not apply to.

**THE INVOICE WAS HARDCODED TO `quantity = 1` for orders.** Storing the column
without this would have been a money bug: three dressings recorded as three,
billed once. It now reads the order's own quantity the same way a prescription's
is read, and a client's figure is still ignored.

**UI.** `OrderSearchBox` replaces the "+ Add Order" button — the box IS the
affordance, and it asks the server so the CATEGORY is searchable ("imaging" is
how a doctor looks for an X-ray they cannot spell). Result rows carry category,
price and a TASK/SERVICE tag, which is the most consequential fact on the row.
`AddOrderModal` has two shapes behind one title, on `KuwickModal` so Phase B's
guard is inherited. The rail lists BOTH types with type, status, room, urgency
and quantity, and keeps the existing PENDING → Start → Complete → View Result
round-trip untouched.

**NOT DONE, and deliberately named rather than left to be discovered:**
1. **Flow's `OrdersSectionBody` still has its own "+ Add Order" picker.** The
   Canvas rail is what Phase E described, but this is the second surface, and
   the last three phases each shipped with one surface behind. Give it the same
   box before calling b2 finished.
2. **`AddProcedureModal` is now dead except in tests.** Delete it with Flow's
   rewiring, not before — Flow may yet be pointed at it.
3. **The orders list and the Direct Services card now overlap**: the picker
   offers standard services and the rail lists them, and Direct Services lists
   them too. The owner said do NOT merge the cards, so both stand — but a
   service added from the orders box appears in both places, and somebody
   should decide whether that is right.

## E-FOLLOWUP — **DONE.** The orders box searches TASK ORDERS only.

Owner's resolution to the overlap: scope the SEARCH, do not merge the cards.
`OrderSearchBox` asks `/services?orderType=TASK_ORDER`, filtered SERVER-side
because the request is bounded to twenty rows — trimming that page in the
browser would return three task orders and present them as the catalogue.

**The LIST is deliberately not filtered.** A visit recorded before this
decision still has a standard service under orders; it still renders, still
shows its quantity, and still bills. Scoping the search must not hide data
already written, and there is a test that the list request carries no
`orderType`.

Boundary copy is on the screen, not left to be discovered: the box reads
"search tests, imaging, procedures…", the empty card says billable services are
added in Direct Services. `AddOrderModal` keeps both shapes and its
standard-service tests now render it DIRECTLY, because that route belongs to
Direct Services — a test reaching it through the orders box would assert a path
that no longer exists.

## PHASE F — **NOT STARTED.** Surveyed, so the next session starts building.

Stopped at the phase boundary on the owner's standing rule rather than begin
something this session could not finish cleanly. What a fresh session needs:

**MODEL GAPS — a migration is required first.**
- `DocumentType` has `MC | REFERRAL | MEMO | QUARANTINE | CUSTOM`. Phase F also
  needs **TIME_SLIP** and **CONSENT**.
- A time slip is a date + HOURS, and no hours column exists. `startDate` /
  `endDate` are `@db.Date`, so they cannot carry a time either — add an
  explicit `hours` (Decimal, nullable) rather than overloading a date.
- Nullable, not backfilled: documents already issued have no hours.

**MOST OF THE FORM ALREADY EXISTS — reuse, do not rewrite.**
`apps/web/src/clinical/documents/CreateDocumentDrawer.tsx` (380 lines) already
does per-type fields: `needsDateRange` (MC, QUARANTINE), `needsDiagnosis`,
`needsReferredTo`. Phase F adds the two new types and their fields, and puts a
`KuwickModal` picker in front rather than a drawer. `DocumentsWorkspace` (397
lines) is the Flow surface and already lists, previews, prints and voids.

**WHERE THE CARD GOES.** `sections/ClinicalRail.tsx` is the canvas right-hand
column — `MedicationsRail`, `OrdersRail`, `ServicesRail`. The Documents card
belongs there. NOTE the comment at `PatientDashboardPage.tsx:351`: the
visit band below holds the ONLY Create MC / Create Referral / Open Invoice
controls in Canvas, and it is explicitly to be removed the day the Documents
card lands. Removing it before the card works would take away a doctor's only
way to issue an MC in production.

**MC ISSUANCE IS ALREADY RECORDED.** A `Document` row with `type = MC`,
`issuedDate`, `startDate`/`endDate` and `issuedByStaffId` is the record an
"MC issued" report reads. Do NOT add a second table for it — that would be two
stores for one fact, the thing Phase D refused for chronic conditions.

**Voiding, not deleting** (D-062) is already the rule and the card's "remove"
must use `useVoidDocument`. An issued MC has left the clinic; deleting the row
erases the only evidence it was ever issued.

## b1.5 STAGING FIXES — **DONE.** Alerts routing, profile control, allergy split.

Three defects the owner found manually testing staging.

**FIX 1 — the alert chip opens the ALERTS view only.** It opened the whole
profile, so a doctor checking why a patient was flagged landed in an editable
demographics form. `PatientAlertsModal` renders the same `AlertsPanel` the
profile does — extracted to `PatientAlertsPanel.tsx` so the rules (nothing is
deleted, resolving stamps a second author, resolved rows stay visible) are one
implementation rather than two that drift.

**FIX 2 — "Patient details" is its own labelled button** in the header actions.
The identity block still opens the profile, because clicking a patient's name
to see the patient is what everyone tries first; its aria-label is now "Open
<name>'s record" rather than "…full patient details", because two controls
whose accessible names end in the same two words are two a screen-reader user
cannot tell apart.

**FIX 3 — an allergy is not a chronic condition. THIS NEEDED A SCHEMA CHANGE,
deliberately.**

`PatientAlertType` gains **ALLERGY**. The instruction was display-and-routing
only, and this is the one part that could not be honoured: `MEDICAL` held both
drug allergies and chronic conditions, so the only alternative was to treat a
row as an allergy when its LABEL contains "allergy" — inferring clinical
meaning from typed text, which this codebase refuses everywhere it matters (the
order type is read from the stored column and never the service name; the
standard-prescription seed leaves a dose blank rather than guess it from a drug
title). Same store: one enum value, no second table.

- `allergyAlerts()` / `nonAllergyAlerts()` in `usePatientAlerts.ts` — the split
  lives in ONE place, keyed on the stored type.
- Allergy chip and prescribing banner: `patient.allergies` + ALLERGY alerts.
- Everything else renders as **"Also on record:"** under the banner, neutral
  rather than red — chronic conditions stop masquerading as allergies without
  disappearing.
- ALLERGY takes the SAME permission as MEDICAL (`patient.alert.medical.write`).
  Adding the value without that would have handed the front counter a
  do-not-prescribe list.

**EXISTING ROWS ARE NOT BACKFILLED, and this is a live consequence on staging.**
A `MEDICAL` alert reading "Penicillin allergy" stays MEDICAL, so it now shows
under "Also on record:" rather than in the red allergy chip. "Almost certainly
an allergy" is not a basis for moving a row onto a do-not-prescribe list on a
patient's behalf. **Real drug allergies should be re-recorded from the alerts
view**, where ALLERGY is now the default type.

**Testing note that keeps costing time:** Playwright's `getByRole` name is
SUBSTRING-matched; testing-library's string form is EXACT. A locator that
passes in vitest can resolve to two elements in Playwright — that is how the
"Patient details" collision surfaced.

## b1.5 HEADER FIXES — **DONE.** Inline alerts, deduplicated allergies.

**FIX 1 — non-allergy alerts render their CONTENT in the header.** The chip
said "1 alert" and a doctor had to click to learn it meant DM. Information you
have to click for is information you do not have mid-consult. `headerAlertSummary`
shows up to `HEADER_ALERT_LIMIT` (3) labels and collapses only the REMAINDER as
"+2 more" — never the whole set. The accessible name always carries the full
list, so a screen-reader user is not the one who has to click.

A CAP rather than a measurement, deliberately: "as many as fit" in a wrapping
flex band means a number that clears the narrowest supported viewport, and a
measured version would reflow every render and still have to pick one.

Hierarchy: allergy chip red at weight 600, alert chip amber at 500. Both
readable without interaction, one clearly louder — an allergy forbids, a
chronic condition qualifies.

**The A0 sweep caught this twice, and both are worth knowing.**
1. `text-overflow: ellipsis` does NOT satisfy the sweep — an ellipsised box
   still has content wider than itself. Exempting ellipsis is what would have
   masked the original Vitals-title defect, so the chip WRAPS instead. That is
   also the honest answer: clipping to "DM, HP…" puts the information back
   behind a click, which is the thing this fix removes.
2. `.kw2-chip` sets `white-space: nowrap` and is declared LATER in `canvas.css`,
   so the single-class override lost on source order — a 426px chip in a 225px
   box. It is now `.kw2-chip.kw2-chip-alerts-active`, order-independent.

**FIX 2 — the allergy chip deduplicates.** Staging read "NSAIDS, AUGMENTIN,
PCM, NSAIDS": the drug was in `patient.allergies` AND recorded as an ALLERGY
alert. `allergyWords` now dedupes case- and whitespace-insensitively, keeping
the FIRST spelling so the patient's own words survive. Display layer only —
neither store was touched.

### ON THE RECORD: should `patient.allergies` be retired? — asked by the owner

**Recommendation: yes, eventually — but NOT until alerts can record a confirmed
negative, and that is a real blocker rather than a detail.**

The case for retiring it is strong and the owner is right that this is the same
duplication Phase D refused for chronic conditions:
- `patient.allergies` is a bare `string[]` with **no author and no timestamp**.
  `patient_alerts` has both, plus resolve-with-attribution and append-only
  enforcement. For do-not-prescribe information, "who recorded this, when" is
  precisely what you want, and the array cannot answer it.
- The dedup shipped above is a display-layer patch on a data-layer duplication.
  That is a smell, not a fix.

**THE BLOCKER — the array carries a state the alerts table cannot express.**
`allergies = []` means "asked, none known"; `allergies = null` means "never
asked". Those are different, the whole three-state banner rests on the
difference, and **absence of an ALLERGY alert is ambiguous between them**.
Retiring the column today would trade a duplication for a lost safety state:
every patient would read "Allergy not asked" forever, including the ones who
were asked and had none.

So the order of operations is:
1. Give alerts a way to record a confirmed negative WITH an author — a
   patient-level "no known allergy, asked by X on <date>" fact. It does not
   have to be a new table.
2. Backfill each non-empty `patient.allergies` entry into an ALLERGY alert.
   Attribution needs a decision: `createdByStaffId` is NOT NULL, and inventing
   an author for a row nobody signed would be worse than the duplication. A
   "migrated from the patient record" marker is the honest option.
3. Point the quick-record chip's WRITE at alerts. Keep the chip itself — two
   clicks mid-consult is genuinely good, and only the destination changes.
4. Then drop the column.

Until then the two stores stand, and the dedup keeps the chip honest.

## b1+b2 PACKAGE — WHAT IS LEFT (next session starts here)

**Phase 1 remainder:**
- ~~Settings UI for 1A–1E~~ and ~~the 1F medicine form~~ — **both done**, see
  PHASE 1G above.
- Stock display/deduction respecting `stockUnitId` + `quantityPerStockUnit`.
  Nothing reads those columns yet, so "X in stock" is unchanged so far.

**Phase 2** — modal rewiring: unit/frequency/consumption-method dropdowns from
the catalogues, duration as number + DAY/WEEK/MONTH, indication combobox
matching EITHER language, prefill from 1F, quantity auto-compute
(dose x timesPerDay x days, WEEK x7, MONTH x30, manual edit stops recalc,
PRN/STAT skip), and the bilingual label output.

**WHERE PHASE 2 LANDS, concretely** (surveyed, not started):
`apps/web/src/clinical/medications/AddMedicationModal.tsx` (594 lines) holds a
`FormState` whose `unit`, `frequency` and `durationDays` are free text/number,
and `prescribing.ts`'s `defaultsFromItem` prefills them by REGEX-SCRAPING the
legacy columns (`"5 days"` -> 5). Phase 2 replaces both: the dropdowns read the
catalogues, and prefill comes from the item's 1F fields, which are already
populated for 226 of 236 medicines. Keep `defaultsFromItem` working as the
fallback for a medicine whose 1F fields are empty — 10 of them have none by
design, and the legacy text is all those rows have.

**The quantity rule is already written and tested** — `computeQuantity` in
`apps/web/src/inventory/standardPrescriptionForm.ts`. It returns `null` for
"cannot be computed" and the caller must LEAVE THE BOX ALONE on null, never fall
back to 1: a PRN frequency has no doses-per-day, so any number there is one
nobody decided. It rounds UP, because a half-tablet course rounded down is four
days of a five-day prescription.

**Phase 3** — `useDismissableModal(isDirty)`: backdrop (**mousedown** target, so
a text-selection drag ending outside does not close), Esc, X and Cancel all
dirty-guarded. Shared, because Phase 4, b1.5 and b3 all reuse it. Build it
BEFORE Phase 4.

**Phase 4 (b2)** — orders/procedures search-first: inline box replacing
"+ Add Order" (Direct Services keeps its own card — do NOT merge), detail modal
with room/urgency/instructions for TASK ORDER vs quantity/remark for STANDARD
SERVICE, task creation in the Tasks tab with PENDING → COMPLETED round-trip,
and both types auto-pulling into the invoice draft.

Note for Phase 4: `service-search.ts` already matches name, code and category on
the server, and all three service surfaces agree — that was this session's
findability unit. Add a row to `e2e/catalogue-findability.spec.ts` for the new
box when it lands.

## b1 — WHAT IS LEFT (next session starts here)

b1-0 and b1a above are done and merged. The rest of the owner's b1 item:

1. **Dosing per `Item.dosingType`** (the enum already exists, every imported
   row is `ADULT_DEFAULT` because the source carries no dosing data):
   `WEIGHT_BASED` → calculator using mg/kg × latest Wt; `AGE_BAND` → band
   picker from DOB (`ItemAgeDosage` exists); `ADULT_DEFAULT` → silent fill or
   empty. `DosageCalculator` and `prescribing.ts` already hold the maths.
2. **Keyboard path**, asserted: type → arrows → Enter → Tab → Enter. The box
   is an antd Select, so type/arrows/Enter already work; what is unasserted is
   the hand-off — Enter opens the form, Tab reaches the dose, Enter submits.
3. **Row fields**: dose, frequency, qty **+ unit (sachet|strip|bottle|box)**,
   duration, indication, remarks. The qty unit is a NEW column —
   `Prescription.unit` is the DOSE unit (ml, tablet); the pack unit is
   `Item.unitOfMeasure` and nothing stores the prescriber's choice.
4. **TAPERING** — its own unit's worth: per-medicine Standard|Tapering toggle,
   steps (dose × freq × days), auto total qty, generated Malay label, collapsed
   row reading "TAPER · N steps", dispensary reading the steps, ONE invoice
   line. Needs a `prescription_taper_steps` table.

5. **THE PRESCRIBER MAY OVERRIDE THE PRICE — owner decision, 2026-08-13.**
   Asked because money in this system resolves through one tested pipeline
   (`billing-pricing.ts`: `item.sellPrice` → a panel-specific override → the
   panel's inventory markup) and the standing contract is that money moves only
   via `invoice_lines`. The owner chose the recorded override over read-only
   and over a mandatory reason. So, when it is built:

   - the row's price is editable, and a doctor-set figure becomes the **top of
     the pricing precedence** — above the panel-specific override, which is
     the part to think hardest about, because a panel contract price being
     beaten by a typed figure is a claim the panel may reject. Consider
     surfacing that on the row when the visit IS a panel visit; it is the one
     case where the doctor cannot see what they are overriding.
   - stored **on the prescription** with actor + timestamp (`priceOverride`,
     `priceOverrideByStaffId`, `priceOverrideAt`), never on the invoice line —
     the line is derived, and the decision belongs to the prescription that
     caused it.
   - NO reason field: the owner's choice was explicitly the middle option.
     Attribution and time are the audit trail; do not quietly add a reason
     prompt back in.
   - `resolveSourcedPrice` is the ONE place that changes. It must keep
     returning null for an unpriceable row rather than falling back to a
     client-supplied figure, which is the property that makes the whole
     pipeline trustworthy.
   - the report-readiness contract is satisfied by actor + timestamp + amount
     on the prescription, and the invoice line still carries
     `sourcePrescriptionId`, so "who changed what a patient paid, and when"
     stays answerable without new data entry at report time.

## MASTER v3 is canonical (owner, 2026-08-13)

Order: **A0 (done)** → b1 medications search-first → b1.5 profile slide-over →
b2 orders & services → b3 documents → b4 invoice + completion (**then the
owner tests the full manual flow**) → b5 patient alerts 2/3+3/3 → A3 platform
polish → C0 doctor schedules → C1 clinic appointments → B-shell + B1 → C2
patient PWA → C3 reminders → B2. Merge to master after EVERY green unit.

**REPORT-READINESS CONTRACT** — every unit from now on: state changes write
who/when/what (+amount/qty/reason); stage transitions are timestamped (they
ARE the waiting-time and doctor-performance reports); money moves only via
invoice_lines and discounts/credits with actor+reason; stock only via
stock_movements with a source reference; documents write a row with
type/params/serial/actor; appointments write status transitions with source
and actor. **Nothing in a report may require new data entry at report time.**
Each unit's report says which points it satisfies.

## Next session starts here

**A0 RESPONSIVE: DONE** — `e2e/canvas-viewport.spec.ts` asserts, at 1366×768
and 1536×864: the document does not scroll sideways, NO element overflows its
own box, and one key control from each of the three columns is visible, wider
than 120px and fully on screen. It found a real defect on its first run — the
Vitals card title clipped to 38px of 93 at 1366 — whose fix is the
non-obvious part: a flex item SHRINKS before its row wraps, so `flex-wrap`
alone changed nothing; `flex: 1 0 auto` on the title is what moves the
actions onto their own line. The three-column geometry itself was already
sound (canvasLayout.ts), which is why no horizontal page scroll ever
appeared — the symptom was clipped content, not a too-wide page.

**PATIENT ALERTS in progress** (spec below, owner-approved). A2 continues in
the owner's 2026-08-12 order: alerts → medications search-first → live
invoice card → orders & services → documents card → bottom action bar +
one-transaction Complete + Undo → remaining A2 polish. Merge to master after
every green unit.
1. **DONE** — schema + migration (`patient_alerts`; RLS has NO DELETE policy,
   so hard deletes are refused by PostgreSQL itself), the permission split
   (`patient.alert.write` / `patient.alert.medical.write`; DOCTOR and
   CLINICAL_STAFF hold both, ADMINISTRATOR the first only, per the table),
   API (list with resolved names / create / deactivate — type-aware
   assertion on BOTH add and retire, attribution from the session), 12
   boundary tests, and the live boundary table re-run 11/11. That script now
   resolves clinic/patient at runtime — it carried hardcoded UUIDs from one
   dead dev database. The legacy accounts it logs in with (siti.front@,
   faiz.finance@) must exist; recreate them in a fresh world before blaming
   the table.
2. **NEXT** — seeded library + Settings › CLINICAL › Patient alerts CRUD.
3. Type-aware placement: header chips + manage popover (reuse the
   AllergyQuickRecord pattern), MEDICAL alerts joining the allergy strip
   (approved wording guard — the verb attaches ONLY to the allergy clause),
   ACCESSIBILITY+COMMUNICATION on queue rows, full list in profile
   slide-over. Hold both constraints in the spec section below.

A1 is done as scoped: golden path enforces zero console errors, the route
sweep is clean (interaction-level sweeps fold into A2 work as each surface
is touched), and the disconnected-form shape is fixed everywhere it existed.

**A2 allergy quick-record: DONE.** The header chip (all three states) opens
a popover that records allergies or a confirmed negative; "Save" states what
it records ("Record: no known allergies" when the box is empty — a negative
answer is never recordable by accident). Live-update proven against the
running app: chip, medications-card strip and checkpoint all read fresh
after one save, because `useUpdatePatient` now also invalidates `['visits']`
— the strip reads the VISIT's embedded patient copy, and the first live run
caught it stale (same family as the billing worklist). Pinned in
`allergyQuickRecord.test.tsx`, which renders BOTH read paths.

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

### GREEN — the complete path, both variants

register at the front counter → queue as Walk-in (W) → **Call** → **Arrived**
→ canvas → vitals with a derived BMI (asserts the NUMBER: 70kg/1.70m = 24.2) →
clinical note typed, saved, **page reloaded, text still there** (this is D1's
regression test) → diagnosis J06.9 → Paracetamol 500mg prescribed (verified in
the database: ORDERED, ONSITE_DISPENSE, TDS) → switch to Canvas → **complete
through the checkpoint** → front desk **dispenses**, asserted against the drug
movement ledger (a DISPENSED −1 referencing the prescription) → **Create
invoice** (consultation auto-adds) → **Add the medication from the worklist**
→ BOTH lines asserted **via the API** (`sourceConsultationVisitId` /
`sourcePrescriptionId`, cancelled lines excluded) → **Collect RM** payment
(Settled, `paidAt` via API) → **Complete Visit** from Queue Management
(Completed tab + `checkOutAt` via API) → doctor reopens the record and the
**history rail's today-card** reads COMPLETED with the Dx (J06.9) and the Rx.

**OTC (C) variant, also green:** the same path queued as OTC (C) with ONLY a
medication — no vitals, note or diagnosis; the checkpoint names those gaps and
is passed deliberately. The billing page states "This kind of visit carries no
consultation charge." (assert it inside `getByRole('alert')` — the sentence
also appears on the worklist row's state tag), ensure-consultation adds
nothing, and the API assertion is inverted: the medication line exists, **no
line carries `sourceConsultationVisitId`**. Payment and completion are shared
with the main path via `payAndComplete()`.

### The billing worklist stall — DIAGNOSED AND FIXED

The recorded five-step order worked exactly as written; hand-reproduction
settled it in one pass. It was **defect 3 — succeed-while-the-UI-does-not-
refresh**, not the D-093 derivation hypothesis: clicking the medication's Add
fired a POST the server accepted (line on the invoice, verified in the
database seconds after the click) while the worklist never refetched, so the
button kept offering itself. Root cause: the five pre-D-094 hooks at the top
of `useInvoices.ts` (`useCreateInvoice`, `useAddInvoiceLine`,
`useRemoveInvoiceLine`, `useCancelInvoice`, `usePayInvoice`) invalidated only
`['invoices', visitId]` and never `['billing-worklist', ...]` /
`['completion-blockers', ...]`. The consultation's Add SEEMED to clear on
create only because `useEnsureConsultation` fired straight after and its
`useBillingRefresh` invalidated the worklist — masking the same gap in
`useCreateInvoice`.

Fix: all five now route through `useBillingRefresh`, and its `['visit', id]`
became `['visits', id]` (the singular key matched nothing); same one-word fix
in `useCompleteVisit`. Pinned by `billingRefresh.test.tsx` in the
holdConsultation style — counts real refetches, asserts the rendered
consequence. Proven the hard way: an accidental run of the OLD code against
the NEW tests (untracked files don't stash) failed exactly those three.

### WHICH LAYOUT OWNS WHAT (read this before touching the canvas)

Assuming this backwards cost an afternoon and produced a wrongly-reported
"defect". There is no layout bug.

| | Flow (**the default**) | Canvas |
|---|---|---|
| columns | Visits History · Record View · one panel | the single consult screen |
| completion footer | **no** | **yes** — `ConsultationFooter` renders ONLY here |
| layout switch | its own row | rides in the context band |

`DEFAULT_RECORD_VIEW_LAYOUT` is `'flow'`, so a fresh browser starts in Flow.
The golden path therefore does the whole consultation in Flow and switches to
Canvas only to complete it. `e2e/golden-path.spec.ts` has a toggle test that
asserts the RENDERED content changes in both directions — a test asserting the
selected class would have passed throughout the confusion.

### Next unit

The **A1 fix-sweep** (in progress), then **A2**. The guardrail is done; keep
it green — red = fix before the next unit, never disable a step.

### A1 so far — the route sweep

`E2E_SWEEP=1 npx playwright test route-sweep` drives all twelve main routes
as the owner and prints per-route console errors (gated tool, not a
guardrail). First run: eleven routes clean; `/management/reports` emitted
eight duplicate-React-key warnings — `TrendChart`'s x-axis labels used
`[0, mid, last]`, which collapses to duplicate index 0 on a 0-1 day range
and fed `dayjs(undefined)` (today) under an empty chart. Fixed via the pure
`axisLabelIndices()` + 4 tests; sweep now fully clean. The sweep only reads
each route's landing state — interacting within pages is the remaining A1
work; the billing-modal form hygiene below is done.

### A1 — zero console errors, enforced

Both golden-path tests now END by asserting `collectConsoleErrors(page)` is
empty (`e2e/support/app.ts`). What the first run of that assertion found, and
what was done with each:

- **34 raw errors.** 30 were antd v6 dev-build DEPRECATION chatter emitted
  through console.error (`[antd: Drawer] width…`) — filtered by prefix as
  upgrade chores, not consult-flow defects.
- **Genuinely disconnected `Form.useForm` instances** — an instance held in a
  component whose `<Form>` renders conditionally (mode switch or
  destroyOnHidden) is connected to nothing. FIXED by structure, in the
  "child owns its form" pattern: `AddQueuePatientDrawer` (NewPatientForm
  child), `AddToQueueDrawer` (QueueDetailsForm child), `EditPatientDrawer`
  (child + initialValues replacing the setFieldsValue effect),
  `NewVisitDrawer` (NewVisitForm child), and `VisitObservationsPanel`
  (the visit-switch effect no longer calls resetFields when the form is not
  showing). The billing modals
  (BillingVisitPage manualForm, BillingSummaryPanel, BillingInvoicePanel,
  PanelBenefitPanel) now follow the same pattern — each modal+form+mutation
  is a child mounted only while open. PanelBenefitPanel was the worst case:
  it created BOTH form instances even on a self-pay visit, where neither
  form could ever render.
- **One library false positive, filtered with evidence**: antd 6.5.2 + React
  19 StrictMode fires "useForm is not connected" once per page load even for
  the LOGIN page's textbook inline `<Form>` — proven by hooking
  `window.setTimeout` in an init script and printing the stack whenever
  `warningUnhooked` schedules (the warning itself fires from a timeout, so a
  console.error hook shows nothing useful; `warningOnce` also dedupes per
  page load, so counts mislead). Field.render, onChange AND submit all warn
  against the login form's own store while the form demonstrably works.
  Dev-build-only; production bundles (what CI tests) strip it.

### Three things this has already caught

1. **A false pass in the spec itself.** The medication assertion matched the
   select box echoing its own value, and passed while nothing was prescribed.
   Found by screenshotting a PASSING run. Assertions are now scoped to the
   card that owns the data.
2. **`Call` does not start the consultation** — it announces. `Arrived` is the
   transition to IN_CONSULTATION.
3. **My own misreading of which layout owns the completion footer** — see the
   layout table above. The toggle was never broken.

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
- **Queue stage tables paginate at ten rows** and the board polls — use
  `expectRowInStage`, which re-selects the tab and walks the pages. A spec that
  reads only page one of the first render calls a busy clinic a regression.
- **The canvas panels have no real `<label>`s** — they caption fields with
  plain text, so `getByLabel` finds nothing there, while the vitals block
  (which does it properly) works. That is an accessibility gap in the app:
  **fix it in A2.** Until then `fieldUnder(page, caption)` reads "the first
  input after this caption".
- Canvas = `/patients/:patientId?visitId=:visitId`. The **Record View** column
  switches the right panel: Clinical Notes · Orders & Services · Diagnosis ·
  Medications · Documents · Invoices. Click the section name to switch.
  Diagnosis: `input[placeholder="Search diagnosis"]` + `Add`. Medications:
  unit `e.g. ml, tablet`, frequency `e.g. BD`, `+ Add to Prescription`.
  Live BMI carries `data-testid="live-bmi"`.
- Billing → completion vocabulary: payment is the `/^Collect RM/` button
  (CASH pre-selected), settlement renders a `Settled` tag; completion lives in
  Queue Management's **Payment** tab — button aria-label
  `Complete visit for <name>`, modal ok-button text `Complete Visit`; the
  canvas rail's today-card is `data-testid="canvas-visit-today"`.
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

**DEPLOY CADENCE (owner rule, permanent): after EVERY unit goes green in
Actions, merge the working branch into master in the same session — PR or
fast-forward — and master must be green in Actions before moving on.** Work
that is not on master is invisible to the owner (deployment tracks master)
and has not been reviewed by anybody real.

**"Done" means green in the Actions tab, citing the CI run — never a local
run alone** (owner rule, 2026-08-11). Every pre-that-date "local green" claim
is unverified until Actions agrees. The e2e job now smoke-asserts a real
login + authenticated GET before any spec runs (`scripts/smoke-login.mjs`),
because /health alone let a total login outage read as spec timeouts.

**E2E assertions target rendered CONSEQUENCES, or ledger/API truths — never
indicator classes, and never "a dialog closed".** Earned three times over in
one session: a medication step that passed because a select box echoed its own
value; a `Call` step that passed while the queue had not moved; and a layout
toggle wrongly reported as broken because the selected class was believed over
what actually rendered. Assert the thing that would be wrong for a user.

**Anything blocking the golden path is priority zero**, whichever workstream
nominally owns it. A defect that stops the guardrail reaching COMPLETED is
guardrail work by definition.

- Nothing red, blocking, or "interaction detected" anywhere in allergy UI.
- No per-add allergy popups — the strip is persistent and non-dismissable.
- Every visible control works or is explicitly disabled with a truthful tooltip.
- Appointment button: disabled stub, tooltip "Coming soon" (built separately).
- Approved deviations: 12px clinical font floor, scoped tokens, Dispensary nav
  item, greyed e-Invoice LHDN, sub-1600 responsive clamps.
- Do not "improve" the approved design without asking.
