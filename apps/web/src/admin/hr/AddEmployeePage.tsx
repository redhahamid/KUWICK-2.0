import { useEffect, useState, useRef } from 'react';
import { App, AutoComplete, Button, DatePicker, Form, Input, Select, Switch } from 'antd';
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
import { parseNric } from '../../core/nric';
import { PhoneField } from './ui/PhoneField';
import { DAY_NAMES } from './StatutoryStandingManager';
import { useJobTitles, useLegalEmployers } from '../hooks/useAdmin';
import { JobTitlePicker } from './JobTitlePicker';
import { MALAYSIAN_STATES } from './malaysianStates';
import { RELATIONSHIPS } from './ui/reasons';

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
 * as the supplied information permits", in the brief's words. What payroll
 * actually refuses a month for is an employing company, a salary, a rest day,
 * a date of birth and the EPF membership; the tax profile is what stops
 * monthly tax being worked out, and a blank LINDUNG answer is enrolled. The first
 * month's UAT found the form asked for none of the first three, so every hire
 * was held up on facts the form could have taken. It asks for all of them now,
 * and the readiness list on the last stage mirrors the run's own blockers.
 *
 * FOUR WRITES, NOT ONE, and deliberately so. The employee is created through
 * the employment endpoint; the employing company through its own assignment;
 * the salary through the dated salary endpoint; the statutory position
 * (membership, tax, rest day, LINDUNG, overtime policy) through the dated
 * classification endpoint. Those refuse to be written on the employment
 * record — because a salary or a Third Schedule Part with no date is a figure
 * the payroll run would resolve differently from the profile, silently. This
 * form therefore ASKS for the date rather than inventing one, and each write
 * keeps its own audit row. The EPF contribution basis is not asked: with no
 * basis recorded the statutory assessment governs, which is the lawful
 * default, and payroll does not block on it.
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
  /** The furthest stage reached: every stage up to it is a tap away, not only the ones behind. */
  const [furthest, setFurthest] = useState(0);
  const [saving, setSaving] = useState(false);
  const { data: clinics } = useClinics();
  const { clinicId } = useClinicFilter();
  const queryClient = useQueryClient();
  const employers = useLegalEmployers();
  const activeEmployers = (employers.data ?? []).filter((row) => row.active);

  const fullName = Form.useWatch('fullName', form) ?? '';
  const role = Form.useWatch('role', form);
  const wantsLogin = Form.useWatch('wantsLogin', form);
  const epfMembership = Form.useWatch('epfMembership', form);
  const identifierType = Form.useWatch('identifierType', form);
  const identifierValue = Form.useWatch('identifierValue', form);
  const jobTitles = useJobTitles();
  /*
   * THE IC SAYS WHEN THEY WERE BORN AND WHICH THEY ARE. A valid Malaysian IC
   * fills the date of birth and the gender, into a box that is still a box:
   * typed over, the typed answer stays, and only a box this filled is
   * refilled when the IC changes.
   */
  const autoFilled = useRef({ dob: false, gender: false });
  useEffect(() => {
    if (identifierType === 'PASSPORT' || !identifierValue) return;
    const parsed = parseNric(identifierValue);
    if (!parsed) return;
    const current = form.getFieldsValue(['dateOfBirth', 'gender']) as { dateOfBirth?: unknown; gender?: string };
    if (!current.dateOfBirth || autoFilled.current.dob) {
      form.setFieldValue('dateOfBirth', parsed.dob);
      autoFilled.current.dob = true;
    }
    if (!current.gender || autoFilled.current.gender) {
      form.setFieldValue('gender', parsed.gender === 'Male' ? 'MALE' : 'FEMALE');
      autoFilled.current.gender = true;
    }
  }, [identifierValue, identifierType, form]);

  // ONE COMPANY MEANS NO CHOICE: a single-entity clinic should not be asked
  // which of its one company employs the person. Two or more stay a question.
  useEffect(() => {
    if (activeEmployers.length === 1 && !form.getFieldValue('legalEmployerId')) {
      form.setFieldValue('legalEmployerId', activeEmployers[0].id);
    }
  }, [activeEmployers, form]);
  const isDoctorRole = role === 'DOCTOR_RESIDENT' || role === 'DOCTOR_LOCUM';

  /** What each stage insists on before the one after it opens. */
  const validateStage = async (index: number) => {
    // Validated stage by stage, so a missing name is reported on the stage
    // that has the name box rather than three stages later.
    if (index === 0) await form.validateFields(['fullName', 'role', 'identifierValue']);
    if (index === 1 && wantsLogin) await form.validateFields(['loginEmail', 'loginPassword']);
    if (index === 2) await form.validateFields(['nationality']);
  };

  const next = async () => {
    // A stage that fails its check shows the messages and stays put; the
    // rejection itself is nothing to report.
    try {
      await validateStage(stage);
    } catch {
      return;
    }
    const target = Math.min(stage + 1, STAGES.length - 1);
    setStage(target);
    setFurthest((reached) => Math.max(reached, target));
  };

  /** Any stage already visited is a tap away; going forward still runs the stages between. */
  const jumpTo = async (index: number) => {
    for (let at = stage; at < index; at += 1) await validateStage(at);
    setStage(index);
  };

  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setSaving(true);
    const notes: string[] = [];
    try {
      const created = await apiClient.post('/workforce/employees', {
        fullName: values.fullName,
        role: values.role,
        clinicId: values.clinicId ?? clinicId,
        employeeNo: values.employeeNo || undefined,
        jobTitleId: values.jobTitleId || undefined,
        position: jobTitles.data?.find((row) => row.id === values.jobTitleId)?.name,
        workDaysPerWeek: values.workDaysPerWeek ?? undefined,
        department: values.department || undefined,
        employmentType: values.employmentType || undefined,
        startDate: values.startDate ? values.startDate.format('YYYY-MM-DD') : undefined,
        identifierType: values.identifierValue ? (values.identifierType ?? 'NRIC') : undefined,
        identifierValue: values.identifierValue || undefined,
        // A passport on file as the identity document is the passport; a non-citizen with an IC on file may add theirs beside it.
        passportNumber: values.identifierType === 'PASSPORT' ? values.identifierValue || undefined : values.passportNumber || undefined,
        dateOfBirth: values.dateOfBirth ? values.dateOfBirth.format('YYYY-MM-DD') : undefined,
        gender: values.gender || undefined,
        // A Malaysian citizen is Malaysian; the form asks nobody to say so twice.
        nationality: values.epfMembership === 'MALAYSIAN_CITIZEN' ? 'Malaysian' : values.nationality || undefined,
        phone: values.phone || undefined,
        email: values.email || undefined,
        address: values.address || undefined,
        postcode: values.postcode || undefined,
        city: values.city || undefined,
        state: values.state || undefined,
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
      const salaryFrom = (values.salaryEffectiveFrom ?? values.startDate)?.format('YYYY-MM-DD');
      // The standing is dated from the day they START, not from the salary's
      // date: a salary "From" later than the start date used to leave the
      // first month with no standing at all.
      const standingFrom = (values.startDate ?? values.salaryEffectiveFrom)?.format('YYYY-MM-DD');

      // THE EMPLOYING COMPANY, first: it is the one refusal the run cannot pass.
      if (staffId && values.legalEmployerId) {
        await apiClient
          .patch(`/workforce/employees/${staffId}/legal-employer`, {
            legalEmployerId: values.legalEmployerId,
            reason: 'Recorded when the employee was added',
          })
          .catch((error: unknown) => {
            notes.push(`employing company not recorded (${error instanceof ApiError ? error.message : 'unknown error'})`);
          });
      }

      if (staffId && values.salaryAmount) {
        await apiClient
          .post(`/workforce/employees/${staffId}/salary`, {
            amount: String(values.salaryAmount),
            basis: values.salaryBasis ?? 'MONTHLY',
            effectiveFrom: salaryFrom,
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
       * with its own date, on the employee's page. Written whenever ANY part
       * of the standing was given, not only the EPF membership: a rest day or
       * a LINDUNG answer on its own is still a fact payroll needs.
       */
      const hasRestDay = values.restDayOfWeek !== undefined && values.restDayOfWeek !== null;
      const standing = {
        ...(values.epfMembership ? { epfMembership: values.epfMembership } : {}),
        ...(values.pcbCategory ? { pcbCategory: values.pcbCategory } : {}),
        ...(values.taxResidence ? { taxResidence: values.taxResidence } : {}),
        ...(values.lindungParticipation ? { lindungParticipation: values.lindungParticipation } : {}),
        ...(hasRestDay
          ? values.restDayOfWeek === 'VARIES'
            ? { restDayOfWeek: null, restDayVaries: true }
            : { restDayOfWeek: values.restDayOfWeek, restDayVaries: false }
          : {}),
        ...(values.overtimeContractPolicy ? { overtimeContractPolicy: values.overtimeContractPolicy } : {}),
      };
      if (staffId && Object.keys(standing).length > 0) {
        if (standingFrom) {
          await apiClient
            .post(`/workforce/employees/${staffId}/statutory-classification`, {
              effectiveFrom: standingFrom,
              ...standing,
              reason: 'Recorded when the employee was added',
            })
            .catch((error: unknown) => {
              notes.push(
                `statutory position not recorded (${error instanceof ApiError ? error.message : 'unknown error'})`,
              );
            });
        } else {
          notes.push('the statutory position was not recorded (no start date to date it from)');
        }
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
    // The run's own blockers, in the order it raises them.
    !values.legalEmployerId ? 'No employing company — payroll refuses the month for them, and that refusal cannot be passed.' : null,
    !values.salaryAmount ? 'No salary in force — payroll leaves them out.' : null,
    values.salaryAmount && values.salaryBasis && values.salaryBasis !== 'MONTHLY'
      ? 'Paid daily or hourly — payroll leaves them out until a monthly salary is recorded.'
      : null,
    values.restDayOfWeek === undefined || values.restDayOfWeek === null ? 'No rest day — payroll refuses the month for them.' : null,
    !values.dateOfBirth ? 'No date of birth — SOCSO and EIS need an age.' : null,
    !values.epfMembership ? 'No EPF membership — EPF, SOCSO and EIS cannot be worked out.' : null,
    !values.taxResidence || !values.pcbCategory ? 'No tax residence or MTD category — monthly tax has to be entered by hand each month.' : null,
    !values.bankAccountNo ? 'No bank account — they cannot be paid out.' : null,
  ].filter(Boolean) as string[];

  return (
    <AdminShell
      title="Add employee"
      subtitle="A name and a job create the record. Payroll also needs an employing company, a rest day, the statutory standing and a salary, all asked for here; the person’s page lists whatever is still missing."
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
          // Any stage already reached is a tap away in either direction; a
          // forward tap still runs the validation of every stage it crosses.
          onSelect: index !== stage && index <= furthest ? () => void jumpTo(index).catch(() => undefined) : undefined,
        }))}
      />

      <Form
        form={form}
        layout="vertical"
        initialValues={{ employmentType: 'PERMANENT', wantsLogin: false, clinicId, salaryBasis: 'MONTHLY', identifierType: 'NRIC', lindungParticipation: 'ENROLLED' }}
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
                    <Input size="large" placeholder="e.g. Nurul Hidayah binti Ahmad" />
                  </Form.Item>
                  <div className="kw-formRow">
                    <Form.Item
                      name="role"
                      label="Account role"
                      rules={[{ required: true, message: 'Which role?' }]}
                      extra="What they can open in Kuwick, and their payroll group. Their job title is on the next stage."
                    >
                      <Select options={ROLES} placeholder="Choose" />
                    </Form.Item>
                    <Form.Item
                      name="identifierValue"
                      label={identifierType === 'PASSPORT' ? 'Passport number' : 'IC number'}
                      rules={[
                        {
                          validator: (_rule, value: string | undefined) =>
                            !value || identifierType === 'PASSPORT' || parseNric(value)
                              ? Promise.resolve()
                              : Promise.reject(new Error('A Malaysian IC is 12 digits, YYMMDD-PB-####, e.g. 900101-14-5567.')),
                        },
                      ]}
                    >
                      <Input placeholder={identifierType === 'PASSPORT' ? 'e.g. A12345678' : 'e.g. 900101-14-5567'} />
                    </Form.Item>
                    <Form.Item name="identifierType" label="Document">
                      <Select
                        options={[
                          { value: 'NRIC', label: 'Malaysian IC' },
                          { value: 'PASSPORT', label: 'Passport' },
                        ]}
                      />
                    </Form.Item>
                  </div>
                  <div className="kw-formRow">
                    <Form.Item name="dateOfBirth" label="Date of birth" extra="Filled from a Malaysian IC; SOCSO and EIS need an age.">
                      <DatePicker
                        style={{ width: '100%' }}
                        format="D MMM YYYY"
                        onChange={() => {
                          autoFilled.current.dob = false;
                        }}
                      />
                    </Form.Item>
                    <Form.Item name="gender" label="Gender">
                      <Select
                        allowClear
                        onChange={() => {
                          autoFilled.current.gender = false;
                        }}
                        options={[
                          { value: 'MALE', label: 'Male' },
                          { value: 'FEMALE', label: 'Female' },
                        ]}
                      />
                    </Form.Item>
                  </div>
                </div>
              </div>
            </Panel>

            <Panel title="How to reach them">
              <div className="kw-formRow">
                <Form.Item name="phone" label="Phone">
                  <PhoneField />
                </Form.Item>
                <Form.Item name="email" label="Email">
                  <Input placeholder="e.g. nurul@example.com" />
                </Form.Item>
              </div>
              <Form.Item name="address" label="Street address">
                <Input placeholder="e.g. 12, Jalan Bangi Avenue 3" />
              </Form.Item>
              <div className="kw-formRow">
                <Form.Item name="postcode" label="Postcode">
                  <Input inputMode="numeric" placeholder="e.g. 43650" />
                </Form.Item>
                <Form.Item name="city" label="City or town">
                  <Input placeholder="e.g. Bandar Baru Bangi" />
                </Form.Item>
                <Form.Item name="state" label="State">
                  <Select allowClear showSearch placeholder="Choose" options={MALAYSIAN_STATES.map((name) => ({ value: name, label: name }))} />
                </Form.Item>
              </div>
              <div className="kw-formRow">
                <Form.Item name="emergencyContactName" label="Emergency contact">
                  <Input />
                </Form.Item>
                <Form.Item name="emergencyContactPhone" label="Their phone">
                  <PhoneField />
                </Form.Item>
                <Form.Item name="emergencyContactRelation" label="Relationship">
                  <AutoComplete options={RELATIONSHIPS.map((value) => ({ value }))} placeholder="Choose or type" />
                </Form.Item>
              </div>
            </Panel>
          </div>

          <div style={{ display: stage === 1 ? 'block' : 'none' }}>
            <Panel title="The job">
              <div className="kw-formRow">
                <Form.Item name="employeeNo" label="Employee number">
                  <Input placeholder="e.g. E-1024" />
                </Form.Item>
                <Form.Item name="jobTitleId" label="Job title" extra="The clinic’s own list. Add to it here if the title is new.">
                  <JobTitlePicker id="jobTitleId" />
                </Form.Item>
                <Form.Item name="department" label="Department or team">
                  <Input placeholder="e.g. Clinical" />
                </Form.Item>
              </div>
              <div className="kw-formRow">
                <Form.Item name="workDaysPerWeek" label="Days a week" extra="Recorded on the record and shown there. The overtime divisor stays the rule set’s.">
                  <Select
                    allowClear
                    placeholder="Choose"
                    options={[
                      { value: 5, label: '5 days' },
                      { value: 5.5, label: '5½ days' },
                      { value: 6, label: '6 days' },
                    ]}
                  />
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
                  <Input placeholder="e.g. MMC 12345" />
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
                  <Input prefix="RM" inputMode="decimal" placeholder="e.g. 3200.00" />
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
                  <Input placeholder="e.g. Maybank" />
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
                  name="legalEmployerId"
                  label="Employed by"
                  extra="The company that pays them and files their EPF, SOCSO and tax. Payroll refuses to work out a month for anybody without one. A branch is where they work; it files nothing."
                >
                  <Select
                    allowClear
                    showSearch
                    optionFilterProp="label"
                    placeholder={activeEmployers.length > 0 ? 'Choose' : 'No company on file yet — add one in Settings, Company and statutory'}
                    options={activeEmployers.map((row) => ({ value: row.id, label: row.name }))}
                  />
                </Form.Item>
                <Form.Item
                  name="restDayOfWeek"
                  label="Rest day"
                  extra="Section 60(1) gives one whole day a week and the employer appoints it. Payroll refuses to work out a month without it. Where it varies week to week, say so: the month runs, and rest-day pay is keyed by hand."
                >
                  <Select
                    allowClear
                    placeholder="Choose"
                    options={[...DAY_NAMES.map((name, index) => ({ value: index, label: name })), { value: 'VARIES', label: 'Varies week to week' }]}
                  />
                </Form.Item>
                <Form.Item
                  name="lindungParticipation"
                  label="LINDUNG 24 JAM (SKBBK)"
                  extra="Every employee is enrolled unless they opt out through PERKESO’s own form. Recorded at hire so the first month is not held up on it."
                >
                  <Select
                    options={[
                      { value: 'ENROLLED', label: 'Enrolled' },
                      { value: 'NOT_PARTICIPATING', label: 'Opted out through PERKESO' },
                      { value: 'MANDATORY_FOREIGN_WORKER', label: 'Mandatory — foreign worker' },
                    ]}
                  />
                </Form.Item>
              </div>
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
              {epfMembership && epfMembership !== 'MALAYSIAN_CITIZEN' ? (
                <Form.Item
                  name="nationality"
                  label="Nationality"
                  rules={[{ required: true, message: 'Which country are they a citizen of?' }]}
                  extra="A Malaysian citizen is recorded as Malaysian without being asked; anybody else is recorded by what is typed here."
                >
                  <Input placeholder="e.g. Indonesian" />
                </Form.Item>
              ) : null}
              {epfMembership && epfMembership !== 'MALAYSIAN_CITIZEN' && identifierType !== 'PASSPORT' ? (
                <Form.Item
                  name="passportNumber"
                  label="Passport number"
                  extra="Beside the IC above, for a non-citizen whose document on file is an IC. Kept for the filings; never shown back."
                >
                  <Input placeholder="e.g. A12345678" />
                </Form.Item>
              ) : null}
              <Form.Item
                name="overtimeContractPolicy"
                label="Overtime above the Act limit"
                extra="Matters only for wages above the Employment Act’s First Schedule ceiling, where the Act’s overtime rates do not apply by law and the contract decides. Payroll asks for it before pricing their overtime."
              >
                <Select
                  allowClear
                  placeholder="Set later"
                  options={[
                    { value: 'PAY_AT_STATUTORY_RATES', label: 'Company pays overtime at the statutory rates' },
                    { value: 'NOT_PAID', label: 'Overtime is not paid' },
                  ]}
                />
              </Form.Item>
              <div className="kw-formRow">
                <Form.Item name="epfNumber" label="EPF number">
                  <Input placeholder="e.g. 12345678" />
                </Form.Item>
                <Form.Item name="socsoNumber" label="SOCSO number">
                  <Input />
                </Form.Item>
                <Form.Item name="taxNumber" label="Income tax number">
                  <Input placeholder="e.g. SG 12345678090" />
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
                      { label: 'Account role', value: roleLabel },
                      { label: 'Job title', value: jobTitles.data?.find((row) => row.id === values.jobTitleId)?.name },
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
