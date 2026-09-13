# Piece 1b — three findings from the owner's own staging test

Piece 1 went to staging and the owner tested it as a person, not as a spec:
four punches through the employee portal, then the timesheet, the Fix drawer
and the Monthly summary. The punch model held. Three things around it did not.

`[D]` marks what was read in the code or the database, `[A]` an assumption,
`[O]` an owner decision.

## 1. What was found

| # | Finding | Where it came from |
|---|---|---|
| 1 | Monthly summary figures did nothing when pressed | **Piece 1 shipped half a fix** |
| 2 | The same day read `0.03 h` in the portal and `0.0 h` to the owner | Two formatters, grown separately |
| 3 | The punch selfie could not be opened | Never built, on four surfaces |

## 2. Finding 1 — a link that went nowhere

`[D]` Piece 1 answered UAT finding 12 by turning every figure on the Monthly
summary into a `<Link>` to `/admin/hr/attendance?staffId=…&month=…`, and
stopped there. **That route is the attendance page itself.** React Router
changed the URL; the component stayed mounted with its tab, its day and its
month in local state; the page never read `staffId` at all. Nothing moved.

`[O]` This is worse than the dead end it replaced. A plain figure tells the
owner to go and look for themselves. A figure that is underlined, changes the
cursor, and then does nothing tells them the product is broken — and they are
right.

`[D]` Fixed by making the destination exist. `TimesheetPage` now reads
`staffId` and `month` off the URL, and with a person in it the summary shows
**that person's month, day by day**: the punches of each day, what the day
came to, and the overtime decision on the day it belongs to rather than back
on the day sheet. Each day is a link into the day sheet for that date, so the
path from a month's figure to a single day's Fix drawer is now whole.

`[D]` Pressing any tab leaves the person behind. Without that, pressing
**Monthly summary** while looking at one person returns to that same person,
and the tab appears not to work — the same complaint, one screen along.

`[A]` I did **not** put a Fix button in the person's month. Fix reads the
day's roster, and the month sheet does not carry one; a drawer that opened
with "no shift" on every day would be a second half-built thing. The day link
goes to the day sheet, where Fix has what it needs.

`[A]` A person's month has **no month stepper of its own**. The month is
chosen on the summary, where people are compared against each other, and the
person's month is a drill-down of that choice; *Back to everybody* returns to
the summary with the same month still selected, where another month — or
another person — is one press away. Adding a second month control inside the
drill-down would mean two places to change the same thing. Say so if you would
rather step months without going back.

`[D]` One rule moved rather than being copied. *Still on the floor* — clocked
in, not out, and the shift has not ended, today — decides whether a day reads
**On duty** or **no clock-out**, and the person's month needs it as much as the
day sheet does. Writing it a second time would have meant two rules drifting
apart, so it is now one function both views call. A day still being worked
reads *On duty* in a person's month too, rather than being accused of a
missing punch.

## 3. Finding 2 — which figure is right

`[D]` The same two-minute day read `0.03 h` in the employee's portal and
`0.0 h` on the owner's timesheet. Two screens, two private formatters:
`toFixed(2)` in `MyAttendancePage`, `toFixed(1)` in `TimesheetPage`.

**Neither figure is paid on.** `[D]` `overtime-pricing.ts:179` computes from
`day.workedMinutes` at full precision. Nothing on either screen reaches the
engine, so this was never a money defect — it was a trust defect, which is the
one the owner actually raised.

`[D]` Which is correct: **one decimal**. It is what payroll uses everywhere —
the register grid, the employee payroll page, the payslip lines — so a month
reading `88.0 h` to the owner and `88.00 h` to the employee invites a question
with no good answer. The portal was the outlier, in one line of one file.

`[O]` But one decimal was not correct for the owner's test day either.
**`0.0 h` beside two visible punch pairs says nobody worked**, and it says it
in the direction that loses somebody's time. So the shared formatter reports
hours to one decimal, and gives the figure in minutes when one decimal cannot
carry it — `2 min`, not `0.0 h`. Minutes are already this screen's unit for
lateness and for the away gap between pairs.

`[D]` The threshold is not written down. The formatter asks whether its own
one-decimal output came to zero, so the two can never disagree.

`[D]` One further thing fixed on the way: the Monthly summary was reading the
API's `workedHours`, which `hoursOf` has **already** rounded to two decimals,
and rounding it again to one. It now reads `workedMinutes` from the same
payload, so nothing is rounded twice.

## 4. Finding 3 — a thumbnail that could not be opened

`[D]` The punch selfie is 28 pixels square with `object-fit: cover`, so it is
a **crop of a face**, and the owner is asked to satisfy themselves it is the
right person. That cannot be done at that size. Pressing it did nothing.

`[D]` It was never only the punch selfie. Every image in HR is the same
component, and none of them could be opened: claim receipts, leave
attachments and medical certificates, and the employee's own copies in the
portal. Fixing `AuthImage` fixes all four surfaces, which is why the fix is
there and not in the Punches strip.

`[D]` The thumbnail is now a real button — so the keyboard reaches it — and
opens the whole image, `object-fit: contain`, because the crop is what sent
the owner looking in the first place. Escape closes it, the close button takes
focus when it opens, and the area around the image closes it on a press.

`[D]` **No new access.** The larger view shows the bytes already fetched for
the thumbnail, through the same `/workforce/staff-files/<id>` route and the
same signed-in token. No second request, no new endpoint, and nobody can see
an image they could not already see — it was only ever too small to read.

`[D]` It opens **through a portal**, unlike the kit's Drawer, for two reasons
that are in the stylesheet rather than in a preference: `.hr-card` sets
`overflow: hidden`, which clips an overlay rendered inside it, and
`.hr-card:hover` sets a transform, which makes the card the containing block
for `position: fixed` for as long as the pointer rests on it. The portal root
carries `kw-hrSlate` so the kit's palette still resolves — the lesson from
Piece 1's own CSS defect, applied deliberately this time.

`[D]` The first version had two controls whose accessible name was "Close" —
the visible button and the area around the image. A test caught it. The area
around the image is now hidden from the accessibility tree: it does exactly
what the button does, and two identical "Close" buttons is a worse screen for
anyone listening to it.

## 5. Tests

| File | What it holds |
|---|---|
| `apps/web/src/admin/hr/ui/duration.test.ts` | One decimal like payroll; `2 min` rather than `0.0 h`; the switch-over asked of the formatter, not hardcoded |
| `apps/web/src/admin/hr/ui/authImage.test.tsx` | The thumbnail is a button; it opens the same bytes, not a second fetch; Escape and the area around it close it; exactly one control named Close |
| `apps/web/src/admin/hr/attendanceFocus.test.tsx` | Arriving with a `staffId` shows one person and not the others; the days are listed; overtime is approved from there; the way back; a tab press leaves the person |

## 6. Not done here

`[D]` `npm run lint` fails in this repository with *ESLint couldn't find an
eslint.config.js* — there is no ESLint configuration anywhere in the tree. It
is pre-existing and unrelated to this change; the four gates do not include
it. Naming it rather than quietly stepping over it.
