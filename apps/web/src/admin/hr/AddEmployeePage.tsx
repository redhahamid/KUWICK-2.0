import { useState } from 'react';
import { App, Button, DatePicker, Form, Input, Select, Switch } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AdminShell } from '../components/AdminShell';
import { Panel, DefinitionList } from '../components/Panel';
import { StageBar } from '../components/StageBar';
import { PersonAvatar } from '../components/Person';
import { StatusChip } from '../components/Chip';
import { ApiError, apiClient } from '../../core/api-client';
import { useClinics } from '../../core/hooks/useClinics';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';

/**
 * ADD EMPLOYEE — four stages, on a page of its own.
 *
 * It was a five-step drawer. Two things were wrong with that. A drawer is
 * 640px of a 1440px screen, so a form with two-column stages had to be one
 * column and ran to three screenfuls; and the fifth step existed because
 * "Access" — whether somebody gets a login — had been given a stage to itself,
 * which is a switch and a pair of fields.
 *
 * The reference sheet's four are Personal, Employment, Pay & Statutory,
 * Review, and they are the right four: they match what a new hire's record is
 * made of, and Access is an employment fact that now sits under Employment
 * where it belongs.
 *
 * THE POINT OF STAGE 3 IS THAT THE PERSON COMES OUT PAYABLE. "As payroll-ready
 * as the supplied information permits", in the brief's words. Salary, bank
 * account, the three statutory reference numbers and the statutory position
 * are the five things payroll blocks on, and a hiring form that collects none
 * of them creates somebody who is quietly left out of the next pay run.
 *
 * THREE WRITES, NOT ONE, and deliberately so. The employee is created through
 * the employment endpoint; the salary goes through the dated salary endpoint;
 * the statutory position goes through the dated classification endpoint. Both
 * of those refuse to be written on the employment record — because a salary
 * or a Third Schedule Part with no date is a figure the payroll run would
 * resolve differently from the profile, silently. This form therefore ASKS for
 * the date rather than inventing one, and each write keeps its own audit row.
 */

const ROLES = [
  { value: 'DOCTOR_RESIDENT', label: 'Doctor (resident)' },
  { value: 'DOCTOR_LOCUM', label: 'Doctor (locum)' },
  { value: 'FRONT_DESK_CLINICAL_STAFF', label: 'Front desk / clinical staff' },
  { value: 'FINANCE_STAFF', label: 'Finance' },
  { value: 'HR_STAFF', label: 'HR' },
  // The person who runs the floor. Approves leave, claims and overtime and
  // keeps employee records; never sees a salary and never touches payroll.
  { value: 'CLINIC_MANAGER', label: 'Clinic manager' },
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

const STAGES = [
  { key: 'personal', label: 'Personal' },
  { key: 'employment', label: 'Employment' },
  { key: 'pay', label: 'Pay & Statutory' },
  { key: 'review', label: 'Review' },
];

export function AddEmployeePage() {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm();
  const [stage, setStage] = useState(0);
  const [saving, setSaving] = useState(false);
  const { data: clinics } = useClinics();
  const { clinicId } = useClinicFilter();
  const queryClient = useQueryClient();

  const fullName = Form.useWatch('fullName', form) ?? '';
  const role = Form.useWatch('role', form);
  const wantsLogin = Form.useWatch('wantsLogin', form);
  const isDoctorRole = role === 'DOCTOR_RESIDENT' || role === 'DOCTOR_LOCUM';

  const next = async () => {
    // Validated stage by stage, so a missing name is reported on the stage
    // that has the name box rather than three stages later.
    if (stage === 0) await form.validateFields(['fullName', 'role']);
    if (stage === 1 && wantsLogin) await form.validateFields(['loginEmail', 'loginPassword']);
    setStage((current) => Math.min(current + 1, STAGES.length - 1));
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const notes: string[] = [];
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
        gender: values.gender || undefined,
        nationality: values.nationality || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        emergencyContactName: values.emergencyContactName || undefined,
        emergencyContactPhone: values.emergencyContactPhone || undefined,
        emergencyContactRelation: values.emergencyContactRelation || undefined,
        medicalRegistrationNo: values.medicalRegistrationNo || undefined,
        loginEmail: values.wantsLogin ? values.loginEmail : undefined,
        loginPassword: values.wantsLogin ? values.loginPassword : undefined,
        bankName: values.bankName || undefined,
        bankAccountNo: values.bankAccountNo || undefined,
        // THE REFERENCE NUMBERS, which are not classifications. An EPF number
        // is an identifier on a form; whether somebody contributes, and under
        // which Part, is a dated position and goes below.
        epfNumber: values.epfNumber || undefined,
        socsoNumber: values.socsoNumber || undefined,
        taxNumber: values.taxNumber || undefined,
      });

      const staffId = (created as { staffId?: string; id?: string }).staffId ?? (created as { id?: string }).id;
      const effectiveFrom = (values.salaryEffectiveFrom ?? values.startDate)?.format('YYYY-MM-DD');

      if (staffId && values.salaryAmount) {
        await apiClient
          .post(`/workforce/employees/${staffId}/salary`, {
            amount: String(values.salaryAmount),
            basis: values.salaryBasis ?? 'MONTHLY',
            effectiveFrom,
            reason: 'Recorded when the employee was added',
          })
          .catch((error: unknown) => {
            notes.push(`salary not recorded (${error instanceof ApiError ? error.message : 'unknown error'})`);
          });
      }

      /*
       * THE STATUTORY POSITION, dated from the day they start.
       *
       * This is the one date the form can honestly supply: on their first day
       * they are a citizen or they are not, and that is when the position
       * begins to matter for payroll. A later change — permanent residence
       * granted, a LINDUNG opt-in signed — closes this row and opens another
       * with its own date, on the employee's page.
       */
      if (staffId && values.epfMembership && effectiveFrom) {
        await apiClient
          .post(`/workforce/employees/${staffId}/statutory-classification`, {
            effectiveFrom,
            epfMembership: values.epfMembership,
            ...(values.pcbCategory ? { pcbCategory: values.pcbCategory } : {}),
            ...(values.taxResidence ? { taxResidence: values.taxResidence } : {}),
            reason: 'Recorded when the employee was added',
          })
          .catch((error: unknown) => {
            notes.push(
              `statutory position not recorded (${error instanceof ApiError ? error.message : 'unknown error'})`,
            );
          });
      }

      await queryClient.invalidateQueries({ queryKey: ['admin-hr'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-employees'] });
      if (notes.length > 0) {
        message.warning(`${values.fullName} was added, but ${notes.join(' and ')}. Finish it on their page.`);
      } else {
        message.success(`${values.fullName} added.`);
      }
      // Straight to the person just created, which is where whatever is still
      // missing is named — rather than back to a directory to find them again.
      navigate(staffId ? `/admin/hr/employees/${staffId}` : '/admin/hr/employees');
    } catch (error) {
      message.error(error instanceof ApiError ? error.message : 'Could not add this person.');
    } finally {
      setSaving(false);
    }
  };

  const values = form.getFieldsValue(true);
  const roleLabel = ROLES.find((option) => option.value === values.role)?.label;

  /*
   * WHAT PAYROLL WILL STILL BE MISSING, said before they click rather than
   * discovered when the pay run leaves somebody out.
   */
  const outstanding = [
    !values.salaryAmount ? 'No salary in force — payroll leaves them out.' : null,
    !values.bankAccountNo ? 'No bank account — they cannot be paid out.' : null,
    !values.dateOfBirth ? 'No date of birth — SOCSO and EIS need an age.' : null,
    !values.epfMembership ? 'No statutory position — EPF, SOCSO and PCB cannot be worked out.' : null,
  ].filter(Boolean) as string[];

  return (
    <AdminShell
      title="Add employee"
      subtitle="Only a name and a job are required. Everything else can be finished on their page."
      actions={
        <Button onClick={() => navigate('/admin/hr/employees')} disabled={saving}>
          Cancel
        </Button>
      }
    >
      <StageBar
        current={STAGES[stage].key}
        stages={STAGES.map((item, index) => ({
          key: item.key,
          label: item.label,
          done: index < stage,
          // Backwards freely, forwards only through Continue so each stage's
          // own validation runs.
          onSelect: index < stage ? () => setStage(index) : undefined,
        }))}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ employmentType: 'PERMANENT', wantsLogin: false, clinicId, salaryBasis: 'MONTHLY' }}
      >
        <div className="kw-formPage">
          <div style={{ display: stage === 0 ? 'block' : 'none' }}>
            <Panel title="Who they are">
              <div className="kw-formPage__identity">
                <div className="kw-formPage__photo">
                  <PersonAvatar name={fullName || '?'} size={72} />
                  {/* HONEST ABOUT WHAT IS NOT BUILT. Kuwick stores no employee
                      photograph — there is no column and no file store — so an
                      upload control here would be a button that loses a file.
                      The avatar is generated from the name and is stable. */}
                  <p className="kw-formPage__photoHint">
                    Photographs are not stored yet. Initials are generated from the name.
                  </p>
                </div>
                <div className="kw-formPage__fields">
                  <Form.Item
                    name="fullName"
                    label="Full name"
                    rules={[{ required: true, min: 2, message: 'A name is the one thing this cannot be created without.' }]}
                  >
                    <Input size="large" placeholder="Nurul Hidayah binti Ahmad" />
                  </Form.Item>
                  <div className="kw-formRow">
                    <Form.Item name="role" label="Job" rules={[{ required: true, message: 'Which job?' }]}>
                      <Select options={ROLES} placeholder="Choose" />
                    </Form.Item>
                    <Form.Item name="identifierValue" label="IC or passport number">
                      <Input placeholder="900101-14-5567" />
                    </Form.Item>
                  </div>
                  <div className="kw-formRow">
                    <Form.Item name="dateOfBirth" label="Date of birth" extra="SOCSO and EIS need an age.">
                      <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                    </Form.Item>
                    <Form.Item name="gender" label="Gender">
                      <Select
                        allowClear
                        options={[
                          { value: 'MALE', label: 'Male' },
                          { value: 'FEMALE', label: 'Female' },
                        ]}
                      />
                    </Form.Item>
                    <Form.Item name="nationality" label="Nationality">
                      <Input placeholder="Malaysian" />
                    </Form.Item>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="How to reach them">
              <div className="kw-formRow">
                <Form.Item name="phone" label="Phone">
                  <Input placeholder="013-2000000" />
                </Form.Item>
                <Form.Item name="email" label="Email">
                  <Input placeholder="nurul@example.com" />
                </Form.Item>
              </div>
              <Form.Item name="address" label="Address">
                <Input.TextArea rows={2} />
              </Form.Item>
              <div className="kw-formRow">
                <Form.Item name="emergencyContactName" label="Emergency contact">
                  <Input />
                </Form.Item>
                <Form.Item name="emergencyContactPhone" label="Their phone">
                  <Input />
                </Form.Item>
                <Form.Item name="emergencyContactRelation" label="Relationship">
                  <Input placeholder="Spouse" />
                </Form.Item>
              </div>
            </Panel>
          </div>

          <div style={{ display: stage === 1 ? 'block' : 'none' }}>
            <Panel title="The job">
              <div className="kw-formRow">
                <Form.Item name="employeeNo" label="Employee number">
                  <Input placeholder="E-1024" />
                </Form.Item>
                <Form.Item name="position" label="Position">
                  <Input placeholder="Staff Nurse" />
                </Form.Item>
                <Form.Item name="department" label="Department or team">
                  <Input placeholder="Clinical" />
                </Form.Item>
              </div>
              <div className="kw-formRow">
                <Form.Item name="employmentType" label="Employment type">
                  <Select options={EMPLOYMENT_TYPES} />
                </Form.Item>
                <Form.Item name="startDate" label="Started on">
                  <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                </Form.Item>
                <Form.Item name="clinicId" label="Branch">
                  <Select
                    allowClear
                    placeholder="Works across every branch"
                    options={(clinics ?? []).map((clinic) => ({ value: clinic.id, label: clinic.name }))}
                  />
                </Form.Item>
              </div>
              {isDoctorRole ? (
                <Form.Item
                  name="medicalRegistrationNo"
                  label="Medical registration number"
                  extra="A registration number is what makes somebody a bookable provider who can sign notes. Leave it empty for an employee with a clinical job title."
                >
                  <Input placeholder="MMC 12345" />
                </Form.Item>
              ) : null}
            </Panel>

            <Panel title="Access to Kuwick" hint="A locum with no account is perfectly normal, and still gets paid.">
              <Form.Item name="wantsLogin" label="Give them a login now" valuePropName="checked">
                <Switch />
              </Form.Item>
              {wantsLogin ? (
                <div className="kw-formRow">
                  <Form.Item
                    name="loginEmail"
                    label="Sign-in email"
                    rules={[{ required: true, type: 'email', message: 'A real email address.' }]}
                  >
                    <Input autoComplete="off" />
                  </Form.Item>
                  <Form.Item
                    name="loginPassword"
                    label="First password"
                    rules={[{ required: true, min: 8, message: 'At least eight characters.' }]}
                    extra="They should change it after signing in."
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                </div>
              ) : null}
            </Panel>
          </div>

          <div style={{ display: stage === 2 ? 'block' : 'none' }}>
            <Panel title="Pay" hint="Salary is dated, so a later change closes this one rather than overwriting it.">
              <div className="kw-formRow">
                <Form.Item name="salaryAmount" label="Basic salary">
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
                <Form.Item name="salaryEffectiveFrom" label="From" extra="Defaults to their start date.">
                  <DatePicker style={{ width: '100%' }} format="D MMM YYYY" />
                </Form.Item>
              </div>
              <div className="kw-formRow">
                <Form.Item name="bankName" label="Bank">
                  <Input placeholder="Maybank" />
                </Form.Item>
                <Form.Item
                  name="bankAccountNo"
                  label="Account number"
                  extra="Only the last four digits are ever shown back."
                >
                  <Input inputMode="numeric" />
                </Form.Item>
              </div>
            </Panel>

            <Panel
              title="Statutory position"
              hint="What Kuwick works EPF, SOCSO, EIS and monthly tax out from. Dated from their start date; a later change opens a new dated row rather than rewriting this one."
            >
              <div className="kw-formRow">
                <Form.Item
                  name="epfMembership"
                  label="EPF membership"
                  extra="Decides the Third Schedule Part their contributions come from."
                >
                  <Select
                    allowClear
                    placeholder="Set later"
                    options={[
                      { value: 'MALAYSIAN_CITIZEN', label: 'Malaysian citizen' },
                      { value: 'PERMANENT_RESIDENT', label: 'Permanent resident' },
                      { value: 'NON_CITIZEN_ELECTED_PRE_1998', label: 'Non-citizen, elected before Aug 1998' },
                      { value: 'NON_CITIZEN', label: 'Non-citizen' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="pcbCategory" label="Monthly tax category">
                  <Select
                    allowClear
                    placeholder="Set later"
                    options={[
                      { value: 'CATEGORY_1', label: 'Category 1 — single' },
                      { value: 'CATEGORY_2', label: 'Category 2 — married, spouse not working' },
                      { value: 'CATEGORY_3', label: 'Category 3 — married, spouse working' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="taxResidence" label="Tax residence">
                  <Select
                    allowClear
                    placeholder="Set later"
                    options={[
                      { value: 'RESIDENT', label: 'Resident' },
                      { value: 'NON_RESIDENT', label: 'Non-resident' },
                    ]}
                  />
                </Form.Item>
              </div>
              <div className="kw-formRow">
                <Form.Item name="epfNumber" label="EPF number">
                  <Input placeholder="12345678" />
                </Form.Item>
                <Form.Item name="socsoNumber" label="SOCSO number">
                  <Input />
                </Form.Item>
                <Form.Item name="taxNumber" label="Income tax number">
                  <Input placeholder="SG 12345678090" />
                </Form.Item>
              </div>
            </Panel>
          </div>

          <div style={{ display: stage === 3 ? 'block' : 'none' }}>
            <Panel title="What will be created">
              <div className="kw-formPage__identity">
                <PersonAvatar name={values.fullName || '?'} size={56} />
                <div className="kw-formPage__fields">
                  <DefinitionList
                    columns={3}
                    items={[
                      { label: 'Name', value: values.fullName },
                      { label: 'Job', value: roleLabel },
                      { label: 'Position', value: values.position },
                      { label: 'Employee number', value: values.employeeNo },
                      {
                        label: 'Starts',
                        value: values.startDate ? values.startDate.format('D MMM YYYY') : null,
                      },
                      { label: 'Branch', value: clinics?.find((clinic) => clinic.id === (values.clinicId ?? clinicId))?.name },
                      {
                        label: 'Salary',
                        value: values.salaryAmount
                          ? `RM${values.salaryAmount} ${String(values.salaryBasis ?? 'MONTHLY').toLowerCase()}`
                          : null,
                      },
                      { label: 'Bank', value: values.bankAccountNo ? values.bankName || 'On file' : null },
                      { label: 'Signs in', value: values.wantsLogin ? values.loginEmail : 'No login' },
                    ]}
                  />
                </div>
              </div>
            </Panel>

            <Panel
              title="Payroll readiness"
              tone={outstanding.length > 0 ? 'attention' : 'ok'}
              hint={
                outstanding.length === 0
                  ? 'Everything payroll needs is here. They can be included in the next run.'
                  : undefined
              }
            >
              {outstanding.length === 0 ? (
                <StatusChip tone="ok">Ready to be paid</StatusChip>
              ) : (
                <ul className="kw-readiness">
                  {outstanding.map((line) => (
                    <li key={line} className="kw-readinessItem kw-readinessItem--advisory">
                      <span className="kw-readinessItem__mark" aria-hidden>
                        !
                      </span>
                      <span className="kw-readinessItem__text">
                        <span className="kw-readinessItem__label">{line}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <div className="kw-formPage__foot">
          {stage > 0 ? <Button onClick={() => setStage((current) => current - 1)}>Back</Button> : <span />}
          {stage < STAGES.length - 1 ? (
            <Button type="primary" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button type="primary" loading={saving} onClick={submit}>
              Add employee
            </Button>
          )}
        </div>
      </Form>
    </AdminShell>
  );
}
