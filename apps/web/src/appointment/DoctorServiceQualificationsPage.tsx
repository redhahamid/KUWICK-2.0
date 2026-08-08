import { useState } from 'react';
import { Button, Drawer, Form, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useDoctorServiceQualifications, useCreateDoctorServiceQualification } from './hooks/useDoctorServiceQualifications';
import { useStaff } from '../hr/hooks/useStaff';
import { useServices } from '../clinical/hooks/useServices';
import { CreateDoctorServiceQualificationDto } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';

export function DoctorServiceQualificationsPage() {
  const { data: qualifications, isLoading } = useDoctorServiceQualifications();
  const { data: staff } = useStaff();
  const { data: services } = useServices();
  const createQualification = useCreateDoctorServiceQualification();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateDoctorServiceQualificationDto>();

  const staffName = (id: string) => staff?.find((member) => member.id === id)?.fullName ?? id;
  const serviceName = (id: string) => services?.find((service) => service.id === id)?.name ?? id;

  const handleSubmit = async (values: CreateDoctorServiceQualificationDto) => {
    try {
      await createQualification.mutateAsync(values);
      message.success('Qualification created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create qualification');
    }
  };

  return (
    <>
      <PageHeader
        title="Doctor-Service Mapping"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Qualification
        </Button>
          </>
        }
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={qualifications}
        columns={[
          { title: 'Doctor', render: (_, record) => staffName(record.staffId) },
          { title: 'Service', render: (_, record) => serviceName(record.serviceId) },
        ]}
      />
      <Drawer title="Add Qualification" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="staffId" label="Doctor" rules={[{ required: true }]}>
            <Select options={staff?.map((member) => ({ value: member.id, label: member.fullName }))} />
          </Form.Item>
          <Form.Item name="serviceId" label="Service" rules={[{ required: true }]}>
            <Select options={services?.map((service) => ({ value: service.id, label: service.name }))} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createQualification.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
