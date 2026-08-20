import { useState } from 'react';
import { Button, DatePicker, Drawer, Space, Spin, Tag, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useAvailability, useRescheduleAppointment } from './hooks/useAppointments';
import { Appointment, AvailableSlot } from './types';
import { ApiError } from '../core/api-client';
import { formatClinicTime } from '../clinical/clinicTime';

const { Text } = Typography;

interface RescheduleAppointmentDrawerProps {
  appointment: Appointment | null;
  onClose: () => void;
}

// Reuses the same availability-driven slot picker as BookAppointmentDrawer.
// Clinic/doctor/service stay fixed — only the time changes, matching what
// AppointmentService.reschedule() actually does on the backend.
export function RescheduleAppointmentDrawer({ appointment, onClose }: RescheduleAppointmentDrawerProps) {
  const rescheduleAppointment = useRescheduleAppointment();
  const [date, setDate] = useState<Dayjs>();
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot>();

  const { data: slots, isFetching: loadingSlots } = useAvailability({
    clinicId: appointment?.clinicId,
    staffId: appointment?.staffId,
    serviceId: appointment?.serviceId,
    date: date?.format('YYYY-MM-DD'),
  });

  const handleClose = () => {
    setDate(undefined);
    setSelectedSlot(undefined);
    onClose();
  };

  const handleReschedule = async () => {
    if (!appointment || !selectedSlot) {
      return;
    }
    try {
      await rescheduleAppointment.mutateAsync({
        id: appointment.id,
        input: { scheduledStart: selectedSlot.start, scheduledEnd: selectedSlot.end },
      });
      message.success('Appointment rescheduled');
      handleClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to reschedule appointment');
    }
  };

  return (
    <Drawer
      title="Reschedule Appointment"
      open={Boolean(appointment)}
      onClose={handleClose}
      destroyOnHidden
      width={420}
      rootClassName="kw-apt3-drawer"
    >
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text>New Date</Text>
          <DatePicker
            style={{ width: '100%' }}
            value={date}
            onChange={(value) => {
              setDate(value ?? undefined);
              setSelectedSlot(undefined);
            }}
          />
        </div>

        {date && (
          <div>
            <Text strong>Available slots</Text>
            {loadingSlots ? (
              <Spin size="small" style={{ display: 'block', marginTop: 8 }} />
            ) : (
              <Space wrap style={{ marginTop: 8 }}>
                {slots && slots.length > 0 ? (
                  slots.map((slot) => (
                    <Button
                      key={slot.start}
                      type={selectedSlot?.start === slot.start ? 'primary' : 'default'}
                      onClick={() => setSelectedSlot(slot)}
                    >
                      {formatClinicTime(slot.start)}
                    </Button>
                  ))
                ) : (
                  <Tag>No open slots for this date</Tag>
                )}
              </Space>
            )}
          </div>
        )}

        <Button
          type="primary"
          block
          disabled={!selectedSlot}
          loading={rescheduleAppointment.isPending}
          onClick={handleReschedule}
        >
          Confirm Reschedule
        </Button>
      </Space>
    </Drawer>
  );
}
