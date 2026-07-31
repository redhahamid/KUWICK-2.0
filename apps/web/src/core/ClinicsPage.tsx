import { useState } from 'react';
import { Button, Drawer, Form, Input, message, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useClinics, useCreateClinic, useUpdateClinic } from './hooks/useClinics';
import { Clinic, CreateClinicDto } from './types';
import { ApiError } from './api-client';

const { Title } = Typography;

export function ClinicsPage() {
  const { data: clinics, isLoading } = useClinics();
  const createClinic = useCreateClinic();
  const updateClinic = useUpdateClinic();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Clinic | null>(null);
  const [form] = Form.useForm<CreateClinicDto>();

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setOpen(true);
  };

  const openEdit = (clinic: Clinic) => {
    setEditing(clinic);
    form.setFieldsValue({
      name: clinic.name,
      address: clinic.address ?? undefined,
      timezone: clinic.timezone,
      phone: clinic.phone ?? undefined,
      email: clinic.email ?? undefined,
    });
    setOpen(true);
  };

  const handleSubmit = async (values: CreateClinicDto) => {
    try {
      if (editing) {
        await updateClinic.mutateAsync({ id: editing.id, dto: values });
        message.success('Clinic updated');
      } else {
        await createClinic.mutateAsync(values);
        message.success('Clinic created');
      }
      form.resetFields();
      setOpen(false);
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to save clinic');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Clinics
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          Add Clinic
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={clinics}
        columns={[
          { title: 'Name', dataIndex: 'name' },
          { title: 'Address', dataIndex: 'address', render: (value: string | null) => value ?? '—' },
          { title: 'Phone', dataIndex: 'phone', render: (value: string | null) => value ?? '—' },
          { title: 'Email', dataIndex: 'email', render: (value: string | null) => value ?? '—' },
          { title: 'Timezone', dataIndex: 'timezone' },
          {
            title: 'Actions',
            render: (_: unknown, r: Clinic) => (
              <Button size="small" onClick={() => openEdit(r)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      <Drawer
        title={editing ? `Edit Clinic — ${editing.name}` : 'Add Clinic'}
        open={open}
        onClose={() => setOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="address" label="Address">
            <Input />
          </Form.Item>
          <Form.Item name="phone" label="Phone" tooltip="Printed on document letterheads (MC/Referral/Memo).">
            <Input placeholder="e.g. 03-1234 5678" />
          </Form.Item>
          <Form.Item name="email" label="Email">
            <Input placeholder="e.g. clinic@example.com" />
          </Form.Item>
          <Form.Item name="timezone" label="Timezone" tooltip="Defaults to Asia/Kuala_Lumpur">
            <Input placeholder="Asia/Kuala_Lumpur" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createClinic.isPending || updateClinic.isPending} block>
            {editing ? 'Save Changes' : 'Create'}
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
