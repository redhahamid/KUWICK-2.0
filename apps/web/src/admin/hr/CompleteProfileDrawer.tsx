import { App, Button, DatePicker, Drawer, Form, Input, Select } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { ApiError, apiClient } from '../../core/api-client';
import { parseNric } from '../../core/nric';

const EMPLOYMENT_TYPES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'PART_TIME', label: 'Part time' },
  { value: 'LOCUM', label: 'Locum' },
  { value: 'INTERN', label: 'Intern' },
];

/**
 * FINISH A STAFF RECORD THAT NEVER GOT AN EMPLOYMENT PROFILE.
 *
 * These people exist in every clinic that has been running a while: an account
 * was created so somebody could sign in, and the paperwork never followed.
 * They can be rostered and they can clock in, and payroll leaves them out —
 * not with a refusal, simply absent, which is much harder to notice than an
 * error.
 *
 * Deliberately the SAME endpoint as every other profile edit, so one path
 * writes employment facts and one audit diff records them. What this adds is
 * a door: an owner should not have to know that a staff row and an employment
 * profile are different tables in order to fix this.
 */
export function CompleteProfileDrawer({
  staffId,
  fullName,
  onClose,
}: {
  staffId: string | null;
  fullName: string;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const save = async () => {
    const values = await form.validateFields();
    try {
      await apiClient.post(`/workforce/employees/${staffId}`, {
        employeeNo: values.employeeNo || undefined,
        position: values.position || undefined,
        department: values.department || undefined,
        employmentType: values.employmentType || undefined,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
        identifierType: values.identifierValue ? (values.identifierType ?? 'NRIC') : undefined,
        identifierValue: values.identifierValue || undefined,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : undefined,
        phone: values.phone || undefined,
      });
      message.success(`${fullName}'s employment profile created.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-hr'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      form.resetFields();
      onClose();
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not save that.');
    }
  };

  return (
    <Drawer
      open={Boolean(staffId)}
      onClose={onClose}
      title={`Complete ${fullName}'s employment profile`}
      width={Math.min(560, typeof window !== 'undefined' ? window.innerWidth : 560)}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" onClick={save}>
            Save profile
          </Button>
        </div>
      }
    >
      <p className="kw-adminSection__desc">
        This person already has a staff record and can be rostered. An employment profile is what lets
        payroll include them.
      </p>
      <Form form={form} layout="vertical" initialValues={{ employmentType: 'PERMANENT', startDate: dayjs() }}>
        <Form.Item name="position" label="Position">
          <Input size="large" placeholder="Staff Nurse" />
        </Form.Item>
        <Form.Item name="employeeNo" label="Employee number">
          <Input size="large" placeholder="E-1024" />
        </Form.Item>
        <Form.Item name="department" label="Department or team">
          <Input size="large" placeholder="Clinical" />
        </Form.Item>
        <Form.Item name="employmentType" label="Employment type">
          <Select options={EMPLOYMENT_TYPES} size="large" />
        </Form.Item>
        <Form.Item name="startDate" label="Started on">
          <DatePicker style={{ width: '100%' }} size="large" format="D MMM YYYY" />
        </Form.Item>
        <Form.Item name="identifierType" label="Document" initialValue="NRIC">
          <Select
            size="large"
            options={[
              { value: 'NRIC', label: 'Malaysian IC' },
              { value: 'PASSPORT', label: 'Passport' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name="identifierValue"
          label="IC or passport number"
          dependencies={['identifierType']}
          rules={[
            ({ getFieldValue }) => ({
              validator: (_rule, value: string | undefined) =>
                !value || getFieldValue('identifierType') === 'PASSPORT' || parseNric(value)
                  ? Promise.resolve()
                  : Promise.reject(new Error('A Malaysian IC is 12 digits, YYMMDD-PB-####, e.g. 900101-14-5567.')),
            }),
          ]}
        >
          <Input size="large" placeholder="e.g. 900101-14-5567" />
        </Form.Item>
        <Form.Item name="dateOfBirth" label="Date of birth">
          <DatePicker style={{ width: '100%' }} size="large" format="D MMM YYYY" />
        </Form.Item>
        <Form.Item name="phone" label="Phone">
          <Input size="large" />
        </Form.Item>
      </Form>
      <p className="kw-adminSection__desc">
        Salary and the statutory profile are recorded separately, <em>with the date they take effect from</em>.
        They are on this person's own page once the profile exists.
      </p>
    </Drawer>
  );
}
