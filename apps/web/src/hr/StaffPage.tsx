import { useState } from 'react';
import { Button, Drawer, Form, Input, message, Select, Space, Table, Typography } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { Role } from '@kuwick/shared';
import { useStaff, useCreateStaff } from './hooks/useStaff';
import { CreateStaffDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

const ROLE_OPTIONS = Object.values(Role).map((role) => ({ value: role, label: role }));

export function StaffPage() {
  const { data: staff, isLoading } = useStaff();
  const createStaff = useCreateStaff();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<CreateStaffDto>();

  const handleSubmit = async (values: CreateStaffDto) => {
    try {
      await createStaff.mutateAsync(values);
      message.success('Staff member created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create staff member');
    }
  };

  return (
    <>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Title level={4} style={{ margin: 0 }}>
          Staff
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Staff
        </Button>
      </Space>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={staff}
        columns={[
          { title: 'Name', dataIndex: 'fullName' },
          { title: 'Role', dataIndex: 'role' },
          { title: 'Staff Number', dataIndex: 'staffNumber', render: (value: string | null) => value ?? '—' },
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
        ]}
      />
      <Drawer title="Add Staff" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item name="staffNumber" label="Staff Number">
            <Input />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={createStaff.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
