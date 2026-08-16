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

**b4 PIECE 1 — RIGHT RAIL VERTICAL BUDGET (2026-08-16). Done except one test,
named below.**

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

**THE DENSITY MEASUREMENT IS BUILT AND RUNNING IN CI. It reports one thing
still outstanding, and that thing is a layout decision — read it before Piece
2, because it is the number Piece 2 was waiting for.**

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
- Three of the four cases pass for real. Every run now PRINTS the budget,
  passing or failing: `RAIL BUDGET — TYPICAL at 1920×1080: rail needs 659px,
  has 845px above the fold (186px to spare)`.

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

**STILL OUTSTANDING — `TYPICAL fits 1366×768`, and it is the only `.fixme`
left.** It is no longer a fixture problem; it is the measurement working:

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

**PIECE A IS NOT FINISHED. What remains, in the owner's own priority order:**

1. Reduce the BAND's height without touching its content — padding, the
   action-button row, vertical rhythm. The allergy strip and alert chips stay
   exactly as they are, wrapping included. This is the y=277 line, and it must
   be attacked as HEIGHT, not by removing contents: that lesson is already paid
   for above.
2. Tighten card headers: a title and a count should cost a line, not a block.
3. Shorten each card's add control further, still without moving it in the DOM.
   (A first pass took them to 26px in `13e4aa5`; the single DOM position that
   fixed the focus-loss bug must stay.)

**THEN REDEFINE THE 1366 ASSERTION — deliberately, in the open, not by
weakening it.** The owner's judgement: four cards holding a real visit will not
fit 768px once the band and the per-card controls are kept, and pretending
otherwise costs more than it buys. `TYPICAL fits 1366×768` is to be REPLACED by
a target that protects what matters, all of it asserted:

  a. At rest, the Medications card header AND its first row are above the fold.
     Medications is what a doctor opens the rail for.
  b. Any row carrying the unresolved-supply warning chip is above the fold at
     rest, or the rail auto-reveals it. That warning must never require a
     scroll to discover. (Note the related fix already made: rows with no
     supply decision are ordered FIRST, so the disclosure threshold cannot
     collapse the warning into "+N more".)
  c. No item text truncated at any width.
  d. No card lost — each of the four reachable and of real height.
  e. At 1920 the full TYPICAL rail still fits with no scrolling at all.

The budget line must still print on every run, pass or fail, and must still
measure against the full 768 including the sticky bar once Piece B lands.

**PIECES B AND C NOT STARTED.** Piece B (invoice + sticky bar) must read
`consultation-tariff.ts` (D-094) first — the OTC-skips-consultation rule almost
certainly belongs there, and a second answer to "should this visit carry a
consultation charge" is the two-allergy-stores mistake again. The bar is slim at
rest (~44px), expands over the canvas on click, and never permanently occupies
more than the slim height. Its height counts inside the measured region; if it
breaks a Piece A assertion, the HEIGHT is what gets fixed.

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

**b4 PIECES 2 AND 3 — NOT STARTED.** Specs are in the owner's message and in
the Phase G/H entries above. Piece 2 note that matters: the invoice lives in the
STICKY BOTTOM BAR, not as a sixth card in the scrolling rail, and
`consultation-tariff.ts` (D-094) already answers "should this visit carry a
consultation charge" server-side — do not build a second answer.

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
| H20–H21 invoice + complete | not started |
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
