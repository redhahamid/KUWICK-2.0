import { useEffect, useState } from 'react';
import { Alert, Button, DatePicker, Select, Skeleton, Space, Tag, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { KuwickModal } from '../../design-system/kuwick/KuwickModal';
import { KuwickModalActionBar } from '../../design-system/kuwick/KuwickModalActionBar';
import { useStaff } from '../../hr/hooks/useStaff';
import { useServices } from '../hooks/useServices';
import { useDoctorServiceQualifications } from '../../appointment/hooks/useDoctorServiceQualifications';
import { useSlotCapacityConfigs } from '../../appointment/hooks/useSlotCapacityConfigs';
import { useAvailability, useCreateAppointment } from '../../appointment/hooks/useAppointments';
import { AvailableSlot } from '../../appointment/types';
import { ApiError } from '../../core/api-client';
import { Visit } from '../types';
import {
  bookableDoctors,
  capacityFor,
  noSlotsReason,
  servicesForDoctor,
  slotLabel,
} from './followUpPresentation';

const { Text } = Typography;

export interface BookFollowUpModalProps {
  open: boolean;
  visit: Visit;
  patientId: string;
  patientName: string;
  onClose: () => void;
  /** Called with the new appointment's id once the server has stored it. */
  onBooked?: (appointmentId: string) => void;
}

/**
 * b4 PIECE C — BOOKING THE FOLLOW-UP, FROM THE ROOM.
 *
 * THE APPOINTMENTS MODULE IS THE STORE, AND THIS IS NOT A SECOND ONE. The
 * booking goes through `POST /appointments`, which resolves the patient, the
 * branch, the doctor and the service under the caller's own tenant and then
 * runs `AppointmentBookingValidator` — qualification, roster, leave, overlap,
 * daily capacity. The slots offered come from `/availability`, which is
 * `SlotAvailabilityService`: the same roster minus the same booked time, cut
 * by the clinic's own slot length and capped at its daily capacity. Nothing
 * about scheduling is decided in this file, and an appointment booked here is
 * an ordinary row in the Appointments module the moment it is written —
 * arrivable, reschedulable and cancellable from there, with no canvas-side
 * copy to reconcile.
 *
 * WHAT IT PRE-FILLS, AND WHY ONLY THIS MUCH. The patient is the one on screen
 * and is not a field at all — a follow-up picker inside a consultation that
 * asks which patient is a picker in the wrong place. The branch is the VISIT'S
 * branch, and the doctor defaults to the visit's attending clinician, because
 * "come back and see me" is what a TCA usually means. Both remain editable:
 * a clinic that rotates its follow-ups to whoever is rostered must be able to
 * say so, and the doctor determines which services are offered.
 *
 * FRONT_DESK as the source, deliberately. The source decides the initial
 * status (`AppointmentService.create`): FRONT_DESK is confirmed on the spot,
 * ONLINE_PORTAL waits for somebody to confirm it. A doctor booking a TCA with
 * the patient in the room has already done the confirming, and leaving it
 * REQUESTED would put a task on the front desk for an appointment nobody is
 * waiting on. It records how the booking was taken, not who took it — the
 * actor is on the record either way.
 */
export function BookFollowUpModal({
  open,
  visit,
  patientId,
  patientName,
  onClose,
  onBooked,
}: BookFollowUpModalProps) {
  const [staffId, setStaffId] = useState<string | undefined>(visit.staffId ?? undefined);
  const [serviceId, setServiceId] = useState<string>();
  const [date, setDate] = useState<Dayjs>();
  const [slot, setSlot] = useState<AvailableSlot>();
  const [error, setError] = useState<string | null>(null);

  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const { data: qualifications, isLoading: loadingMapping } = useDoctorServiceQualifications();
  const { data: capacityConfigs } = useSlotCapacityConfigs();
  const createAppointment = useCreateAppointment();

  // Re-opening starts clean, and starts from the attending doctor again. The
  // modal is destroyed on close (KuwickModal → destroyOnHidden), so this is
  // about the state held here rather than about the DOM.
  useEffect(() => {
    if (!open) return;
    setStaffId(visit.staffId ?? undefined);
    setServiceId(undefined);
    setDate(undefined);
    setSlot(undefined);
    setError(null);
  }, [open, visit.staffId]);

  const doctors = bookableDoctors(staff);
  const offered = servicesForDoctor(services, qualifications, staffId);
  const capacity = capacityFor(capacityConfigs, { clinicId: visit.clinicId, staffId, serviceId });

  const { data: slots, isFetching: loadingSlots } = useAvailability({
    clinicId: visit.clinicId,
    staffId,
    serviceId,
    date: date?.format('YYYY-MM-DD'),
  });

  const book = async () => {
    if (!staffId || !serviceId || !slot) return;
    setError(null);
    try {
      const appointment = await createAppointment.mutateAsync({
        clinicId: visit.clinicId,
        patientId,
        staffId,
        serviceId,
        source: 'FRONT_DESK',
        scheduledStart: slot.start,
        scheduledEnd: slot.end,
      });
      message.success('Follow-up booked.');
      onBooked?.(appointment.id);
      onClose();
    } catch (err) {
      // INSIDE the modal, not as a toast. Every refusal here is one the doctor
      // can act on — a slot somebody else took while this was open, a capacity
      // that filled — and a message that disappears while they are still
      // looking at the form it refers to is a message they have to guess at.
      setError(err instanceof ApiError ? err.message : 'The follow-up could not be booked.');
    }
  };

  const dirty = Boolean(serviceId || date || slot);

  return (
    <KuwickModal
      open={open}
      size="small"
      title="Book a follow-up"
      subtitle={`${patientName} · ${visit.visitNumber}`}
      dirty={dirty}
      error={error}
      loading={createAppointment.isPending}
      onClose={onClose}
      dataTestId="book-follow-up"
      footer={
        <KuwickModalActionBar
          cancel={<Button onClick={onClose}>Cancel</Button>}
          primary={
            <Button
              type="primary"
              disabled={!slot}
              loading={createAppointment.isPending}
              onClick={() => void book()}
              data-testid="confirm-follow-up"
            >
              Book follow-up
            </Button>
          }
        />
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div>
          <Text strong>Doctor</Text>
          <Select
            style={{ width: '100%' }}
            value={staffId}
            aria-label="Follow-up doctor"
            placeholder="Choose a doctor"
            showSearch
            optionFilterProp="label"
            onChange={(value) => {
              setStaffId(value);
              // The mapping and the diary both belong to the doctor, so
              // everything chosen under the previous one is now a guess.
              setServiceId(undefined);
              setSlot(undefined);
            }}
            options={doctors.map((member) => ({ value: member.id, label: member.fullName }))}
          />
        </div>

        <div>
          <Text strong>Service</Text>
          {loadingMapping ? (
            <Skeleton active paragraph={false} />
          ) : (
            <>
              <Select
                style={{ width: '100%' }}
                value={serviceId}
                aria-label="Follow-up service"
                placeholder={offered.length ? 'Choose a service' : 'No services mapped to this doctor'}
                disabled={offered.length === 0}
                showSearch
                optionFilterProp="label"
                onChange={(value) => {
                  setServiceId(value);
                  setSlot(undefined);
                }}
                options={offered.map((service) => ({ value: service.id, label: service.name }))}
              />
              {staffId && offered.length === 0 && (
                <Alert
                  type="info"
                  showIcon
                  style={{ marginTop: 6 }}
                  message="This doctor is not mapped to any service yet"
                  description="Settings → Appointments & Scheduling → Doctor-Service Mapping decides who may be booked for what. Until a service is mapped there, a booking for this doctor would be refused."
                />
              )}
            </>
          )}
        </div>

        <div>
          <Text strong>Date</Text>
          <DatePicker
            style={{ width: '100%' }}
            value={date}
            aria-label="Follow-up date"
            disabled={!serviceId}
            // A follow-up is in the future. Today is left bookable — a "come
            // back this evening" is a real instruction — and the roster does
            // the rest of the refusing.
            disabledDate={(value) => value.isBefore(dayjs().startOf('day'))}
            onChange={(value) => {
              setDate(value ?? undefined);
              setSlot(undefined);
            }}
          />
          {capacity && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              {capacity.slotLengthMinutes}-minute slots
              {capacity.dailyCapacity != null
                ? ` · up to ${capacity.dailyCapacity} a day for this service`
                : ''}
            </Text>
          )}
        </div>

        {serviceId && date && (
          <div data-testid="follow-up-slots">
            <Text strong>Open slots</Text>
            {loadingSlots ? (
              <Skeleton active paragraph={{ rows: 1 }} title={false} />
            ) : slots && slots.length > 0 ? (
              <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {slots.map((option) => (
                  <Button
                    key={option.start}
                    size="small"
                    type={slot?.start === option.start ? 'primary' : 'default'}
                    onClick={() => setSlot(option)}
                    data-slot={option.start}
                  >
                    {slotLabel(option)}
                  </Button>
                ))}
              </div>
            ) : (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 6 }}
                message="No open slots"
                description={noSlotsReason(Boolean(capacity))}
              />
            )}
          </div>
        )}

        {slot && (
          <Tag color="blue" data-testid="follow-up-chosen">
            {dayjs(slot.start).format('ddd D MMM')} · {dayjs(slot.start).format('HH:mm')}–
            {dayjs(slot.end).format('HH:mm')}
          </Tag>
        )}
      </Space>
    </KuwickModal>
  );
}
