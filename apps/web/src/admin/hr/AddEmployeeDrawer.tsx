import { useState } from 'react';
import { App, Button, DatePicker, Divider, Drawer, Form, Input, Select, Steps, Switch } from 'antd';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError, apiClient } from '../../core/api-client';
import { useClinics } from '../../core/hooks/useClinics';

/**
 * ADD EMPLOYEE — the door that did not exist.
 *
 * Hiring somebody used to mean creating a staff member on one screen, finding
 * them again on another, and completing an employment profile there. People
 * stopped half way, which left a staff row that looked like an employee and
 * could not be paid — not refused by payroll, simply absent from it, which is
 * far harder to notice.
 *
 * FOUR STEPS, and only the first is required. The rest can be finished later
 * from the employee's own page, and the last step says so plainly rather than
 * pretending a half-filled form is a problem. What it will NOT do is create
 * something incomplete without saying which parts are missing.
 *
 * SALARY IS HERE NOW, AND WITH ITS DATE. It used to be left out on the
 * grounds that it is effective-dated and this form had no date to give it —
 * true, and the honest answer was to ASK for the date rather than to omit the
 * salary. Leaving it out meant almost every new hire was created unpayable,
 * and "no salary in force" is the single most common payroll blocker.
 *
 * It is recorded through the SAME endpoint the employee's own salary panel
 * uses, as a second call after the employee exists — not folded into the
 * create — so there is exactly one path that writes an effective-dated salary
 * and one audit trail behind it.
 *
 * The STATUTORY classification stays out for the reason salary no longer does:
 * it is not one field with one date but a set of dated positions (EPF, SOCSO,
 * EIS, PCB category, LINDUNG), and asking for them at hiring would be asking
 * somebody to guess. The review step names them and links to where they go.
 */

const ROLES = [
  { value: 'DOCTOR_RESIDENT', label: 'Doctor (resident)' },
  { value: 'DOCTOR_LOCUM', label: 'Doctor (locum)' },
  { value: 'FRONT_DESK_CLINICAL_STAFF', label: 'Front desk / clinical staff' },
  { value: 'FINANCE_STAFF', label: 'Finance' },
  { value: 'HR_STAFF', label: 'HR' },
  { value: 'STOCK_STAFF', label: 'Stock / pharmacy' },
  { value: 'PANEL_STAFF', label: 'Panel' },
  { value: 'OWNER_ADMIN', label: 'Owner / administrator' },
];

const EMPLOYMENT_TYPES = [
  { value: 'PERMANENT', label: 'Permanent' },
  { value: 'CONTRACT', label: 'Contract' },
  { value: 'PART_TIME', label: 'Part time' },
  { value: 'LOCUM', label: 'Locum' },
  { value: 'INTERN', label: 'Intern' },
];

const STEPS = ['Person', 'Employment', 'Pay & bank', 'Access', 'Review'];

export function AddEmployeeDrawer({
  open,
  onClose,
  /** Pre-fills the branch when the directory is filtered to one. */
  clinicId,
  /** So the directory can say what is still needed before payroll. */
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  clinicId?: string;
  onAdded?: (name: string) => void;
}) {
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const { data: clinics } = useClinics();
  const queryClient = useQueryClient();
  const role = Form.useWatch('role', form);
  const wantsLogin = Form.useWatch('wantsLogin', form);
  const isDoctorRole = role === 'DOCTOR_RESIDENT' || role === 'DOCTOR_LOCUM';

  const next = async () => {
    // Validated step by step, so somebody is told about a missing name on the
    // step that has the name box rather than four steps later.
    if (step === 0) await form.validateFields(['fullName', 'role']);
    if (step === 3 && wantsLogin) await form.validateFields(['loginEmail', 'loginPassword']);
    setStep((current) => current + 1);
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const created = await apiClient.post('/workforce/employees', {
        fullName: values.fullName,
        role: values.role,
        clinicId: values.clinicId ?? clinicId,
        employeeNo: values.employeeNo || undefined,
        position: values.position || undefined,
        department: values.department || undefined,
        employmentType: values.employmentType || undefined,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
        identifierType: values.identifierValue ? 'NRIC' : undefined,
        identifierValue: values.identifierValue || undefined,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        medicalRegistrationNo: values.medicalRegistrationNo || undefined,
        loginEmail: values.wantsLogin ? values.loginEmail : undefined,
        loginPassword: values.wantsLogin ? values.loginPassword : undefined,
        // The bank account the create already accepted and nothing ever sent.
        bankName: values.bankName || undefined,
        bankAccountNo: values.bankAccountNo || undefined,
      });

      /*
       * THE SALARY, THROUGH ITS OWN DATED PATH.
       *
       * A second call rather than a field on the create, so an effective-dated
       * salary has exactly one way in and one audit trail. If this half fails
       * the person still exists — which is the right failure: an employee with
       * no salary is a known, visible state the directory reports, whereas a
       * half-written create would be neither.
       */
      if (created && values.salaryAmount) {
        const staffId = (created as { staffId?: string; id?: string }).staffId ?? (created as { id?: string }).id;
        if (staffId) {
          await apiClient
            .post(`/workforce/employees/${staffId}/salary`, {
              amount: String(values.salaryAmount),
              basis: values.salaryBasis ?? 'MONTHLY',
              effectiveFrom: (values.salaryEffectiveFrom ?? values.startDate)?.format('YYYY-MM-DD'),
              reason: 'Recorded when the employee was added',
            })
            .catch((error: unknown) => {
              message.warning(
                `${values.fullName} was added, but the salary could not be recorded: ${
                  error instanceof ApiError ? error.message : 'unknown error'
                }. Set it on their page.`,
              );
            });
        }
      }
      message.success(`${values.fullName} added.`);
      await queryClient.invalidateQueries({ queryKey: ['admin-hr'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      form.resetFields();
      setStep(0);
      onClose();
      onAdded?.(values.fullName);
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add this person.');
    } finally {
      setSaving(false);
    }
  };

  const values = form.getFieldsValue(true);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Add employee"
      width={Math.min(640, typeof window !== 'undefined' ? window.innerWidth : 640)}
      destroyOnHidden
      footer={
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {step > 0 ? <Button onClick={() => setStep((current) => current - 1)}>Back</Button> : null}
          {step < STEPS.length - 1 ? (
            <Button type="primary" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="primary" loading={saving} onClick={submit}>
              Add employee
            </Button>
          )}
        </div>
      }
    >
      <Steps size="small" current={step} items={STEPS.map((title) => ({ title }))} style={{ marginBottom: 18 }} />

      <Form form={form} layout="vertical" initialValues={{ employmentType: 'PERMANENT', wantsLogin: false, clinicId }}>
        <div style={{ display: step === 0 ? 'block' : 'none' }}>
          <Form.Item
            name="fullName"
            label="Full name"
            rules={[{ required: true, min: 2, message: 'A name is the one thing this cannot be created without.' }]}
          >
            <Input size="large" placeholder="Nurul Hidayah binti Ahmad" />
          </Form.Item>
          <Form.Item name="role" label="Job title" rules={[{ required: true, message: 'Which job?' }]}>
            <Select options={ROLES} size="large" placeholder="Choose" />
          </Form.Item>
          <Form.Item name="clinicId" label="Branch">
            <Select
              allowClear
              size="large"
              placeholder="Works across every branch"
              options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
            />
          </Form.Item>
          <Form.Item name="identifierValue" label="IC or passport number">
            <Input size="large" placeholder="900101-14-5567" />
          </Form.Item>
          <Form.Item name="dateOfBirth" label="Date of birth">
            <DatePicker style={{ width: '100%' }} size="large" format="D MMM YYYY" />
          </Form.Item>
          <Form.Item name="phone" label="Phone">
            <Input size="large" placeholder="013-2000000" />
          </Form.Item>
        </div>

        <div style={{ display: step === 1 ? 'block' : 'none' }}>
          <Form.Item name="employeeNo" label="Employee number">
            <Input size="large" placeholder="E-1024" />
          </Form.Item>
          <Form.Item name="position" label="Position">
            <Input size="large" placeholder="Staff Nurse" />
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
          {isDoctorRole ? (
            <>
              <Divider />
              <Form.Item
                name="medicalRegistrationNo"
                label="Medical registration number"
                extra="A registration number is what makes somebody a provider who can be booked and can sign notes. Leave it empty and this is an employee with a clinical job title, which is a different and perfectly ordinary thing."
              >
                <Input size="large" placeholder="MMC 12345" />
              </Form.Item>
            </>
          ) : null}
        </div>

        {/* PAY & BANK — the two things whose absence stops payroll, asked for
            at the moment somebody is hired rather than discovered on pay day. */}
        <div style={{ display: step === 2 ? 'block' : 'none' }}>
          <Form.Item
            name="salaryAmount"
            label="Basic salary"
            extra="Leave blank to set it later. Payroll leaves out anybody with no salary in force."
          >
            <Input prefix="RM" inputMode="decimal" placeholder="3200.00" />
          </Form.Item>
          <Form.Item name="salaryBasis" label="Paid">
            <Select
              options={[
                { value: 'MONTHLY', label: 'Monthly' },
                { value: 'DAILY', label: 'Daily' },
                { value: 'HOURLY', label: 'Hourly' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="salaryEffectiveFrom"
            label="From"
            extra="Salary is dated, so a later change closes this one rather than overwriting it. Defaults to their start date."
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Divider />

          <Form.Item name="bankName" label="Bank">
            <Input placeholder="Maybank" />
          </Form.Item>
          <Form.Item
            name="bankAccountNo"
            label="Account number"
            extra="Needed before anybody can be paid. Only the last four digits are ever shown back."
          >
            <Input inputMode="numeric" />
          </Form.Item>
        </div>

        <div style={{ display: step === 3 ? 'block' : 'none' }}>
          <Form.Item name="wantsLogin" label="Give them a login now" valuePropName="checked">
            <Switch />
          </Form.Item>
          <p className="kw-adminSection__desc">
            A member of staff who signs in gets My Kuwick: their own shifts, clock in and out, leave, claims
            and payslips. Somebody who does not sign in is still an employee and still gets paid — a locum
            with no account is perfectly normal.
          </p>
          {wantsLogin ? (
            <>
              <Form.Item
                name="loginEmail"
                label="Sign-in email"
                rules={[{ required: true, type: 'email', message: 'A real email address.' }]}
              >
                <Input size="large" autoComplete="off" />
              </Form.Item>
              <Form.Item
                name="loginPassword"
                label="First password"
                rules={[{ required: true, min: 8, message: 'At least eight characters.' }]}
                extra="They should change it after signing in the first time."
              >
                <Input.Password size="large" autoComplete="new-password" />
              </Form.Item>
            </>
          ) : null}
        </div>

        <div style={{ display: step === 4 ? 'block' : 'none' }}>
          <p className="kw-adminSection__desc">
            <strong>{values.fullName || '—'}</strong>
            {values.position ? ` · ${values.position}` : ''}
            {values.employeeNo ? ` · ${values.employeeNo}` : ''}
          </p>
          <p className="kw-adminSection__desc">
            {values.wantsLogin ? `Will sign in as ${values.loginEmail}.` : 'No login yet.'}
            {values.medicalRegistrationNo
              ? ' Registered as a provider, so appointments can be booked with them.'
              : ''}
          </p>
          <p className="kw-adminSection__desc">
            {values.salaryAmount
              ? `Paid RM${values.salaryAmount} ${String(values.salaryBasis ?? 'MONTHLY').toLowerCase()}.`
              : 'No salary yet — payroll will leave them out until one is set.'}
            {values.bankAccountNo ? ' Bank account on file.' : ' No bank account yet.'}
          </p>
          <Divider />
          {/* WHAT STILL HAS TO HAPPEN, said before they click rather than
              discovered when payroll refuses to include somebody. */}
          <p className="kw-adminSection__desc">
            <strong>Still to do after this.</strong> The Malaysian statutory profile — EPF, SOCSO, EIS, PCB
            category and LINDUNG — is a set of <em>dated positions</em> rather than one field, so it is set on
            this person's own page. Until it is, payroll works out what it can and raises the rest as an
            exception; it never guesses.
          </p>
        </div>
      </Form>
    </Drawer>
  );
}
