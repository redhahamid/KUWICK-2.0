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

`[D]` Run **sequentially**, on 2026-09-13, on this branch.

| Gate | Command | Result |
|---|---|---|
| API unit | `npm run test:api` | 131 suites, **2775 passed**, 0 failed |
| API e2e | `npm run test:api:e2e` | 41 suites, **470 passed**, 0 failed |
| Web unit | `cd apps/web && npx vitest run` | 100 files, **1728 passed**, 0 failed |
| Browser | `CHROME_PATH=/opt/pw-browsers/chromium npx playwright test` | 102 collected, **100 passed**, 0 failed, 2 skipped |

`[D]` `route-sweep.spec.ts:26` is one of the two skips in the first run —
observed, it is the last line of the run. `[A]` The other is
`golden-path.spec.ts:762` by elimination: it is the only remaining test whose
source skips on an unset variable (`E2E_DUMP`, and `route-sweep` wants
`E2E_SWEEP`), and the only other conditional skip in the suite,
`hr-workforce.spec.ts:104`, did not fire when I ran that file on its own. Both
env-gated tests call themselves tools rather than guardrails in their own
source.

`[D]` `canvas-appointment.spec.ts` — which failed during Pieces 3e and 3f — is
collected and passes here. I confirmed it is collected by listing the suite,
not by inferring it from the absence of a failure line.

`[D]` Run sequentially, never at once. Four at a time on this container turns a
green suite into a wall of five-second timeouts — measured in Piece 3e and
unchanged since.

`[D]` The two API gates ran at `bca4f10`, before the CSS fix below. That fix
touches one file, `apps/web/src/admin/hr/ui/slate.css`, which no API test
reads. The web and browser gates in the table were both run after it.

### 9.1 One red, and what it was really hiding

`[D]` The web gate first came back **1 failed of 1728**: `slateIsolation.test.tsx
> the Slate kit > declares its palette only on HR scopes, never on :root`,
listing eight leaked selectors, every one of them mine.

That guard strips `var(--hr-…)` reads and treats any `--hr-` that survives as a
declaration. My punch rules had written the reads with fallbacks —
`var(--hr-gold-ink, #8a6d1f)`, `var(--hr-muted, #6b7a83)`,
`var(--hr-line, #e6ebee)`, `var(--hr-red, #b4291f)` — and the strip does not
match a fallback, so all eight rules looked like declarations.

`[D]` Two of those four token names **do not exist in the kit**, and that is the
part worth keeping. The kit declares its palette on `.kw-hrSlate,
.kw-hrSlateHeader`, and every element that carries a punch class sits inside
that shell — the Fix drawer is plain JSX rather than a portal, and the employee
portal's own layout carries `.kw-hrSlate`. So:

| Written | What actually painted | What it should have been |
|---|---|---|
| `var(--hr-gold-ink, #8a6d1f)` | `#8a6d1f` — **no such token**, the fallback painted | `--hr-gold` `#b7791f` |
| `var(--hr-muted, #6b7a83)` | `#6b7a83` — **no such token**, the fallback painted | `--hr-ink3` `#8b979f` |
| `var(--hr-line, #e6ebee)` | `#e4e7eb` — the token resolved, fallback was dead code | `--hr-line`, as written |
| `var(--hr-red, #b4291f)` | `#c2362e` — the token resolved, fallback was dead code | `--hr-red`, as written |

So five rules were painted in two colours belonging to no palette:
`.hr-punchGap` and `.hr-punchPreview__warn` in a gold that is not the kit's, and
`.hr-punchRow__n`, `.hr-punchRow__meta` and `.hr-punchRow__wrong[disabled]` in a
grey that is not `--hr-ink3`. Nothing would ever have reported it on its own: a
`var()` with a fallback is silent when the name is wrong. Only the isolation
guard noticed, and for a different reason than the one that mattered.

`[D]` Fixed by using the kit's real tokens with no fallback, which is the house
style — no other rule in `slate.css` uses one. Before removing the fallbacks I
checked that nothing renders these classes outside `.kw-hrSlate`, since outside
it the rules would then have had no colour at all. Gate re-run green, 1728 of
1728.

`[A]` The screenshots in `docs/screenshots/hr-punches/` were taken before this
fix, so the away-gap line and the incomplete warning in them are a shade off the
gold that now ships, and three small labels a shade off the grey. Layout,
wording and every figure are unchanged. I did not re-take them: the dev world
would have to be rebuilt to do it, and the piece was accepted on what they show.
Say the word and I will.

### 9.2 The browser gate is not repeatable against one seeded world

`[D]` I ran the browser gate a second time, on the fixed CSS, to leave no
caveat in the table. It came back **99 passed, 3 skipped** where the first run
was **100 passed, 2 skipped**. Same 102 collected, zero failures both times —
but a test that passed had skipped itself.

`[D]` It is `admin-integration.spec.ts:153` — *Day-end closing, end to end ›
counting short forces an explanation, and closing freezes the day*. It reads
the day-end STATUS off the screen and, if it is not `Open`, calls
`test.skip(true, 'today is already counted or closed — re-run the admin UAT
seed')` on itself. **The first run closed the day.** That is the thing the test
exists to prove, and having proved it the world no longer offers an open day to
close.

So the gate is green twice, and the second run is a weaker green than the
first. This is not Piece 1's doing — it reproduces on master, on any second
consecutive run without re-seeding — and the test says so in its own skip
message. `[A]` The table above reports the FIRST run, where the day-end test
actually ran.

`[A]` Worth a piece of its own later, not this one: a guard that skips itself
into silence is indistinguishable from a guard that passed, and on a re-run
that is the report you get.

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
