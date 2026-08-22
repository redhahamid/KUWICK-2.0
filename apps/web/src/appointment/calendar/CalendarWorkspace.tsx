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
  message,
} from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { AppointmentStatus } from '@kuwick/shared';
import { useAppointments, useRescheduleAppointment } from '../hooks/useAppointments';
import { SetupChecklistCard } from '../SetupChecklistCard';
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
import {
  CardModel,
  cardLines,
  cardModel,
  compactLine,
  displayBounds,
  earliestRosteredHour,
  isReleased,
  outsideDisplayCount,
  scrollToHour,
  statusCardBackground,
  statusDotColor,
} from './calendar-events';
import { useBookingSettings } from '../hooks/useBookingSettings';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import { getDoctorColor } from './doctor-color';
import { useCan } from '../../core/hooks/useCan';
import { ApiError } from '../../core/api-client';

dayjs.extend(utc);
dayjs.extend(timezone);
const localizer = dayjsLocalizer(dayjs);

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
  card: CardModel;
  tooltip: string;
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

function initialsOf(name: string): string {
  return name
    .replace(/^Dr\.?\s+/i, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

/**
 * THE CALENDAR — the module's default workspace (§7), and V3's hero surface.
 *
 * LAYOUT. A command bar (navigate, the date said big, the view switcher), a
 * quiet filter bar with the live counts at its end, and then the grid takes
 * everything that is left. Selecting an appointment opens a DRAWER over the
 * right-hand edge rather than a panel that is permanently reserved and empty
 * most of the time.
 *
 * THE GRID WEARS KUWICK, NOT THE LIBRARY. react-big-calendar still does the
 * geometry; headers, cards, the now-line, working-hours shading and the month
 * cells are all custom components or scoped CSS (appointment-v3.css). Two
 * V3-specific behaviours worth naming:
 *
 *   WORKING HOURS ARE SHAPE. `slotPropGetter` marks every half-hour nobody is
 *   rostered (per column in the Providers view, merged elsewhere) so the
 *   clinic's day is visible before a single booking is — presentation only,
 *   derived from the same roster read the grid bounds already use.
 *
 *   THE VIEWPORT OPENS ON THE WORK. On a 24-hour roster the grid must RENDER
 *   from midnight (the night half exists), but it should not OPEN there; the
 *   scroll effect below places the first meaningful hour at the top, because
 *   rbc's own scrollToTime prop is only honoured on mount.
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
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  // Phase 3D — a standard-hours branch can reveal the whole day on demand;
  // scroll position only, never a new axis shape per date.
  const [showFullDay, setShowFullDay] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [booking, setBooking] = useState<{ staffId?: string; start?: Dayjs } | null>(null);
  // The appointment picked up for moving. Two-step rather than a drag — see
  // the block comment above.
  const [moving, setMoving] = useState<Appointment | null>(null);

  const reschedule = useRescheduleAppointment();
  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const { data: patients } = usePatients();
  // Phase 3B/3C — the branch's own calendar-display settings, the diary
  // axis's ONLY source. The roster below shades availability; it no longer
  // shapes the grid.
  const { data: bookingSettings } = useBookingSettings(clinicId);

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
      .filter(
        (appointment) => sourceFilter.length === 0 || sourceFilter.includes(appointment.source),
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
        const label = {
          time: formatClinicTime(appointment.scheduledStart),
          timeRange: `${formatClinicTime(appointment.scheduledStart)} – ${formatClinicTime(appointment.scheduledEnd)}`,
          patientName: patientName(appointment.patientId),
          serviceName: serviceName(appointment.serviceId),
          providerName: staffName(appointment.staffId),
        };
        const lines = cardLines(label, minutes);
        return {
          id: appointment.id,
          title: lines.join(' · '),
          start,
          end,
          resourceId: appointment.staffId,
          appointment,
          card: cardModel(label, minutes),
          tooltip: lines.join(' · '),
          compact: compactLine(label.time, label.patientName),
          released: isReleased(appointment.status),
        };
      });
  }, [
    appointments,
    visibleProviderIds,
    serviceFilter,
    statusFilter,
    sourceFilter,
    search,
    patientName,
    serviceName,
    staffName,
  ]);

  // THE AXIS (Phase 3). A pure function of the branch's display settings and
  // the reveal toggle — shifts, dates and filters have no way in, so the
  // diary's shape holds still whatever the day contains.
  const bounds = useMemo(
    () => displayBounds(bookingSettings, showFullDay),
    [bookingSettings, showFullDay],
  );
  const is24hBranch = bookingSettings?.calendarDisplayMode === 'TWENTY_FOUR_HOURS';

  // Phase 3D — what the fixed band cannot show is SAID, never hidden: the
  // notice counts live bookings outside the displayed hours and offers the
  // full day. Month view positions by date, not hour, so it is exempt.
  const outsideCount = useMemo(
    () => (viewMode === 'month' ? 0 : outsideDisplayCount(events, bounds)),
    [events, bounds, viewMode],
  );

  // Phase 3H — active filters, worn on the sleeve. A diary quietly filtered
  // to one doctor looks exactly like a quiet day, which is how the other
  // doctors get double-booked.
  const filtersActive =
    providerFilter.length > 0 ||
    serviceFilter.length > 0 ||
    statusFilter.length > 0 ||
    sourceFilter.length > 0 ||
    search.trim().length > 0;

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; remove: () => void }[] = [];
    for (const id of providerFilter) {
      chips.push({
        key: `provider-${id}`,
        label: staffName(id) || 'Provider',
        remove: () => setProviderFilter((current) => current.filter((value) => value !== id)),
      });
    }
    for (const id of serviceFilter) {
      chips.push({
        key: `service-${id}`,
        label: serviceName(id) || 'Service',
        remove: () => setServiceFilter((current) => current.filter((value) => value !== id)),
      });
    }
    for (const status of statusFilter) {
      chips.push({
        key: `status-${status}`,
        label: status.replace(/_/g, ' ').toLowerCase(),
        remove: () => setStatusFilter((current) => current.filter((value) => value !== status)),
      });
    }
    for (const source of sourceFilter) {
      chips.push({
        key: `source-${source}`,
        label: SOURCE_LABELS[source as AppointmentSource] ?? source,
        remove: () => setSourceFilter((current) => current.filter((value) => value !== source)),
      });
    }
    if (search.trim()) {
      chips.push({ key: 'search', label: `“${search.trim()}”`, remove: () => setSearch('') });
    }
    return chips;
  }, [providerFilter, serviceFilter, statusFilter, sourceFilter, search, staffName, serviceName]);

  const clearFilters = useCallback(() => {
    setProviderFilter([]);
    setServiceFilter([]);
    setStatusFilter([]);
    setSourceFilter([]);
    setSearch('');
  }, []);

  // The first booking of the day being looked at — where reading starts on a
  // roster whose grid has to render from midnight.
  const earliestEventHour = useMemo(() => {
    const hours = events
      .filter((event) => !event.released)
      .map((event) => event.start.getHours());
    return hours.length > 0 ? Math.min(...hours) : null;
  }, [events]);

  const scrollHour = useMemo(
    () =>
      scrollToHour({
        anchor,
        now: clinicDayjs(new Date()),
        earliestRosteredHour: earliestRosteredHour(shifts),
        earliestEventHour,
      }),
    [anchor, shifts, earliestEventHour],
  );

  const gridRef = useRef<HTMLDivElement>(null);

  // Phase 1 — account permissions, published by the server at login. An
  // empty slot is a booking INVITATION, and a card drag is a reschedule;
  // neither invitation is extended to an account the server would refuse.
  const permCreate = useCan('appointment.create');
  const permReschedule = useCan('appointment.reschedule');

  // V3.1.2 — STABLE GRID INSTANTS, and the fix for the night-jump.
  //
  // react-big-calendar re-runs its own scroll positioning whenever the
  // `scrollToTime` PROP IDENTITY changes (componentWillReceiveProps compares
  // by reference), and its internal ratio measures the target from MIDNIGHT
  // while dividing by the min→max span — off by the grid's start hour on any
  // diary that does not begin at 00:00. Built inline, these Dates were new
  // objects on EVERY parent re-render, so opening the booking drawer (or an
  // iPad width change re-render) made the library re-apply that miscomputed
  // scroll and throw the diary to the night rows. Memoised, their identity
  // only changes when the DATE, VIEW-derived bounds or intended hour change —
  // which is exactly the set of moments a re-scroll is wanted, and the
  // deliberate effect below owns the actual position arithmetic.
  const gridMin = useMemo(
    () => anchor.hour(bounds.startHour).minute(0).toDate(),
    [anchor, bounds.startHour],
  );
  // endHour names the line the day CLOSES on (18 → the diary ends at 18:00),
  // so the last rendered hour block is endHour-1:59.
  const gridMax = useMemo(
    () => anchor.hour(Math.max(bounds.startHour, Math.min(23, bounds.endHour - 1))).minute(59).toDate(),
    [anchor, bounds.startHour, bounds.endHour],
  );
  const gridScrollTo = useMemo(
    () => anchor.hour(Math.max(bounds.startHour, Math.min(scrollHour, bounds.endHour - 1))).minute(0).toDate(),
    [anchor, scrollHour, bounds.startHour, bounds.endHour],
  );

  // WORKING HOURS AS SHAPE. One sorted interval list per provider, read from
  // the same roster answer the grid bounds use; a slot is "on" when anybody
  // visible (or the column's own provider, in the Providers view) is rostered
  // WORKING or LOCUM across it.
  const workingIntervals = useMemo(() => {
    const per = new Map<string, [number, number][]>();
    for (const shift of shifts ?? []) {
      if (shift.shiftType !== 'WORKING' && shift.shiftType !== 'LOCUM') continue;
      const list = per.get(shift.staffId) ?? [];
      list.push([new Date(shift.startsAt).getTime(), new Date(shift.endsAt).getTime()]);
      per.set(shift.staffId, list);
    }
    return per;
  }, [shifts]);

  const slotPropGetter = useCallback(
    (slot: Date, resourceId?: string | number) => {
      if (workingIntervals.size === 0) return {};
      const instant = fromClinicWallDate(slot).getTime();
      const ids = resourceId != null ? [String(resourceId)] : [...visibleProviderIds];
      const rostered = ids.some((id) =>
        (workingIntervals.get(id) ?? []).some(([from, to]) => instant >= from && instant < to),
      );
      return rostered ? {} : { className: 'kw-slot-off' };
    },
    [workingIntervals, visibleProviderIds],
  );

  const dayPropGetter = useCallback((date: Date) => {
    const day = date.getDay();
    return day === 0 || day === 6 ? { className: 'kw-day-weekend' } : {};
  }, []);

  // §12 — WHERE NOW IS, said in the gutter's own words. react-big-calendar
  // draws the line; this pins a small pill reading the clinic clock into
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

  // THE VIEWPORT OPENS ON THE WORK. rbc honours `scrollToTime` only on the
  // mount it happens to coincide with; this places the target hour at the top
  // of the scroll box deterministically on every view/date change. Purely a
  // scroll position — the grid still renders every rostered hour.
  useEffect(() => {
    if (isLoading) return;
    const grid = gridRef.current;
    if (!grid) return;
    const content = grid.querySelector<HTMLElement>('.rbc-time-content');
    const group = grid.querySelector<HTMLElement>('.rbc-timeslot-group');
    if (!content || !group) return;
    // A timeslot-group is `step × timeslots` minutes tall — 30 here.
    const hourHeight = group.offsetHeight * 2;
    // INITIAL SCROLL IS NOT THE AXIS (Phase 3C): the target hour is clamped
    // into the fixed band; the band itself never moves to meet it.
    const target = Math.max(bounds.startHour, Math.min(scrollHour, bounds.endHour - 1));
    content.scrollTop = Math.max(0, (target - bounds.startHour) * hourHeight);
  }, [viewMode, anchor, isLoading, scrollHour, bounds.startHour, bounds.endHour]);

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
    if (moving ? !permReschedule : !permCreate) return;
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

  const todayWall = clinicWallDate(new Date());

  return (
    <div className="kw-calendar-workspace" data-testid="calendar-workspace">
      {/* PHASE 8 — renders nothing once the core setup is done. */}
      <SetupChecklistCard clinicId={clinicId} />

      {/* COMMAND BAR — navigate, the date said big, the view switcher. */}
      <div className="kw-calendar-toolbar">
        <Space wrap size={10}>
          <Button.Group>
            <Button onClick={() => setAnchor(todayAnchor())}>Today</Button>
            <Button
              icon={<LeftOutlined />}
              aria-label="Previous"
              onClick={() => setAnchor((current) => shiftAnchor(viewMode, current, -1))}
            />
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
          <span className="kw-cal-heading">{heading}</span>
        </Space>
        <Segmented
          value={viewMode}
          options={VIEW_OPTIONS}
          onChange={(value) => setViewMode(value as CalendarViewMode)}
        />
      </div>

      {/* FILTER BAR — dense and intentional; the live counts close the row. */}
      <div className="kw-cal-filterbar">
        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          size="small"
          optionFilterProp="label"
          style={{ minWidth: 158 }}
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
          size="small"
          optionFilterProp="label"
          style={{ minWidth: 148 }}
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
          size="small"
          optionFilterProp="label"
          style={{ minWidth: 138 }}
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
        <Select
          mode="multiple"
          allowClear
          maxTagCount={1}
          size="small"
          optionFilterProp="label"
          style={{ minWidth: 128 }}
          placeholder="All sources"
          value={sourceFilter}
          onChange={setSourceFilter}
          options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <Input.Search
          allowClear
          size="small"
          placeholder="Find a patient"
          style={{ width: 170 }}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <CalendarMetrics
          appointments={events.map((event) => event.appointment)}
          filtered={filtersActive}
        />
      </div>

      {/* ACTIVE FILTERS SAID OUT LOUD (Phase 3H) — a diary quietly showing a
          tenth of the day is how a receptionist double-books the other nine
          tenths. Each chip removes itself; Clear all removes the lot. */}
      {filtersActive ? (
        <div className="kw-cal-active-filters" data-testid="calendar-active-filters">
          {activeFilterChips.map((chip) => (
            <span key={chip.key} className="kw-filter-chip">
              {chip.label}
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={chip.remove}
              >
                ×
              </button>
            </span>
          ))}
          <Button type="link" size="small" onClick={clearFilters}>
            Clear all
          </Button>
        </div>
      ) : null}

      {/* WHAT THE BAND CANNOT SHOW IS SAID (Phase 3D). Out-of-hours bookings
          stay real: the strip counts them and opens the full day. */}
      {!is24hBranch && (outsideCount > 0 || showFullDay) ? (
        <div className="kw-cal-outside" data-testid="calendar-outside-hours">
          {showFullDay ? (
            <>
              <span>Showing the full 24 hours.</span>
              <Button size="small" onClick={() => setShowFullDay(false)}>
                Back to clinic hours
              </Button>
            </>
          ) : (
            <>
              <span>
                {outsideCount} booking{outsideCount === 1 ? '' : 's'} outside the displayed hours.
              </span>
              <Button size="small" onClick={() => setShowFullDay(true)}>
                Show full 24 hours
              </Button>
            </>
          )}
        </div>
      ) : null}

      {moving ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 10 }}
          message={`Moving ${patientName(moving.patientId)} — click an empty slot to place it, or press Escape to stop.`}
          action={<Button size="small" onClick={() => setMoving(null)}>Stop</Button>}
        />
      ) : null}

      <div
        className="kw-cal-outer"
        data-scroll={
          viewMode === 'providers' && (resources?.length ?? 0) > 4 ? 'true' : undefined
        }
      >
      <div
        ref={gridRef}
        className={
          'kw-calendar-grid' +
          (viewMode === 'providers' && (resources?.length ?? 0) > 4 ? ' kw-calendar-grid--wide' : '')
        }
        style={{ ['--cal-cols' as string]: resources?.length ?? 0 }}
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
            min={gridMin}
            max={gridMax}
            scrollToTime={gridScrollTo}
            // V3.1.2 — the library is NOT a scroll writer here. rbc's own
            // applyScroll() measures scrollToTime from MIDNIGHT but divides
            // by the min→max span, so on a diary starting at 07:00 its ratio
            // lands hours too deep (the reported "23:00 on drawer open").
            // The deliberate effect above owns the viewport position with
            // correct arithmetic; this keeps rbc's remount-time apply from
            // ever competing with it.
            enableAutoScroll={false}
            resources={resources}
            resourceIdAccessor="resourceId"
            resourceTitleAccessor="resourceTitle"
            getNow={() => clinicWallDate(new Date())}
            onSelectSlot={onSlot}
            onSelectEvent={onSelectEvent}
            onDoubleClickEvent={(event: CalendarEvent) => permReschedule && setMoving(event.appointment)}
            onDrillDown={(value: Date) => {
              // A month cell click opens that DAY, which is what "+3 more"
              // means to somebody who clicked it.
              setAnchor(clinicDayjs(value));
              setViewMode('day');
            }}
            messages={{ showMore: (count: number) => `+ ${count} more` }}
            slotPropGetter={slotPropGetter}
            dayPropGetter={dayPropGetter}
            components={{
              // A narrow week/month cell carries a dot, the time and a first
              // name; the day and provider columns carry the structured card.
              // The whole story is always one click away in the drawer, and
              // the tooltip carries it on hover for the impatient.
              event: ({ event }: { event: CalendarEvent }) => {
                const dot = (
                  <span
                    className="kw-event-dot"
                    style={{ background: statusDotColor(event.appointment.status) }}
                    aria-hidden
                  />
                );
                // Every card carries BOTH bodies; the stylesheet's container
                // query shows the one the card's real width can hold, so an
                // overlap squeeze degrades by design instead of clipping
                // (V3.1 §5). Week/month and 15-minute cards start compact.
                const compactMode =
                  viewMode === 'week' || viewMode === 'month' || event.card.compact;
                const [timePart, ...nameParts] = event.compact.split(' ');
                return (
                  <Tooltip title={`${event.tooltip} — double-click to move`}>
                    <div
                      className={
                        'kw-calendar-event ' + (compactMode ? 'kw-ev--compact' : 'kw-ev--full')
                      }
                    >
                      <span className="kw-event-compact">
                        <span className="kw-ec-time">
                          {dot}
                          {timePart}
                        </span>
                        <span className="kw-ec-name">{nameParts.join(' ')}</span>
                      </span>
                      {!compactMode ? (
                        <div className="kw-event-full">
                          {/* 3F — a 30-minute card holds exactly two lines,
                              so time and name share the first (dense) while
                              taller cards give each its own. */}
                          {event.card.dense ? (
                            <div className="kw-event-lead">
                              <span className="kw-event-time">
                                {dot}
                                {event.card.time}
                              </span>
                              <span className="kw-event-patient">{event.card.patient}</span>
                            </div>
                          ) : (
                            <>
                              <span className="kw-event-time">
                                {dot}
                                {event.card.time}
                              </span>
                              <div className="kw-event-patient">{event.card.patient}</div>
                            </>
                          )}
                          {event.card.service ? (
                            <div className="kw-event-secondary">{event.card.service}</div>
                          ) : null}
                          {event.card.provider && viewMode !== 'providers' ? (
                            <div className="kw-event-secondary">{event.card.provider}</div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </Tooltip>
                );
              },
              // Week headers: small-caps weekday over the date numeral, today
              // in a filled ink circle.
              week: {
                header: ({ date }: { date: Date }) => {
                  const day = dayjs(date);
                  const isToday = day.isSame(dayjs(todayWall), 'day');
                  return (
                    <div className="kw-cal-dayhead" data-today={isToday || undefined}>
                      <span className="kw-cal-dayhead-dow">{day.format('ddd')}</span>
                      <span className="kw-cal-dayhead-num">{day.format('D')}</span>
                    </div>
                  );
                },
              },
              // The provider column header is a person, not a string: the
              // initial in the provider's own calendar colour is the same
              // identity cue every card's left edge already carries.
              resourceHeader: ({ label, resource }: { label: React.ReactNode; resource?: { resourceId?: string } }) => {
                const id = resource?.resourceId ? String(resource.resourceId) : '';
                const name = String(label ?? '');
                return (
                  <div className="kw-provider-head">
                    <span
                      className="kw-provider-avatar"
                      style={id ? { background: getDoctorColor(id) } : undefined}
                      aria-hidden
                    >
                      {initialsOf(name)}
                    </span>
                    {/* Native title: the full name survives the ellipsis. */}
                    <span className="kw-provider-name" title={name}>
                      {name}
                    </span>
                  </div>
                );
              },
            }}
            eventPropGetter={(event: CalendarEvent) => {
              const colour = getDoctorColor(event.appointment.staffId);
              const picked = moving?.id === event.id;
              return {
                style: {
                  // The PROVIDER is the 3px edge; the STATUS is the dot on the
                  // card and the word in the drawer. Released bookings stay on
                  // the grid, struck through — never hidden.
                  background: event.released
                    ? '#f5f6f8'
                    : statusCardBackground(event.appointment.status),
                  borderLeft: `3px solid ${event.released ? '#98a2b3' : colour}`,
                  color: '#172033',
                  opacity: event.released ? 0.62 : 1,
                  textDecoration: event.released ? 'line-through' : undefined,
                  outline: picked ? '2px dashed #132447' : undefined,
                },
              };
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>
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
