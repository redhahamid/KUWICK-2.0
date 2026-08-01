import { useEffect, useState } from 'react';
import { Button, DatePicker, Drawer, Select, Space, Spin, Tag, Typography, message } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { usePatients } from '../core/hooks/usePatients';
import { useStaff } from '../hr/hooks/useStaff';
import { useServices } from '../clinical/hooks/useServices';
import { useAvailability, useCreateAppointment } from './hooks/useAppointments';
import { AvailableSlot } from './types';
import { ApiError } from '../core/api-client';

const { Text } = Typography;

interface BookAppointmentDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function BookAppointmentDrawer({ open, onClose }: BookAppointmentDrawerProps) {
  const { data: clinics } = useClinics();
  const { data: patients } = usePatients();
  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const defaultClinicId = useDefaultClinicId();
  const createAppointment = useCreateAppointment();

  const [clinicId, setClinicId] = useState<string>();
  const [patientId, setPatientId] = useState<string>();
  const [staffId, setStaffId] = useState<string>();
  const [serviceId, setServiceId] = useState<string>();
  const [date, setDate] = useState<Dayjs>();
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot>();

  // A single-clinic tenant, or a staff member tied to one branch, never
  // needs to pick this — pre-fill it the moment the drawer opens.
  useEffect(() => {
    if (open && defaultClinicId && !clinicId) {
      setClinicId(defaultClinicId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultClinicId]);

  const { data: slots, isFetching: loadingSlots } = useAvailability({
    clinicId,
    staffId,
    serviceId,
    date: date?.format('YYYY-MM-DD'),
  });

  const reset = () => {
    setClinicId(undefined);
    setPatientId(undefined);
    setStaffId(undefined);
    setServiceId(undefined);
    setDate(undefined);
    setSelectedSlot(undefined);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleBook = async () => {
    if (!clinicId || !patientId || !staffId || !serviceId || !selectedSlot) {
      return;
    }
    try {
      await createAppointment.mutateAsync({
        clinicId,
        patientId,
        staffId,
        serviceId,
        source: 'FRONT_DESK',
        scheduledStart: selectedSlot.start,
        scheduledEnd: selectedSlot.end,
      });
      message.success('Appointment booked');
      handleClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to book appointment');
    }
  };

  const readyForSlots = Boolean(clinicId && staffId && serviceId && date);

  return (
    <Drawer title="Book Appointment" open={open} onClose={handleClose} destroyOnHidden width={420}>
      <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <div>
          <Text>Clinic</Text>
          <Select
            style={{ width: '100%' }}
            value={clinicId}
            onChange={(value) => {
              setClinicId(value);
              setSelectedSlot(undefined);
            }}
            options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
          />
        </div>
        <div>
          <Text>Patient</Text>
          <Select
            style={{ width: '100%' }}
            value={patientId}
            onChange={setPatientId}
            options={patients?.map((patient) => ({ value: patient.id, label: patient.name }))}
          />
        </div>
        <div>
          <Text>Doctor</Text>
          <Select
            style={{ width: '100%' }}
            value={staffId}
            onChange={(value) => {
              setStaffId(value);
              setSelectedSlot(undefined);
            }}
            options={staff?.map((member) => ({ value: member.id, label: member.fullName }))}
          />
        </div>
        <div>
          <Text>Service</Text>
          <Select
            style={{ width: '100%' }}
            value={serviceId}
            onChange={(value) => {
              setServiceId(value);
              setSelectedSlot(undefined);
            }}
            options={services?.map((service) => ({ value: service.id, label: service.name }))}
          />
        </div>
        <div>
          <Text>Date</Text>
          <DatePicker
            style={{ width: '100%' }}
            value={date}
            onChange={(value) => {
              setDate(value ?? undefined);
              setSelectedSlot(undefined);
            }}
          />
        </div>

        {readyForSlots && (
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
                      {dayjs(slot.start).format('HH:mm')}
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
          disabled={!patientId || !selectedSlot}
          loading={createAppointment.isPending}
          onClick={handleBook}
        >
          Book Appointment
        </Button>
      </Space>
    </Drawer>
  );
}
