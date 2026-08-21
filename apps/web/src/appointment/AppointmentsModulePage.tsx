import { useMemo, useState } from 'react';
import { Button, ConfigProvider, Select, Tabs, Tooltip, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { permissionHint, useCan } from '../core/hooks/useCan';
import { useNavigate, useParams } from 'react-router-dom';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { CalendarWorkspace } from './calendar/CalendarWorkspace';
import { AppointmentListView } from './list/AppointmentListView';
import { RosterPage } from './roster/RosterPage';
import { ServicesPage } from './services/ServicesPage';
import { BookingPageSettings } from './booking-page/BookingPageSettings';
import { StaffBookingFlow } from './StaffBookingFlow';
import { appointmentTheme } from './appointment-theme';

const TABS = ['calendar', 'list', 'roster', 'services', 'booking-page'] as const;
export type AppointmentTab = (typeof TABS)[number];

const TAB_LABELS: Record<AppointmentTab, string> = {
  calendar: 'Calendar',
  list: 'List',
  roster: 'Roster & Availability',
  services: 'Services',
  'booking-page': 'Booking Page',
};

/**
 * APPOINTMENTS — one module, five surfaces (§6).
 *
 * The tabs replace four separate settings screens and a second roster page in
 * the main navigation. What each one absorbed:
 *
 *   Roster & Availability  the two roster screens that used to write the same
 *       table with opposite models, one of which deleted the other's rows.
 *   Services               Doctor-Service Mapping (now Service ▸ Providers)
 *       and Slot Capacity (now Service ▸ Scheduling). Both junctions survive
 *       untouched; only their presentation moved, because "who can do this?"
 *       is a question about a service and not a grid of every doctor against
 *       every service.
 *   Booking Page           the public link, its fields, its reminders and its
 *       sharing, which were never anywhere.
 *
 * CALENDAR IS THE DEFAULT (§7). Opening Appointments should show the day, not
 * a filter form: the receptionist's first question every morning is "who is
 * coming in", and the list answers a different one.
 *
 * V3 COMPOSITION — three layers. The app shell above is untouched; this page
 * owns the MODULE HEADER (title, the one primary action, the branch, the five
 * surfaces) and the WORKING CANVAS, a raised white surface the active tab
 * renders into. "New appointment" lives here, once, so it exists on every
 * surface instead of being one control among six on two of them.
 */
export function AppointmentsModulePage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const [booking, setBooking] = useState(false);

  const active: AppointmentTab = TABS.includes(tab as AppointmentTab)
    ? (tab as AppointmentTab)
    : 'calendar';

  // The PATIENT-FACING name (booking-page displayName -> clinic name),
  // resolved server-side on the clinics list. This is the name WhatsApp
  // messages carry, so it must never be the internal environment label.
  const clinicName = useMemo(() => {
    const clinic = clinics?.find((row) => row.id === clinicId);
    return clinic?.patientFacingName?.trim() || clinic?.name || 'the clinic';
  }, [clinics, clinicId]);

  const permCreate = useCan('appointment.create');

  return (
    <ConfigProvider theme={appointmentTheme}>
      <div className="kw-apt3 kw-appt-module">
        <div className="kw-apt3-head">
          <Typography.Title level={3} className="kw-apt3-title">
            Appointments
          </Typography.Title>
          <div className="kw-apt3-head-spacer" />
          {showSelector ? (
            <Select
              placeholder="Branch"
              value={clinicId}
              onChange={setClinicId}
              options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
              style={{ minWidth: 170 }}
            />
          ) : null}
          <Tooltip title={permCreate ? undefined : permissionHint('book an appointment')}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              disabled={!permCreate}
              onClick={() => setBooking(true)}
            >
              New appointment
            </Button>
          </Tooltip>
        </div>

        <Tabs
          className="kw-apt3-nav kw-appt-tabs"
          activeKey={active}
          onChange={(key) => navigate(`/appointments/${key}`)}
          items={TABS.map((value) => ({ key: value, label: TAB_LABELS[value] }))}
        />

        <div className="kw-apt3-canvas">
          {active === 'calendar' ? <CalendarWorkspace clinicId={clinicId} /> : null}
          {active === 'list' ? (
            <AppointmentListView
              clinicId={clinicId}
              clinicName={clinicName}
              onBook={() => setBooking(true)}
            />
          ) : null}
          {active === 'roster' ? <RosterPage clinicId={clinicId} /> : null}
          {active === 'services' ? <ServicesPage clinicId={clinicId} /> : null}
          {active === 'booking-page' ? <BookingPageSettings clinicId={clinicId} /> : null}
        </div>

        <StaffBookingFlow
          open={booking}
          clinicId={clinicId}
          onClose={() => setBooking(false)}
        />
      </div>
    </ConfigProvider>
  );
}
