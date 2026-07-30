import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar as BigCalendar, dayjsLocalizer } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import { Button, Checkbox, DatePicker, Segmented, Space, Tag, Typography } from 'antd';
import { LeftOutlined, RightOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import { Role } from '@kuwick/shared';
import { useAppointments } from '../hooks/useAppointments';
import { useDoctorSchedules } from '../hooks/useDoctorSchedules';
import { useScheduleExceptions } from '../hooks/useScheduleExceptions';
import { useServices } from '../hooks/useServices';
import { useStaff } from '../../hr/hooks/useStaff';
import { usePatients } from '../../core/hooks/usePatients';
import { Appointment } from '../types';
import { AppointmentDetailPopover } from '../AppointmentDetailPopover';
import { RescheduleAppointmentDrawer } from '../RescheduleAppointmentDrawer';
import { CalendarViewMode, getCalendarRange, shiftAnchor, todayAnchor } from './calendar-range';
import { getDoctorColor } from './doctor-color';

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

const VIEW_OPTIONS: { label: string; value: CalendarViewMode; shortcut: string }[] = [
  { label: 'Day (D)', value: 'day', shortcut: 'd' },
  { label: 'Week (W)', value: 'week', shortcut: 'w' },
  { label: 'Month (M)', value: 'month', shortcut: 'm' },
  { label: 'Provider (P)', value: 'provider', shortcut: 'p' },
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

  const resources: CalendarResource[] | undefined =
    viewMode === 'provider'
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
    if (viewMode === 'day' || viewMode === 'provider') return anchor.format('dddd, DD MMMM YYYY');
    if (viewMode === 'week') return `${range.start.format('DD MMM')} – ${range.end.format('DD MMM YYYY')}`;
    return anchor.format('MMMM YYYY');
  }, [viewMode, anchor, range]);

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'space-between' }} wrap>
        <Space>
          <Segmented options={VIEW_OPTIONS} value={viewMode} onChange={(value) => setViewMode(value as CalendarViewMode)} />
          <Button icon={<LeftOutlined />} onClick={() => setAnchor((current) => shiftAnchor(viewMode, current, -1))} />
          <Button onClick={() => setAnchor(todayAnchor())}>Today</Button>
          <Button icon={<RightOutlined />} onClick={() => setAnchor((current) => shiftAnchor(viewMode, current, 1))} />
          <DatePicker value={anchor} onChange={(value) => value && setAnchor(value)} allowClear={false} />
          <Text strong>{rangeLabel}</Text>
        </Space>
        <Button onClick={onSwitchToList}>List view (L)</Button>
      </Space>
      <Space style={{ marginBottom: 12 }} wrap>
        <Checkbox
          checked={selectedStaffIds === null}
          indeterminate={selectedStaffIds !== null && selectedStaffIds.length > 0 && selectedStaffIds.length < doctors.length}
          onChange={(event) => setSelectedStaffIds(event.target.checked ? null : [])}
        >
          Select all
        </Checkbox>
        {doctors.map((doctor) => (
          <Checkbox
            key={doctor.id}
            checked={visibleStaffIds.has(doctor.id)}
            onChange={(event) => {
              const current = selectedStaffIds ?? doctors.map((d) => d.id);
              const next = event.target.checked
                ? [...current, doctor.id]
                : current.filter((id) => id !== doctor.id);
              setSelectedStaffIds(next);
            }}
          >
            <Tag color={getDoctorColor(doctor.id)} style={{ marginRight: 4 }}>
              &nbsp;
            </Tag>
            {doctor.fullName}
          </Checkbox>
        ))}
      </Space>
      <div style={{ height: 640, opacity: isLoading ? 0.6 : 1 }}>
        <BigCalendar
          localizer={localizer}
          view={viewMode === 'provider' ? 'day' : viewMode}
          onView={() => {
            /* view switching is driven by our own Segmented control, not RBC's toolbar */
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
        />
      </div>
      <AppointmentDetailPopover
        appointment={detailAppointment}
        patientName={detailAppointment ? patientName(detailAppointment.patientId) : ''}
        staffName={detailAppointment ? staffName(detailAppointment.staffId) : ''}
        serviceName={detailAppointment ? serviceName(detailAppointment.serviceId) : ''}
        onClose={() => setDetailAppointment(null)}
        onReschedule={(appointment) => {
          setDetailAppointment(null);
          setReschedulingAppointment(appointment);
        }}
      />
      <RescheduleAppointmentDrawer
        appointment={reschedulingAppointment}
        onClose={() => setReschedulingAppointment(null)}
      />
    </div>
  );
}
