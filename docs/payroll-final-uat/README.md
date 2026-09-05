# Final-validation UAT — screenshot pack

Taken against the freshly seeded synthetic clinic (Klinik Contoh (UAT) — synthetic identities only),
walking the month the way a clinic owner would: found blocked, fixed the legitimate way, read step by
step, approved, CORRECTED through a reopen to revision 2, paid on the corrected record, one filing
recorded, and read back through the reports. The historical P1 pack (docs/payroll-p1-uat/) is untouched;
the defective states this validation fixed are preserved under before/.

| Frame | Route | State | Viewport | What it shows |
| --- | --- | --- | --- | --- |
| `01-home-blocked.png` | `/admin/hr/payroll` | No run for the shown month | Desktop 1680×1050 | The landing as a month opens: what to do, and last month’s figure labelled unapproved |
| `02-readiness-blocked.png` | `/admin/hr/payroll/readiness?period=<blocked month>` | Blocked | Desktop 1680×1050 | Who cannot be paid and why: 4 people blocked for two different reasons; employer filing identities checked apart |
| `03-readiness-checklist.png` | `/admin/hr/payroll/readiness` | Blocked, one row expanded | Desktop 1680×1050 | One employee’s checklist: blocking before advisory, bank masked to last four, s.60(3) explained in words |
| `04-step1-employees-blocked.png` | `/admin/hr/payroll/:id?step=employees` | CALCULATED with blockers | Desktop 1680×1050 | Step 1 while blocked: who is in the month and who cannot be paid yet |
| `05-exception-centre-blocked.png` | `/admin/hr/payroll/:id?step=review` | CALCULATED with blockers | Desktop 1680×1050 | The exception centre: severity, person, cause, consequence, remediation, deep link; approval impossible |
| `06-step1-employees.png` | `/admin/hr/payroll/:id?step=employees` | CALCULATED, clean | Desktop 1680×1050 | Step 1 after the legitimate fixes: everyone in, part-months named |
| `07-step2-attendance.png` | `/admin/hr/payroll/:id?step=attendance` | CALCULATED, clean | Desktop 1680×1050 | Attendance and overtime as the month recorded them — nothing typed twice |
| `08-step3-earnings.png` | `/admin/hr/payroll/:id?step=earnings` | CALCULATED, clean | Desktop 1680×1050 | Earnings: server figures only; every column the gross contains, unpaid leave on the wages side |
| `09-step4-deductions.png` | `/admin/hr/payroll/:id?step=deductions` | CALCULATED, clean | Desktop 1680×1050 | Deductions: EPF/SOCSO/EIS, LINDUNG apart, PCB with its source named |
| `10-step5-review-clean.png` | `/admin/hr/payroll/:id?step=review` | CALCULATED, clean | Desktop 1680×1050 | Review with nothing blocking; two warnings that gate nothing |
| `11-epf-basis-discrepancy.png` | `/admin/hr/payroll/:id?step=review` | Blocked by the owner’s own selection | Desktop 1680×1050 | The owner tries "basic only": the discrepancy names the person, the component and the ringgit; blocking, and deliberately not overridable |
| `12-epf-basis-panel.png` | `/admin/hr/employees/:staffId (Salary tab)` | Selection recorded | Desktop 1680×1050 | The EPF basis panel, beside the salary it prices: the selection in words, since when, by whom and why — and the dated history a payroll run resolves against |
| `13-epf-basis-selected-row.png` | `/admin/hr/payroll/:id?step=deductions` | CALCULATED, clean again | Desktop 1680×1050 | The deductions row says which EPF basis governs it — “EPF on RM… — selected basis”; the detour survives only in history |
| `14-step6-approve.png` | `/admin/hr/payroll/:id?step=approve` | CALCULATED, clean | Desktop 1680×1050 | The approval step: the rule in force named before anybody clicks |
| `15-approved.png` | `/admin/hr/payroll/:id?step=approve` | APPROVED (v1) | Desktop 1680×1050 | The frozen, hashed record — the month is now a fact |
| `16-payslips-panel.png` | `/admin/hr/payroll/:id?step=approve` | APPROVED | Desktop 1680×1050 | Payslips issued only from the approved snapshot, revision named |
| `17-report-register.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | The register: every column footing to the run’s own totals |
| `18-report-employer-cost.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Cost to the clinic: gross + contributions = employer cost, HRD levy included |
| `19-report-statutory.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Statutory totals by scheme; a null survives as a null |
| `20-report-pcb.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Monthly tax: calculated vs entered, decided by the marker, never the wording |
| `21-report-ytd.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | The cumulative ledger; TP3 money listed apart from this employer’s months |
| `22-report-overtime.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Overtime day by day, naming the Employment Act provision that priced each |
| `23-report-unpaid-leave.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Absence as a wage reduction — deliberately no deductions column |
| `24-report-payment-status.png` | `/admin/hr/reports` | PAID | Desktop 1680×1050 | Where the money stands, in the language of evidence |
| `25-reopened-review.png` | `/admin/hr/payroll/:id?step=review` | Reopened (CALCULATED, snapshot v1 stands) | Desktop 1680×1050 | The correction cycle: back at review while revision 1 keeps serving payslips and filings |
| `26-reopened-report-banner.png` | `/admin/hr/reports (Payroll register)` | Reopened | Desktop 1680×1050 | The register says these are candidate figures while the approved record stands — every run report carries this now |
| `27-reapproved-v2.png` | `/admin/hr/payroll/:id?step=approve` | APPROVED (v2) | Desktop 1680×1050 | Approved again: revision 2 beside revision 1, nothing overwritten, everything dated |
| `28-payment-generated.png` | `/admin/hr/payroll/:id?step=approve` | APPROVED v2, listing prepared | Desktop 1680×1050 | The honesty ladder, rung 1: a listing exists, says it is NOT a bank file, and nothing claims paid |
| `29-payment-recorded.png` | `/admin/hr/payroll/:id?step=approve` | PAID (recorded) | Desktop 1680×1050 | Rung 3: a person recorded the transfer with date and reference — the only place "paid" is ever said |
| `30-statutory-outputs.png` | `/admin/hr/payroll/:id?step=approve` | PAID, one filing recorded | Desktop 1680×1050 | Per-scheme amounts from the approved record, each schedule named with its verification; EPF "Filed" with its reference, every other scheme "Not filed — prepared only"; missing membership numbers say so in words (wages ride in the downloadable listing) |
| `31-employees.png` | `/admin/hr/employees` | Directory | Desktop 1680×1050 | No salary column, by design |
| `32-employee-workspace.png` | `/admin/hr/employees/:staffId` | Overview tab | Desktop 1680×1050 | LAST PAID reads only an approved month; money always two decimals |
| `33-statutory-standing.png` | `/admin/hr/employees/:staffId (Employment tab)` | Standing recorded | Desktop 1680×1050 | The dated statutory standing and its version history |
| `34-standing-editor.png` | `/admin/hr/employees/:staffId (modal)` | Editor open | Desktop 1680×1050 | Relief facts rest at “Not recorded” — nothing asserted that nobody entered |
| `35-employee-tax.png` | `/admin/hr/employees/:staffId (Tax tab)` | TP1/TP3 captured | Desktop 1680×1050 | The month’s reliefs and previous employment with provenance; a year picker for January’s questions |
| `36-ytd-opening-refuses-blanks.png` | `/admin/hr/payroll/ytd-opening` | Add-month refused | Desktop 1680×1050 | A blank box is not RM0.00: the blank figures are named, and genuine zeros are one deliberate click |
| `37-settings.png` | `/admin/hr/settings` | Configured | Desktop 1680×1050 | The schedules with their evidence and verification; what remains outside Kuwick, stated in words |
| `38-employers.png` | `/admin/hr/employers` | Configured | Desktop 1680×1050 | Filing identities; the employer bank account shows presence and last four only |
| `39-tablet-home.png` | `/admin/hr/payroll` | PAID month | iPad 1024×1366 | iPad: the landing |
| `40-tablet-readiness.png` | `/admin/hr/payroll/readiness` | Clean | iPad 1024×1366 | iPad: Get ready |
| `41-tablet-deductions.png` | `/admin/hr/payroll/:id?step=deductions` | PAID | iPad 1024×1366 | iPad: the statutory columns scroll inside the panel, never the page |
| `42-tablet-approved.png` | `/admin/hr/payroll/:id?step=approve` | PAID | iPad 1024×1366 | iPad: the approved month |
| `43-tablet-payment.png` | `/admin/hr/payroll/:id?step=approve` | PAID | iPad 1024×1366 | iPad: the payment ladder |
| `44-tablet-outputs.png` | `/admin/hr/payroll/:id?step=approve` | PAID | iPad 1024×1366 | iPad: statutory filings — scheme blocks stack; the page never scrolls sideways |
| `45-tablet-report-pcb.png` | `/admin/hr/reports` | PAID | iPad 1024×1366 | iPad: the monthly tax summary |
| `46-phone-home.png` | `/admin/hr/payroll` | PAID month | Phone 390×844 | Phone (390px): the landing stays readable; wide content scrolls in its own panel |

## before/ — the found-defective states

Captured before any fix, for the before/after record:

- 01-settings-stale-ytd-copy.png — BEFORE — payroll settings claims the YTD import is not implemented while the screen exists
- 02-ytd-opening-import.png — BEFORE — opening balances import; blank statutory fields silently become RM0.00 on staging
- 03-benefits-two-remainings.png — BEFORE — strip Remaining clamps across the clinic; table total sums per-account clamps
- 04-legacy-payroll-stale-claims.png — BEFORE — legacy payroll page still claims PCB is not calculated and payslips do not exist
- 05-legacy-run-blue-notice.png — BEFORE — "This run is blue/default" wording from the tag-colour map
- 06-payroll-home.png — BEFORE — payroll landing; attention card fails open when the gate is unknown
- 07-employee-workspace-overview.png — BEFORE — LAST PAID fact reads the newest run with no status filter
- 08-employee-workspace-payroll-tab.png — BEFORE — take-home column renders RM figures with one decimal for .x0 amounts
