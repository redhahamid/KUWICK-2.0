import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { PageHeader } from '../design-system/components/PageHeader';
import { permissionHint, useCan } from '../core/hooks/useCan';
import { ApiError, apiClient } from '../core/api-client';

const { Text, Paragraph } = Typography;

interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  _count?: { assignments: number };
}

/** Groupings and words for the servable catalogue — presentation only. */
const PERMISSION_GROUPS: { title: string; keys: string[] }[] = [
  {
    title: 'Appointments',
    keys: [
      'appointment.view',
      'appointment.create',
      'appointment.edit',
      'appointment.reschedule',
      'appointment.cancel',
      'appointment.check_in',
      'appointment.no_show',
      'appointment.override',
      'appointment.configure',
      'appointment.manage_roster',
    ],
  },
  {
    title: 'Front counter & patients',
    keys: [
      'patient.demographics.write',
      'patient.identity.write',
      'patient.lhdn.write',
      'patient.alert.write',
      'queue.manage',
      'queue.consultationFlow',
      'document.print',
      'document.issueAdministrative',
    ],
  },
  {
    title: 'Billing & inventory',
    keys: ['billing.counter', 'billing.corrections', 'dispense.perform'],
  },
  /*
   * HR — ABSENT UNTIL UAT ASKED FOR IT.
   *
   * There was no HR group here at all, and none of these permissions was in
   * the servable catalogue either, so a clinic composing its own "Clinic
   * manager" could not give it the one job such a person does every week.
   * Pay is deliberately not here: salary, payroll and the statutory tables
   * are the owner's, and a role that could see or move everybody's pay is one
   * an owner should compose deliberately rather than reach for by habit.
   */
  {
    title: 'HR & people',
    keys: ['hr.view', 'hr.employee.manage', 'hr.attendance.manage', 'hr.leave.approve', 'hr.claim.approve'],
  },
];

const PERMISSION_WORDS: Record<string, string> = {
  'hr.view': 'Open the HR module',
  'hr.employee.manage': 'Keep employee records',
  'hr.attendance.manage': 'Correct attendance and approve overtime',
  'hr.leave.approve': 'Approve leave',
  'hr.claim.approve': 'Decide staff expense claims',
  'appointment.view': 'See the diary',
  'appointment.create': 'Book appointments',
  'appointment.edit': 'Change appointments',
  'appointment.reschedule': 'Move appointments',
  'appointment.cancel': 'Cancel appointments',
  'appointment.check_in': 'Register / check in',
  'appointment.no_show': 'Mark no-shows',
  'appointment.override': 'Book against scheduling rules',
  'appointment.configure': 'Configure services & booking page',
  'appointment.manage_roster': 'Write the roster',
  'patient.demographics.write': 'Edit patient details',
  'patient.identity.write': 'Correct IC / date of birth',
  'patient.lhdn.write': 'Edit e-Invoice buyer details',
  'patient.alert.write': 'Manage non-medical alerts',
  'queue.manage': 'Run the queue',
  'queue.consultationFlow': 'Move patients through consultation',
  'document.print': 'Print documents',
  'document.issueAdministrative': 'Issue administrative documents',
  'billing.counter': 'Take counter payments',
  'billing.corrections': 'Discounts & invoice corrections',
  'dispense.perform': 'Dispense medication',
};

/**
 * FINAL-UAT — CLINIC SETTINGS → ORGANISATION → ROLES & PERMISSIONS.
 *
 * Tenant-defined roles: named permission bundles ("Branch Manager",
 * "Inventory") assigned to people from the Staff page's Access drawer. The
 * permission list here is the SERVER's closed catalogue — nothing clinical,
 * nothing owner-tier, and the page says why.
 */
export function RolesSettingsPage() {
  const canManage = useCan('users.manage');
  const queryClient = useQueryClient();
  const { data: roles, isLoading } = useQuery({
    queryKey: ['custom-roles'],
    queryFn: () => apiClient.get<CustomRoleRow[]>('/staff-access/custom-roles'),
  });
  const { data: catalogue } = useQuery({
    queryKey: ['custom-role-catalogue'],
    queryFn: () => apiClient.get<{ permissions: string[] }>('/staff-access/custom-roles/catalogue'),
  });

  const [editing, setEditing] = useState<CustomRoleRow | 'new' | null>(null);
  const [form] = Form.useForm<{ name: string; description?: string; permissions: string[] }>();

  const save = useMutation({
    mutationFn: (values: { name: string; description?: string; permissions: string[] }) =>
      editing && editing !== 'new'
        ? apiClient.patch(`/staff-access/custom-roles/${editing.id}`, values)
        : apiClient.post('/staff-access/custom-roles', values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      setEditing(null);
      message.success('Role saved.');
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not save the role.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiClient.delete(`/staff-access/custom-roles/${id}`),
    onSuccess: (result: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['custom-roles'] });
      const count = (result as { unassignedFrom?: number })?.unassignedFrom ?? 0;
      message.success(
        count > 0 ? `Role deleted and removed from ${count} staff member${count === 1 ? '' : 's'}.` : 'Role deleted.',
      );
    },
    onError: (error) =>
      message.error(error instanceof ApiError ? error.message : 'Could not delete the role.'),
  });

  const openEditor = (role: CustomRoleRow | 'new') => {
    setEditing(role);
    form.setFieldsValue(
      role === 'new'
        ? { name: '', description: '', permissions: [] }
        : { name: role.name, description: role.description ?? '', permissions: role.permissions },
    );
  };

  const allowed = new Set(catalogue?.permissions ?? []);

  return (
    <div className="kw-settings-page" data-testid="roles-settings">
      <PageHeader
        title="Roles & permissions"
        subtitle="Named permission bundles you assign to staff — Branch Manager, Inventory, whatever this clinic calls the job."
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            title={canManage ? undefined : permissionHint('manage users and roles')}
            onClick={() => openEditor('new')}
          >
            New role
          </Button>
        }
      />

      <Alert
        type="info"
        showIcon
        className="kw-settings-alert"
        message="Custom roles are administrative"
        description="Clinical authority (writing notes, prescribing, signing) comes only from the built-in Doctor and Clinical staff roles with their credential checks, and owner powers stay with Owner. A custom role can carry everything else."
      />

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={roles}
        pagination={false}
        columns={[
          { title: 'Role', dataIndex: 'name', render: (value: string) => <Text strong>{value}</Text> },
          {
            title: 'Description',
            dataIndex: 'description',
            render: (value: string | null) => value ?? <Text type="secondary">—</Text>,
          },
          {
            title: 'Permissions',
            render: (_: unknown, row: CustomRoleRow) => (
              <Text type="secondary">{row.permissions.length}</Text>
            ),
          },
          {
            title: 'Held by',
            render: (_: unknown, row: CustomRoleRow) => (
              <Text type="secondary">{row._count?.assignments ?? 0}</Text>
            ),
          },
          {
            title: '',
            render: (_: unknown, row: CustomRoleRow) => (
              <Space>
                <Button size="small" disabled={!canManage} onClick={() => openEditor(row)}>
                  Edit
                </Button>
                <Popconfirm
                  title={`Delete "${row.name}"?`}
                  description={
                    row._count?.assignments
                      ? `It is removed from ${row._count.assignments} staff member${row._count.assignments === 1 ? '' : 's'} at the same time.`
                      : 'Nobody holds it.'
                  }
                  okText="Delete"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => remove.mutate(row.id)}
                  disabled={!canManage}
                >
                  <Button size="small" danger disabled={!canManage}>
                    Delete
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]}
        locale={{
          emptyText: 'No custom roles yet — the built-in Owner / Administrator / Clinical staff / Doctor roles cover most clinics.',
        }}
      />

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        width={520}
        title={editing === 'new' ? 'New role' : 'Edit role'}
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={(values) => save.mutate(values)}
          data-testid="custom-role-form"
        >
          <Form.Item name="name" label="Role name" rules={[{ required: true, min: 2, max: 60 }]}>
            <Input placeholder="e.g. Branch Manager" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input.TextArea rows={2} maxLength={300} placeholder="What this job is, in this clinic's words" />
          </Form.Item>
          <Form.Item
            name="permissions"
            label="What this role may do"
            valuePropName="value"
            trigger="onChange"
          >
            <Checkbox.Group style={{ width: '100%' }}>
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                {PERMISSION_GROUPS.map((group) => {
                  const keys = group.keys.filter((key) => allowed.size === 0 || allowed.has(key));
                  if (keys.length === 0) return null;
                  return (
                    <div key={group.title}>
                      <Text strong style={{ display: 'block', marginBottom: 4 }}>
                        {group.title}
                      </Text>
                      <Space direction="vertical" size={2}>
                        {keys.map((key) => (
                          <Checkbox key={key} value={key}>
                            {PERMISSION_WORDS[key] ?? key}{' '}
                            <Tag style={{ fontFamily: 'monospace', fontSize: 10 }}>{key}</Tag>
                          </Checkbox>
                        ))}
                      </Space>
                    </div>
                  );
                })}
              </Space>
            </Checkbox.Group>
          </Form.Item>
          <Paragraph type="secondary" style={{ fontSize: 12 }}>
            Assign the role from Management → HR → Staff → Access.
          </Paragraph>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={!canManage}>
            Save role
          </Button>
        </Form>
      </Drawer>
    </div>
  );
}
