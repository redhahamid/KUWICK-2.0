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

`[D]` **That last sentence turned out to be wrong, and the answers are why.**
Valuing the days needed no migration. The account holder's added requirement —
that the clinic may choose not to pay it, on the record — needed four columns on
`leave_policies`, because a decision with a name and a date on it has to be
stored somewhere. The migration is `20260916140000_untaken_leave_payout_choice`.


---

# ANSWERED — the account holder's decision, 16 September 2026

`[O]` All four checked against the Act's own text before answering, and one
requirement added that none of the four asked about.

## `[O]` 1. Does s.60E(3) reach a resignation? **Yes.**

> "s.60E(3) TERPAKAI untuk peletakan jawatan juga… 'mana-mana pihak', jadi
> termasuk staf berhenti sendiri. s.60E(2A) juga bercakap tentang 'penamatan
> kontrak perkhidmatan' tanpa membezakan siapa yang menamatkan. Jadi ini
> kewajipan berkanun, bukan amalan syarikat."

**Either party.** The section does not distinguish who ends the contract, so a
clinic whose staff all resign is inside it, not outside it. This is the answer
the whole piece turns on: it moves untaken leave from a company benefit the
clinic may grant to a statutory debt the clinic may only decline on the record.

## `[O]` 2. Are carried-forward days worth the same? **Yes, on exit.**

> "Akta senyap… Dasar klinik saya: 3 hari sahaja boleh dibawa ke tahun depan
> sebagai cuti (bukan dibayar), lebihnya hangus di hujung tahun. Tetapi apabila
> staf berhenti, 3 hari itu sudah jadi sebahagian bakinya, jadi ia dinilai sama
> seperti kelayakan tahun semasa."

`[D]` The Act imposes no carry-forward and caps none; the cap and the lapsing
are clinic policy, which is why `carryForwardDays` is a clinic field. But once a
day is in the balance it is a day of paid annual leave the employee is entitled
to and has not taken, which is the only test s.60E(3) applies. So the engine
values `carriedIn` at the same rate as the current year's days, and the code
says why at the line that does it.

## `[O]` 3. How is an incomplete final year pro-rated? **By complete months, with a prescribed rounding.**

> "pekerja yang belum genap 12 bulan perkhidmatan berterusan pada tahun
> kontraknya tamat berhak kepada cuti tahunan secara prorata mengikut bulan
> lengkap yang telah bekerja. Pecahan kurang setengah hari diabaikan, lebih
> setengah hari dibundarkan naik ke satu hari penuh. Kadar biasa = gaji bulanan
> ÷ 26, atau kadar lebih murah hati kalau majikan pilih."

`[D]` Implemented as `proRatedAnnualLeaveOnExit` and `completeMonthsWorkedInYear`
in `apps/api/src/statutory/employment-act.ts`, pinned by six tests.

`[A]` **One case his wording does not cover, and it is flagged in the code
rather than hidden:** "less than half is disregarded, more than half rounds up"
says nothing about a fraction that is EXACTLY half. It is rounded **up**,
because the Act sets minimums and the employee is the one the minimum protects.
That is an assumption, not a reading.

`[D]` **Kuwick's own pro-rating is not replaced by it.** `proRateEntitlement`
divides by calendar days to the nearest half day and is what the Leave screen
has always shown. The two are compared and the employee gets the better of them
— usually Kuwick's, but not always: sixteen days over five complete months is
6.5 by calendar days and 7 under the Act.

## `[O]` 4. Is notice pay part of this? **No — out of scope for now.**

> "Bayaran notis — keluar daripada skop buat masa ini."

## `[O]` ADDED — the employer's option not to pay

> "Amalan klinik saya sekarang ialah tidak membayar cuti yang tidak habis. Saya
> mahu Kuwick benarkan majikan memilih antara BAYAR dan TIDAK BAYAR, tetapi ikut
> corak yang sama seperti pengganda di bawah Akta… Lalai produk ialah BAYAR,
> kerana itu yang Akta kata."

`[D]` Built to the six conditions he set, in the same shape as the below-Act
multipliers:

| What he asked for | Where it is |
| --- | --- |
| "Tidak bayar" saved, not refused | `LeavePolicy.payUntakenLeaveOnExit`, default `true` |
| A clear warning before Save naming s.60E(3), that it is statutory, and that it reaches resignation | the notice in `LeavePolicyPanel`, and the server's own refusal message |
| Active confirmation — a tick and a written reason | `notPayingAcknowledged` + `notPayingReason`, both required together |
| Who chose and when, recorded | `notPayingAcknowledgedByStaffId`, `notPayingAcknowledgedAt` |
| A permanent mark on screen | the gold "Below the Act: not paid out" chip, with the name, the date and the reason under it |
| Product default is PAY | the column default, and the DTO leaves it alone unless asked |

## `[D]` What this piece could NOT settle, and did not guess

**What a leave payout attracts for EPF, SOCSO, EIS and PCB.** That is a fresh
statutory question about each scheme's definition of wages, and nobody has
answered it. So the run **names the amount and does not add a pay line**:
`LEAVER_LEAVE_PAYOUT_DUE` prints the days, the daily rate and the total, and
says to record it as a payroll input under the component whose treatment the
clinic has established. A guessed treatment would file wrong figures with four
agencies and look right on the payslip.
