import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar as BigCalendar, dayjsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button, Calendar as MiniCalendar, Checkbox, Segmented, Space, Tag, Typography, message } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Role } from '@kuwick/shared';
import { useAppointments, useRescheduleAppointment } from '../hooks/useAppointments';
import { useDoctorSchedules } from '../hooks/useDoctorSchedules';
import { useScheduleExceptions } from '../hooks/useScheduleExceptions';
import { useServices } from '../../clinical/hooks/useServices';
import { useStaff } from '../../hr/hooks/useStaff';
import { usePatients } from '../../core/hooks/usePatients';
import { Appointment } from '../types';
import { AppointmentDetailPanel } from './AppointmentDetailPanel';
import { CalendarBookingModal } from './CalendarBookingModal';
import { RescheduleAppointmentDrawer } from '../RescheduleAppointmentDrawer';
import { CalendarViewMode, getCalendarRange, shiftAnchor, todayAnchor } from './calendar-range';
import { getDoctorColor } from './doctor-color';
import { ApiError } from '../../core/api-client';
import { useQueryClient } from '@tanstack/react-query';
import { clinicDayjs } from '../../clinical/clinicTime';

const { Text } = Typography;

// DoctorSchedule.startTime/endTime store the wall-clock time-of-day in the
// UTC hour/minute fields (apps/api/src/appointment/time.util.ts) — reading
// them without .utc() shifts by the browser's local offset (see also the
// same fix in DoctorSchedulesPage.tsx).
dayjs.extend(utc);
const localizer = dayjsLocalizer(dayjs);
const DOCTOR_ROLES: Role[] = [Role.DOCTOR_RESIDENT, Role.DOCTOR_LOCUM];
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;

// DAY is one column per selected provider — the brief's day view and the old
// separate "Provider" view are the same thing, and having both made the plain
// day column a fourth thing nobody chose.
const VIEW_OPTIONS: { label: string; value: CalendarViewMode; shortcut: string }[] = [
  { label: 'Day (D)', value: 'day', shortcut: 'd' },
  { label: 'Week (W)', value: 'week', shortcut: 'w' },
  { label: 'Month (M)', value: 'month', shortcut: 'm' },
];

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  resourceId: string;
  appointment: Appointment;
}

interface CalendarResource {
  resourceId: string;
  resourceTitle: string;
}

interface AppointmentCalendarViewProps {
  clinicId?: string;
  onSwitchToList: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA';
}

export function AppointmentCalendarView({ clinicId, onSwitchToList }: AppointmentCalendarViewProps) {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('week');
  const [anchor, setAnchor] = useState<Dayjs>(() => todayAnchor());
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[] | null>(null);
  const [detailAppointment, setDetailAppointment] = useState<Appointment | null>(null);
  const [reschedulingAppointment, setReschedulingAppointment] = useState<Appointment | null>(null);
  const [booking, setBooking] = useState<{ staffId: string; start: Dayjs; end: Dayjs } | null>(null);
  // The appointment picked up for moving. See `handleSlot` for why this is a
  // two-step gesture rather than a drag.
  const [moving, setMoving] = useState<Appointment | null>(null);

  const queryClient = useQueryClient();
  const rescheduleAppointment = useRescheduleAppointment();
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    // The dashboard's stats bar counts the same rows.
    queryClient.invalidateQueries({ queryKey: ['appointment-dashboard'] });
  }, [queryClient]);

  const { data: staff } = useStaff();
  const { data: patients } = usePatients();
  const { data: services } = useServices();
  const { data: doctorSchedules } = useDoctorSchedules();

  const doctors = useMemo(() => (staff ?? []).filter((member) => DOCTOR_ROLES.includes(member.role)), [staff]);
  const visibleStaffIds = useMemo(
    () => new Set(selectedStaffIds ?? doctors.map((doctor) => doctor.id)),
    [selectedStaffIds, doctors],
  );

  const range = useMemo(() => getCalendarRange(viewMode, anchor), [viewMode, anchor]);

  const { data: appointments, isLoading } = useAppointments({
    clinicId,
    from: range.start.toISOString(),
    to: range.end.toISOString(),
  });
  const { data: scheduleExceptions } = useScheduleExceptions({
    clinicId,
    from: range.start.format('YYYY-MM-DD'),
    to: range.end.format('YYYY-MM-DD'),
  });

  const patientName = (id: string) => patients?.find((patient) => patient.id === id)?.name ?? id;
  const staffName = (id: string) => staff?.find((member) => member.id === id)?.fullName ?? id;
  const serviceName = (id: string) => services?.find((service) => service.id === id)?.name ?? id;

  const events: CalendarEvent[] = useMemo(
    () =>
      (appointments ?? [])
        .filter((appointment) => visibleStaffIds.has(appointment.staffId))
        .map((appointment) => ({
          id: appointment.id,
          title: `${patientName(appointment.patientId)} — ${serviceName(appointment.serviceId)}`,
          start: new Date(appointment.scheduledStart),
          end: new Date(appointment.scheduledEnd),
          resourceId: appointment.staffId,
          appointment,
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appointments, visibleStaffIds, patients, services],
  );

  // One column per SELECTED provider, in Day view only. Week and month have
  // no room for a column each and read as a diary rather than a rota.
  const resources: CalendarResource[] | undefined =
    viewMode === 'day'
      ? doctors
          .filter((doctor) => visibleStaffIds.has(doctor.id))
          .map((doctor) => ({ resourceId: doctor.id, resourceTitle: doctor.fullName }))
      : undefined;

  // Full-day exceptions only (no startTime) — the whole day is shaded off
  // for that doctor. Partial-day exceptions are deferred (see the Calendar
  // view plan's explicitly-deferred list).
  const fullDayLeaveByStaffAndDate = useMemo(() => {
    const set = new Set<string>();
    for (const exception of scheduleExceptions ?? []) {
      if (!exception.startTime) {
        set.add(`${exception.staffId}-${dayjs(exception.date).format('YYYY-MM-DD')}`);
      }
    }
    return set;
  }, [scheduleExceptions]);

  const scheduleByStaffAndDay = useMemo(() => {
    const map = new Map<string, typeof doctorSchedules>();
    for (const entry of doctorSchedules ?? []) {
      const key = `${entry.staffId}-${entry.dayOfWeek}`;
      const list = map.get(key) ?? [];
      list.push(entry);
      map.set(key, list);
    }
    return map;
  }, [doctorSchedules]);

  const isWithinWorkingHours = useCallback(
    (staffId: string, date: Dayjs): boolean => {
      const schedules = scheduleByStaffAndDay.get(`${staffId}-${date.day()}`) ?? [];
      return schedules.some((schedule) => {
        if (dayjs(schedule.effectiveFrom).isAfter(date, 'day')) return false;
        if (schedule.effectiveTo && dayjs(schedule.effectiveTo).isBefore(date, 'day')) return false;
        const startMinutes = dayjs.utc(schedule.startTime).hour() * 60 + dayjs.utc(schedule.startTime).minute();
        const endMinutes = dayjs.utc(schedule.endTime).hour() * 60 + dayjs.utc(schedule.endTime).minute();
        const currentMinutes = date.hour() * 60 + date.minute();
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      });
    },
    [scheduleByStaffAndDay],
  );

  const slotPropGetter = useCallback(
    (date: Date, resourceId?: number | string) => {
      if (!resourceId) return {};
      const d = dayjs(date);
      if (fullDayLeaveByStaffAndDate.has(`${resourceId}-${d.format('YYYY-MM-DD')}`)) {
        return { style: { backgroundColor: '#fafafa' } };
      }
      if (!isWithinWorkingHours(String(resourceId), d)) {
        return { style: { backgroundColor: '#fafafa' } };
      }
      return {};
    },
    [fullDayLeaveByStaffAndDate, isWithinWorkingHours],
  );

  const dayPropGetter = useCallback(
    (date: Date) => {
      const d = dayjs(date).format('YYYY-MM-DD');
      const anyoneOnLeave = [...visibleStaffIds].some((staffId) => fullDayLeaveByStaffAndDate.has(`${staffId}-${d}`));
      return anyoneOnLeave ? { style: { backgroundColor: '#fafafa' } } : {};
    },
    [visibleStaffIds, fullDayLeaveByStaffAndDate],
  );

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    const terminal = ['CANCELLED', 'NO_SHOW', 'RESCHEDULED'].includes(event.appointment.status);
    return {
      style: {
        backgroundColor: getDoctorColor(event.resourceId),
        opacity: terminal ? 0.45 : 1,
        border: 'none',
      },
    };
  }, []);

  /**
   * MOVING AN APPOINTMENT — pick it up, then click where it goes.
   *
   * NOT a drag. `react-big-calendar`'s drag-and-drop addon ships CommonJS-only
   * against an ESM entry and its default export does not survive this project's
   * production bundle — it throws at render, and because the router mounts at
   * the root that blanks EVERY page rather than just the calendar. Rather than
   * fight the bundler, the gesture became two clicks.
   *
   * Which is the better interaction anyway, and would be worth choosing on its
   * own: a drag is unusable from a keyboard, awkward on the tablet the front
   * desk actually uses, and gives no chance to change your mind. Two clicks
   * are reversible, announce themselves, and work with any input device.
   *
   * The move is a PROPOSAL either way. It goes through the same reschedule
   * endpoint the drawer uses, so the same validator decides — capacity, the
   * roster, the clinic's window, the service mapping — and an invalid target
   * comes back with the engine's own sentence rather than a status code.
   */
  const handleSlot = useCallback(
    async (slot: { start: Date; end: Date; resourceId?: string | number }) => {
      const staffId = slot.resourceId ? String(slot.resourceId) : undefined;

      if (moving) {
        const appointment = moving;
        // Moving to another doctor's column is a change of PROVIDER, which
        // reschedule does not express — refused in words rather than silently
        // moving the time and keeping the old doctor.
        if (staffId && staffId !== appointment.staffId) {
          message.warning(
            'Pick a time in the same doctor\'s column — changing doctor needs a new booking.',
          );
          return;
        }
        // The appointment keeps its LENGTH; only its start moves. Taking the
        // clicked slot's end would silently resize a 30-minute consultation to
        // whatever the grid happens to be sliced at.
        const lengthMs =
          new Date(appointment.scheduledEnd).getTime() - new Date(appointment.scheduledStart).getTime();
        try {
          await rescheduleAppointment.mutateAsync({
            id: appointment.id,
            input: {
              scheduledStart: slot.start.toISOString(),
              scheduledEnd: new Date(slot.start.getTime() + lengthMs).toISOString(),
            },
          });
          message.success('Moved.');
          setMoving(null);
          refresh();
        } catch (error) {
          message.error(error instanceof ApiError ? error.message : 'That time is not available.');
        }
        return;
      }

      // Not moving anything: an empty slot is an invitation to book. Only in
      // Day view, where a column names the doctor — in week and month a click
      // names a time but nobody to see it.
      if (!staffId) return;
      setBooking({ staffId, start: clinicDayjs(slot.start), end: clinicDayjs(slot.end) });
    },
    [moving, rescheduleAppointment, refresh],
  );

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key === 'l') {
        onSwitchToList();
        return;
      }
      const match = VIEW_OPTIONS.find((option) => option.shortcut === key);
      if (match) {
        setViewMode(match.value);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onSwitchToList]);

  const rangeLabel = useMemo(() => {
    if (viewMode === 'day') return anchor.format('dddd, DD MMMM YYYY');
    if (viewMode === 'week') return `${range.start.format('DD MMM')} – ${range.end.format('DD MMM YYYY')}`;
    return anchor.format('MMMM YYYY');
  }, [viewMode, anchor, range]);

  return (
    <div className="kw-cal-shell">
      {/* ---- LEFT: the month at a glance, and who is on it ---------------- */}
      <div className="kw-cal-rail">
        <MiniCalendar
          fullscreen={false}
          value={anchor}
          onSelect={(value, info) => {
            // `info.source === 'date'` is a click on a day; month/year changes
            // move the mini calendar without dragging the main grid with them.
            if (info.source !== 'date') return;
            setAnchor(value);
            if (viewMode === 'month') setViewMode('day');
          }}
        />

        <div className="kw-cal-providers">
          <Checkbox
            checked={selectedStaffIds === null}
            indeterminate={
              selectedStaffIds !== null &&
              selectedStaffIds.length > 0 &&
              selectedStaffIds.length < doctors.length
            }
            onChange={(event) => setSelectedStaffIds(event.target.checked ? null : [])}
          >
            All providers
          </Checkbox>
          {doctors.map((doctor) => (
            <Checkbox
              key={doctor.id}
              checked={visibleStaffIds.has(doctor.id)}
              onChange={(event) => {
                const current = selectedStaffIds ?? doctors.map((d) => d.id);
                setSelectedStaffIds(
                  event.target.checked
                    ? [...current, doctor.id]
                    : current.filter((id) => id !== doctor.id),
                );
              }}
            >
              <span
                className="kw-cal-provider-swatch"
                style={{ backgroundColor: getDoctorColor(doctor.id) }}
                aria-hidden
              />
              {doctor.fullName}
            </Checkbox>
          ))}
          {doctors.length === 0 && (
            <Text type="secondary">No doctors are set up yet.</Text>
          )}
        </div>
      </div>

      {/* ---- CENTRE: the grid -------------------------------------------- */}
      <div className="kw-cal-main">
        <Space className="kw-cal-toolbar" wrap>
          <Segmented
            options={VIEW_OPTIONS}
            value={viewMode}
            onChange={(value) => setViewMode(value as CalendarViewMode)}
          />
          <Space.Compact>
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
          </Space.Compact>
          <Text strong>{rangeLabel}</Text>
          <Button onClick={onSwitchToList}>List view (L)</Button>
        </Space>

        {moving && (
          <div className="kw-cal-moving" role="status" data-testid="calendar-moving-banner">
            <span>
              Moving <strong>{patientName(moving.patientId)}</strong> — click a time in{' '}
              {staffName(moving.staffId)}'s column.
            </span>
            <Button size="small" onClick={() => setMoving(null)}>
              Cancel move
            </Button>
          </div>
        )}

        <div className="kw-cal-grid" data-loading={isLoading} data-moving={moving !== null}>
          <BigCalendar
            localizer={localizer}
            view={viewMode}
            onView={() => {
              /* view switching is our Segmented control, not RBC's toolbar */
            }}
            date={anchor.toDate()}
            onNavigate={(newDate) => setAnchor(dayjs(newDate))}
            onDrillDown={(newDate) => {
              setAnchor(dayjs(newDate));
              setViewMode('day');
            }}
            toolbar={false}
            events={events}
            resources={resources}
            resourceIdAccessor="resourceId"
            resourceTitleAccessor="resourceTitle"
            resourceAccessor="resourceId"
            min={dayjs().hour(DAY_START_HOUR).minute(0).toDate()}
            max={dayjs().hour(DAY_END_HOUR).minute(0).toDate()}
            eventPropGetter={eventPropGetter}
            slotPropGetter={slotPropGetter}
            dayPropGetter={dayPropGetter}
            onSelectEvent={(event) => setDetailAppointment(event.appointment)}
            selectable={viewMode === 'day'}
            onSelectSlot={handleSlot}
          />
        </div>
      </div>

      {/* ---- RIGHT: the detail panel -------------------------------------- */}
      <AppointmentDetailPanel
        appointment={detailAppointment}
        patientName={detailAppointment ? patientName(detailAppointment.patientId) : ''}
        staffName={detailAppointment ? staffName(detailAppointment.staffId) : ''}
        serviceName={detailAppointment ? serviceName(detailAppointment.serviceId) : ''}
        onClose={() => setDetailAppointment(null)}
        onChanged={() => {
          setDetailAppointment(null);
          refresh();
        }}
        onReschedule={(appointment) => {
          setDetailAppointment(null);
          setReschedulingAppointment(appointment);
        }}
        onMove={(appointment) => {
          // Day view is the only one whose columns name a doctor, so it is the
          // only one where a clicked slot is unambiguous.
          setViewMode('day');
          setAnchor(clinicDayjs(appointment.scheduledStart));
          setDetailAppointment(null);
          setMoving(appointment);
        }}
      />

      <RescheduleAppointmentDrawer
        appointment={reschedulingAppointment}
        onClose={() => {
          setReschedulingAppointment(null);
          refresh();
        }}
      />

      <CalendarBookingModal
        open={booking !== null}
        clinicId={clinicId}
        staffId={booking?.staffId}
        staffName={booking ? staffName(booking.staffId) : ''}
        slotStart={booking?.start ?? null}
        slotEnd={booking?.end ?? null}
        onClose={() => setBooking(null)}
        onBooked={() => {
          setBooking(null);
          refresh();
        }}
      />
    </div>
  );
}
