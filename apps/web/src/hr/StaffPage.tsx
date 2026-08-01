import { useState } from 'react';
import { Button, Checkbox, Drawer, Form, Input, message, Select, Space, Switch, Table, Typography } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Role } from '@kuwick/shared';
import { useStaff, useCreateStaff, useUpdateStaff } from './hooks/useStaff';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { CreateStaffDto, Staff, UpdateStaffDto } from './types';
import { ApiError } from '../core/api-client';

const { Title } = Typography;

const ROLE_OPTIONS = Object.values(Role).map((role) => ({ value: role, label: role }));

interface StaffFormValues extends CreateStaffDto {
  setupLogin?: boolean;
}

export function StaffPage() {
  const { data: staff, isLoading } = useStaff();
  const { data: clinics } = useClinics();
  const defaultClinicId = useDefaultClinicId();
  const createStaff = useCreateStaff();
  const updateStaff = useUpdateStaff();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Staff | null>(null);
  const [form] = Form.useForm<StaffFormValues>();
  const [editForm] = Form.useForm<UpdateStaffDto>();
  const setupLogin = Form.useWatch('setupLogin', form);

  // D-045 — only worth showing when there's actually more than one branch
  // to pick between; a single-clinic tenant has nothing to choose.
  const showClinicField = (clinics?.length ?? 0) > 1;

  const clinicName = (id: string | null) => {
    if (!id) return 'All clinics';
    return clinics?.find((clinic) => clinic.id === id)?.name ?? id;
  };

  const handleSubmit = async ({ setupLogin: _setupLogin, ...values }: StaffFormValues) => {
    try {
      await createStaff.mutateAsync(values);
      message.success('Staff member created');
      form.resetFields();
      setOpen(false);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to create staff member');
    }
  };

  const handleEditSubmit = async (values: UpdateStaffDto) => {
    if (!editing) return;
    try {
      await updateStaff.mutateAsync({ id: editing.id, dto: values });
      message.success('Staff member updated');
      setEditing(null);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Failed to update staff member');
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
          ...(showClinicField
            ? [{ title: 'Home Clinic', dataIndex: 'clinicId', render: (value: string | null) => clinicName(value) }]
            : []),
          { title: 'Active', dataIndex: 'active', render: (value: boolean) => (value ? 'Yes' : 'No') },
          {
            title: 'Actions',
            render: (_: unknown, record: Staff) => (
              <Button
                size="small"
                icon={<EditOutlined />}
                onClick={() => {
                  setEditing(record);
                  editForm.setFieldsValue({
                    role: record.role,
                    staffNumber: record.staffNumber ?? undefined,
                    clinicId: record.clinicId ?? undefined,
                    active: record.active,
                  });
                }}
              />
            ),
          },
        ]}
      />
      <Drawer title="Add Staff" open={open} onClose={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={handleSubmit} initialValues={{ clinicId: defaultClinicId }}>
          <Form.Item name="fullName" label="Full Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {showClinicField && (
            <Form.Item
              name="clinicId"
              label="Home Clinic"
              tooltip="Leave blank for staff who work across every clinic (owner, finance, HR-type roles) — they'll keep a clinic picker everywhere. Set it for staff tied to one branch, and every clinic-scoped screen skips asking."
            >
              <Select
                allowClear
                placeholder="Works across every clinic"
                options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="staffNumber" label="Staff Number">
            <Input />
          </Form.Item>
          <Form.Item name="setupLogin" valuePropName="checked" style={{ marginBottom: setupLogin ? 12 : 24 }}>
            <Checkbox>Set up login for this staff member</Checkbox>
          </Form.Item>
          {setupLogin && (
            <>
              <Form.Item
                name="loginEmail"
                label="Login Email"
                rules={[{ required: setupLogin, type: 'email', message: 'Enter a valid email' }]}
              >
                <Input placeholder="staff@clinic.com" />
              </Form.Item>
              <Form.Item
                name="loginPassword"
                label="Temporary Password"
                rules={[{ required: setupLogin, min: 8, message: 'At least 8 characters' }]}
              >
                <Input.Password />
              </Form.Item>
            </>
          )}
          <Button type="primary" htmlType="submit" loading={createStaff.isPending} block>
            Create
          </Button>
        </Form>
      </Drawer>
      <Drawer title={editing ? `Edit ${editing.fullName}` : 'Edit Staff'} open={Boolean(editing)} onClose={() => setEditing(null)} destroyOnHidden>
        <Form form={editForm} layout="vertical" onFinish={handleEditSubmit}>
          <Form.Item name="role" label="Role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {showClinicField && (
            <Form.Item
              name="clinicId"
              label="Home Clinic"
              tooltip="Leave blank for staff who work across every clinic (owner, finance, HR-type roles)."
            >
              <Select
                allowClear
                placeholder="Works across every clinic"
                options={clinics?.map((clinic) => ({ value: clinic.id, label: clinic.name }))}
              />
            </Form.Item>
          )}
          <Form.Item name="staffNumber" label="Staff Number">
            <Input />
          </Form.Item>
          <Form.Item name="active" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={updateStaff.isPending} block>
            Save
          </Button>
        </Form>
      </Drawer>
    </>
  );
}
