# Piece 1 — Every punch of a day, and the pairs it makes

The first of the eight pieces the September UAT produced, and the one the
owner put first because it destroys data every day it is not fixed. `[D]`
marks what was read in the code or the database, `[A]` an assumption, `[O]` an
owner decision.

## 1. The defect, as the owner found it

The clinic's admin staff clock out at lunch and back in — deliberately, so the
owner can see who left and came back late. Four punches a day is normal there.

`[D]` `attendance_records` was `@@unique([tenantId, staffId, workDate])` with
one `clock_in_at` and one `clock_out_at`, and the clock path read:

```ts
const clockInAt  = existing?.clockInAt ?? now;
const clockOutAt = existing?.clockInAt ? now : null;
```

The first punch of the day became the clock-in and never moved; every later
punch overwrote the clock-out. `[D]` `computeAttendance` then measured
`minutesBetween(clockInAt, clockOutAt)` — first punch to last — so the lunch
hour counted as worked. `[D]` And the punches in between were kept nowhere:
`clock()` runs under `withTenantTx` with no `recordAudit` call, so nothing
could recover them.

Reproduced by the owner on staging: punches at 14:01, 14:03, 14:06 and 14:07
reported **0.10 h**, being 14:01 to 14:07. The two stretches actually worked
are three minutes.

## 2. What changed

| Part | Change |
|---|---|
| Arithmetic | `computePunchedDay` returns Σ (OUT − IN) over the closed pairs. `computeAttendance` is now a thin adapter over it |
| Schema | `attendance_punches`, append-only, one row per press of the button |
| Service | `recomputeDay` is the one place a day's summary is written; `clock()` appends, `correct()` takes the day punch by punch |
| Screens | The timesheet draws each pair and states the gap; the Fix drawer is the day as a list; the portal shows the employee their own punches |
| Seeds | Write punches, including one four-punch day |

The gaps between pairs are simply not counted, so **a punched break is unpaid
without anything being configured**.

## 3. Decisions, each with a test

| Decision | Why |
|---|---|
| Lateness from the FIRST clock-in, early leaving from the LAST clock-out | Those are the two ends of the working day whatever happened between them, and both were already right — every existing test of them passes unchanged |
| A second IN with no OUT between is somebody who forgot to clock out | Not two stretches at once. The earlier one is abandoned and the day is incomplete |
| An OUT with nothing open adds no minutes | It cannot say when the work started — exactly what a lone clock-out always did |
| One stretch closed and another open reports the hours that DID close, and is still `MISSING_PUNCH` | Returning null throws away hours we know. A day where *nothing* closed still returns null: an unfinished day is not a zero-hour day |
| The flat unpaid break applies only to a day worked as ONE stretch | A clinic that punches its break has already excluded it; deducting the policy's hour on top charges the same hour twice |

`[O]` **Append-only**, decided by the owner: a punch is never edited and never
deleted. A correction writes new punches and supersedes the ones it replaces,
with who and why, and the employee sees both. `[D]` It is the promise
`correct()` already made about the original clock-in, and the only shape that
makes sense for the fix to a bug whose nature was losing data. A check
constraint enforces that a superseding decision carries its author and reason
or is not recorded.

## 4. The backfill, measured rather than reasoned about

`[D]` Run against the dev database before anything else was built on it:

```
records: 77 | clock-ins: 77  clock-outs: 73
punches: 150 | IN: 77  OUT: 73          → one punch per timestamp
closed days checked: 73 | differing from stored worked_minutes: 0
RLS forced: true | policies: 1
```

A day with one pair is one closed pair, and the sum of one pair is the span
between its ends — so **every historical day reads identically**. That
identity is what makes the migration safe against a database whose figures
have already been reconciled.

Two things it deliberately does not invent. `recorded_by_staff_id` stays null,
because the old record never said who pressed the button. `distance_metres`
and `outside_clinic` stay null and false, because the record's values are a
DAY-level fact — the furthest punch of that day — and attributing them to
either punch would state something the old row never knew.

## 5. A bug the punch model itself introduced

`[D]` The portal decided "still on duty" from a day with a clock-in and no
clock-out. Once a day can hold four punches, somebody who clocked out at lunch
HAS a clock-out — the middle one — so the portal would have offered **Clock
in** to a person standing at the counter, and that punch would have opened a
third stretch. It now asks what the day's last punch that counts was.

Found by reading the model's consequences, not by a failing test. It is the
reason a piece like this cannot be only a schema change.

## 6. The screens

**The timesheet shows the pairs, not a total.** `Clock in` and `Clock out` are
gone as columns — two headings cannot describe a day somebody clocked out at
lunch — replaced by one **Punches** column drawing each pair with the gap
below it: `09:02–13:01 · 14:12–18:03`, `away 1 h 11 m`.

`[O]` The gap is **stated, never judged**. Nothing here knows how long a break
was meant to be — the policy field that would say so is inert (§8) — and a
column that makes an accusation it cannot support is one people learn to
ignore. The owner reads the duration and decides.

**The Fix drawer is the day, not a form.** It lists the punches in order and
lets each be moved, marked wrong, or added to. `[O]` **"Wrong" is the word,
never a bin icon**: a manager in a hurry reads a bin as delete, and one who
believes the button destroys a punch forever will hesitate over a day that
genuinely needs correcting. A punch marked wrong is struck through and stays.

`[O]` **The preview never shows a bare number.** Marking a punch wrong without
replacing it leaves the day unpaired and the hours fall — correctly, but a
smaller figure alone reads as an answer rather than a warning. So it says
`7.8 h → 3.9 h · incomplete` and names the punch left hanging.

**The employee sees every punch of their own day**, superseded ones included.
"The manager changed my clock-in" is the dispute this record exists to settle,
and it cannot settle it by hiding the punch that was replaced.

## 7. Finding 12, riding along

`[O]` Agreed to travel with this piece rather than be fixed twice: every
figure on the **Monthly summary** — Worked, OT approved, OT pending — now
opens the month for that person. `[D]` `OT pending 4.0 h` with no way through
left walking the Timesheet backwards a day at a time as the only route.

## 8. Named and NOT fixed here

`[D]` **`payableMinutes` is still read by nothing.** `computeAttendance`
derives it from the policy's `unpaidBreakMinutes` and `breakAfterMinutes`, and
grep finds every use inside `attendance-hours.ts` itself. Both fields save,
display, and change nothing.

It stays that way on purpose. Making an inert setting live changes what people
are paid, and it belongs to the settings audit — piece 4 — where the owner
asked for *every* HR setting to be checked for whether the engine reads it.
The arithmetic here is simply correct for the day it is revived.

## 9. Gates

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | see the piece's commit trailer |
| API e2e | `npm run test:api:e2e` | |
| Web unit | `cd apps/web && npx vitest run` | |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | |

`[D]` Run **sequentially**. Running the four at once on this container turns a
green suite into a wall of five-second timeouts — measured in Piece 3e and
unchanged since.

Screenshots: `docs/screenshots/hr-punches/`.

## 10. Two probe errors of mine, reported because they are instructive

`[D]` While preparing the screenshots I inserted test punches straight into
the table as naive timestamps. Two things went wrong, neither in the code:

1. They were read as UTC, so 09:02 displayed as 17:02. The screen was right;
   my data was in the wrong zone.
2. They bypassed `recomputeDay`, so the record's summary stayed stale and the
   **Result** column read *"no clock-out"* for a complete four-punch day. The
   punches drew correctly because they come from the punch rows.

The second is worth keeping: it is exactly what happens when something writes
punches without recomputing the day, and it is why `recomputeDay` must stay
the only door.

`[D]` Separately, running `provision-app-role.mjs` against the dev database
rotated `kuwick_app`'s password and the API died with `28P01` — the trap this
repository's own runbook documents, walked into while doing something else.
Restored by re-provisioning with the password from `.env`. It is the reason
`hr-uat-seed.yml` must always pass the same secret.
