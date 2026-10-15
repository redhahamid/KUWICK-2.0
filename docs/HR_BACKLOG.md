# HR backlog (deferred, 14 October 2026)

Not built in the HR core push. Each is a known gap, not a bug.

| Item | Why it waits |
|---|---|
| UI polish across HR screens | Function first; looks after UAT. |
| Replacement days for public holidays worked | Decision 8 agreed (expire after 90 days, then paid out); build with leave phase 2. |
| Leave accrual (first-year "1 day per N days worked") | Decision 7 agreed; leave types and balances come first. |
| Service-year leave tables beyond a simple list | Phase 2 of leave. |
| Special leave by job-title tag | Needs tags on job titles; phase 2 of leave. |
| Charging a counter bill to the medical benefit | Decisions 12–13 agreed; needs billing changes. Usage is entered by hand meanwhile. |
| Archive a branch | Not needed for payroll. |
| Automatic year-end carry forward of leave | The cap per type is a setting and is enforced; carried-in days are entered or imported until a rollover job exists. |
| Start date of the s.60C 3-week averaging cycle | Cycles are counted in threes from a fixed week so every run agrees; a clinic-chosen start can come later. |
| Daily-cap claims split across several claims on one day | The cap counts every claim of that type on the same day; a later claim over the cap is refused, not part-paid. |
| Doctors on a standing weekly pattern on the monthly roster | A bookable doctor on "standing weekly" shows in the weekly section; switch them to the monthly roster to roster nights and locum hours. |
| EA form box B2 (arrears for earlier years) filled automatically | Arrears paid this year for an earlier year go in the box of their item; move them to B2 by hand on the printed form until earned-in lines carry the year. |
| EA form Part F as the exempt part of each allowance | An item marked "not taxable" goes wholly in F; a partly exempt allowance (exemption limit) is not split yet. |
| C.P.8D file in LHDN's exact e-Filing layout | Kuwick gives a plain CSV with the same facts; the e-Filing template changes yearly and must be checked first. |
| Previous employment (Form TP3) on the EA form | TP3 money is not this employer's and is left off, as LHDN asks; shown in the Year to date report. |
| Email or phone notifications (leave decided, claim paid, payslip ready) | Staff see every status in My Kuwick; no mail or push sender exists in the product yet. |
| A manager's own approvals inbox on the phone | Managers approve from HR → Leave / Claims / Attendance, which work on a phone; a single combined inbox can come later. |
| Bank change: verify the account name against the bank | HR compares the proof photo by eye; no bank verification service is connected. |
| **MUST BE DONE BEFORE A SECOND CLINIC GOES LIVE.** Kuwick maintains the official federal and state public holiday list centrally, every year | Today the 2026 list is built into the code from published calendars (`apps/api/src/hr/holiday-presets.ts`), checked by hand against the JPM list by the owner. Needed: one official list per year that Kuwick (the platform) updates from the Jabatan Perdana Menteri gazette and each state's announcements, including replacement days (cuti ganti) and moon-sighted dates once confirmed, that every clinic's calendar is offered from. |
| Borang EA box D5 | Left blank until the auditor confirms whether it is a count of children or an RM amount. |
| Bonus already set as SOCSO/EIS-liable in an existing clinic | New clinics get Bonus without SOCSO/EIS (PERKESO: annual bonus is not wages). A clinic that seeded earlier changes it on Payroll items, with a date and a reason. |
| **MUST BE DONE BEFORE A SECOND CLINIC GOES LIVE.** Permission on clinic settings saved through `/global-settings` | "Defaults for new staff" and the opening-balances answer use the generic settings endpoint, which checks only that somebody is signed in to the clinic. Any staff login of that clinic could change them. Needs a permission per setting key (HR keys: `hr.employee.manage`). |
| Bonus SOCSO/EIS in the Hijraa clinic | Still ON there (left as it is, owner asked). No Jan–Sep 2026 payslip had a bonus, so nothing was charged. Decide with the auditor before the first bonus is paid. |
| Test only: first employee-list call of an integration run can time out | The 5-second database transaction of the employees list is exceeded on a cold start in the local test database; the same spec passes when run again. Not seen on staging. |
| Staging public booking page offers no services | `/book/hijraabangi` has 4 active services, none switched to "bookable online", so a patient sees nothing to book. A setting for the clinic, not a code fault. |

