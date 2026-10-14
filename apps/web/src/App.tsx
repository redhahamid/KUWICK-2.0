import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { ManagementLayout } from './design-system/components/ManagementLayout';
import { SettingsLayout } from './design-system/components/SettingsLayout';
import { StockHealthPage } from './inventory/StockHealthPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { MyKuwickLayout } from './me/MyKuwickLayout';
import { MyHomePage } from './me/MyHomePage';
import { MyAttendancePage } from './me/MyAttendancePage';
import { MyLeavePage } from './me/MyLeavePage';
import { MyClaimsPage } from './me/MyClaimsPage';
import { MyPayslipsPage } from './me/MyPayslipsPage';
import { MyProfilePage } from './me/MyProfilePage';
import { RequirePlatformAuth } from './auth/RequirePlatformAuth';
import { PlatformLayout } from './platform/PlatformLayout';
import { PlatformDashboardPage } from './platform/PlatformDashboardPage';
import { PlatformClinicsPage } from './platform/PlatformClinicsPage';
import { PlatformPlansPage } from './platform/PlatformPlansPage';
import { PlatformSubscriptionsPage } from './platform/PlatformSubscriptionsPage';
import { PlatformPanelClinicsPage } from './platform/PlatformPanelClinicsPage';
import { PlatformProceduresPage } from './platform/PlatformProceduresPage';
import { PlatformSettingsPage } from './platform/PlatformSettingsPage';
import { PlatformStatutoryTablesPage } from './platform/PlatformStatutoryTablesPage';
import { AppointmentsModulePage } from './appointment/AppointmentsModulePage';
import { PublicBookingPage } from './appointment/public/PublicBookingPage';
import { ManageBookingPage } from './appointment/public/ManageBookingPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { PublicHolidaysPage } from './admin/hr/PublicHolidaysPage';
import { ShiftSettingsPage } from './admin/hr/ShiftSettingsPage';
import { AttendanceKioskPage } from './admin/hr/AttendanceKioskPage';
import { ServicesPage } from './clinical/ServicesPage';
import { ConsultationTariffsPage } from './clinical/ConsultationTariffsPage';
import { PanelClinicsPage } from './clinical/PanelClinicsPage';
import { PanelClaimsPage } from './clinical/PanelClaimsPage';
import { DiagnosesDirectoryPage } from './clinical/DiagnosesDirectoryPage';
import { PrescriptionVocabularyPage } from './clinical/PrescriptionVocabularyPage';
import { PatientDashboardPage } from './clinical/PatientDashboardPage';
import { QueueManagementPage } from './clinical/QueueManagementPage';
import { DispensaryPage } from './clinical/dispensary/DispensaryPage';
import { QueueMonitorPage } from './clinical/QueueMonitorPage';
import { RoomsPage } from './clinical/RoomsPage';
import { QueueDisplaySettingsPage } from './clinical/QueueDisplaySettingsPage';
import { DocumentTemplatesPage } from './clinical/DocumentTemplatesPage';
import { PlatformDocumentTemplatesPage } from './platform/PlatformDocumentTemplatesPage';
import { PrintOrderResultPage } from './clinical/PrintOrderResultPage';
import { ProcedureQueuePage } from './clinical/ProcedureQueuePage';
import { BillingVisitPage } from './clinical/BillingVisitPage';
import { HistoricalVisitPage } from './clinical/history/HistoricalVisitPage';
import { BookingRulesPage } from './appointment/BookingRulesPage';
import { CommunicationSettingsPage } from './appointment/communication/CommunicationSettingsPage';
import { RolesSettingsPage } from './hr/RolesSettingsPage';
import { UsersSettingsPage } from './hr/UsersSettingsPage';
import { ItemsPage } from './inventory/ItemsPage';
import { SuppliersPage } from './inventory/SuppliersPage';
import { StockTakePage } from './inventory/StockTakePage';
import { ProcurementRequestsPage } from './inventory/ProcurementRequestsPage';
import { PurchaseOrdersPage } from './inventory/PurchaseOrdersPage';
import { ReportsPage } from './reports/ReportsPage';
import { DayEndPage } from './reports/DayEndPage';
import { SalesAnalysisPage } from './reports/SalesAnalysisPage';
import { PatientAnalysisPage } from './reports/PatientAnalysisPage';
import { ProcedureAnalysisPage } from './reports/ProcedureAnalysisPage';
import { DoctorPerformancePage } from './reports/DoctorPerformancePage';
import { InvoiceListingPage } from './reports/InvoiceListingPage';
import { DrugMovementPage } from './reports/DrugMovementPage';
import { WaitTimesPage } from './reports/WaitTimesPage';
// THE ADMIN PROGRAMME — five back-office modules that have to feel like one
// product. Added alongside Management rather than replacing it: the reports a
// clinic already relies on keep working while these go through UAT.
import { AdminLayout } from './admin/AdminLayout';
import { OperationsOverviewPage } from './admin/operation/OperationsOverviewPage';
import { SegmentPlPage } from './admin/operation/SegmentPlPage';
import { ProgrammesPage } from './admin/operation/ProgrammesPage';
import { MarketingPage } from './admin/operation/MarketingPage';
import { StockLevelsPage } from './inventory/StockLevelsPage';
import { StockOverviewPage } from './admin/stock/StockOverviewPage';
import { StockTransfersPage } from './admin/stock/StockTransfersPage';
import { StockTakePage as AdminStockTakePage } from './admin/stock/StockTakePage';
import { StockMovementsPage } from './admin/stock/StockMovementsPage';
import { PanelWorkspacePage } from './admin/panel/PanelWorkspacePage';
import { PayablesPage } from './admin/finance/PayablesPage';
import { PanelMoneyPage } from './admin/finance/PanelMoneyPage';
import { ClaimImportPage } from './admin/panel/ClaimImportPage';
import { NewItemRequestsPage } from './admin/stock/NewItemRequestsPage';
import { PanelConfigPage } from './admin/panel/PanelConfigPage';
import { HrOverviewPage } from './admin/hr/HrOverviewPage';
import { EmployeesPage } from './admin/hr/EmployeesPage';
import { TimesheetPage } from './admin/hr/TimesheetPage';
import { LegalEmployersPage } from './admin/hr/LegalEmployersPage';
import { IncentivesPage } from './admin/hr/IncentivesPage';
import { AdminRosterPage } from './admin/hr/RosterPage';
import { LeavePage } from './admin/hr/LeavePage';
import { ClaimsPage } from './admin/hr/ClaimsPage';
import { LocumPage } from './admin/hr/LocumPage';
import { PayrollReportsPage } from './admin/hr/PayrollReportsPage';
import { EaFormsPage } from './admin/hr/EaFormsPage';
import { PayrollSettingsPage } from './admin/hr/PayrollSettingsPage';
import { PayrollItemsPage } from './admin/hr/PayrollItemsPage';
import { StatutoryRatesPage } from './admin/hr/StatutoryRatesPage';
import { HrSettingsPage } from './admin/hr/HrSettingsPage';
import { AttendanceSettingsPage } from './admin/hr/AttendanceSettingsPage';
import { PayrollMonthPage } from './admin/hr/PayrollMonthPage';
import { PayrollHistoryPage } from './admin/hr/PayrollHistoryPage';
import { YtdOpeningImportPage } from './admin/hr/YtdOpeningImportPage';
import { PayrollRunPage } from './admin/hr/PayrollRunPage';
import { PayrollEmployeePage } from './admin/hr/PayrollEmployeePage';
import { StatutoryFilingPage } from './admin/hr/StatutoryFilingPage';
import { EmployeeWorkspacePage } from './admin/hr/EmployeeWorkspacePage';
import { AddEmployeePage } from './admin/hr/AddEmployeePage';
import { BulkEmployeesPage } from './admin/hr/BulkEmployeesPage';
import { FinanceOverviewPage } from './admin/finance/FinanceOverviewPage';
import { DayEndClosingPage } from './admin/finance/DayEndClosingPage';
import { PaymentsPage } from './admin/finance/PaymentsPage';
import { ReceivablesPage } from './admin/finance/ReceivablesPage';
import { CreditNotesPage } from './admin/finance/CreditNotesPage';
import { TaxPage } from './admin/finance/TaxPage';
import { ProfitabilityPage } from './admin/finance/ProfitabilityPage';
import { InterCompanyPage } from './admin/finance/InterCompanyPage';
import { EInvoicePage } from './admin/finance/EInvoicePage';

export function App() {
  return (
    <Routes>
      {/* Public — no sidebar/auth chrome, meant for a waiting-room TV. */}
      <Route path="/queue/monitor/:clinicId" element={<QueueMonitorPage />} />
      <Route path="/print/order-service/:id" element={<PrintOrderResultPage />} />

      {/* PUBLIC PATIENT BOOKING — no session, no sidebar, no staff chrome.
          `/book/:slug/manage/:token` comes FIRST: a `:serviceSlug` route
          registered before it would read "manage" as a service and 404 a link
          the clinic has already sent to a patient by SMS. */}
      <Route path="/book/:slug/manage/:token" element={<ManageBookingPage />} />
      <Route path="/book/:slug/:serviceSlug" element={<PublicBookingPage />} />
      <Route path="/book/:slug" element={<PublicBookingPage />} />

      {/* Auth (D-034/D-049) — one login form for everyone; the response
          decides platform console vs clinic workspace. The old separate
          platform login page is gone — it rejected clinic credentials and
          confused real users within minutes, so the bookmark redirects. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/platform/login" element={<Navigate to="/login" replace />} />
      <Route element={<RequirePlatformAuth />}>
        <Route element={<PlatformLayout />}>
          <Route path="/platform/dashboard" element={<PlatformDashboardPage />} />
          <Route path="/platform/clinics" element={<PlatformClinicsPage />} />
          {/* Old bookmark from the first console iteration. */}
          <Route path="/platform/tenants" element={<PlatformClinicsPage />} />
          <Route path="/platform/plans" element={<PlatformPlansPage />} />
          <Route path="/platform/subscriptions" element={<PlatformSubscriptionsPage />} />
          <Route path="/platform/panel-clinics" element={<PlatformPanelClinicsPage />} />
          <Route path="/platform/procedures" element={<PlatformProceduresPage />} />
          <Route path="/platform/document-templates" element={<PlatformDocumentTemplatesPage />} />
          <Route path="/platform/settings" element={<PlatformSettingsPage />} />
          <Route path="/platform/statutory-tables" element={<PlatformStatutoryTablesPage />} />
        </Route>
      </Route>

      {/*
        * MY KUWICK — the staff-facing area, OUTSIDE the clinic workspace shell.
        *
        * Signed in, and nothing more: every route under it is authorised by
        * identity rather than by a permission, because nobody should be able
        * to withhold somebody's own attendance record from them. It sits
        * outside `AppLayout` deliberately — an employee should not be shown
        * the workspace navigation, the patient list or the module rail, since
        * a screen that offers controls it then refuses is worse than one that
        * never offered them.
        */}
      <Route element={<RequireAuth />}>
        {/* The branch kiosk: full screen, no navigation (UAT, 14 October 2026). */}
        <Route path="/kiosk/attendance" element={<AttendanceKioskPage />} />
        <Route element={<MyKuwickLayout />}>
          <Route path="/my" element={<MyHomePage />} />
          {/* The portal mockups carry no Schedule tab: the roster is on Attendance. */}
          <Route path="/my/schedule" element={<Navigate to="/my/attendance" replace />} />
          <Route path="/my/attendance" element={<MyAttendancePage />} />
          <Route path="/my/leave" element={<MyLeavePage />} />
          <Route path="/my/claims" element={<MyClaimsPage />} />
          <Route path="/my/payslips" element={<MyPayslipsPage />} />
          <Route path="/my/profile" element={<MyProfilePage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<AppointmentsModulePage />} />
          {/* Calendar is the default workspace (§7): opening Appointments
              shows the day, not a filter form. */}
          <Route path="/appointments" element={<Navigate to="/appointments/calendar" replace />} />
          <Route path="/appointments/:tab" element={<AppointmentsModulePage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/patients/:id" element={<PatientDashboardPage />} />
          <Route path="/queue" element={<QueueManagementPage />} />
          {/* G4.5d5b-3 — the dispensary counter's own workspace. `?visitId=`
              opens it on one patient, so the Queue can hand a specific visit
              across and a colleague can be sent a link. */}
          <Route path="/dispensary" element={<DispensaryPage />} />
          <Route path="/procedure-queue" element={<ProcedureQueuePage />} />
          {/* G3c (D-065) — the billing workflow's own route. The Clinical
              Workspace shows a read-only summary and links here. */}
          <Route path="/billing/visits/:visitId" element={<BillingVisitPage />} />
          {/* G4 (D-067) — read-only historical visit, opened in its own tab. */}
          <Route path="/history/patients/:patientId/visits/:visitId" element={<HistoricalVisitPage />} />

          {/* Management (M1, owner-approved horizontal layout) — review/
              approve/report work only; set-once config lives under
              /settings below. Executive Dashboard is the landing page. */}
          <Route path="/management" element={<Navigate to="/management/reports" replace />} />
          <Route element={<ManagementLayout />}>
            <Route path="/management/reports" element={<ReportsPage />} />
            <Route path="/management/reports/day-end" element={<DayEndPage />} />
            <Route path="/management/reports/sales" element={<SalesAnalysisPage />} />
            <Route path="/management/reports/patients" element={<PatientAnalysisPage />} />
            <Route path="/management/reports/procedures" element={<ProcedureAnalysisPage />} />
            <Route path="/management/reports/doctors" element={<DoctorPerformancePage />} />
            <Route path="/management/reports/invoices" element={<InvoiceListingPage />} />
            <Route path="/management/reports/drug-movement" element={<DrugMovementPage />} />
            <Route path="/management/reports/wait-times" element={<WaitTimesPage />} />

            <Route path="/management/hr/staff" element={<Navigate to="/admin/hr/employees" replace />} />
            {/*
              * ONE ATTENDANCE. This used to render a SECOND attendance screen,
              * derived from `Visit.checkInAt` — patient traffic, not punches —
              * so a doctor who saw nobody was "absent" and a receptionist who
              * never sees a patient was permanently absent. The canonical
              * screen reads real clock-ins against the roster. The old URL is
              * kept working rather than broken, because it is bookmarked.
              */}
            <Route path="/management/hr/attendance" element={<Navigate to="/admin/hr/attendance" replace />} />
            {/* The Management-era leave screen is gone: it carried an
                "Approving/Rejecting as" picker whose value the server wrote
                down as the approver, unchecked. Its URL still resolves, to
                the work area that replaced it. */}
            <Route path="/management/hr/leave-requests" element={<Navigate to="/admin/hr/leave" replace />} />

            <Route path="/management/stock/health" element={<StockHealthPage />} />
            <Route path="/management/stock/items" element={<ItemsPage />} />
            <Route path="/management/stock/suppliers" element={<SuppliersPage />} />
            <Route path="/management/stock/stock-take" element={<StockTakePage />} />
            <Route path="/management/stock/procurement-requests" element={<ProcurementRequestsPage />} />
            <Route path="/management/stock/purchase-orders" element={<PurchaseOrdersPage />} />

            <Route path="/management/panel/clinics" element={<PanelClinicsPage />} />
            <Route path="/management/panel/claims" element={<PanelClaimsPage />} />
          </Route>

          {/* CMS Settings (M1) — configuration changed a few times a year,
              extracted from Management. Same page components, new home. */}
          {/* ---------------------------------------------------------------
              THE ADMIN PROGRAMME. Five modules, each landing on the page that
              answers its own first question. Management's URLs are untouched.
              --------------------------------------------------------------- */}
          {/* ONE ADMIN, NOT TWO PRODUCTS.

              Fourteen of the routes below render a component that was built
              for /management, /settings or /appointments. They are MOUNTED,
              not copied: same import, same hooks, same endpoints, same rows.
              The owner's complaint was that reaching item pricing from
              Admin ▸ Stock meant leaving Admin and arriving somewhere that
              looked like a different application — that is a navigation
              defect, and a second ItemsPage would have been a data defect.

              The original URLs below still resolve to the Management shell,
              so every bookmark, deep link and redirect keeps working. */}
          <Route path="/admin" element={<Navigate to="/admin/operation" replace />} />
          <Route element={<AdminLayout />}>
            <Route path="/admin/operation" element={<OperationsOverviewPage />} />
            <Route path="/admin/operation/segments" element={<SegmentPlPage />} />
            <Route path="/admin/operation/programmes" element={<ProgrammesPage />} />
            <Route path="/admin/operation/marketing" element={<MarketingPage />} />
            {/* Clinic performance is one subject. It was split across two hubs. */}
            <Route path="/admin/operation/patients" element={<PatientAnalysisPage />} />
            <Route path="/admin/operation/procedures" element={<ProcedureAnalysisPage />} />
            <Route path="/admin/operation/doctors" element={<DoctorPerformancePage />} />
            <Route path="/admin/operation/wait-times" element={<WaitTimesPage />} />

            <Route path="/admin/stock" element={<StockOverviewPage />} />
            {/* THE CATALOGUE, not a copy of it. One item record, one price. */}
            <Route path="/admin/stock/items" element={<ItemsPage />} />
            <Route path="/admin/stock/locations" element={<StockLevelsPage />} />
            <Route path="/admin/stock/transfers" element={<StockTransfersPage />} />
            <Route path="/admin/stock/purchase-orders" element={<PurchaseOrdersPage />} />
            <Route path="/admin/stock/procurement-requests" element={<ProcurementRequestsPage />} />
            <Route path="/admin/stock/suppliers" element={<SuppliersPage />} />
            <Route path="/admin/stock/stock-take" element={<AdminStockTakePage />} />
            <Route path="/admin/stock/movements" element={<StockMovementsPage />} />
            {/* Three doors into the attention board. A prop, not three boards:
                the rail names the questions an owner asks separately, and the
                page answers whichever one it was opened by. */}
            <Route path="/admin/stock/near-expiry" element={<StockOverviewPage initialView="near-expiry" />} />
            <Route path="/admin/stock/slow-moving" element={<StockOverviewPage initialView="slow-moving" />} />
            <Route path="/admin/stock/value" element={<StockOverviewPage focus="value" />} />

            <Route path="/admin/panel" element={<PanelWorkspacePage />} />
            <Route path="/admin/finance/payables" element={<PayablesPage />} />
            <Route path="/admin/finance/panel-money" element={<PanelMoneyPage />} />
            <Route path="/admin/panel/import" element={<ClaimImportPage />} />
            <Route path="/admin/stock/new-item-requests" element={<NewItemRequestsPage />} />
            <Route path="/admin/panel/configuration" element={<PanelConfigPage />} />
            <Route path="/admin/panel/batches" element={<PanelClaimsPage />} />
            <Route path="/admin/panel/companies" element={<PanelClinicsPage />} />

            {/*
              * HR OPENS ON PAYROLL. Paying people is why this module is
              * opened at all; a dashboard about HR is not a thing anybody
              * arrives meaning to look at. The old landing keeps a URL of its
              * own — it is a useful screen, just not the front door.
              */}
            <Route path="/admin/hr" element={<Navigate to="/admin/hr/payroll" replace />} />
            <Route path="/admin/hr/today" element={<HrOverviewPage />} />

            {/* SIX GROUPS, AND THE URLS THAT USED TO BE TWELVE.
                Each group has a canonical path; every route it absorbed still
                resolves, because links to them are in the user guide, in
                payroll exception remedies, and in people's bookmarks. The old
                top-level names redirect so there is ONE canonical URL per
                screen; the detail routes under them are untouched. */}
            {/* "Employees" is the word the product uses everywhere else, so it
                is the word in the URL. `/people` was the odd one out. */}
            <Route path="/admin/hr/employees" element={<EmployeesPage />} />
            <Route path="/admin/hr/employees/new" element={<AddEmployeePage />} />
            <Route path="/admin/hr/employees/bulk" element={<BulkEmployeesPage />} />
            <Route path="/admin/hr/people" element={<Navigate to="/admin/hr/employees" replace />} />
            <Route path="/admin/hr/people/new" element={<Navigate to="/admin/hr/employees/new" replace />} />
            {/* One employee, addressable. The record used to live only in a
                drawer, so it could not be linked to, left open, or reached from
                a payroll exception without landing on a directory first. */}
            <Route path="/admin/hr/employees/:staffId" element={<EmployeeWorkspacePage />} />

            {/* TIME & LEAVE — one section, four views. Attendance, roster,
                leave and claims all answer "was somebody meant to work, did
                they, and what have they asked me for?". They were four
                top-level tabs. Every old URL still resolves. */}
            {/*
              * THREE SEPARATE DECISIONS, THREE ENTRIES. "Time & Leave" bundled
              * "was somebody here", "may somebody be away" and "do we owe
              * somebody money back" behind one label, so two of the three were
              * invisible until you clicked the third.
              */}
            <Route path="/admin/hr/attendance" element={<TimesheetPage />} />
            <Route path="/admin/hr/attendance/roster" element={<AdminRosterPage />} />
            <Route path="/admin/hr/leave" element={<LeavePage />} />
            <Route path="/admin/hr/claims" element={<ClaimsPage />} />
            <Route path="/admin/hr/time" element={<Navigate to="/admin/hr/attendance" replace />} />
            <Route path="/admin/hr/time/roster" element={<Navigate to="/admin/hr/attendance/roster" replace />} />
            <Route path="/admin/hr/time/leave" element={<Navigate to="/admin/hr/leave" replace />} />
            <Route path="/admin/hr/time/claims" element={<Navigate to="/admin/hr/claims" replace />} />
            <Route path="/admin/hr/schedule" element={<Navigate to="/admin/hr/attendance/roster" replace />} />
            <Route path="/admin/hr/roster" element={<Navigate to="/admin/hr/attendance/roster" replace />} />
            <Route path="/admin/hr/requests" element={<Navigate to="/admin/hr/leave" replace />} />

            {/* PAYROLL OPENS ON THE MONTH, not on a page about payroll. The
                landing dashboard this replaced put a hero, three explanatory
                cards and a table of previous runs between an owner and the
                register they came to read. */}
            <Route path="/admin/hr/payroll" element={<PayrollMonthPage />} />
            <Route path="/admin/hr/payroll/history" element={<PayrollHistoryPage />} />
            {/* Readiness was a whole page listing who was not ready. It now sits
                beside the person it is about, on their register row — so the URL
                lands on the register rather than 404ing a bookmark. */}
            <Route path="/admin/hr/payroll/readiness" element={<Navigate to="/admin/hr/payroll" replace />} />
            <Route path="/admin/hr/payroll/all" element={<Navigate to="/admin/hr/payroll/history" replace />} />
            {/* ONE PERSON'S MONTH — employee-payroll.html. Reached from the grid's rows. */}
            <Route path="/admin/hr/payroll/:id/employees/:staffId" element={<PayrollEmployeePage />} />
            <Route path="/admin/hr/payroll/:id/filing" element={<StatutoryFilingPage />} />
            <Route path="/admin/hr/payroll/:id" element={<PayrollRunPage />} />
            <Route path="/admin/hr/incentives" element={<IncentivesPage />} />
            {/* Medical benefits is a view of Employees now (Piece 1 decision); the old address still lands on it. */}
            <Route path="/admin/hr/benefits" element={<Navigate to="/admin/hr/employees?view=benefits" replace />} />
            <Route path="/admin/hr/locum" element={<LocumPage />} />
            <Route path="/admin/hr/reports" element={<PayrollReportsPage />} />
            <Route path="/admin/hr/reports/year-end" element={<EaFormsPage />} />
            {/*
              * SETTINGS IS ONE PLACE, UNDER HR. It used to be two: six cards
              * here, and a near-empty "HR & Attendance" category in Clinic
              * Settings holding Public Holidays alone. A manager looking for
              * "HR settings" could land on either, and one of them was almost
              * nothing.
              */}
            <Route path="/admin/hr/settings" element={<HrSettingsPage />} />
            <Route path="/admin/hr/settings/company" element={<LegalEmployersPage />} />
            <Route path="/admin/hr/settings/payroll-items" element={<PayrollItemsPage />} />
            <Route path="/admin/hr/settings/statutory" element={<StatutoryRatesPage />} />
            <Route path="/admin/hr/settings/payroll" element={<PayrollSettingsPage />} />
            <Route path="/admin/hr/settings/attendance-leave" element={<AttendanceSettingsPage />} />
            <Route path="/admin/hr/settings/public-holidays" element={<PublicHolidaysPage />} />
            <Route path="/admin/hr/settings/shifts" element={<ShiftSettingsPage />} />
            <Route path="/admin/hr/settings/opening-balances" element={<YtdOpeningImportPage />} />
            {/* Where each of those used to live. */}
            <Route path="/admin/hr/employers" element={<Navigate to="/admin/hr/settings/company" replace />} />
            <Route
              path="/admin/hr/settings/attendance"
              element={<Navigate to="/admin/hr/settings/attendance-leave" replace />}
            />
            <Route
              path="/admin/hr/payroll/ytd-opening"
              element={<Navigate to="/admin/hr/settings/opening-balances" replace />}
            />
            {/* Roles are product-wide, not HR's. One home, in Clinic Settings. */}
            <Route path="/admin/hr/access" element={<Navigate to="/settings/organisation/roles" replace />} />

            <Route path="/admin/finance" element={<FinanceOverviewPage />} />
            <Route path="/admin/finance/sales" element={<SalesAnalysisPage />} />
            <Route path="/admin/finance/day-end" element={<DayEndClosingPage />} />
            <Route path="/admin/finance/payments" element={<PaymentsPage />} />
            {/* The existing invoice listing. There is one invoice source. */}
            <Route path="/admin/finance/invoices" element={<InvoiceListingPage />} />
            <Route path="/admin/finance/receivables" element={<ReceivablesPage />} />
            <Route path="/admin/finance/credit-notes" element={<CreditNotesPage />} />
            <Route path="/admin/finance/tax" element={<TaxPage />} />
            <Route path="/admin/finance/profitability" element={<ProfitabilityPage />} />
            <Route path="/admin/finance/inter-company" element={<InterCompanyPage />} />
            <Route path="/admin/finance/e-invoice" element={<EInvoicePage />} />
          </Route>

          <Route path="/settings" element={<Navigate to="/settings/organisation/branches" replace />} />
          <Route element={<SettingsLayout />}>
            <Route path="/settings/organisation/branches" element={<ClinicsPage />} />
            <Route path="/settings/organisation/roles" element={<RolesSettingsPage />} />
            <Route path="/settings/organisation/users" element={<UsersSettingsPage />} />
            <Route path="/settings/queue/rooms" element={<RoomsPage />} />
            <Route path="/settings/queue/display" element={<QueueDisplaySettingsPage />} />
            {/* The branch's own booking defaults — first/last session, notice,
                horizon, closed dates. Service-level rules live in the
                Appointments module's Services tab. */}
            <Route path="/settings/scheduling/booking-rules" element={<BookingRulesPage />} />
            {/* PHASE 8 — the one store for message templates and reminder
                timing; the Booking Page tab links here. */}
            <Route
              path="/settings/scheduling/communication"
              element={<CommunicationSettingsPage />}
            />
            <Route path="/settings/clinical/services" element={<ServicesPage />} />
            <Route path="/settings/clinical/consultation-tariffs" element={<ConsultationTariffsPage />} />
            <Route path="/settings/clinical/diagnoses" element={<DiagnosesDirectoryPage />} />
            <Route
              path="/settings/clinical/prescription-vocabulary"
              element={<PrescriptionVocabularyPage />}
            />
            <Route path="/settings/documents/templates" element={<DocumentTemplatesPage />} />
            <Route
              path="/settings/hr/public-holidays"
              element={<Navigate to="/admin/hr/settings/public-holidays" replace />}
            />
          </Route>

          {/* Old-URL redirects (M1/M2) — bookmarks and deep links keep
              working; nothing is deleted. */}
          <Route path="/management/operation/clinics" element={<Navigate to="/settings/organisation/branches" replace />} />
          <Route path="/management/operation/services" element={<Navigate to="/settings/clinical/services" replace />} />
          {/* THE RETIRED SCHEDULING PAGES. Doctor-Service Mapping and Slot
              Capacity are no longer top-level clinic-owner workflows: both are
              tabs of the service editor, because "who can do this?" and "how
              many at once?" are questions about a service. The junction tables
              are untouched — only the presentation moved — and every old URL
              REDIRECTS rather than 404s, because a bookmark that breaks is how
              somebody concludes the feature was removed.

              The main-nav Schedules page and Provider Availability are gone
              for a harder reason: they wrote the same table with opposite
              models, and saving one silently destroyed the other's rows. There
              is now one roster. */}
          <Route path="/management/operation/qualifications" element={<Navigate to="/appointments/services" replace />} />
          <Route path="/settings/scheduling/doctor-service-mapping" element={<Navigate to="/appointments/services" replace />} />
          <Route path="/management/operation/slot-capacity" element={<Navigate to="/appointments/services" replace />} />
          <Route path="/settings/scheduling/slot-capacity" element={<Navigate to="/appointments/services" replace />} />
          <Route path="/management/operation/doctor-schedules" element={<Navigate to="/appointments/roster" replace />} />
          <Route path="/settings/scheduling/provider-availability" element={<Navigate to="/appointments/roster" replace />} />
          <Route path="/management/operation/diagnoses" element={<Navigate to="/settings/clinical/diagnoses" replace />} />
          <Route path="/management/operation/rooms" element={<Navigate to="/settings/queue/rooms" replace />} />
          <Route path="/management/operation/queue-display" element={<Navigate to="/settings/queue/display" replace />} />
          <Route path="/management/operation/document-templates" element={<Navigate to="/settings/documents/templates" replace />} />
          <Route path="/management/hr/public-holidays" element={<Navigate to="/admin/hr/settings/public-holidays" replace />} />
          <Route path="/management/stock/levels" element={<Navigate to="/management/stock/health" replace />} />
          <Route path="/management/stock/low-stock" element={<Navigate to="/management/stock/health?tab=low" replace />} />
          <Route path="/management/stock/near-expiry" element={<Navigate to="/management/stock/health?tab=near-expiry" replace />} />
          <Route path="/management/stock/negative-stock" element={<Navigate to="/management/stock/health?tab=negative" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
