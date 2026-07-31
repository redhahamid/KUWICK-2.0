import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { ManagementLayout } from './design-system/components/ManagementLayout';
import { LoginPage } from './auth/LoginPage';
import { PlatformLoginPage } from './auth/PlatformLoginPage';
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
import { AppointmentsPage } from './appointment/AppointmentsPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { StaffPage } from './hr/StaffPage';
import { AttendancePage } from './hr/AttendancePage';
import { LeaveRequestsPage } from './hr/LeaveRequestsPage';
import { PublicHolidaysPage } from './hr/PublicHolidaysPage';
import { ServicesPage } from './clinical/ServicesPage';
import { PanelClinicsPage } from './clinical/PanelClinicsPage';
import { PanelClaimsPage } from './clinical/PanelClaimsPage';
import { DiagnosesDirectoryPage } from './clinical/DiagnosesDirectoryPage';
import { PatientDashboardPage } from './clinical/PatientDashboardPage';
import { QueueManagementPage } from './clinical/QueueManagementPage';
import { QueueMonitorPage } from './clinical/QueueMonitorPage';
import { PrintOrderResultPage } from './clinical/PrintOrderResultPage';
import { ProcedureQueuePage } from './clinical/ProcedureQueuePage';
import { DoctorSchedulesPage } from './appointment/DoctorSchedulesPage';
import { DoctorServiceQualificationsPage } from './appointment/DoctorServiceQualificationsPage';
import { SlotCapacityConfigsPage } from './appointment/SlotCapacityConfigsPage';
import { ItemsPage } from './inventory/ItemsPage';
import { SuppliersPage } from './inventory/SuppliersPage';
import { StockLevelsPage } from './inventory/StockLevelsPage';
import { LowStockPage } from './inventory/LowStockPage';
import { NegativeStockPage } from './inventory/NegativeStockPage';
import { ProcurementRequestsPage } from './inventory/ProcurementRequestsPage';
import { PurchaseOrdersPage } from './inventory/PurchaseOrdersPage';
import { ReportsPage } from './reports/ReportsPage';

export function App() {
  return (
    <Routes>
      {/* Public — no sidebar/auth chrome, meant for a waiting-room TV. */}
      <Route path="/queue/monitor/:clinicId" element={<QueueMonitorPage />} />
      <Route path="/print/order-service/:id" element={<PrintOrderResultPage />} />

      {/* Auth (D-034) — separate identities: clinic staff vs platform admin. */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/platform/login" element={<PlatformLoginPage />} />
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
          <Route path="/platform/settings" element={<PlatformSettingsPage />} />
        </Route>
      </Route>

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<AppointmentsPage />} />
          <Route path="/appointments" element={<AppointmentsPage />} />
          <Route path="/patients" element={<PatientsPage />} />
          <Route path="/patients/:id" element={<PatientDashboardPage />} />
          <Route path="/queue" element={<QueueManagementPage />} />
          <Route path="/procedure-queue" element={<ProcedureQueuePage />} />

          {/* Management — HR/Stock/Panel/Operation, director/admin-staff use,
              not daily clinical/front-desk operation (matches Klinik Hijraa
              CMS's own admin-panel separation). */}
          <Route element={<ManagementLayout />}>
            <Route path="/management/reports" element={<ReportsPage />} />

            <Route path="/management/operation/clinics" element={<ClinicsPage />} />
            <Route path="/management/operation/services" element={<ServicesPage />} />
            <Route path="/management/operation/doctor-schedules" element={<DoctorSchedulesPage />} />
            <Route path="/management/operation/qualifications" element={<DoctorServiceQualificationsPage />} />
            <Route path="/management/operation/slot-capacity" element={<SlotCapacityConfigsPage />} />
            <Route path="/management/operation/diagnoses" element={<DiagnosesDirectoryPage />} />

            <Route path="/management/hr/staff" element={<StaffPage />} />
            <Route path="/management/hr/attendance" element={<AttendancePage />} />
            <Route path="/management/hr/leave-requests" element={<LeaveRequestsPage />} />
            <Route path="/management/hr/public-holidays" element={<PublicHolidaysPage />} />

            <Route path="/management/stock/items" element={<ItemsPage />} />
            <Route path="/management/stock/suppliers" element={<SuppliersPage />} />
            <Route path="/management/stock/levels" element={<StockLevelsPage />} />
            <Route path="/management/stock/low-stock" element={<LowStockPage />} />
            <Route path="/management/stock/negative-stock" element={<NegativeStockPage />} />
            <Route path="/management/stock/procurement-requests" element={<ProcurementRequestsPage />} />
            <Route path="/management/stock/purchase-orders" element={<PurchaseOrdersPage />} />

            <Route path="/management/panel/clinics" element={<PanelClinicsPage />} />
            <Route path="/management/panel/claims" element={<PanelClaimsPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
