import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { AppointmentsPage } from './appointment/AppointmentsPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { StaffPage } from './hr/StaffPage';
import { ServicesPage } from './clinical/ServicesPage';
import { DiagnosesDirectoryPage } from './clinical/DiagnosesDirectoryPage';
import { PatientDashboardPage } from './clinical/PatientDashboardPage';
import { QueueManagementPage } from './clinical/QueueManagementPage';
import { QueueMonitorPage } from './clinical/QueueMonitorPage';
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
      <Route element={<AppLayout />}>
        <Route index element={<AppointmentsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/clinics" element={<ClinicsPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/patients/:id" element={<PatientDashboardPage />} />
        <Route path="/queue" element={<QueueManagementPage />} />
        <Route path="/procedure-queue" element={<ProcedureQueuePage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/diagnoses" element={<DiagnosesDirectoryPage />} />
        <Route path="/doctor-schedules" element={<DoctorSchedulesPage />} />
        <Route path="/doctor-service-qualifications" element={<DoctorServiceQualificationsPage />} />
        <Route path="/slot-capacity-configs" element={<SlotCapacityConfigsPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/suppliers" element={<SuppliersPage />} />
        <Route path="/stock-levels" element={<StockLevelsPage />} />
        <Route path="/low-stock" element={<LowStockPage />} />
        <Route path="/negative-stock" element={<NegativeStockPage />} />
        <Route path="/procurement-requests" element={<ProcurementRequestsPage />} />
        <Route path="/purchase-orders" element={<PurchaseOrdersPage />} />
      </Route>
    </Routes>
  );
}
