# Integrated Management UAT — screenshot pack

Every Management screen a clinic owner is being asked to accept, walked against the seeded synthetic
clinic (Klinik Contoh (UAT) — synthetic identities only) at desktop and iPad width.

This is a **breadth** pack: it proves each Management screen renders real, populated content from the
one integrated period. The Payroll *journey* has its own 46-frame depth pack in `docs/payroll-final-uat/`
and is not repeated here.

The walk is also the smoke test — `prisma/management-uat-shots.ts` fails any route that renders an error
boundary or a near-empty body, and reports every browser console error it sees. On the run that produced
these frames: **no dead screens, and no React key collisions** (the one that existed on Stock was found by
this walk and fixed — see the checkpoint document).

| Frame | Area | Viewport | What it shows |
| --- | --- | --- | --- |
| `01-admin-home.png` | Shell | Desktop 1680×1050 | Administration — the Management landing and its five areas |
| `02-operation-overview.png` | Operation | Desktop 1680×1050 | Operation — visits, patients, mix and workload for the period |
| `03-operation-doctors.png` | Operation | Desktop 1680×1050 | Operation — provider workload, described rather than ranked punitively |
| `04-operation-patients.png` | Operation | Desktop 1680×1050 | Operation — new vs returning and the patient-flow view |
| `05-operation-procedures.png` | Operation | Desktop 1680×1050 | Operation — service and procedure volume |
| `06-operation-wait-times.png` | Operation | Desktop 1680×1050 | Operation — waiting-time indicators and their coverage |
| `07-stock-overview.png` | Stock | Desktop 1680×1050 | Stock — the inventory position and what needs attention |
| `08-stock-items.png` | Stock | Desktop 1680×1050 | Stock — the item master with unit and balance |
| `09-stock-movements.png` | Stock | Desktop 1680×1050 | Stock — the movement ledger: every quantity change with its cause |
| `10-stock-purchase-orders.png` | Stock | Desktop 1680×1050 | Stock — purchase orders and their receiving state |
| `11-stock-near-expiry.png` | Stock | Desktop 1680×1050 | Stock — batch and expiry watch (FEFO support) |
| `12-stock-valuation.png` | Stock | Desktop 1680×1050 | Stock — valuation, stating its costing method rather than implying precision |
| `13-stock-take.png` | Stock | Desktop 1680×1050 | Stock — stock takes and the variance they record |
| `14-panel-workspace.png` | Panel | Desktop 1680×1050 | Panel — the claim workspace: what is claimable, claimed, awaiting and outstanding |
| `15-panel-companies.png` | Panel | Desktop 1680×1050 | Panel — the panel master |
| `16-panel-configuration.png` | Panel | Desktop 1680×1050 | Panel — fee treatment: withheld, added, none, or deliberately unconfigured |
| `17-panel-batches.png` | Panel | Desktop 1680×1050 | Panel — claim batches and their submission record |
| `18-hr-today.png` | HR / Payroll | Desktop 1680×1050 | HR — the day at a glance |
| `19-hr-employees.png` | HR / Payroll | Desktop 1680×1050 | HR — the employee directory, deliberately without a salary column |
| `20-hr-attendance.png` | HR / Payroll | Desktop 1680×1050 | HR — timesheets, with unapproved overtime shown apart and unpaid |
| `21-hr-leave.png` | HR / Payroll | Desktop 1680×1050 | HR — leave and its balances |
| `22-hr-claims.png` | HR / Payroll | Desktop 1680×1050 | HR — staff claims and their payment route |
| `23-hr-incentives.png` | HR / Payroll | Desktop 1680×1050 | HR — doctor incentives |
| `24-hr-locum.png` | HR / Payroll | Desktop 1680×1050 | HR — locum sessions |
| `25-hr-roster.png` | HR / Payroll | Desktop 1680×1050 | HR — the roster |
| `26-hr-payroll-home.png` | HR / Payroll | Desktop 1680×1050 | HR → Payroll — the month, and what it needs before anybody is paid |
| `27-hr-reports.png` | HR / Payroll | Desktop 1680×1050 | HR → Payroll — the report catalogue |
| `28-finance-overview.png` | Finance | Desktop 1680×1050 | Finance — the overview: billed, collected, and what is still owed |
| `29-finance-sales.png` | Finance | Desktop 1680×1050 | Finance — sales, cash vs panel |
| `30-finance-payments.png` | Finance | Desktop 1680×1050 | Finance — collections and their tender |
| `31-finance-receivables.png` | Finance | Desktop 1680×1050 | Finance — patient receivables |
| `32-finance-panel-money.png` | Finance | Desktop 1680×1050 | Finance — the panel position, consumed from Panel rather than recomputed |
| `33-finance-day-end.png` | Finance | Desktop 1680×1050 | Finance — day end: counted, closed, reopenable with a reason |
| `34-finance-payables.png` | Finance | Desktop 1680×1050 | Finance — supplier payables from procurement |
| `35-finance-credit-notes.png` | Finance | Desktop 1680×1050 | Finance — credit notes |
| `36-finance-profitability.png` | Finance | Desktop 1680×1050 | Finance — profitability, and what it does not claim to include |
| `37-tablet-admin-home.png` | Shell | iPad 1024×1366 | iPad — the Management landing |
| `38-tablet-operation.png` | Operation | iPad 1024×1366 | iPad — Operation |
| `39-tablet-stock.png` | Stock | iPad 1024×1366 | iPad — Stock |
| `40-tablet-panel.png` | Panel | iPad 1024×1366 | iPad — Panel |
| `41-tablet-hr-payroll.png` | HR / Payroll | iPad 1024×1366 | iPad — HR → Payroll |
| `42-tablet-finance.png` | Finance | iPad 1024×1366 | iPad — Finance |
