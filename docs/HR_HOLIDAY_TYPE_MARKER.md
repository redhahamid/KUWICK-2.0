# Can the Public holidays list carry a type marker?

Asked before building, because a clinic wanting Raya Puasa and Raya Haji priced
differently from an ordinary public holiday needs the calendar to know which is
which.

**Short answer: no, not today. It would need a migration.** Nothing was built
for this. What follows is what exists and what a marker would cost.

---

## What the list holds now — `[D]` observed in the schema and the code

`[D]` `apps/api/prisma/schema.prisma`, model `PublicHoliday` (mapped to the
`public_holidays` table) has exactly five columns:

| Column | Type | What it is |
| --- | --- | --- |
| `id` | uuid | |
| `tenant_id` | uuid | tenant-wide, not per clinic |
| `date` | date | unique per tenant |
| `name` | text | free text: "Hari Raya Aidilfitri", "Hari Kebangsaan" |
| `created_at` | timestamp | |

`[D]` There is **no** `type`, `kind`, `category`, `tier` or `rate` column.

`[D]` `apps/api/src/hr/dto/create-public-holiday.dto.ts` accepts `date` and
`name` and nothing else. `[D]` `apps/api/src/hr/public-holiday.service.ts`
stores those two and reads the list back ordered by date.

`[D]` The payroll engine uses the calendar as a **set of dates**, never as a set
of records: `apps/api/src/workforce/overtime-pricing.ts` `classifyDay()` takes
`publicHolidayDates: ReadonlySet<string>` and answers `PUBLIC_HOLIDAY`,
`REST_DAY` or `NORMAL_DAY`. Every public holiday is therefore priced identically
by construction — the engine cannot currently tell one from another even if the
name says Raya, because the name never reaches it.

`[A]` Matching on the `name` text would be the only way to do it without a
migration, and it should not be done: the name is free text a clinic types, it
is not unique across years, and "Hari Raya Aidilfitri" versus "Hari Raya
Aidilfitri (Hari Kedua)" versus a Malay/English spelling would silently change
somebody's pay. A rate must not depend on a spelling.

## What a marker would need

Three things, in this order:

1. **A migration** adding a column to `public_holidays`. The honest shape is not
   a fixed `RAYA | ORDINARY` enum — the clinic that asked for Raya at 3× is one
   clinic, and the next one will want Deepavali or Thaipusam or Chinese New Year
   on its own rate. A nullable free **tier** the clinic names once and then
   assigns to dates (`NULL` = ordinary) covers every clinic without the product
   deciding which holidays are special. That is one column on
   `public_holidays`, plus somewhere to hold the tier's rate.

2. **Somewhere to hold the tier's multiplier.** A rule set holds one
   public-holiday multiplier today (see `payroll_policies`). Per-tier rates mean
   either a small table of `(policy, tier) -> multiplier`, or a JSON column on
   the rule set. A table is the right shape; JSON would put money in a field
   nothing can constrain.

3. **The screen.** Public holidays would gain a tier column and a way to set one
   when adding a date; the rule set drawer would list a multiplier per tier
   instead of one.

`[A]` Estimate: one migration, two new API surfaces (tier CRUD, tier on the
holiday), one engine change (`classifyDay` returning the tier as well as the
kind), two screens. Bigger than either piece delivered today, and it needs a
decision on point 1 before any of it is worth writing.

## What was built instead, and what it does not cover

The clinic can now set **one** public-holiday multiplier per rule set, applied
to every public holiday alike. So:

* "all public holidays at 3×" — **works today**, one figure on the rule set.
* "Raya at 3×, ordinary public holidays at 2×" — **does not work today**, and
  is what the marker above is for.

`[D]` A second, separate point on that example. The Act's floor on the
public-holiday **multiplier** is 3× — s.60D(3)(aa) — and that multiplier applies
to the hours **beyond normal hours**. A request for "ordinary public holidays at
2×" will therefore be refused as below the Act if it means the multiplier.

`[A]` It may not mean the multiplier. s.60D(3)(a)(i) pays the **day itself** on
a public holiday worked at **two days' wages**, "regardless that the period of
work done on that day is less than the normal hours of work" — so 2× is already
the Act's figure for the day, and 3× for the day would be paying above it. If
what is wanted is three days' wages for Raya and the Act's two for an ordinary
holiday, that is the **day** figure, not the hour figure, and it is a fourth
settable number this piece did not add. It needs saying which one is meant
before it is built, because the two are different money on the same payslip.
