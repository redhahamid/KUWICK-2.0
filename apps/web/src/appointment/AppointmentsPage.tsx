import { useState } from 'react';
import { Button, Popconfirm, Select, Space, Table, Typography, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { AppointmentStatus, APPOINTMENT_STATUS_TONE } from '@kuwick/shared';
import { StatusBadge } from '../design-system/components/StatusBadge';
import { useClinics } from '../core/hooks/useClinics';
import { usePatients } from '../core/hooks/usePatients';
import { useStaff } from '../hr/hooks/useStaff';
import {
  useAppointments,
  useArrivedAppointment,
  useCancelAppointment,
  useConfirmAppointment,
  useNoShowAppointment,
} from './hooks/useAppointments';
import { Appointment } from './types';
import { BookAppointmentDrawer } from './BookAppointmentDrawer';
import { RescheduleAppointmentDrawer } from './RescheduleAppointmentDrawer';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

const ARRIVABLE_FROM: AppointmentStatus[] = [AppointmentStatus.CONFIRMED, AppointmentStatus.REMINDED];
const NON_CANCELLABLE: AppointmentStatus[] = [
  AppointmentStatus.CANCELLED,
  AppointmentStatus.RESCHEDULED,
  AppointmentStatus.NO_SHOW,
  AppointmentStatus.COMPLETED,
];

export function AppointmentsPage() {
  const [clinicId, setClinicId] = useState<string>();
  const [staffId, setStaffId] = useState<string>();
  const [status, setStatus] = useState<AppointmentStatus>();
  const [bookOpen, setBookOpen] = useState(false);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);

  const { data: appointments, isLoading } = useAppointments({ clinicId, staffId, status });
  const { data: clinics } = useClinics();
  const { data: patients } = usePatients();
  const { data: staff } = useStaff();

  const confirmAppointment = useConfirmAppointment();
  const cancelAppointment = useCancelAppointment();
  const noShowAppointment = useNoShowAppointment();
  const arrivedAppointment = useArrivedAppointment();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;
  const patientName = (id: string) => patients?.find((patient) => patient.id === id)?.name ?? id;
  const staffName = (id: string) => staff?.find((member) => member.id === id)?.fullName ?? id;

  const reportFailure = (error: unknown, fallback: string) => {
    message.error(error instanceof ApiError ? error.message : fallback);
  };

  const handleConfirm = async (id: string) => {
    try {
      await confirmAppointment.mutateAsync({ id });
    } catch (error) {
      reportFailure(error, 'Failed to confirm');
    }
  };

  const handleArrived = async (id: string) => {
    try {
      await arrivedAppointment.mutateAsync({ id });
    } catch (error) {
      reportFailure(error, 'Failed to mark arrived');
    }
  };

  const handleNoShow = async (id: string) => {
    try {
      await noShowAppointment.mutateAsync({ id });
    } catch (error) {
      reportFailure(error, 'Failed to mark no-show');
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelAppointment.mutateAsync({ id, input: {} });
    } catch (error) {
      reportFailure(error, 'Failed to cancel');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Appointments
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setBookOpen(true)}>
          Book Appointment
        </Button>
      </Space>
      <Space style={{ marginBottom: 16 }} wrap>
        <Select
          allowClear
          placeholder="Filter by clinic"
          style={{ width: 200 }}
          value={clinicId}
          onChange={setClinicId}
          options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
        />
        <Select
          allowClear
          placeholder="Filter by doctor"
          style={{ width: 200 }}
          value={staffId}
          onChange={setStaffId}
          options={staff?.map((member) => ({ value: member.id, label: member.fullName }))}
        />
        <Select
          allowClear
          placeholder="Filter by status"
          style={{ width: 200 }}
          value={status}
          onChange={setStatus}
          options={Object.values(AppointmentStatus).map((value) => ({ value, label: value }))}
        />
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={appointments}
        columns={[
          { title: 'Patient', render: (_, record: Appointment) => patientName(record.patientId) },
          { title: 'Doctor', render: (_, record: Appointment) => staffName(record.staffId) },
          { title: 'Clinic', render: (_, record: Appointment) => clinicName(record.clinicId) },
          {
            title: 'Scheduled',
            render: (_, record: Appointment) =>
              `${dayjs(record.scheduledStart).format('YYYY-MM-DD HH:mm')}–${dayjs(record.scheduledEnd).format('HH:mm')}`,
          },
          {
            title: 'Status',
            dataIndex: 'status',
            render: (value: AppointmentStatus) => (
              <StatusBadge label={value} tone={APPOINTMENT_STATUS_TONE[value]} />
            ),
          },
          {
            title: 'Actions',
            render: (_, record: Appointment) => (
              <Space wrap>
                {record.status === AppointmentStatus.REQUESTED && (
                  <Button size="small" onClick={() => handleConfirm(record.id)}>
                    Confirm
                  </Button>
                )}
                {ARRIVABLE_FROM.includes(record.status) && (
                  <Button size="small" onClick={() => handleArrived(record.id)}>
                    Arrived
                  </Button>
                )}
                {ARRIVABLE_FROM.includes(record.status) && (
                  <Button size="small" onClick={() => handleNoShow(record.id)}>
                    No-Show
                  </Button>
                )}
                {!NON_CANCELLABLE.includes(record.status) && (
                  <Button size="small" onClick={() => setRescheduling(record)}>
                    Reschedule
                  </Button>
                )}
                {!NON_CANCELLABLE.includes(record.status) && (
                  <Popconfirm title="Cancel this appointment?" onConfirm={() => handleCancel(record.id)}>
                    <Button size="small" danger>
                      Cancel
                    </Button>
                  </Popconfirm>
                )}
              </Space>
            ),
          },
        ]}
      />
      <BookAppointmentDrawer open={bookOpen} onClose={() => setBookOpen(false)} />
      <RescheduleAppointmentDrawer appointment={rescheduling} onClose={() => setRescheduling(null)} />
    </>
  );
}
