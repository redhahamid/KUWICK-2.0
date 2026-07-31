import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { ManagementLayout } from './design-system/components/ManagementLayout';
import { AppointmentsPage } from './appointment/AppointmentsPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { StaffPage } from './hr/StaffPage';
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

export function App() {
  return (
    <Routes>
      {/* Public — no sidebar/auth chrome, meant for a waiting-room TV. */}
      <Route path="/queue/monitor/:clinicId" element={<QueueMonitorPage />} />
      <Route path="/print/order-service/:id" element={<PrintOrderResultPage />} />
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
          <Route path="/management/operation/clinics" element={<ClinicsPage />} />
          <Route path="/management/operation/services" element={<ServicesPage />} />
          <Route path="/management/operation/doctor-schedules" element={<DoctorSchedulesPage />} />
          <Route path="/management/operation/qualifications" element={<DoctorServiceQualificationsPage />} />
          <Route path="/management/operation/slot-capacity" element={<SlotCapacityConfigsPage />} />
          <Route path="/management/operation/diagnoses" element={<DiagnosesDirectoryPage />} />

          <Route path="/management/hr/staff" element={<StaffPage />} />

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
    </Routes>
  );
}
