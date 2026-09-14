# Piece 3 — the clinic manager, and a permission that was two jobs

UAT finding 2. `[D]` marks what was read in the code or the database, `[A]` an
assumption, `[O]` an owner decision.

## 1. What the owner found

`[D]` The clinic manager could not press **Approve** on a leave request. Six
things were behind it, and only the first is the one that shows:

1. `CUSTOM_ROLE_GRANTABLE` held **no `hr.*` at all**, so a clinic composing its
   own role could not give it any HR ability.
2. The Roles screen had **no HR group** — three groups, none of them people.
3. `StaffAccessDrawer.tsx` exists and is **never rendered**.
4. The Roles copy points at `/admin/hr/access`, which redirects back to Roles.
5. `ClaimsPage` had **no permission check**, so Approve looked live and failed
   at the server after the press.
6. The seed gave Rohana Yusof `HR_STAFF` while its own console output said she
   approved leave, claims and overtime — **it contradicted its own
   documentation.**

`[O]` The decision: split `hr.claim.approve` from `hr.payroll.approve`; add a
built-in **CLINIC_MANAGER** role covering leave, claims, overtime, employee
records and attendance — never payroll; and no `hr.salary.view`. Claims and
Leave must work fully without it, with no blank sections and no errors.

## 2. Why a role rather than a widened clerk

`[D]` `HR_STAFF` grants `hr.view`, `hr.employee.manage`,
`hr.attendance.manage` and says why it stops there:

> NOT leave approval, payroll or incentives: an HR clerk maintaining records is
> not the person who approves somebody's leave or signs off their pay.

`[O]` That comment is right. The job it does not describe is the one this
clinic actually has. Widening the clerk to fit the manager would have deleted a
distinction the code had deliberately drawn — so the manager got a role.

`[O]` **What CLINIC_MANAGER does not hold is the point of it.** No
`hr.salary.view`, and nothing from payroll — not view, not run, not approve.
Somebody has to decide the leave and the receipts every week, and that person
does not have to know the doctor's salary.

## 3. The split

`[D]` Deciding a RM180 dental receipt and signing off the month's payroll were
one permission. A clinic that wanted the first delegated had to hand over the
second.

`[D]` `decide` now takes `hr.claim.approve`. **`settle` stays on
`hr.payroll.approve`** — that one is money leaving through Finance, which is a
different act from saying yes to a receipt, and the tests hold both.

`[D]` The owner keeps everything: the split **added** a permission rather than
moving one away, and `OWNER_ADMIN` grants it.

## 4. What is composable now

`[D]` `CUSTOM_ROLE_GRANTABLE` gains `hr.view`, `hr.employee.manage`,
`hr.attendance.manage`, `hr.leave.approve` and `hr.claim.approve`, and the
Roles screen gains an **HR & people** group with words for each.

`[O]` Pay is deliberately still absent — salary, payroll and the statutory
tables stay the owner's, for the same reason `hr.payroll.approve` and
`finance.configure` were already out: a role that can see or move everybody's
pay is one an owner should compose deliberately, not reach for by habit.

## 5. The screen that lied

`[D]` `ClaimsPage` had no `useCan` at all. The row button now reads **Review**
for someone who can decide and **View** for someone who cannot, with the
refusal sentence on hover — the check is on the screen as well as the server,
so the answer arrives before the press rather than after it.

## 6. Migration

`[D]` **Yes — one.** `20260914090000_clinic_manager_role` adds
`CLINIC_MANAGER` to the `Role` enum. No existing staff row is migrated onto it;
the demo seed assigns it, and a real clinic assigns it from Add employee.

## 7. Named and NOT fixed here

`[D]` **`StaffAccessDrawer.tsx` is still never rendered**, and the Roles copy
still refers to it. A *custom* role can therefore be created and not assigned.
The built-in CLINIC_MANAGER is assignable from **Add employee**, which is the
path this finding needed, so the dead drawer is a separate defect rather than
part of this one — and it is a screen that has to be designed, not a line that
has to be moved.

`[D]` **Finding 5 — the claim receipt thumbnail — was already delivered in
Piece 1b.** `ClaimsPage` renders receipts through `AuthImage`, which became
openable across all four surfaces when the punch selfie was fixed. Verified
rather than assumed.
