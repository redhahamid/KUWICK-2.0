import { useState } from 'react';
import { Button, DatePicker, Drawer, Form, message, Select, Space, Table, TimePicker, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { Dayjs } from 'dayjs';
import { useDoctorSchedules, useCreateDoctorSchedule } from './hooks/useDoctorSchedules';
import { useClinics } from '../core/hooks/useClinics';
import { useStaff } from '../hr/hooks/useStaff';
import { CreateDoctorScheduleDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

const DAY_OPTIONS = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

interface DoctorScheduleFormValues {
  clinicId: string;
  staffId: string;
  dayOfWeek: number;
  timeRange: [Dayjs, Dayjs];
  effectiveFrom: Dayjs;
  effectiveTo?: Dayjs;
}

export function DoctorSchedulesPage() {
  const { data: schedules, isLoading } = useDoctorSchedules();
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const createSchedule = useCreateDoctorSchedule();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<DoctorScheduleFormValues>();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;
  const staffName = (id: string) => staff?.find((member) => member.id === id)?.fullName ?? id;

  const handleSubmit = async (values: DoctorScheduleFormValues) => {
    const dto: CreateDoctorScheduleDto = {
      clinicId: values.clinicId,
      staffId: values.staffId,
      dayOfWeek: values.dayOfWeek,
      startTime: values.timeRange[0].format('HH:mm'),
      endTime: values.timeRange[1].format('HH:mm'),
      effectiveFrom: values.effectiveFrom.format('YYYY-MM-DD'),
      effectiveTo: values.effectiveTo?.format('YYYY-MM-DD'),
    };
    try {
      await createSchedule.mutateAsync(dto);
      message.success('Doctor schedule created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create doctor schedule');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Doctor Schedules
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Schedule
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={schedules}
        columns={[
          { title: 'Doctor', render: (_, record) => staffName(record.staffId) },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          { title: 'Day', dataIndex: 'dayOfWeek', render: (value: number) => DAY_OPTIONS[value]?.label },
          {
            title: 'Hours',
            render: (_, record) => `${dayjs(record.startTime).format('HH:mm')}–${dayjs(record.endTime).format('HH:mm')}`,
          },
          { title: 'Effective From', dataIndex: 'effectiveFrom', render: (value: string) => dayjs(value).format('YYYY-MM-DD') },
          {
            title: 'Effective To',
            dataIndex: 'effectiveTo',
            render: (value: string | null) => (value ? dayjs(value).format('YYYY-MM-DD') : 'Ongoing'),
          },
        ]}
      />
      <Drawer title="Add Doctor Schedule" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
            <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
          </Form.Item>
          <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
            <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
          </Form.Item>
          <Form.Item name="dayOfWeek" label="Day of Week" rules={[{ required: true }]}>
            <Select options={DAY_OPTIONS} />
          </Form.Item>
          <Form.Item name="timeRange" label="Hours" rules={[{ required: true }]}>
            <TimePicker.RangePicker format="HH:mm" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="effectiveFrom" label="Effective From" rules={[{ required: true }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="effectiveTo" label="Effective To (leave blank for ongoing)">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createSchedule.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
