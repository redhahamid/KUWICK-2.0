import { useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import { APPOINTMENT_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from '../../design-system/components/StatusBadge';
import { RailPanel } from '../sections/RailPanel';
import { useAppointments } from '../../appointment/hooks/useAppointments';
import { useStaff } from '../../hr/hooks/useStaff';
import { useServices } from '../hooks/useServices';
import { Visit } from '../types';
import { BookFollowUpModal } from './BookFollowUpModal';
import { describeWhen, upcomingAppointments } from './followUpPresentation';

const { Text } = Typography;

export interface NextAppointmentCardProps {
  visit: Visit;
  patientId: string;
  patientName: string;
  /** Opened from the header's Appointment button as well as from this card. */
  bookingOpen?: boolean;
  onBookingOpenChange?: (open: boolean) => void;
}

/**
 * b4 PIECE C — THE APPOINTMENT CARD.
 *
 * WHAT IT IS FOR. Two facts a doctor needs at the end of a consultation and
 * currently has to leave the room for: whether this patient already has a
 * follow-up standing, and how to make one. The first matters more than it
 * looks — "come back in two weeks" said to a patient who is already booked
 * for next Tuesday produces a double booking that the front desk untangles
 * afterwards.
 *
 * WHERE IT SITS, AND WHY LAST. The right column's clinical order is Direct
 * Services → Orders / Procedures → Medications → Documents, and this card is
 * BELOW all four, immediately above the sticky bar. A follow-up is decided at
 * the end, next to Complete Consultation, and — the binding reason — the
 * rail's vertical budget at 1366×768 is spent: anything inserted above
 * Medications pushes the unresolved-supply warning and the first medication
 * row toward the fold, which are the two things the measured assertions
 * protect (`e2e/canvas-viewport.spec.ts`, (a) and (b)). Its height is measured
 * with the rest of the rail rather than excluded from it — a card that did not
 * count would be a card that could grow without anybody noticing.
 *
 * ONE LINE WHEN THERE IS NOTHING TO SAY. It is a `RailPanel`, so an empty
 * card collapses to its header, its wording and the control — the same shape
 * the other four cards take on a first visit.
 *
 * IT SHOWS, IT DOES NOT DECIDE. The bookings come from `GET /appointments`
 * filtered by this patient; which of them still stands is
 * `SETTLED_APPOINTMENT_STATUSES`, which mirrors the server's own list. There
 * is no canvas-side appointment store, and cancelling or rescheduling stays
 * where it has always been — the Appointments module.
 */
export function NextAppointmentCard({
  visit,
  patientId,
  patientName,
  bookingOpen,
  onBookingOpenChange,
}: NextAppointmentCardProps) {
  const [localOpen, setLocalOpen] = useState(false);
  // The header's Appointment button opens the SAME modal, so the page may own
  // the flag. Uncontrolled otherwise, so the card works on its own.
  const controlled = bookingOpen !== undefined;
  const open = controlled ? Boolean(bookingOpen) : localOpen;
  const setOpen = (next: boolean) => {
    if (!controlled) setLocalOpen(next);
    onBookingOpenChange?.(next);
  };

  // The patient's appointments, unfiltered by time. A `from=<now>` would put a
  // moving timestamp in the query key and refetch on every render for a list
  // this size; which of them are still ahead is a question the presentation
  // rules answer from the same rows.
  const { data: appointments, isLoading, error } = useAppointments({ patientId });
  const { data: staff } = useStaff();
  const { data: services } = useServices();

  const upcoming = upcomingAppointments(appointments, new Date());
  // An id is never printed, and neither is a plausible-looking noun. While the
  // directory is still loading the row says so; once it has loaded and the row
  // is still not in it, that is a fact worth reading as one.
  const named = <T extends { id: string }>(
    list: T[] | undefined,
    id: string,
    label: (item: T) => string,
    missing: string,
  ) => {
    if (!list) return '…';
    const found = list.find((item) => item.id === id);
    return found ? label(found) : missing;
  };
  const doctorName = (id: string) =>
    named(staff, id, (member) => member.fullName, 'doctor no longer listed');
  const serviceName = (id: string) =>
    named(services, id, (service) => service.name, 'service no longer listed');

  return (
    <>
      <RailPanel
        anchorId="canvas-appointment"
        title="Next Appointment"
        count={upcoming.length}
        isLoading={isLoading}
        error={error}
        // A patient with nothing booked is the ordinary case, and it is said in
        // the words a doctor would use rather than as "No data".
        emptyText="No follow-up booked."
        // ONE. The next appointment is the fact; the rest collapse into the
        // panel's own "+N more" rather than costing the rail a line each.
        previewLimit={1}
        // ON THE HEADER LINE, not in `addControl`, and this is a measurement
        // rather than a preference: as an add control it took a line of its
        // own and the card measured 116px on a rail that is already ~280px
        // over its window at 1366×768. In the header the card measures 38px
        // empty and 92px holding a booking.
        //
        // The rule `addControl` exists for does not reach this button.
        // RailPanel keeps that slot in ONE DOM position because the other
        // cards put a SEARCH BOX there, and moving a search box between the
        // header and the body remounts it and drops focus mid-word. This is a
        // button that opens a modal: there is nothing to type into and nothing
        // to lose.
        status={
          <Button
            size="small"
            icon={<CalendarOutlined />}
            onClick={() => setOpen(true)}
            data-testid="book-follow-up-button"
          >
            Book follow-up
          </Button>
        }
        items={upcoming.map((appointment) => (
          <div
            // Deliberately NOT `.kw-rail-row`. That class is what the density
            // measurement counts as a clinical row — the medications, orders
            // and documents whose disclosure it asserts exact numbers about —
            // and an appointment is none of those. It keeps
            // `.kw-rail-row-main` on its text, so the no-truncation assertion
            // covers this row like every other.
            className="kw-appt-row"
            key={appointment.id}
            data-appointment-id={appointment.id}
          >
            <Space size={4} direction="vertical" className="kw-rail-row-main">
              <Text strong style={{ fontSize: 13 }}>
                {describeWhen(appointment)}
              </Text>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {doctorName(appointment.staffId)} · {serviceName(appointment.serviceId)}
              </Text>
            </Space>
            <StatusBadge
              label={appointment.status}
              tone={APPOINTMENT_STATUS_TONE[appointment.status]}
            />
          </div>
        ))}
      />

      {open && (
        <BookFollowUpModal
          open
          visit={visit}
          patientId={patientId}
          patientName={patientName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
