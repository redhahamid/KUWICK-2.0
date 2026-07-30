import { Route, Routes } from 'react-router-dom';
import { AppLayout } from './design-system/components/AppLayout';
import { AppointmentsPage } from './appointment/AppointmentsPage';
import { ClinicsPage } from './core/ClinicsPage';
import { PatientsPage } from './core/PatientsPage';
import { StaffPage } from './hr/StaffPage';
import { ServicesPage } from './appointment/ServicesPage';
import { DoctorSchedulesPage } from './appointment/DoctorSchedulesPage';
import { DoctorServiceQualificationsPage } from './appointment/DoctorServiceQualificationsPage';
import { SlotCapacityConfigsPage } from './appointment/SlotCapacityConfigsPage';

export function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<AppointmentsPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/clinics" element={<ClinicsPage />} />
        <Route path="/patients" element={<PatientsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/doctor-schedules" element={<DoctorSchedulesPage />} />
        <Route path="/doctor-service-qualifications" element={<DoctorServiceQualificationsPage />} />
        <Route path="/slot-capacity-configs" element={<SlotCapacityConfigsPage />} />
      </Route>
    </Routes>
  );
}
