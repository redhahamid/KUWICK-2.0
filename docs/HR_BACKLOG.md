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
| Bonus SOCSO/EIS in the Hijraa clinic | Still ON there (left as it is, owner asked). No Jan–Sep 2026 payslip had a bonus, so nothing was charged. Decide with the auditor before the first bonus is paid. |
| **MUST BE DONE BEFORE ANY CLINIC USES KUWICK FOR REAL.** Separate production database, with daily backups | Plan for our own server: docs/SELF_HOSTING.md (3 November 2026). Today there is one Supabase project (staging, free plan), which pauses after about a week without use and keeps no backups we can restore from. Plan: (1) a new Supabase project for production on a paid plan, with daily backups and point-in-time recovery switched on, and a test restore done once before go-live; (2) production Render services on a paid plan, so the API never sleeps; (3) separate secrets for production (database URL, app role password, JWT secrets), never shared with staging; (4) the seed, wipe and demo workflows refuse a production database by name, so they can only ever touch staging; (5) staging stays as it is for testing, with demo data only. |
| Test only: an integration run on a busy machine can time out | Database transactions of 5 seconds (employees list, RLS clean-up) are exceeded when the test machine is loaded; the same specs pass when run again on their own. Not seen on staging. |
| Staging public booking page offers no services | `/book/hijraabangi` has 4 active services, none switched to "bookable online", so a patient sees nothing to book. A setting for the clinic, not a code fault. Left as it is: the owner switches a service on as a clinic owner would. |
| Rest-day and public-holiday hours worked out from attendance are paid on the Overtime line | The new "Rest day / public holiday pay" item is for days the clinic keys by hand. Splitting the priced hours onto their own line needs a change in the payroll engine. |
| Unused annual leave on leaving: the cases where it is not owed | Kuwick pays it out by default (s.60E(3)); a clinic can switch it off with a reason. Our reading is that the Act excludes a dismissal for misconduct under s.14(1)(a), and staff outside the Act follow their contract; confirm with the auditor before Kuwick names those cases on screen. |
| Hijraa start dates and years of service | The 28 Hijraa staff were put on "Standard leave" on 3 November 2026 (owner's instruction). 19 of them have a start date of 1 January 2026, so Kuwick counts 0 years of service and gives the 8-day minimum. If they joined earlier, the Act gives 12 days from 2 years and 16 from 5: HR corrects the start dates (or the policy) after comparing with the contracts. |
| A new leave or claim type still asks for a code | Codes are hidden on the lists; the add form still asks for one. It could be made from the name. |
| Month comparison on Review counts the runs of one branch | "Compare with October" sets this month beside the same branch's run for the month before. A clinic that runs payroll for all branches at once compares that run only. |
