# HR restructure — Piece 3e: Attendance, Leave and Claims for the manager

The three screens a clinic manager works from every day, on the kit and shell
from 3a, after `attendance.html`, `leave.html` and `claims.html`. No Prisma
schema change: everything these screens show already exists, and what 3g added
(the selfie with a punch, the certificate with a leave request, the receipt's
bytes, the mileage rate) reaches HR here for the first time. `[D]` marks what
was read in the code or the database, `[A]` marks an assumption.

## 1. What changed

| Screen | Route | State after 3e |
|---|---|---|
| Attendance | `/admin/hr/attendance` | Rebuilt on `attendance.html`: four figures for the day, then Timesheet · Roster · Corrections · Monthly summary. The timesheet is **one day at a time**, everybody who was expected, with the selfie beside each punch and the rules in force along the bottom. |
| Roster | `/admin/hr/attendance/roster` | Unchanged, and reached from the Roster tab. `[D]` There is one shift board in the product, shared with the appointment calendar; it is not forked or repainted here. |
| Leave | `/admin/hr/leave` | Rebuilt on `leave.html`: four figures, Requests · Calendar · Balances, and the decision in a drawer with the balance after, who else is away, the certificate and what it does to payroll. |
| Claims | `/admin/hr/claims` | Rebuilt on `claims.html`: four figures, All · Waiting · Approved · Paid with a month filter, and the decision in a drawer with the receipt itself, the journey it was priced from, and Approve / Approve a different amount / Reject. |

Nothing was deleted. `LeaveCalendar` moved out of `LeavePage.tsx` into its own
file and onto the kit's own grid (`.hr-cal`), which is the last screen that
was still drawing itself with the product-wide palette inside HR.

### The three API additions, all additive

| Change | File | Why |
|---|---|---|
| A timesheet day carries `scheduledStart`, `scheduledEnd` and `earlyOutMinutes` | `attendance-record.service.ts` | The day sheet's *Shift* column and *Left N min early*. Both were on the record and neither reached the screen. |
| A leave request carries its `attachments` (id, name, type, size, path) | `leave-request.service.ts` | The MC the policy asked for, in the drawer where the decision is made. `[D]` 3g stored it and only the employee's own portal could see it. |
| A claim row carries `distanceKm`, `mileageRate` and each attachment's `filePath` | `staff-claim.service.ts` | *42 km × RM 0.60* in the drawer, and the receipt image itself. |

`AuthImage` moved from the portal into the kit (`admin/hr/ui/AuthImage.tsx`):
a stored file is fetched with the reader's own token and shown from a blob
URL, which is now how both the portal and HR read a selfie, a receipt or an
MC. Nobody's file is ever a bare URL.

## 2. Attendance

**The day is the unit.** "Who is late this morning" and "who never clocked out
yesterday" are the two questions the screen is opened for, and a month-long
list answers neither without arithmetic. The month is the fourth tab, for the
payroll conversation.

**The sheet is everybody expected, not everybody who punched.** A person who
was rostered and never clocked in has no attendance row at all, so a sheet
built from records alone cannot show the one thing it is for. Rows come from
three places and each row says which: the punches, the roster (`[D]` one
branch's, so those rows appear once a branch is chosen — the empty state says
so), and approved leave.

**On duty is not a missing punch.** Somebody who clocked in this morning and is
still on the floor has no clock-out. Counting them as missing turns every
normal day into an exception list, so the shift's end — or the end of the day
when nothing was rostered — is the line, and the row reads *On duty* until
then. `[A]` The mockup has no such case; it draws a finished day.

**What 3g put on the row.** The selfie kept with each punch, beside the time.
A gold *Outside clinic · 6.9 km* chip when the phone was further from the
branch than the radius allows — recorded, never refused, and the distance is
the furthest punch of that day. *Entered by HR* under the name when the punch
was made from this screen rather than by the employee.

**Overtime stays two numbers.** The day names what is waiting on a manager in
its own column, with the approval as the control (*Pending · approve*); the
month keeps *OT approved* and *OT pending* in two columns; and the footer says
in words that overtime nobody has approved is not paid. The rules in force are
read from the clinic's own policy and the footer links to where they are
changed.

**Fix** opens the correction drawer: the times, a required reason, and a note
that the original punch stays on the record with the approver's name against
it. On a row with no punch at all the same button records one, and says it
will be marked as entered by HR.

## 3. Leave

Four figures — waiting for a decision (with how long the oldest has waited),
away today, away in the next seven days, unpaid days this month and that they
feed payroll — then Requests, the Calendar, and Balances.

**The decision is made in a drawer, against the list it came from**, and
everything it turns on is in it: what was asked for, the days, when it was
applied for, the reason, the balance after (`[D]` the server's own balance
figures, minus the days this request would take), who else is away over the
same dates, the certificate if one was sent, and what the request does to
payroll (an unpaid day is a deduction in that month's run; a paid one is not).
A refusal carries its reason, and the employee sees it.

**The approver is the session, never a dropdown.** `[D]` This screen once had
a control headed *Approving/Rejecting as:* where a manager picked a colleague
to record as the approver, and the server wrote it down as fact with no
permission check. That has been gone since the earlier HR work; the drawer
inherits it.

*Record leave* is still here for leave asked for away from the portal. It
joins the queue like any other request rather than being approved on the spot.

## 4. Claims

Four figures — waiting (and what they add up to), approved but not yet paid
(and which payroll they ride), paid this year, and how much of the clinic's
medical benefit is used — then All · Waiting · Approved · Paid, a search, and
a month filter that offers the two months anything was claimed for.

**The decision is three answers at once** and the drawer asks them together:
how much (the claimed amount, or a different one), from where (with the
salary, or separately by Finance — the answer a duplicate payment turns on,
and not changeable once the money has moved), and why, when the answer is not
*all of it*. A note is required to reject **or to change the amount**.

**The receipt is in the drawer.** `[D]` Before 3g the clinic kept a receipt's
name and size and nothing else, so approving meant trusting a filename; the
bytes are stored now and read back with the manager's own token. A claim with
nothing attached says so.

**A mileage claim says what it was priced at** — the kilometres and the rate
frozen on the claim when it was sent — so a later change to the clinic's rate
cannot quietly rewrite what was approved.

A claim routed to Finance keeps its *Record as reimbursed* step, with
Finance's own reference, in the same drawer.

## 5. Where the result differs from the mockup, and why

| Mockup | Result | Why |
|---|---|---|
| Branch chips *Contoh Bandar · Contoh Central* | The same, plus *All branches* | The hub opens on all branches; a chip row that cannot say so would lie about what is on screen. |
| Leave head has both *Balances* and *Record leave* | *Record leave* only | Balances is a tab on the same page. Two doors to one place is the defect Settings has just finished removing. `[A]` Reported. |
| Timesheet *Result* as coloured text | The same, plus a chip for *Outside clinic*, *Corrected* and *Entered by HR* | Those are states, not results; the kit's chips are the vocabulary for a state. |
| Claims *Receipts · 1* | The same count, and the image itself in the drawer | 3g stores the bytes. |
| *Rules in force: 15-min grace · … rounded down to 0.5 h* | The clinic's own numbers, in minutes | `[D]` Rounding is stored in minutes; printing 15 minutes as *0.3 h* was worse than printing minutes. |
| Roster as a tab that draws the board | A tab that goes to the board | `[D]` One shift table, one component. Forking it is how two screens once wrote it with opposite models. |
| *Change in Settings →* | *Change in Settings* | No arrows in link copy. |

## 6. Tests

| Where | What |
|---|---|
| `e2e/hr-navigation.spec.ts` | The attendance views are the panel's four tabs, and Roster still goes to the one board with the rail staying on Attendance. Updated for the kit's tabs; the guarantee is unchanged. |
| `e2e/admin-hr.spec.ts` | Unapproved overtime is named as unpaid and is never merged with approved overtime — pinned where it now lives: the day's *OT status* column and the month's two columns. |
| `e2e/hr-workforce.spec.ts` | Untouched: the roster board, its filters and its branch question are the same component and the same route. |

## 7. Not in this piece

Reports (3f). QR and device clock-in. A claim's receipt as a PDF preview
rather than a download (`[D]` the drawer shows images; a PDF is named and
opened, not previewed).
