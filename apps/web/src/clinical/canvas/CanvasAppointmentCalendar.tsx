import { useState } from 'react';
import { Badge, Button, Calendar, Space, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { CalendarOutlined, PlusOutlined } from '@ant-design/icons';
import { IconTile } from '../../design-system/components/IconTile';
import { useAppointments } from '../../appointment/hooks/useAppointments';
import { useStaff } from '../../hr/hooks/useStaff';
import { useServices } from '../hooks/useServices';
import { Visit } from '../types';
import { BookFollowUpModal } from './BookFollowUpModal';
import {
  appointmentsOn,
  describeWhen,
  isStanding,
  previousAppointment,
  upcomingAppointments,
} from './followUpPresentation';

const { Text } = Typography;

export interface CanvasAppointmentCalendarProps {
  visit: Visit;
  patientId: string;
  patientName: string;
  /** Opened from the header's Appointment button as well as from a date. */
  bookingOpen?: boolean;
  onBookingOpenChange?: (open: boolean) => void;
}

/**
 * b4 PIECE C (3) — THE APPOINTMENT, BOTTOM LEFT, AS A MONTH.
 *
 * The owner's layout decision, and it changes what the surface IS. As a rail
 * card it answered "is anything booked?"; as a month it answers "what does
 * this patient's diary look like, and when shall I bring them back?" — which
 * is the question a doctor is actually holding at the end of a consultation.
 * Tapping a date starts the booking on that date.
 *
 * WHERE IT SITS. In the empty space below the visits rail, and it is DOCKED
 * there: `position: sticky; bottom` in the left column (see canvas.css). Two
 * consequences, both required by the owner's brief — it cannot push the visits
 * panel, because nothing below a block moves it, and it cannot make the page
 * scroll, because the left column is far shorter than the middle and right
 * ones and a sticky block adds no height beyond its own. The viewport spec
 * measures both.
 *
 * PREVIOUS AND NEXT, IN PLACE. The two facts that decide whether to book at
 * all: when this patient last had an appointment (including one they did not
 * attend — a no-show is exactly the context a doctor wants before booking
 * another) and what is already standing. "Come back in two weeks" said to a
 * patient already booked for next Tuesday is a double booking the front desk
 * untangles afterwards.
 *
 * IT SHOWS AND IT BOOKS. NOTHING ELSE. Cancelling and rescheduling stay in the
 * Appointments module, which is also the only store: the booking goes through
 * `/availability` and `POST /appointments`, so the clinic's Doctor-Service
 * Mapping and Slot Capacity decide what can be booked, exactly as they do at
 * the front desk.
 */
export function CanvasAppointmentCalendar({
  visit,
  patientId,
  patientName,
  bookingOpen,
  onBookingOpenChange,
}: CanvasAppointmentCalendarProps) {
  const [localOpen, setLocalOpen] = useState(false);
  const [chosenDate, setChosenDate] = useState<Dayjs>();
  // The header's Appointment button opens the SAME modal, so the page may own
  // the flag. Uncontrolled otherwise, so the calendar works on its own.
  const controlled = bookingOpen !== undefined;
  const open = controlled ? Boolean(bookingOpen) : localOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setLocalOpen(next);
    onBookingOpenChange?.(next);
  };

  // The patient's appointments, unfiltered by time — the calendar needs the
  // past ones too. A `from=<now>` would also put a moving timestamp in the
  // query key and refetch on every render.
  const { data: appointments } = useAppointments({ patientId });
  const { data: staff } = useStaff();
  const { data: services } = useServices();

  const now = new Date();
  const next = upcomingAppointments(appointments, now)[0] ?? null;
  const previous = previousAppointment(appointments, now);

  const named = <T extends { id: string }>(list: T[] | undefined, id: string, label: (item: T) => string) => {
    if (!list) return '…';
    const found = list.find((item) => item.id === id);
    return found ? label(found) : 'no longer listed';
  };
  const who = (staffId: string) => named(staff, staffId, (member) => member.fullName);
  const what = (serviceId: string) => named(services, serviceId, (service) => service.name);

  const openOn = (date: Dayjs) => {
    setChosenDate(date);
    setOpen(true);
  };

  return (
    <section className="kw2-appt-dock" aria-label="Appointments" data-testid="canvas-appointment-calendar">
      <div className="kw2-appt-head">
        <span className="kw-card-title">
          <IconTile tone="blue" size="sm">
            <CalendarOutlined />
          </IconTile>
          <Text strong style={{ fontSize: 13 }}>
            Appointments
          </Text>
        </span>
        <Button
          size="small"
          type="link"
          icon={<PlusOutlined />}
          className="kw-rail-more"
          onClick={() => openOn(dayjs())}
          data-testid="book-follow-up-button"
        >
          Book
        </Button>
      </div>

      {/* THE TWO FACTS, ABOVE THE MONTH. Read before a date is chosen, because
          they are what decides whether to choose one at all. */}
      <div className="kw2-appt-facts">
        <div data-testid="appointment-previous">
          <Text type="secondary" style={{ fontSize: 11 }}>
            Last
          </Text>{' '}
          {previous ? (
            <Text style={{ fontSize: 12 }}>
              {describeWhen(previous, now)} · {who(previous.staffId)}
              {previous.status === 'NO_SHOW' ? ' · did not attend' : ''}
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              no previous appointment
            </Text>
          )}
        </div>
        <div data-testid="appointment-next">
          <Text type="secondary" style={{ fontSize: 11 }}>
            Next
          </Text>{' '}
          {next ? (
            <Text strong style={{ fontSize: 12 }} data-appointment-id={next.id}>
              {describeWhen(next, now)} · {who(next.staffId)} · {what(next.serviceId)}
            </Text>
          ) : (
            <Text type="secondary" style={{ fontSize: 12 }}>
              none booked
            </Text>
          )}
        </div>
      </div>

      {/* The month. antd's compact calendar, with the patient's own standing
          appointments marked — a dot on a date is this patient's, never the
          clinic's whole diary, which is the Appointments module's screen. */}
      <Calendar
        fullscreen={false}
        className="kw2-appt-calendar"
        onSelect={(date, info) => {
          // `info.source` is 'date' for a day click and 'month'/'year' for the
          // header pickers — booking on a header click would open the form
          // because somebody changed month.
          if (!info || info.source === 'date') openOn(date);
        }}
        headerRender={({ value, onChange }) => (
          <div className="kw2-appt-month">
            <Button
              size="small"
              type="text"
              aria-label="Previous month"
              onClick={() => onChange(value.subtract(1, 'month'))}
            >
              ‹
            </Button>
            <Text strong style={{ fontSize: 12 }}>
              {value.format('MMMM YYYY')}
            </Text>
            <Button
              size="small"
              type="text"
              aria-label="Next month"
              onClick={() => onChange(value.add(1, 'month'))}
            >
              ›
            </Button>
          </div>
        )}
        fullCellRender={(date, info) => {
          if (info.type !== 'date') return info.originNode;
          const onThisDay = appointmentsOn(appointments, date.toDate());
          const standing = onThisDay.filter(isStanding).length;
          return (
            <div
              className="kw2-appt-cell"
              data-date={date.format('YYYY-MM-DD')}
              data-appointments={onThisDay.length || undefined}
            >
              <span>{date.date()}</span>
              {standing > 0 && <Badge status="processing" className="kw2-appt-dot" />}
            </div>
          );
        }}
      />

      {open && (
        <BookFollowUpModal
          open
          visit={visit}
          patientId={patientId}
          patientName={patientName}
          initialDate={chosenDate}
          onClose={() => setOpen(false)}
        />
      )}
    </section>
  );
}
