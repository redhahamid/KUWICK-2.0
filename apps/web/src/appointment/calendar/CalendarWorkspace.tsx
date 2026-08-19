import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as BigCalendar, dayjsLocalizer, Views } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Segmented,
  Select,
  Space,
  Spin,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { LeftOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { AppointmentStatus } from '@kuwick/shared';
import { useAppointments, useRescheduleAppointment } from '../hooks/useAppointments';
import { useRosterRange } from '../hooks/useRoster';
import { useStaff } from '../../hr/hooks/useStaff';
import { useServices } from '../../clinical/hooks/useServices';
import { usePatients } from '../../core/hooks/usePatients';
import { clinicDayjs, clinicWallDate, fromClinicWallDate, formatClinicTime, getClinicTimeZone } from '../../clinical/clinicTime';
import { Appointment } from '../types';
import { AppointmentDrawer } from './AppointmentDrawer';
import { StaffBookingFlow } from '../StaffBookingFlow';
import { CalendarMetrics } from './CalendarMetrics';
import { CalendarViewMode, getCalendarRange, shiftAnchor, todayAnchor } from './calendar-range';
import { cardLines, earliestRosteredHour, gridBounds, isReleased, scrollToHour, compactLine } from './calendar-events';
import { getDoctorColor } from './doctor-color';
import { ApiError } from '../../core/api-client';

dayjs.extend(utc);
dayjs.extend(timezone);
const localizer = dayjsLocalizer(dayjs);

const { Text } = Typography;

const VIEW_OPTIONS: { label: string; value: CalendarViewMode }[] = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
  { label: 'Providers', value: 'providers' },
];

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  appointment: Appointment;
  lines: string[];
  /** "09:00 Siti" — the narrow-column rendering (week/month). */
  compact: string;
  released: boolean;
}

interface CalendarWorkspaceProps {
  clinicId?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * THE CALENDAR — the module's default workspace (§7).
 *
 * LAYOUT (§8). The grid takes the whole width. Selecting an appointment opens
 * a DRAWER over the right-hand edge rather than a panel that is permanently
 * reserved and empty most of the time: on a 13-inch laptop that panel was the
 * difference between five provider columns and three.
 *
 * RESCHEDULING (§48) is pick-up-and-place, and that is a deliberate choice
 * rather than a missing feature. Drag-and-drop through `react-big-calendar`'s
 * addon does not survive this project's production bundle — the CJS default
 * export comes through as an object, `(0, addon.default)` is not a function,
 * and because the router mounts at the root the whole application renders
 * blank. Pick-up-and-place works identically on a tablet, which drag does not,
 * and it goes through the SAME server-side reschedule endpoint: availability
 * is revalidated, conflicts refuse with a sentence, and the move is audited.
 * Nothing is ever mutated client-side.
 */
export function CalendarWorkspace({ clinicId }: CalendarWorkspaceProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('day');
  const [anchor, setAnchor] = useState<Dayjs>(() => todayAnchor());
  const [providerFilter, setProviderFilter] = useState<string[]>([]);
  const [serviceFilter, setServiceFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ staffId?: string; start?: Dayjs } | null>(null);
  // The appointment picked up for moving. Two-step rather than a drag — see
  // the block comment above.
  const [moving, setMoving] = useState<Appointment | null>(null);

  const reschedule = useRescheduleAppointment();
  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const { data: patients } = usePatients();

  const range = useMemo(() => getCalendarRange(viewMode, anchor), [viewMode, anchor]);

  const { data: appointments, isLoading } = useAppointments({
    clinicId,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
  });
  const { data: shifts } = useRosterRange(
    clinicId,
    range.start.format('YYYY-MM-DD'),
    range.end.format('YYYY-MM-DD'),
  );

  const providers = useMemo(() => {
    // The providers ON THIS CLINIC'S ROSTER, not every staff member. A grid
    // with a column for the finance clerk is a grid nobody can read.
    const rostered = new Set((shifts ?? []).map((shift) => shift.staffId));
    const booked = new Set((appointments ?? []).map((appointment) => appointment.staffId));
    return (staff ?? []).filter(
      (member) => rostered.has(member.id) || booked.has(member.id),
    );
  }, [staff, shifts, appointments]);

  const visibleProviderIds = useMemo(
    () => new Set(providerFilter.length > 0 ? providerFilter : providers.map((p) => p.id)),
    [providerFilter, providers],
  );

  const patientName = useCallback(
    (id: string) => patients?.find((patient) => patient.id === id)?.name ?? 'Patient',
    [patients],
  );
  const staffName = useCallback(
    (id: string) => staff?.find((member) => member.id === id)?.fullName ?? '',
    [staff],
  );
  const serviceName = useCallback(
    (id: string) => services?.find((service) => service.id === id)?.name ?? '',
    [services],
  );

  const events: CalendarEvent[] = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (appointments ?? [])
      .filter((appointment) => visibleProviderIds.has(appointment.staffId))
      .filter(
        (appointment) => serviceFilter.length === 0 || serviceFilter.includes(appointment.serviceId),
      )
      .filter(
        (appointment) => statusFilter.length === 0 || statusFilter.includes(appointment.status),
      )
      .filter((appointment) =>
        term ? patientName(appointment.patientId).toLowerCase().includes(term) : true,
      )
      .map((appointment) => {
        // Pseudo-dates: the grid positions by LOCAL fields, so it is handed
        // the clinic wall clock (clinicWallDate) — the same clock every label
        // already renders. Anything the grid returns goes back through
        // fromClinicWallDate before it touches the server. D-103.
        const start = clinicWallDate(appointment.scheduledStart);
        const end = clinicWallDate(appointment.scheduledEnd);
        const minutes = (end.getTime() - start.getTime()) / 60000;
        const lines = cardLines(
          {
            time: formatClinicTime(appointment.scheduledStart),
            timeRange: `${formatClinicTime(appointment.scheduledStart)} – ${formatClinicTime(appointment.scheduledEnd)}`,
            patientName: patientName(appointment.patientId),
            serviceName: serviceName(appointment.serviceId),
            providerName: staffName(appointment.staffId),
          },
          minutes,
        );
        return {
          id: appointment.id,
          title: lines.join(' · '),
          start,
          end,
          resourceId: appointment.staffId,
          appointment,
          lines,
          compact: compactLine(
            formatClinicTime(appointment.scheduledStart),
            patientName(appointment.patientId),
          ),
          released: isReleased(appointment.status),
        };
      });
  }, [
    appointments,
    visibleProviderIds,
    serviceFilter,
    statusFilter,
    search,
    patientName,
    serviceName,
    staffName,
  ]);

  const bounds = useMemo(() => gridBounds(shifts), [shifts]);
  const scrollHour = useMemo(
    () =>
      scrollToHour({
        anchor,
        now: clinicDayjs(new Date()),
        earliestRosteredHour: earliestRosteredHour(shifts),
      }),
    [anchor, shifts],
  );

  const gridRef = useRef<HTMLDivElement>(null);

  // §12 — WHERE NOW IS, said in the gutter's own words. react-big-calendar
  // draws the red line; this pins a small pill reading the clinic clock into
  // the hour gutter at the same height, so "now" is a time you can read and
  // not only a line you can see. DOM-side on purpose: the indicator is
  // library-rendered, and re-applied on a slow tick because the grid
  // re-renders freely and replaces it.
  useEffect(() => {
    const paint = () => {
      const grid = gridRef.current;
      if (!grid) return;
      const gutter = grid.querySelector<HTMLElement>('.rbc-time-gutter');
      const indicator = grid.querySelector<HTMLElement>('.rbc-current-time-indicator');
      let pill = grid.querySelector<HTMLElement>('.kw-now-pill');
      if (!gutter || !indicator) {
        pill?.remove();
        return;
      }
      if (!pill || pill.parentElement !== gutter) {
        pill?.remove();
        pill = document.createElement('span');
        pill.className = 'kw-now-pill';
        pill.setAttribute('aria-hidden', 'true');
        gutter.appendChild(pill);
      }
      pill.textContent = formatClinicTime(new Date());
      const offset = indicator.getBoundingClientRect().top - gutter.getBoundingClientRect().top;
      pill.style.top = `${Math.max(0, offset)}px`;
    };
    paint();
    const timer = window.setInterval(paint, 30_000);
    return () => window.clearInterval(timer);
  }, [viewMode, anchor, events, isLoading]);

  // Keyboard: D / W / M / P and the arrows. A receptionist works the calendar
  // all day and reaching for the mouse to move one day is friction that adds up.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey) return;
      const map: Record<string, CalendarViewMode> = { d: 'day', w: 'week', m: 'month', p: 'providers' };
      const view = map[event.key.toLowerCase()];
      if (view) {
        setViewMode(view);
        return;
      }
      if (event.key === 'ArrowLeft') setAnchor((current) => shiftAnchor(viewMode, current, -1));
      if (event.key === 'ArrowRight') setAnchor((current) => shiftAnchor(viewMode, current, 1));
      if (event.key.toLowerCase() === 't') setAnchor(todayAnchor());
      if (event.key === 'Escape') setMoving(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewMode]);

  /**
   * An empty slot: either PLACE the appointment being moved, or start a new
   * booking prefilled with the provider, the date and the time.
   */
  const onSlot = async (slot: { start: Date; end: Date; resourceId?: string | number }) => {
    const staffId = slot.resourceId ? String(slot.resourceId) : moving?.staffId;
    // The grid speaks wall-clock pseudo-dates (see the events mapping);
    // convert back to a real instant the moment one leaves it.
    const slotStart = fromClinicWallDate(slot.start);
    if (!moving) {
      setBooking({ staffId, start: clinicDayjs(slotStart) });
      return;
    }
    const minutes =
      (new Date(moving.scheduledEnd).getTime() - new Date(moving.scheduledStart).getTime()) / 60000;
    const target = moving;
    setMoving(null);
    try {
      await reschedule.mutateAsync({
        id: target.id,
        input: {
          scheduledStart: slotStart.toISOString(),
          scheduledEnd: new Date(slotStart.getTime() + minutes * 60000).toISOString(),
          ...(staffId && staffId !== target.staffId ? { staffId } : {}),
          reason: 'Moved on the calendar',
        },
      });
      message.success('Appointment moved');
    } catch (error) {
      // THE SERVER'S OWN WORDS. It knows whether the slot is taken, off the
      // grid, outside the clinic's hours or past its notice period, and a
      // generic "could not move" would send somebody hunting for which.
      message.error(
        error instanceof ApiError ? error.message : 'That appointment could not be moved.',
      );
    }
  };

  const onSelectEvent = (event: CalendarEvent) => {
    if (moving?.id === event.id) {
      setMoving(null);
      return;
    }
    setSelectedId(event.id);
  };

  const rbcView =
    viewMode === 'providers' ? Views.DAY : viewMode === 'day' ? Views.DAY : viewMode === 'week' ? Views.WEEK : Views.MONTH;

  const resources =
    viewMode === 'providers'
      ? providers
          .filter((provider) => visibleProviderIds.has(provider.id))
          .map((provider) => ({ resourceId: provider.id, resourceTitle: provider.fullName }))
      : undefined;

  const heading = useMemo(() => {
    if (viewMode === 'month') return anchor.format('MMMM YYYY');
    if (viewMode === 'week') {
      return `${range.start.format('D MMM')} – ${range.end.format('D MMM YYYY')}`;
    }
    return anchor.format('dddd D MMMM YYYY');
  }, [viewMode, anchor, range]);

  return (
    <div className="kw-calendar-workspace" data-testid="calendar-workspace">
      <div className="kw-calendar-toolbar">
        <Space wrap size={8}>
          <Button.Group>
            <Button
              icon={<LeftOutlined />}
              aria-label="Previous"
              onClick={() => setAnchor((current) => shiftAnchor(viewMode, current, -1))}
            />
            <Button onClick={() => setAnchor(todayAnchor())}>Today</Button>
            <Button
              icon={<RightOutlined />}
              aria-label="Next"
              onClick={() => setAnchor((current) => shiftAnchor(viewMode, current, 1))}
            />
          </Button.Group>
          <DatePicker
            value={anchor}
            onChange={(value) => value && setAnchor(value)}
            allowClear={false}
            format="D MMM YYYY"
          />
          <Text strong style={{ fontSize: 15 }}>
            {heading}
          </Text>
          <Segmented
            value={viewMode}
            options={VIEW_OPTIONS}
            onChange={(value) => setViewMode(value as CalendarViewMode)}
          />
        </Space>

        <Space wrap size={8}>
          <Select
            mode="multiple"
            allowClear
            maxTagCount={1}
            style={{ minWidth: 160 }}
            placeholder="All providers"
            value={providerFilter}
            onChange={setProviderFilter}
            options={providers.map((provider) => ({
              value: provider.id,
              label: provider.fullName,
            }))}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount={1}
            style={{ minWidth: 150 }}
            placeholder="All services"
            value={serviceFilter}
            onChange={setServiceFilter}
            options={(services ?? []).map((service) => ({
              value: service.id,
              label: service.name,
            }))}
          />
          <Select
            mode="multiple"
            allowClear
            maxTagCount={1}
            style={{ minWidth: 140 }}
            placeholder="All statuses"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              AppointmentStatus.REQUESTED,
              AppointmentStatus.CONFIRMED,
              AppointmentStatus.ARRIVED,
              AppointmentStatus.CHECKED_IN,
              AppointmentStatus.COMPLETED,
              AppointmentStatus.NO_SHOW,
              AppointmentStatus.CANCELLED,
            ].map((status) => ({ value: status, label: status.replace(/_/g, ' ') }))}
          />
          <Input.Search
            allowClear
            placeholder="Find a patient"
            style={{ width: 180 }}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setBooking({})}>
            New appointment
          </Button>
        </Space>
      </div>

      <CalendarMetrics appointments={appointments ?? []} />

      {moving ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 8 }}
          message={`Moving ${patientName(moving.patientId)} — click an empty slot to place it, or press Escape to stop.`}
          action={<Button size="small" onClick={() => setMoving(null)}>Stop</Button>}
        />
      ) : null}

      <div
        ref={gridRef}
        className={
          'kw-calendar-grid' +
          (viewMode === 'providers' && (resources?.length ?? 0) > 4 ? ' kw-calendar-grid--wide' : '')
        }
      >
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <BigCalendar
            localizer={localizer}
            events={events}
            date={anchor.toDate()}
            view={rbcView}
            onNavigate={(value) => setAnchor(clinicDayjs(value))}
            onView={() => undefined}
            toolbar={false}
            selectable
            popup
            // Overlapping bookings share the column side-by-side instead of
            // stacking translucent fragments on top of each other — the
            // difference between a busy 9 o'clock and an unreadable one.
            dayLayoutAlgorithm="no-overlap"
            step={15}
            timeslots={2}
            min={anchor.hour(bounds.startHour).minute(0).toDate()}
            max={anchor.hour(Math.min(23, bounds.endHour)).minute(59).toDate()}
            scrollToTime={anchor.hour(scrollHour).minute(0).toDate()}
            resources={resources}
            resourceIdAccessor="resourceId"
            resourceTitleAccessor="resourceTitle"
            getNow={() => clinicWallDate(new Date())}
            onSelectSlot={onSlot}
            onSelectEvent={onSelectEvent}
            onDoubleClickEvent={(event: CalendarEvent) => setMoving(event.appointment)}
            onDrillDown={(value: Date) => {
              // A month cell click opens that DAY, which is what "+3 more"
              // means to somebody who clicked it.
              setAnchor(clinicDayjs(value));
              setViewMode('day');
            }}
            messages={{ showMore: (count: number) => `+ ${count} more` }}
            components={{
              // A narrow week/month cell carries time + first name; the day
              // and provider columns are wide enough for the full card. The
              // whole story is always one click away in the drawer, and the
              // tooltip carries it on hover for the impatient.
              event: ({ event }: { event: CalendarEvent }) => (
                <Tooltip title={`${event.lines.join(' · ')} — double-click to move`}>
                  {viewMode === 'week' || viewMode === 'month' ? (
                    <div className="kw-calendar-event">
                      <div className="kw-event-primary">{event.compact}</div>
                    </div>
                  ) : (
                    <div className="kw-calendar-event">
                      {event.lines.map((line, index) => (
                        <div key={line + index} className={index === 0 ? 'kw-event-primary' : 'kw-event-secondary'}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}
                </Tooltip>
              ),
              // The provider column header is a person, not a string: the
              // initial in the provider's own calendar colour is the same
              // identity cue every card's left edge already carries.
              resourceHeader: ({ label, resource }: { label: React.ReactNode; resource?: { resourceId?: string } }) => {
                const id = resource?.resourceId ? String(resource.resourceId) : '';
                const name = String(label ?? '');
                const initials = name
                  .replace(/^Dr\.?\s+/i, '')
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((part) => part[0] ?? '')
                  .join('')
                  .toUpperCase();
                return (
                  <div className="kw-provider-head">
                    <span
                      className="kw-provider-avatar"
                      style={id ? { background: getDoctorColor(id) } : undefined}
                      aria-hidden
                    >
                      {initials}
                    </span>
                    <span className="kw-provider-name">{name}</span>
                  </div>
                );
              },
            }}
            eventPropGetter={(event: CalendarEvent) => {
              const colour = getDoctorColor(event.appointment.staffId);
              const picked = moving?.id === event.id;
              return {
                style: {
                  // The PROVIDER is the colour; the status is a chip in the
                  // drawer and an opacity here. Colour never carries the
                  // meaning on its own.
                  backgroundColor: event.released ? '#f2f4f7' : `${colour}1a`,
                  borderLeft: `3px solid ${event.released ? '#98a2b3' : colour}`,
                  color: '#17212b',
                  opacity: event.released ? 0.6 : 1,
                  textDecoration: event.released ? 'line-through' : undefined,
                  outline: picked ? '2px dashed #184a6b' : undefined,
                },
              };
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>

      <AppointmentDrawer
        appointmentId={selectedId}
        open={Boolean(selectedId)}
        onClose={() => setSelectedId(null)}
        onReschedule={(id) => {
          const appointment = appointments?.find((row) => row.id === id);
          if (appointment) {
            setMoving(appointment);
            setSelectedId(null);
          }
        }}
      />

      <StaffBookingFlow
        open={Boolean(booking)}
        clinicId={clinicId}
        prefill={booking}
        onClose={() => setBooking(null)}
        onBooked={(id) => setSelectedId(id)}
      />
    </div>
  );
}

/** Exported for the tests, which assert on the clinic's clock, not the runner's. */
export { getClinicTimeZone };
