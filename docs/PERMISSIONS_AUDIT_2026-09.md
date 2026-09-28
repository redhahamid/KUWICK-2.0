# Permission audit — September 2026

Legend: `[D]` read in the code or measured; `[A]` an inference or a proposal.
Method, as in `HR_SETTINGS_AUDIT_2026-09.md`: a key counts as live only if
something in `apps/api/src` reads it. Every key was searched for as a quoted
string outside the catalogue and the specs; each key with three or fewer
hits was read by hand. `apps/api/src/core/permissions-coverage.spec.ts` now
fails when a key is neither checked nor listed here.

## 1. The catalogue

- `[D]` 82 permission keys, the `Permission` union in `apps/api/src/core/permissions.ts`.
  `ADMIN_SYSTEM_PRODUCTION_READINESS.md` §5 said 73; it was written before the HR and analytics keys.
- `[D]` Grants by capability role in `ROLE_PERMISSIONS`; legacy job titles fall back through `LEGACY_ROLE_FALLBACK` and
  `LEGACY_ROLE_PERMISSIONS`; `effectivePermissions` resolves a person, removing `note.sign` without a credential.
- `[D]` Every key is granted to at least one role.
- `[D]` There are no permission decorators or guards apart from `PlatformAuthGuard` on platform routes. Checks are
  function calls: `withAdminTx`, `requirePermission`, `actorCan`, `withScopedAdminTx`, `requireScope` and
  `requireScopeAny` in `finance/admin-actor.ts`; the clinical helpers in `clinical-authorization.ts`; the queue and
  appointment maps; `requireClinicalAuthor`. The browser's `useCan` is display only.

## 2. Eleven keys nothing checks

| Key | Granted to | What actually gates the act `[D]` | Recommendation `[A]` |
|---|---|---|---|
| `note.sign` | DOCTOR | The signing credential `canSignClinicalNotes` | Keep as credential-derived |
| `prescription.write` | DOCTOR | `note.write` via `requireClinicalAuthor` | Wire in; no behaviour change |
| `order.write` | DOCTOR | `note.write` | Wire in; no behaviour change |
| `consultation.complete` | DOCTOR | `note.write` plus the attending-doctor rule | Wire in; no behaviour change |
| `allergy.write` | DOCTOR, CLINICAL_STAFF | `patient.alert.medical.write` | Remove; superseded |
| `discount.approve` | OWNER | `billing.corrections` | Remove; superseded |
| `consultation.resume` | DOCTOR, CLINICAL_STAFF, ADMINISTRATOR | `queue.consultationFlow` | Wire in, with the owner's agreement |
| `order.fulfil` | CLINICAL_STAFF | Nothing: order start, complete and cancel have no check | Security gap; the owner decides who holds it |
| `procurement.manage` | OWNER, STOCK_STAFF | Nothing: procurement, purchase orders, goods receiving and suppliers have no check | Security gap; the owner decides who holds it |
| `patient.lhdn.write` | ADMINISTRATOR, custom roles | Nothing; patients have no e-Invoice buyer fields | Mark reserved; take off the custom-role list |
| `document.print` | DOCTOR, CLINICAL_STAFF, ADMINISTRATOR, custom roles | Nothing; printing happens in the browser | Remove or reserve; take off the custom-role list |

None of the eleven was wired in or removed in this pass: each changes who may do
something, which is the owner's call. The coverage spec keeps the list honest
until they are decided.

## 3. Other findings

- `[D]` Checks that ignore custom roles and individual grants: `patient.service.ts` (three sites) and
  `visit-completion.service.ts` pass the actor's roles but not `directGrants`, so a custom role granting
  `patient.demographics.write`, `patient.identity.write` or `queue.manage` is ignored there.
- `[D]` Checks by job title, bypassing the permission module: `dispensary-authorization.ts`,
  `panel-benefit.service.ts`, `staff.service.ts` (the OWNER_ADMIN fallback), `queue-authorization.ts`.
- `[D]` No refusal sentence, so the user gets a generic message: `hr.salary.view`, `hr.payroll.reopen`,
  `hr.payroll.export.bank`, `hr.payroll.export.statutory`, `hr.payroll.export.reports`, `hr.statutory.manage`.
- `[D]` `PATCH /staff/:id` accepts `role` under `users.manage`, writes no audit row for the change, and no screen calls
  it. `HR_UAT_FINDINGS_2026-09.md` ("cannot be changed anywhere") is half right: the API can, no screen can.
- `[D]` Fixed in Batch 2 alongside this audit: the roster, doctor schedule, staff directory and public holiday routes
  ran on the JWT alone (see the branch-scope e2e suite).

## 4. The Role enum

- `[D]` The Prisma `enum Role` has ten values, `CLINIC_MANAGER` among them. The shared TypeScript `Role` in
  `packages/shared/src/index.ts` had nine: `CLINIC_MANAGER` was added to the schema alone.
- `[D]` Nothing broke today: the shared enum types `Staff.role` and a billing fallback, and the only role picker is a
  hand-written list. `[A]` A role picker built from `Object.values(Role)`, an exhaustive switch, or a "promote"
  screen would have silently missed clinic managers.
- Fixed: `CLINIC_MANAGER` is in the shared enum, and `apps/api/src/core/role-parity.spec.ts` fails if the two drift.
- `[D]` Open, for the owner: `workforceCategoryOf` files a clinic manager under "Other", not "Finance / management".
  That decides which payroll rule set applies by category and how the roster groups them. Changing it changes pay
  pricing, so it is not changed here.

## 5. Where this supersedes older text

- `ADMIN_SYSTEM_PRODUCTION_READINESS.md` §5 now points here for the count and the unchecked keys.
- `HR_RESTRUCTURE_PIECE3_PERMISSIONS.md` §7 points here.
- `DATABASE_ARCHITECTURE.md` lists Clinic Manager among the roles.
