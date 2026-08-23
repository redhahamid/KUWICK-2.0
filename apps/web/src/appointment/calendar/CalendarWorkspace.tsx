import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Calendar as BigCalendar, Views } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Spin,
  Tooltip,
  message,
} from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
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
import { calendarLocalizer as localizer, weekCalendarLocalizer } from './calendar-localizer';
import {
  CardModel,
  capConcurrency,
  cardLines,
  cardModel,
  compactLine,
  dateKeyOf,
  monthDayComposition,
  defaultScrollOpening,
  displayBounds,
  gridDateAt,
  gridWindow,
  isReleased,
  outsideDisplayCount,
  scrollToHour,
  statusDotColor,
} from './calendar-events';
import { useBookingSettings } from '../hooks/useBookingSettings';
import { SOURCE_LABELS, type AppointmentSource } from '../types';
import { softTint } from './doctor-color';
import { useProviderColors } from '../hooks/useProviderColors';
import { PersonAvatar } from '../shared/PersonAvatar';
import { ProviderRail, ProviderSidePanel } from './ProviderRail';
import { CalendarEventCard } from './CalendarEventCard';
import { useCan } from '../../core/hooks/useCan';
import { ApiError } from '../../core/api-client';

// RC BLOCKER FIX — the localizer lives in calendar-localizer.ts, built on a
// dayjs FACADE without `.tz`. Handing rbc the timezone-extended dayjs made
// its `merge()` shift every day-column's min/max by the browser's UTC offset
// (23:00-previous-day wraps on any Malaysian device). See that module.

/**
 * How many LINES a month cell may draw — chips plus the overflow summary.
 * Three is what a ~100px row holds under the date header; a fourth is where
 * react-big-calendar starts truncating with its own "+N more" and the
 * composition stops being ours.
 */
const MONTH_ROW_BUDGET = 3;

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
  /**
   * Set only on the synthetic "+N more" tile: the bookings this band could
   * not show at a readable width. They keep their real times and open from
   * the tile — nothing is hidden from the desk, only from the pixels.
   */
  overflow?: CalendarEvent[];
}

interface CalendarWorkspaceProps {
  clinicId?: string;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
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
  // WHO IS THIS DOCTOR, IN COLOUR — the provider's own stored calendar
  // colour where they have one, a stable curated fallback where they do not.
  // One resolver for the whole workspace so a card's edge, its avatar, the
  // rail and the column header can never disagree.
  const providerColor = useProviderColors();
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

  // READABLE OVERLAP (owner blocker). A week column is ~150px and a provider
  // column ~250px, so the number of cards that can share a band before the
  // text stops being text is small and known. Everything past it becomes one
  // "+N more" tile — the same overflow the approved mockup draws — carrying
  // the hidden bookings for the click. Month positions by DATE, not hour, and
  // rbc's own popup already handles it there.
  // MONTH — composed, not truncated (approved decision 6). Three
  // representative bookings, live ones ranked ahead of cancelled, and the
  // rest behind one honest overflow chip that says how many and how many of
  // those were cancelled. Held separately from displayEvents because the
  // date cell's own header reads the same composition for its count.
  const monthDays = useMemo(
    () => (viewMode === 'month' ? monthDayComposition(events, MONTH_ROW_BUDGET) : null),
    [events, viewMode],
  );

  const displayEvents: CalendarEvent[] = useMemo(() => {
    if (viewMode === 'month') {
      if (!monthDays) return events;
      const composed: CalendarEvent[] = [];
      for (const day of monthDays.values()) {
        composed.push(...day.shown);
        if (day.hidden.length === 0) continue;
        // The overflow chip takes the day's LAST start so the library's own
        // chronological ordering puts it under the chips rather than among
        // them — its text carries no time, so nothing is misstated.
        const last = day.hidden.reduce(
          (latest, row) => (row.start > latest ? row.start : latest),
          day.hidden[0].start,
        );
        const releasedWord =
          day.hiddenReleased > 0 ? ` · ${day.hiddenReleased} cancelled` : '';
        composed.push({
          ...day.hidden[0],
          id: `month-overflow:${day.dateKey}`,
          start: last,
          end: last,
          compact: `+${day.hidden.length} more${releasedWord}`,
          tooltip: day.hidden
            .map((row) => `${row.card.time} ${row.card.patient}`)
            .join(' · '),
          released: false,
          overflow: day.hidden,
        });
      }
      return composed;
    }
    const limit = viewMode === 'week' ? 2 : 3;
    const { visible, overflow } = capConcurrency(events, limit);
    if (overflow.length === 0) return events;
    const tiles: CalendarEvent[] = overflow.map((bundle) => ({
      id: bundle.id,
      title: `${bundle.hidden.length} more`,
      start: bundle.start,
      end: bundle.end,
      resourceId: bundle.resourceId ?? '',
      // The tile borrows the first hidden booking's appointment so every
      // accessor on the event stays defined; nothing reads it for display.
      appointment: bundle.hidden[0].appointment,
      card: bundle.hidden[0].card,
      tooltip: bundle.hidden
        .map((row) => `${row.card.time} ${row.card.patient}`)
        .join(' · '),
      compact: `+${bundle.hidden.length} more`,
      released: false,
      overflow: bundle.hidden,
    }));
    return [...visible, ...tiles];
  }, [events, viewMode, monthDays]);

  // The bookings behind a "+N more" tile, once somebody asks for them.
  const [overflowGroup, setOverflowGroup] = useState<CalendarEvent[] | null>(null);

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

  // RC blocker — the scroll POLICY (owner-specified): today opens near the
  // clinic's now, a day with appointments at its first appointment, an empty
  // day at the branch's opening hour. The roster is not an input; date
  // identity travels as YYYY-MM-DD keys so no dayjs mode can shift it.
  const anchorKey = anchor.format('YYYY-MM-DD');
  const scrollHour = useMemo(() => {
    const now = clinicDayjs(new Date());
    return scrollToHour({
      anchorKey,
      nowKey: now.format('YYYY-MM-DD'),
      nowHour: now.hour(),
      earliestEventHour,
      openingHour: defaultScrollOpening(bookingSettings),
    });
  }, [anchorKey, earliestEventHour, bookingSettings]);

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
  // RC blocker — every Date the grid receives is built from the anchor's
  // CALENDAR-DATE KEY with local-field construction (gridWindow): min, max,
  // date and the scroll target all share one calendar date whatever mode the
  // anchor dayjs happens to be in (the drill-down path used to store a
  // timezone-mode dayjs, putting min on 23:00 of the previous date — the
  // wrapped diary, and rbc's Invalid-array-length white screen).
  const grid = useMemo(() => gridWindow(anchorKey, bounds), [anchorKey, bounds]);
  const gridScrollTo = useMemo(
    () => gridDateAt(anchorKey, Math.max(bounds.startHour, Math.min(scrollHour, bounds.endHour - 1))),
    [anchorKey, scrollHour, bounds.startHour, bounds.endHour],
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

  // EMPTY COLUMNS SAY SO (approved mockup 2: "No appointments" down the quiet
  // weekend columns). react-big-calendar has no per-column empty state, so
  // this is applied DOM-side after render — the same technique the now-pill
  // uses, and for the same reason: the caption belongs to a column the
  // library owns. Presentation only; it reads what is on screen and adds a
  // label, never a booking.
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || viewMode !== 'week' || isLoading) return;
    const columns = grid.querySelectorAll<HTMLElement>('.rbc-time-content .rbc-day-slot');
    const added: HTMLElement[] = [];
    columns.forEach((column) => {
      const existing = column.querySelector('.kw-col-empty');
      if (column.querySelector('.rbc-event')) {
        existing?.remove();
        return;
      }
      if (existing) return;
      const caption = document.createElement('span');
      caption.className = 'kw-col-empty';
      caption.textContent = 'No appointments';
      caption.setAttribute('aria-hidden', 'true');
      column.appendChild(caption);
      added.push(caption);
    });
    return () => added.forEach((node) => node.remove());
  }, [viewMode, isLoading, displayEvents, anchor]);

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
    if (event.overflow) {
      setOverflowGroup(event.overflow);
      return;
    }
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

      <div className="kw-cal-body">
      {/* Target mockup 3 — the Providers view carries a person rail on the
          left and a mini-calendar + day summary on the right, INSIDE the
          module canvas. The rail drives the same providerFilter the filter
          bar owns, so rail, chips and grid cannot disagree. */}
      {viewMode === 'providers' && !isLoading ? (
        <ProviderRail
          providers={providers}
          appointments={events.map((event) => event.appointment)}
          selection={providerFilter}
          onSelect={setProviderFilter}
        />
      ) : null}
      <div className="kw-cal-main">
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
        data-view={viewMode}
        style={{ ['--cal-cols' as string]: resources?.length ?? 0 }}
      >
        {isLoading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin />
          </div>
        ) : (
          <BigCalendar
            // The WEEK view alone runs Monday → Sunday (approved mockup); the
            // other views keep the Sunday-first localizer. See
            // calendar-localizer.ts for why this is a second instance rather
            // than a global dayjs locale change.
            localizer={viewMode === 'week' ? weekCalendarLocalizer : localizer}
            events={displayEvents}
            date={grid.date}
            view={rbcView}
            // The Dates rbc hands back are PSEUDO-dates (clinic wall clock in
            // local fields) — their local Y-M-D IS the clinic date. A plain
            // local dayjs keeps it; clinicDayjs() here would re-convert an
            // already-converted value and store a timezone-mode anchor.
            onNavigate={(value) => setAnchor(dayjs(value))}
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
            min={grid.min}
            max={grid.max}
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
            onDoubleClickEvent={(event: CalendarEvent) =>
              !event.overflow && permReschedule && setMoving(event.appointment)
            }
            onDrillDown={(value: Date) => {
              // A month cell click opens that DAY, which is what "+3 more"
              // means to somebody who clicked it. Plain dayjs — see onNavigate.
              setAnchor(dayjs(value));
              setViewMode('day');
            }}
            messages={{ showMore: (count: number) => `+ ${count} more` }}
            // The mockup's gutter reads "8 AM", not "08:00 AM" every half
            // hour. The half-hour labels are hidden in CSS; this is the
            // wording of the ones that remain. Clinic clock, as everywhere.
            formats={{
              // Every label stays FULLY QUALIFIED (meridiem included) so the
              // axis walk can still read and order all of them; the half-hour
              // rows are hidden visually in CSS, which is a display decision,
              // not a data one.
              timeGutterFormat: (date: Date) =>
                dayjs(date).format(dayjs(date).minute() === 0 ? 'h A' : 'h:mm A'),
            }}
            slotPropGetter={slotPropGetter}
            dayPropGetter={dayPropGetter}
            components={{
              // A narrow week/month cell carries a dot, the time and a first
              // name; the day and provider columns carry the structured card.
              // The whole story is always one click away in the drawer, and
              // the tooltip carries it on hover for the impatient.
              event: ({ event }: { event: CalendarEvent }) => {
                // The overflow tile — the mockup's "+ 2 more", carrying the
                // bookings that would otherwise have been slivers.
                if (event.overflow) {
                  // In MONTH the overflow is a line of type under the chips —
                  // "+21 more · 2 cancelled" — because the cell's job is to
                  // say how heavy the day is, and a stacked tile would eat a
                  // chip's worth of height to say less.
                  if (viewMode === 'month') {
                    return (
                      <Tooltip title={`${event.tooltip} — click to open`}>
                        <div className="kw-calendar-event kw-evchip kw-evchip--more">
                          {event.compact}
                        </div>
                      </Tooltip>
                    );
                  }
                  return (
                    <Tooltip title={`${event.tooltip} — click to open`}>
                      <div className="kw-ev-more">
                        <span className="kw-ev-more-count">+{event.overflow.length}</span>
                        <span className="kw-ev-more-word">more</span>
                      </div>
                    </Tooltip>
                  );
                }
                // The CARD is a Kuwick component (CalendarEventCard); the
                // library keeps only the geometry. Month cells are dates
                // rather than hours, so they take the one-line chip.
                return (
                  <CalendarEventCard
                    card={event.card}
                    status={event.appointment.status}
                    color={providerColor(event.appointment.staffId)}
                    providerName={staffName(event.appointment.staffId)}
                    compact={viewMode === 'month'}
                    compactLine={event.compact}
                    tooltip={event.tooltip}
                    // Day and the single-provider workspace give a card the
                    // full width of the column; the card composes ACROSS
                    // there instead of stacking, so a 30-minute booking reads
                    // as a row and not as a banner.
                    wide={viewMode === 'day' || viewMode === 'providers'}
                    showProvider={viewMode !== 'providers'}
                  />
                );
              },
              // THE MONTH DATE CELL (approved decision 6). The date, and the
              // day's real appointment count beside it — counted from the
              // appointments already on screen, never modelled. A day with
              // nothing booked says nothing rather than "0".
              month: {
                dateHeader: ({
                  date,
                  label,
                  onDrillDown,
                }: {
                  date: Date;
                  label: React.ReactNode;
                  onDrillDown?: (event: React.MouseEvent) => void;
                }) => {
                  const day = monthDays?.get(dateKeyOf(date));
                  const total = day?.total ?? 0;
                  return (
                    <div className="kw-month-datehead">
                      {/* Still the library's drill-down link: clicking a date
                          opens that day. Replacing the header must not cost
                          the navigation it carried. */}
                      <button
                        type="button"
                        className="rbc-button-link kw-month-date"
                        onClick={onDrillDown}
                      >
                        {label}
                      </button>
                      {total > 0 ? (
                        <span className="kw-month-load">
                          {total} appointment{total === 1 ? '' : 's'}
                        </span>
                      ) : null}
                    </div>
                  );
                },
              },
              // Week headers: small-caps weekday over the date numeral, today
              // in a filled ink circle.
              week: {
                header: ({ date }: { date: Date }) => {
                  // Mockup 2 — "Mon 17" reads as one horizontal token, and
                  // today wears a filled navy pill around the whole thing.
                  const day = dayjs(date);
                  const isToday = day.isSame(dayjs(todayWall), 'day');
                  return (
                    <div className="kw-cal-dayhead" data-today={isToday || undefined}>
                      <span className="kw-cal-dayhead-pill">
                        <span className="kw-cal-dayhead-dow">{day.format('ddd')}</span>
                        <span className="kw-cal-dayhead-num">{day.format('D')}</span>
                      </span>
                    </div>
                  );
                },
              },
              // The provider column header is a person, not a string: the
              // shared avatar in the provider's own calendar colour is the
              // same identity cue every card's left edge already carries, and
              // the count says how heavy the column is before it is read.
              resourceHeader: ({ label, resource }: { label: React.ReactNode; resource?: { resourceId?: string } }) => {
                const id = resource?.resourceId ? String(resource.resourceId) : '';
                const name = String(label ?? '');
                const count = events.filter((event) => event.resourceId === id).length;
                return (
                  <div className="kw-provider-head">
                    <PersonAvatar name={name} color={providerColor(id)} size="sm" />
                    {/* Native title: the full name survives the ellipsis. */}
                    <span className="kw-provider-name" title={name}>
                      {name}
                    </span>
                    <span className="kw-provider-headcount">{count}</span>
                  </div>
                );
              },
            }}
            eventPropGetter={(event: CalendarEvent) => {
              // Final visual pass — the outer rbc-event is now only the
              // POSITIONING box; the visible card is the inner
              // .kw-calendar-event, which is what lets consecutive bookings
              // breathe apart (mockup 2's separated cards) instead of
              // touching. Colour travels as CSS variables so the stylesheet
              // can decide per view: white cards in the day/provider columns,
              // the provider's soft wash in week and month. The PROVIDER is
              // the edge and the wash; the STATUS stays the dot beside its
              // word. Released bookings stay on the grid, struck through —
              // never hidden.
              if (event.overflow) {
                return { className: ' kw-ev--overflow', style: {} };
              }
              const identity = providerColor(event.appointment.staffId);
              const picked = moving?.id === event.id;
              return {
                className:
                  (event.released ? ' kw-ev--released' : '') +
                  (picked ? ' kw-ev--picked' : ''),
                style: {
                  ['--ev-edge' as string]: event.released ? '#98a2b3' : identity.accent,
                  // The provider's pastel — a GUTTER and a month chip ground,
                  // never a body fill. Which of the three the view actually
                  // spends is the stylesheet's decision.
                  ['--ev-pastel' as string]: event.released ? '#f2f4f7' : identity.pastel,
                  // The week's whisper: the same hue at ~4%, deliberately
                  // weaker than the pastel so a full column stays neutral.
                  ['--ev-wash' as string]: event.released
                    ? '#fafbfc'
                    : softTint(identity.accent, 0.045),
                  ['--ev-text' as string]: event.released ? '#667085' : identity.text,
                },
              };
            }}
            style={{ height: '100%' }}
          />
        )}
      </div>
      </div>
      {/* Mockup 1/2 — the status summary bar closes the calendar canvas: the
          same live counts as the filter-bar strip, said once more where the
          eye rests after reading the grid. */}
      {!isLoading ? (
        <div className="kw-cal-statusbar">
          {/* THE THIRD LEVEL of the toolbar hierarchy, and deliberately not
              in the toolbar. Primary navigation and the filters compete for
              the top of the screen; the operational summary does not need to
              join that fight, and the approved mockup puts it exactly here —
              closing the canvas, where the eye rests after reading the grid.
              Said once now, rather than twice. */}
          <CalendarMetrics
            appointments={events.map((event) => event.appointment)}
            filtered={filtersActive}
            bar
          />
        </div>
      ) : null}
      </div>
      {viewMode === 'providers' && !isLoading ? (
        <ProviderSidePanel
          clinicId={clinicId}
          providers={providers}
          appointments={events.map((event) => event.appointment)}
          shifts={shifts ?? []}
          rangeFrom={range.start.format('YYYY-MM-DD')}
          rangeTo={range.end.format('YYYY-MM-DD')}
          selection={providerFilter}
          anchor={anchor}
          onPickDate={setAnchor}
        />
      ) : null}
      </div>

      {/* What the band could not show, in full: real times, real people, one
          click to the booking itself. */}
      <Modal
        open={Boolean(overflowGroup)}
        onCancel={() => setOverflowGroup(null)}
        footer={null}
        width={420}
        title={`${overflowGroup?.length ?? 0} more at this time`}
      >
        <div className="kw-ev-more-list">
          {(overflowGroup ?? []).map((row) => (
            <button
              key={row.id}
              type="button"
              className="kw-ev-more-row"
              onClick={() => {
                setOverflowGroup(null);
                setSelectedId(row.id);
              }}
            >
              <span
                className="kw-ev-more-edge"
                style={{ background: providerColor(row.appointment.staffId).accent }}
                aria-hidden
              />
              <span className="kw-ev-more-time">{row.card.time}</span>
              <span className="kw-ev-more-body">
                <span className="kw-ev-more-name">{row.card.patient}</span>
                <span className="kw-ev-more-meta">
                  {[row.card.service, staffName(row.appointment.staffId)]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span
                className="kw-event-dot"
                style={{ background: statusDotColor(row.appointment.status) }}
                aria-hidden
              />
            </button>
          ))}
        </div>
      </Modal>

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
