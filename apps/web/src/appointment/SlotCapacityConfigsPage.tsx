import { useState } from 'react';
import { Button, Drawer, Form, InputNumber, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useSlotCapacityConfigs, useCreateSlotCapacityConfig } from './hooks/useSlotCapacityConfigs';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { useStaff } from '../hr/hooks/useStaff';
import { useServices } from '../clinical/hooks/useServices';
import { CreateSlotCapacityConfigDto } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

export function SlotCapacityConfigsPage() {
  const { data: configs, isLoading } = useSlotCapacityConfigs();
  const { data: clinics } = useClinics();
  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const defaultClinicId = useDefaultClinicId();
  const createConfig = useCreateSlotCapacityConfig();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateSlotCapacityConfigDto>();

  const clinicName = (id: string) => clinics?.find((clinic) => clinic.id === id)?.name ?? id;
  const staffName = (id: string) => staff?.find((member) => member.id === id)?.fullName ?? id;
  const serviceName = (id: string) => services?.find((service) => service.id === id)?.name ?? id;

  const handleSubmit = async (values: CreateSlotCapacityConfigDto) => {
    try {
      await createConfig.mutateAsync(values);
      message.success('Slot capacity config created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create slot capacity config');
    }
  };

  return (
    <>
      <PageHeader
        title="Slot Capacity Configs"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Config
        </Button>
          </>
        }
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={configs}
        columns={[
          { title: 'Doctor', render: (_, record) => staffName(record.staffId) },
          { title: 'Clinic', render: (_, record) => clinicName(record.clinicId) },
          { title: 'Service', render: (_, record) => serviceName(record.serviceId) },
          { title: 'Slot Length (min)', dataIndex: 'slotLengthMinutes' },
          {
            title: 'Daily Capacity',
            dataIndex: 'dailyCapacity',
            render: (value: number | null) => value ?? 'Uncapped',
          },
        ]}
      />
      <Drawer title="Add Slot Capacity Config" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ clinicId: defaultClinicId }}>
          <Form.Item name="clinicId" label="Clinic" rules={[{ required: true }]}>
            <Select options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))} />
          </Form.Item>
          <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
            <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
          </Form.Item>
          <Form.Item name="serviceId" label="Service" rules={[{ required: true }]}>
            <Select options={services?.map((service) => ({ value: service.id, label: service.name }))} />
          </Form.Item>
          <Form.Item name="slotLengthMinutes" label="Slot Length (minutes)" rules={[{ required: true }]}>
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="dailyCapacity" label="Daily Capacity (leave blank for uncapped)">
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createConfig.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
