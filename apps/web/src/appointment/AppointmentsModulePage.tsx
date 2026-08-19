import { useMemo, useState } from 'react';
import { Select, Space, Tabs } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../design-system/components/PageHeader';
import { useClinicFilter } from '../core/hooks/useClinicFilter';
import { CalendarWorkspace } from './calendar/CalendarWorkspace';
import { AppointmentListView } from './list/AppointmentListView';
import { RosterPage } from './roster/RosterPage';
import { ServicesPage } from './services/ServicesPage';
import { BookingPageSettings } from './booking-page/BookingPageSettings';
import { StaffBookingFlow } from './StaffBookingFlow';

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
 */
export function AppointmentsModulePage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();
  const { clinicId, clinics, showSelector, setClinicId } = useClinicFilter();
  const [booking, setBooking] = useState(false);

  const active: AppointmentTab = TABS.includes(tab as AppointmentTab)
    ? (tab as AppointmentTab)
    : 'calendar';

  const clinicName = useMemo(
    () => clinics?.find((clinic) => clinic.id === clinicId)?.name ?? 'the clinic',
    [clinics, clinicId],
  );

  return (
    <div className="kw-appt-module">
      <PageHeader
        title="Appointments"
        subtitle={
          active === 'calendar'
            ? 'The diary, in the clinic’s own clock.'
            : active === 'roster'
              ? 'Who is working, and when they can be booked.'
              : active === 'services'
                ? 'What can be booked, by whom, and on what terms.'
                : active === 'booking-page'
                  ? 'The link patients book through.'
                  : 'The diary as a worklist.'
        }
        extra={
          showSelector ? (
            <Space>
              <Select
                placeholder="Branch"
                value={clinicId}
                onChange={setClinicId}
                options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
                style={{ minWidth: 170 }}
              />
            </Space>
          ) : null
        }
      />

      <Tabs
        activeKey={active}
        onChange={(key) => navigate(`/appointments/${key}`)}
        items={TABS.map((value) => ({ key: value, label: TAB_LABELS[value] }))}
      />

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

      <StaffBookingFlow
        open={booking}
        clinicId={clinicId}
        onClose={() => setBooking(false)}
      />
    </div>
  );
}
