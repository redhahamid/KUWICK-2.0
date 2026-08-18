import { Button, Descriptions, Drawer, Popconfirm, Space, message } from 'antd';
import dayjs from 'dayjs';
import { AppointmentStatus, APPOINTMENT_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from '../design-system/components/StatusBadge';
import {
  useArrivedAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from './hooks/useAppointments';
import { ARRIVABLE_FROM_STATUSES, NON_CANCELLABLE_STATUSES } from './appointment-status.constants';
import { Appointment } from './types';
import { ApiError } from '../core/api-client';
import { formatClinicDateTime, formatClinicTime } from '../clinical/clinicTime';

interface AppointmentDetailPopoverProps {
  appointment: Appointment | null;
  patientName: string;
  staffName: string;
  serviceName: string;
  onClose: () => void;
  onReschedule: (appointment: Appointment) => void;
}

// Opened by clicking a Calendar-view block — reuses the exact same lifecycle
// mutations and status guards as AppointmentsPage's row actions
// (appointment-status.constants.ts), so the two entry points can't diverge.
export function AppointmentDetailPopover({
  appointment,
  patientName,
  staffName,
  serviceName,
  onClose,
  onReschedule,
}: AppointmentDetailPopoverProps) {
  const confirmAppointment = useConfirmAppointment();
  const arrivedAppointment = useArrivedAppointment();
  const noShowAppointment = useNoShowAppointment();
  const cancelAppointment = useCancelAppointment();

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    try {
      await action();
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : fallback);
    }
  };

  return (
    <Drawer title={patientName} open={Boolean(appointment)} onClose={onClose} destroyOnHidden width={380}>
      {appointment && (
        <>
          <Descriptions column={1} size="small">
            <Descriptions.Item label="Status">
              <StatusBadge label={appointment.status} tone={APPOINTMENT_STATUS_TONE[appointment.status]} />
            </Descriptions.Item>
            <Descriptions.Item label="Doctor">{staffName}</Descriptions.Item>
            <Descriptions.Item label="Service">{serviceName}</Descriptions.Item>
            <Descriptions.Item label="Scheduled">
              {formatClinicDateTime(appointment.scheduledStart)} –{' '}
              {formatClinicTime(appointment.scheduledEnd)}
            </Descriptions.Item>
            {appointment.notes && <Descriptions.Item label="Notes">{appointment.notes}</Descriptions.Item>}
          </Descriptions>
          <Space style={{ marginTop: 16 }} wrap>
            {appointment.status === AppointmentStatus.REQUESTED && (
              <Button
                size="small"
                onClick={() => run(() => confirmAppointment.mutateAsync({ id: appointment.id }), 'Failed to confirm')}
              >
                Confirm
              </Button>
            )}
            {ARRIVABLE_FROM_STATUSES.includes(appointment.status) && (
              <Button
                size="small"
                onClick={() =>
                  run(() => arrivedAppointment.mutateAsync({ id: appointment.id }), 'Failed to mark arrived')
                }
              >
                Arrived
              </Button>
            )}
            {ARRIVABLE_FROM_STATUSES.includes(appointment.status) && (
              <Button
                size="small"
                onClick={() =>
                  run(() => noShowAppointment.mutateAsync({ id: appointment.id }), 'Failed to mark no-show')
                }
              >
                No-Show
              </Button>
            )}
            {!NON_CANCELLABLE_STATUSES.includes(appointment.status) && (
              <Button size="small" onClick={() => onReschedule(appointment)}>
                Reschedule
              </Button>
            )}
            {!NON_CANCELLABLE_STATUSES.includes(appointment.status) && (
              <Popconfirm
                title="Cancel this appointment?"
                onConfirm={() =>
                  run(() => cancelAppointment.mutateAsync({ id: appointment.id, input: {} }), 'Failed to cancel')
                }
              >
                <Button size="small" danger>
                  Cancel
                </Button>
              </Popconfirm>
            )}
          </Space>
        </>
      )}
    </Drawer>
  );
}
