# The leaver's settlement — what is built, and the four things I will not guess

`[D]` observed in the code. `[A]` my assumption. `[O]` the account holder's
decision.

## `[D]` What is built and working

**The last month is already prorated, and always was.** `prorationFor` in
`apps/api/src/workforce/proration.ts` cuts a leaver's month to the days actually
served, inclusive of the last day worked, and `proratedBasicCents` applies it on
every regular run. Somebody leaving on 15 August of a 31-day month on RM2,600 is
paid RM1,258.06. That was never the gap, and it is pinned by
`payroll-leaver-settlement.e2e-spec.ts`.

**The gap was that nothing said the untaken leave is owed.** A leaver stopped
appearing, the month footed correctly without them, and the payout was
remembered or it was not. `LEAVER_UNTAKEN_LEAVE` now fires once, on the month
containing the last day, naming the person and printing the whole ledger —
entitled, carried in, adjusted, taken, left — and **blocks** the run. It is
overridable, because the override is the record of what was paid.

**The days are certain. The money is not, and is not computed.**

## `[O]` Termination benefits are out of scope

Employment (Termination and Lay-Off Benefits) Regulations 1980 — excluded by the
account holder: his staff resign, and the benefit applies to termination by the
employer. To be revisited if that changes.

## The four questions, for checking against another source

`[A]` Everything in this section is my reading and none of it is relied on by
any code. I have written what I believe and what I am unsure of separately, so
a second source can correct either.

### 1. Does s.60E(3) reach a RESIGNATION, or only termination by the employer?

`[A]` My reading is that s.60E(3) obliges the employer to pay the ordinary rate
of pay for each day of untaken annual leave where the employment **terminates**,
and that "terminates" is not obviously restricted to employer-initiated
termination — but I am not certain, and the distinction decides whether Kuwick
should treat the payout as a statutory obligation or as a company practice.

**Why it matters here:** a statutory obligation should block and be computed. A
company practice should be offered and left to the clinic. Today it blocks and
is not computed, which is the safe position for either answer.

### 2. Are days CARRIED FORWARD worth the same as the current year's entitlement?

`[D]` `LeaveBalance` keeps them apart: `entitledDays` is the year's own
entitlement, `carriedInDays` is what crossed from last year under the clinic's
`carryForwardDays` cap. `computeLeaveBalance` returns both, and the exception
prints both.

`[A]` The Act confers the entitlement; carrying days forward is a clinic policy
the Act does not require. So a defensible reading is that s.60E(3) values the
untaken part of **this year's entitlement**, and carried days are valued by
whatever the clinic promised. Another defensible reading is that once carried,
a day is a day.

**Why it matters here:** it changes the figure. In the e2e fixture — 12
entitled, 3 taken, 9 left — the two readings agree because nothing was carried.
A real leaver with 5 carried days is where they diverge.

### 3. Is the final year's entitlement pro-rated, and how does it round?

`[D]` The product already pro-rates: `proRateEntitlement` reduces the year's
entitlement for somebody who joined or left mid-year, **rounded to the nearest
half day**, and it is applied only when the leave policy has `proRateOnJoin` set.

`[A]` I believe the Act contemplates a proportionate entitlement for an
incomplete year of service, but I do not know whether the rounding — half a day,
up, or down — is prescribed or left to the employer. Half-day rounding is what
the code already does and was not chosen against any source I can cite.

**Why it matters here:** rounding one way or the other on every leaver is small
each time and permanent.

### 4. Is notice pay part of this settlement?

`[D]` The existing `FINAL_PAY` refusal names **two** unmodelled things: accrued
annual leave *and* notice pay. `[O]` The account holder's scope named only the
prorated month and the untaken leave.

`[A]` On a resignation, notice runs the other way: an employee who leaves
without giving the contractual notice may owe the employer pay in lieu, rather
than the other way round. That makes it a deduction question, not a payout
question, and a different conversation.

**Not built, not raised, not assumed.** Flagged because the code already says it
is missing and the scope did not mention it.

## `[D]` What happens when these are answered

The exception already carries every figure the answer needs. Valuing the days is
one function against the ordinary rate of pay, which the engine already computes
(`ordinaryRateOfPayCents`, s.60I(1A), monthly wages over 26). No migration, no
new data — the ledger and the rate both exist.
