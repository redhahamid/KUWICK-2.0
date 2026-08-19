import { useMemo, useState } from 'react';
import { Select, Tabs, Typography } from 'antd';
import { useNavigate, useParams } from 'react-router-dom';
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
      {/* §9 — ONE header row: title, the five surfaces, the branch. The old
          composition spent three stacked bands (title+subtitle, tabs, then
          the toolbar) before a single appointment was visible; on a laptop
          that was the first booking of the day below the fold. The tab name
          already says what the surface is — the subtitle line paid rent in
          pixels for information the tab label carried. */}
      <div className="kw-appt-header">
        <Typography.Title level={4} className="kw-page-title" style={{ margin: 0 }}>
          Appointments
        </Typography.Title>
        <Tabs
          className="kw-appt-tabs"
          activeKey={active}
          onChange={(key) => navigate(`/appointments/${key}`)}
          items={TABS.map((value) => ({ key: value, label: TAB_LABELS[value] }))}
        />
        {showSelector ? (
          <Select
            placeholder="Branch"
            value={clinicId}
            onChange={setClinicId}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            style={{ minWidth: 170 }}
          />
        ) : null}
      </div>

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
