# Four real July 2026 payslips against Kuwick, to the sen

`[O]` The account holder supplied four of his clinic's own July 2026 payslips
with the names replaced by neutral labels, and asked for Kuwick's arithmetic to
be checked against them before he starts UAT. Report only; nothing was changed.

`[D]` read in the code or measured · `[A]` assumption · `[O]` the owner's words

**How this was produced.** Four employees labelled `BANDING A`–`D` in their own
clinic, "BANDING (perbandingan Julai 2026)", inside `Klinik Contoh (UAT)`. The
July run contains only them; his twelve existing test employees are in Contoh
Central, were not touched, not included and not recalculated. Every earning was
entered as a payroll input rather than derived from attendance, so what is under
test is the statutory arithmetic on a known set of earnings. The run was driven
through the API, so every figure below is the product's own.

---

## The scoreboard

| | A | B | C | D |
|---|---|---|---|---|
| Gross | ✅ | ✅ | ✅ | ✅ |
| EPF employee | ✅ | ✅ | ✅ | ✅ |
| EPF employer | ✅ | ✅ | ✅ | ✅ |
| SOCSO | ❌ | ❌ | ✅ | ✅ |
| EIS | ❌ | ❌ | ✅ | ✅ |
| SKBBK | n/a | ❌ | n/a | ✅ |
| PCB | ✅ | ✅ | ⚠️ | ⚠️ |

**Every EPF figure matches exactly, on all four.** 205.00/242.00 · 231.00/273.00
· 1,078.00/1,176.00 · 935.00/1,020.00. The Third Schedule bands and the clinic's
"EPF on basic only" policy reproduce his payslips to the sen.

---

## 1. `[D]` SOCSO, EIS and SKBBK: a different wage, not a different table

Kuwick's figures and his differ on A and B only, and by a few ringgit:

| | His | Kuwick | Difference |
|---|---|---|---|
| A SOCSO employee | 10.75 | 11.75 | +1.00 |
| A SOCSO employer | 37.65 | 41.15 | +3.50 |
| A EIS each side | 4.30 | 4.70 | +0.40 |
| B SOCSO employee | 10.25 | 10.75 | +0.50 |
| B SOCSO employer | 35.85 | 37.65 | +1.80 |
| B EIS each side | 4.10 | 4.30 | +0.20 |
| B SKBBK | 15.35 | 16.15 | +0.80 |

`[D]` **The cause is which earnings enter the contribution wage, not the table.**
Solving backwards from his figures:

* **A** — his figures fall in the RM2,100.01–2,200 band. The full RM2,391.58
  would be the RM2,300.01–2,400 band. So his payroll **left the RM214.00
  commission out** of the SOCSO wage. (Three bases land in that same band, so A
  alone cannot say whether the RM50 attendance allowance is in or out.)
* **B** — his figures are the RM2,000.01–2,100 band, which is basic alone. So
  his payroll **left the RM100.00 allowance out** too.

`[D]` Kuwick puts both in, because `COMMISSION` and `ALLOWANCE` ship
`socsoLiable: true` in the component catalogue.

`[A]` **On the face of it his old payroll under-contributes.** PERKESO's
definition of wages takes in commissions and allowances, with named exclusions —
travelling allowance and the like. An attendance allowance is not a travelling
allowance. But which allowance his "Allowance" line actually is decides the
answer, and I am not the authority on that; PERKESO is.

**To make Kuwick match his old payroll:** Payroll items → set `socsoLiable`,
`eisLiable` off on `COMMISSION` and `ALLOWANCE`, with a reason and a date.
**That is his decision and I would not take it without advice** — it lowers a
statutory contribution, and the difference is small enough that the cost of
being wrong is larger than the saving.

---

## 2. `[D]` PCB: Kuwick's method agrees with his payroll. The gap was my missing history.

| | His July | Kuwick, no prior months | Kuwick, with six prior months |
|---|---|---|---|
| C | 4,005.25 | 2,392.80 | **3,921.85** |
| D | 1,552.80 | 468.05 | **1,546.90** |

The MTD method is cumulative. The seeded employees had no January–June, so
Kuwick computed July as the first month of the year. Feeding in six prior months
closed almost all of it.

`[D]` **The residual is arithmetic, not disagreement.** July's tax moves one
ringgit for every ringgit the earlier months did not pay. Solving for the
history that lands exactly on his payslip:

* **C** — exact at 4,005.25 when January–June each paid **3,921.85**
* **D** — exact at 1,552.80 when January–June each paid **1,546.90**

Those are ordinary figures, and they are within RM83 and RM6 of what I guessed.
`[A]` I invented January–June by repeating July, which is the one thing they
certainly were not — his procedure incentives, commission and locum vary. **PCB
cannot be reconciled without his real January–June figures**, and nothing here
suggests it needs to be.

`[D]` **Ruled out as a cause:** whether procedure incentives are treated as
additional remuneration moves PCB by **10 sen**. Not the explanation.

**What he must do before comparing PCB:** import the real January–June
year-to-date (Settings → Opening balances). Without it every mid-year comparison
is meaningless, not wrong.

---

## 3. `[D]` SKBBK — his diagnosis was right about the shape, wrong about the table

`[O]` "Kuwick sekarang salah: ia melayan Lindung 24 Jam sebagai potongan
berasingan yang ditanggung pekerja, sedangkan ia sebenarnya lajur ketiga dalam
jadual caruman PERKESO yang sama dengan SOCSO… semak jadual PERKESO yang Kuwick
guna sekarang — sama ada ia jadual lama (dua lajur) atau jadual baharu."

`[D]` **Kuwick already holds the new table**, and it was built from the very PDF
he attached. `src/statutory/socso-act4.ts` names the source in its header, and
the top band is `[600000, null, 10415, 2975, 4465, 7440, 4465]` — employer
104.15, invalidity 29.75, non-employment injury 44.65, exactly his BANDING C and
D. `lindungContribution` reads column 4 of that same table, not a percentage.
The 65 bands carry both categories, and the two non-employment-injury columns
are identical in every one of them.

**So the figures are right and the old table is not the cause.** But the
structural point holds, and two real defects sit behind it:

### `[D]` 3a. The default is inverted — the one that moves money

`[O]` "SKBBK ialah opt-in secara lalai. Setiap pekerja dicarum secara automatik
melainkan dia memilih keluar melalui borang PERKESO."

`[D]` Kuwick says the opposite. `lindung-24-jam.ts` returns `NOT_ELIGIBLE` with
"This employee has not joined LINDUNG 24 JAM. **It is voluntary for local
employees**", and an unrecorded participation is `CANNOT_DETERMINE`. So Kuwick's
polarity is off: it assumes out until told in, where the scheme assumes in until
told out.

**What that costs:** every employee nobody has explicitly enrolled contributes
nothing, and on his own payslips **A and C have no SKBBK line at all** — A would
be RM16.15 and C RM44.65 a month. If they have not filed opt-out forms, his old
payroll is under-deducting them, and Kuwick as it stands would reproduce that
silently rather than catch it.

**What he asked for:** a per-employee switch, default ON, turned off for anyone
who opted out — the same shape as the EPF 9%/11% election already on the
employee's Statutory tab. Not built.

### `[D]` 3b. The code contradicts itself about what SKBBK is

Two files state opposite things:

* `socso-act4.ts` — "Act 4 contributions, **including** the Non-Employment
  Injury Scheme… the document prints them in separate columns", and warns that
  "an implementation carrying *second category means the employee pays nothing*
  is now wrong."
* `statutory.ts` — "LINDUNG 24 JAM (SKBBK) — **a scheme of its own, not a column
  of Act 4**", and for age 60+ prints "Second Category — Employment Injury only.
  **No employee share under Act 4.**"

`[D]` The second file says precisely what the first warns against. The **money**
is still right for a 60+ employee, because the separate SKBBK path picks up the
non-employment-injury figure and the two categories' columns are identical — but
the payslip note tells the employee something untrue, and the next person to
read `statutory.ts` will believe it.

---

## `[D]` 4. Not differences, but check them

* **HRD levy** — Kuwick computed RM18.50 / 22.00 / 97.50 / 85.00. His payslips
  show none, correctly: it is employer cost, not a payslip line. But it is
  computed because `Klinik Contoh Sdn Bhd` is recorded `MANDATORY_SECTION_14` in
  the UAT world. Worth confirming his real clinic is registered.
* **Locum and BOD fee** — `LOCUM_FEE` and `DIRECTOR_FEE` ship EPF, SOCSO and EIS
  off and PCB on, which is exactly how his payslips treat them. No difference.

---

## `[A]` What I left in his UAT world, and should probably take out

To diagnose PCB I imported **invented** January–June 2026 year-to-date for the
four BANDING employees — his July figures repeated six times. It is labelled as
such in its source note, but it is fabricated money sitting in his UAT tenant,
and it will make any later comparison on those four wrong. **Say the word and I
will delete it**, or replace it with his real January–June.

The four employees, their clinic and the July run are real seed data and are
meant to stay.

---

# CORRECTED — the month was wrong, and the history is now real

`[O]` Two corrections from the account holder: **the four payslips are AUGUST
2026, not July** (the clinic pays BOD fee, locum and overtime a month in
arrears, so "BOD FEE JULY" is July's work paid in the August wages), and
**BANDING A and C had genuinely opted out of SKBBK**, so his payslips were right
about them. He then supplied BANDING C's real January–July 2026.

The seed was moved to August and C's invented history replaced. Everything below
supersedes the July figures above.

## `[D]` August 2026, against his payslips

| | His August | Kuwick | Difference |
|---|---|---|---|
| **A** gross | 2,391.58 | 2,391.58 | — |
| A EPF employee / employer | 205.00 / 242.00 | 205.00 / 242.00 | — |
| A SOCSO employee | 10.75 | 11.75 | **+1.00** |
| A EIS | 4.30 | 4.70 | **+0.40** |
| A SKBBK | none | none | — |
| A net | 2,171.53 | 2,170.13 | **−1.40** |
| **B** gross | 2,200.00 | 2,200.00 | — |
| B EPF employee / employer | 231.00 / 273.00 | 231.00 / 273.00 | — |
| B SOCSO employee | 10.25 | 10.75 | **+0.50** |
| B EIS | 4.10 | 4.30 | **+0.20** |
| B SKBBK | 15.35 | 16.15 | **+0.80** |
| B net | 1,939.30 | 1,937.80 | **−1.50** |
| **C** gross | 22,137.69 | 22,137.69 | — |
| C EPF employee / employer | 1,078.00 / 1,176.00 | 1,078.00 / 1,176.00 | — |
| C SOCSO employee | 29.75 | 29.75 | — |
| C EIS | 11.90 | 11.90 | — |
| C SKBBK | none | none | — |
| **C PCB** | **4,005.25** | **3,930.20** | **−75.05** |
| C net | 17,012.79 | 17,087.84 | +75.05 |

`[D]` **BANDING D is not comparable.** Only C's history was replaced; A, B and D
still carry the six invented months. A and B pay no PCB either way so their rows
stand, but D's PCB of 1,232.20 means nothing — ignore it.

## `[D]` The June SOCSO of RM74.40 is not an error

`[O]` "SOCSO Jun ialah 74.40, bukan 29.75 seperti bulan lain. Saya tidak tahu
kenapa."

`[D]` **RM29.75 + RM44.65 = RM74.40** — exactly the First Category *employee
total* from the PERKESO table he supplied: invalidity plus non-employment
injury. SKBBK came into force on **1 June 2026**. So June is the scheme's first
month, C was auto-enrolled, the payroll printed the two employee columns as one
combined figure, and C then filed the opt-out — which is why July and August
show RM29.75 alone.

`[A]` Nothing to correct. And it is evidence for his own point: **his old
payroll auto-enrolled, which is the behaviour Kuwick lacks.** The one thing
worth checking is whether June's RM44.65 was actually remitted to PERKESO, since
C later opted out.

## `[D]` The remaining RM75.05 on C, and what it is not

Kuwick prints its whole MTD working, so the figure is auditable:

```
P (chargeable income for the year)  223,386.47
M / rate / B                        100,000 · 25% · 9,400
n (months after August)             4
relief                              9,000 individual
EPF relief                          4,000, fully consumed by January-July
year tax / year MTD                 40,746.61 / 40,246.70
```

`[D]` Ruled out as the cause:

* **The incentive treatment.** Procedure incentives as additional remuneration
  versus normal monthly pay moves August by **5 sen**.
* **EPF relief.** Capped at RM4,000 for the year and entirely used by January–
  July (7 × 1,078 = 7,546), which is what the specification requires.
* **The other contributions.** EPF, SOCSO and EIS are exact on all four.

`[A]` **What I cannot determine is his payroll's own working.** The MTD method
needs an estimate of the REMAINING months' remuneration, and LHDN's
specification leaves that estimate to the employer. Kuwick projects September to
December at August's normal remuneration (RM20,137.69 a month). A payroll that
projects differently — at the year's average, at basic only, at full gross —
lands on a different figure, and more than one of those is defensible.

**To settle it I need one of:** the PCB working printed on his August payslip,
or the rule his payroll uses to project the remaining months. Until then the
honest statement is that Kuwick is within **RM75.05, or 1.9%**, of his figure on
a month where every other line agrees exactly.

## `[A]` Still fabricated in his UAT tenant

The six invented months for **A, B and D** remain. C's are now real. Say the
word and I will clear A, B and D, or replace them with their real history.
