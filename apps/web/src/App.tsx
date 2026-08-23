import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { ManagementLayout } from './design-system/components/ManagementLayout';
import { SettingsLayout } from './design-system/components/SettingsLayout';
import { StockHealthPage } from './inventory/StockHealthPage';
import { LoginPage } from './auth/LoginPage';
import { RequireAuth } from './auth/RequireAuth';
import { RequirePlatformAuth } from './auth/RequirePlatformAuth';
import { PlatformLayout } from './platform/PlatformLayout';
import { PlatformDashboardPage } from './platform/PlatformDashboardPage';
import { PlatformClinicsPage } from './platform/PlatformClinicsPage';
import { PlatformPlansPage } from './platform/PlatformPlansPage';
import { PlatformSubscriptionsPage } from './platform/PlatformSubscriptionsPage';
import { PlatformPanelClinicsPage } from './platform/PlatformPanelClinicsPage';
import { PlatformProceduresPage } from './platform/PlatformProceduresPage';
import { PlatformSettingsPage } from './platform/PlatformSettingsPage';
import { AppointmentsModulePage } from './appointment/AppointmentsModulePage';
import { PublicBookingPage } from './appointment/public/PublicBookingPage';
import { ManageBookingPage } from './appointment/public/ManageBookingPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { StaffPage } from './hr/StaffPage';
import { AttendancePage } from './hr/AttendancePage';
import { LeaveRequestsPage } from './hr/LeaveRequestsPage';
import { PublicHolidaysPage } from './hr/PublicHolidaysPage';
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

            <Route path="/management/hr/staff" element={<StaffPage />} />
            <Route path="/management/hr/attendance" element={<AttendancePage />} />
            <Route path="/management/hr/leave-requests" element={<LeaveRequestsPage />} />

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
          <Route path="/settings" element={<Navigate to="/settings/organisation/branches" replace />} />
          <Route element={<SettingsLayout />}>
            <Route path="/settings/organisation/branches" element={<ClinicsPage />} />
            <Route path="/settings/organisation/roles" element={<RolesSettingsPage />} />
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
            <Route path="/settings/hr/public-holidays" element={<PublicHolidaysPage />} />
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
          <Route path="/management/hr/public-holidays" element={<Navigate to="/settings/hr/public-holidays" replace />} />
          <Route path="/management/stock/levels" element={<Navigate to="/management/stock/health" replace />} />
          <Route path="/management/stock/low-stock" element={<Navigate to="/management/stock/health?tab=low" replace />} />
          <Route path="/management/stock/near-expiry" element={<Navigate to="/management/stock/health?tab=near-expiry" replace />} />
          <Route path="/management/stock/negative-stock" element={<Navigate to="/management/stock/health?tab=negative" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
