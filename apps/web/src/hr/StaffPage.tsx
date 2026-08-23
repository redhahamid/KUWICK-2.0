import { useState } from 'react';
import { Alert, Button, Checkbox, Divider, Drawer, Form, Input, message, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import { Role } from '@kuwick/shared';
import { useStaff, useCreateStaff, useUpdateStaff } from './hooks/useStaff';
import { useClinics } from '../core/hooks/useClinics';
import { useDefaultClinicId } from '../core/hooks/useClinicFilter';
import { CreateStaffDto, Staff, UpdateStaffDto } from './types';
import { ApiError } from '../core/api-client';
import { PageHeader } from '../design-system/components/PageHeader';
import { useCan } from '../core/hooks/useCan';
import { StaffAccessDrawer } from './StaffAccessDrawer';
import { ProviderColorPicker } from './ProviderColorPicker';

const ROLE_OPTIONS = Object.values(Role).map((role) => ({ value: role, label: role }));

/** The roles that get a column on the diary, and therefore a colour. */
const PROVIDER_ROLES: Role[] = [Role.DOCTOR_RESIDENT, Role.DOCTOR_LOCUM];

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
  // Final-UAT — the Access drawer (capability roles, custom roles, grants).
  const [accessFor, setAccessFor] = useState<Staff | null>(null);
  const canManageUsers = useCan('users.manage');
  const [form] = Form.useForm<StaffFormValues>();
  const [editForm] = Form.useForm<UpdateStaffDto>();
  const setupLogin = Form.useWatch('setupLogin', form);
  // The colour picker only appears for people who appear on the diary.
  const newRole = Form.useWatch('role', form);
  const editRole = Form.useWatch('role', editForm);

  /** Which curated colours this clinic's other providers already hold. */
  const colorsTaken = (exceptStaffId?: string): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const member of staff ?? []) {
      if (!member.calendarColor || member.id === exceptStaffId) continue;
      if (!PROVIDER_ROLES.includes(member.role)) continue;
      map[member.calendarColor.toUpperCase()] = member.fullName;
    }
    return map;
  };

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
      <PageHeader
        title="Staff"
        extra={
          <>
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOpen(true)}>
          Add Staff
        </Button>
          </>
        }
      />
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
            // C0 (D-051) — three DISTINCT states, deliberately not collapsed
            // into one "verified doctor" badge: a completed professional
            // profile, a clinic-recorded verification, and clinical-note
            // signing being enabled.
            title: 'Clinical Signing',
            render: (_: unknown, record: Staff) => {
              if (record.professionalType !== 'MEDICAL_DOCTOR') {
                return <Tag>Non-clinical</Tag>;
              }
              return (
                <Space direction="vertical" size={0}>
                  <Tag color={record.medicalRegistrationNo ? 'blue' : 'default'}>
                    {record.medicalRegistrationNo ? `Profile: ${record.medicalRegistrationNo}` : 'Profile incomplete'}
                  </Tag>
                  <Tag color={record.professionalVerifiedAt ? 'cyan' : 'default'}>
                    {record.professionalVerifiedAt ? 'Verification recorded' : 'Not verified'}
                  </Tag>
                  <Tag color={record.clinicalSigningEnabledAt ? 'green' : 'default'}>
                    {record.clinicalSigningEnabledAt ? 'Signing enabled' : 'Signing off'}
                  </Tag>
                </Space>
              );
            },
          },
          {
            title: 'Actions',
            render: (_: unknown, record: Staff) => (
              <Space>
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
                      professionalType: record.professionalType,
                      medicalRegistrationNo: record.medicalRegistrationNo ?? undefined,
                      professionalActive: record.professionalActive,
                      canSignClinicalNotes: record.canSignClinicalNotes,
                      calendarColor: record.calendarColor ?? undefined,
                    });
                  }}
                />
                {canManageUsers ? (
                  <Button size="small" onClick={() => setAccessFor(record)} data-testid="open-access">
                    Access
                  </Button>
                ) : null}
              </Space>
            ),
          },
        ]}
      />
      <StaffAccessDrawer
        staffId={accessFor?.id ?? null}
        staffName={accessFor?.fullName}
        onClose={() => setAccessFor(null)}
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
          {newRole && PROVIDER_ROLES.includes(newRole) ? (
            <Form.Item
              name="calendarColor"
              label="Calendar colour"
              tooltip="How this provider is identified on the diary — the edge on their appointment cards, their avatar and their column header. Leave it and Kuwick assigns the clinic's next unused colour."
            >
              <ProviderColorPicker taken={colorsTaken()} />
            </Form.Item>
          ) : null}
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
          {editRole && PROVIDER_ROLES.includes(editRole) ? (
            <Form.Item
              name="calendarColor"
              label="Calendar colour"
              tooltip="How this provider is identified on the diary — the edge on their appointment cards, their avatar and their column header."
            >
              <ProviderColorPicker taken={colorsTaken(editing?.id)} />
            </Form.Item>
          ) : null}

          {/* C0 (D-051) — professional identity, separate from Role above.
              Clinical-note signing is derived from ALL of these, never from
              the administrative role. */}
          <Divider plain style={{ marginTop: 8 }}>
            Clinical Practitioner Profile
          </Divider>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Recorded by your Clinic Group"
            description="Kuwick does not verify registration with the MMC — these fields record your own clinic's verification. Signing is only possible when the profile is complete, verification is recorded, and signing is enabled."
          />
          <Form.Item name="professionalType" label="Professional Type">
            <Select
              options={[
                { value: 'NON_CLINICAL', label: 'Non-clinical' },
                { value: 'MEDICAL_DOCTOR', label: 'Medical Doctor' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="medicalRegistrationNo"
            label="Medical Registration No."
            tooltip="e.g. MMC number. Required before clinical-note signing can be enabled."
          >
            <Input placeholder="e.g. MMC123456" />
          </Form.Item>
          <Form.Item
            name="professionalActive"
            label="Professional verification recorded"
            valuePropName="checked"
            tooltip="Records that your Clinic Group has sighted and verified this practitioner's credentials. The timestamp and who recorded it are stored automatically."
          >
            <Switch />
          </Form.Item>
          <Form.Item
            name="canSignClinicalNotes"
            label="Clinical-note signing enabled"
            valuePropName="checked"
            tooltip="Allows this practitioner to electronically sign clinical notes. Recorded with a timestamp and the enabling staff member."
          >
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
