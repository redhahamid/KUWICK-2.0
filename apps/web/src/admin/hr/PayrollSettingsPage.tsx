import { useState } from 'react';
import { Link } from 'react-router-dom';
import { App, Input, Select, Switch } from 'antd';
import dayjs from 'dayjs';
import { useCan } from '../../core/hooks/useCan';
import {
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  useSetPayrollApprovalPolicy,
  useStatutoryRates,
  useUpsertPayrollPolicy,
} from '../hooks/useAdmin';
import { Drawer, HrPage, NotApplied, Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconEdit, IconPlus } from './ui/icons';
import type { OvertimeMode, PayrollPolicyRow } from '../types';

/**
 * PAYROLL POLICIES — one settings area, reached from the Settings landing.
 *
 * Two decisions live here. Who may approve a run — three choices, written as
 * sentences, because the owner is choosing how their clinic works and not
 * learning a control framework's vocabulary. And how pay is worked out — the
 * bases the engine prices a day and an hour from, per rule set.
 *
 * What does NOT live here any more: the employer table (Company & statutory),
 * the attendance editor (Attendance & leave policies), the pay components
 * (Payroll items), the statutory tables (Statutory rates). Each was a second
 * copy of a fact that has one home, and this page points at the home.
 *
 * HOW EXTRA HOURS ARE PRICED lives here too (§6): each rule set is either
 * the Employment Act's arithmetic or the clinic's own fixed rates, applies to
 * a group of the workforce, and — for anybody on RM4,000 or less — is held
 * to the Act as a floor. The server works the floor out against the
 * employees the rule set actually prices and says who it would underpay; the
 * gold notice under the table is that answer, and the payroll run blocks the
 * same people until the rate is corrected.
 */
const CHOICES = [
  {
    value: 'STANDARD',
    title: 'Anybody who can approve payroll',
    detail: 'One approval, and the person who ran the payroll may give it. Right for a clinic where one person does everything.',
  },
  {
    value: 'MAKER_CHECKER',
    title: 'Somebody other than the person who ran it',
    detail: 'One approval, from a second person. Right once two people share the work and you want the figures looked at twice.',
  },
  {
    value: 'DUAL_APPROVAL',
    title: 'Two people, neither of them the one who ran it',
    detail: 'The run stays open until two different people approve it. Right for a group that treats payroll as a board-level payment.',
  },
] as const;

const basisLabel = (basis: string, days: number | null) =>
  basis === 'CALENDAR_DAYS' ? 'calendar days' : basis === 'FIXED_DAYS' && days ? `${days}-day month` : basis.toLowerCase().replace(/_/g, ' ');

const rm = (value: string) => `RM${Number(value).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One line naming how a rule set prices extra hours. */
const pricingLine = (row: PayrollPolicyRow) => {
  if (row.overtimeMode !== 'CLINIC_RATE' || !row.clinicRates) return 'Employment Act: 1.5× · rest day 2.0× · public holiday 3.0×';
  const parts = [
    row.clinicRates.overtimeHourly ? `${rm(row.clinicRates.overtimeHourly)} an hour` : null,
    row.clinicRates.publicHolidayShift ? `${rm(row.clinicRates.publicHolidayShift)} a public holiday shift` : null,
    row.clinicRates.restDayShift ? `${rm(row.clinicRates.restDayShift)} a rest day shift` : null,
    row.clinicRates.session ? `${rm(row.clinicRates.session)} a session` : null,
  ].filter((part): part is string => part !== null);
  return `Clinic rate: ${parts.join(' · ')}`;
};

/**
 * THE ACT'S FIGURES FOR A RM4,000 WAGE, the highest the First Schedule
 * reaches — so the person typing a clinic rate can see the floor before the
 * server checks it against real employees. Same arithmetic as the server:
 * a day is the wage over 26, an hour is a day over the normal hours, rounded
 * to the sen before the multiplier.
 */
const actFloorAt4000 = (hoursPerDay: number) => {
  const daily = 400000 / 26;
  const hourly = Math.round(daily / hoursPerDay);
  const money = (cents: number) => rm((cents / 100).toFixed(2));
  return {
    hour: money(Math.round(hourly * 1.5)),
    holiday: money(Math.round(daily * 2)),
    restDay: money(Math.round(daily)),
  };
};

const MODES: { value: OvertimeMode; title: string; detail: string }[] = [
  {
    value: 'STATUTORY',
    title: 'Employment Act 1955',
    detail: 'A day is the monthly salary over 26 and an hour is a day over the normal hours. Overtime at 1.5×, a rest day at 2.0×, a public holiday at 3.0× with two days’ wages for the day itself.',
  },
  {
    value: 'CLINIC_RATE',
    title: 'Clinic rate',
    detail: 'Fixed amounts set here, never typed into the payroll grid. A kind of day left blank is priced by the Act. For anybody on RM4,000 or less the Act is a floor.',
  },
];

export function PayrollSettingsPage() {
  const { message } = App.useApp();
  const approval = usePayrollApprovalPolicy();
  const setApproval = useSetPayrollApprovalPolicy();
  const policies = usePayrollPolicies();
  const rates = useStatutoryRates();

  const choose = (body: Record<string, unknown>) =>
    setApproval.mutate(body, {
      onSuccess: () => message.success('Approval rule updated'),
      onError: (error: Error) => message.error(error.message),
    });

  const check = rates.data?.check ?? null;
  const error = [approval, policies].find((query) => query.error)?.error;

  const mayManage = useCan('hr.statutory.manage');
  const upsert = useUpsertPayrollPolicy();
  const [editing, setEditing] = useState<PayrollPolicyRow | 'new' | null>(null);
  const [name, setName] = useState('');
  const [appliesTo, setAppliesTo] = useState<string>('__hand');
  const [mode, setMode] = useState<OvertimeMode>('STATUTORY');
  const [hourly, setHourly] = useState('');
  const [holiday, setHoliday] = useState('');
  const [restDay, setRestDay] = useState('');
  const [session, setSession] = useState('');
  // THE ORDINARY-RATE DIVISORS. Held as strings so a half-typed field is not
  // silently read as 0 while somebody is still typing it.
  const [otDays, setOtDays] = useState('26');
  const [ulDays, setUlDays] = useState('31');
  const [hoursDay, setHoursDay] = useState('7.5');
  const [problem, setProblem] = useState<string | null>(null);

  const openNew = () => {
    setName('');
    setAppliesTo('__hand');
    setMode('STATUTORY');
    setHourly('');
    setHoliday('');
    setRestDay('');
    setSession('');
    setOtDays('26');
    setUlDays('31');
    setHoursDay('7.5');
    setProblem(null);
    setEditing('new');
  };
  const openEdit = (row: PayrollPolicyRow) => {
    setName(row.name);
    setAppliesTo(row.workforceCategory ?? (row.isDefault ? '__default' : '__hand'));
    setMode(row.overtimeMode);
    setHourly(row.clinicRates?.overtimeHourly ?? '');
    setHoliday(row.clinicRates?.publicHolidayShift ?? '');
    setRestDay(row.clinicRates?.restDayShift ?? '');
    setSession(row.clinicRates?.session ?? '');
    setOtDays(String(row.overtime.days ?? 26));
    setUlDays(String(row.unpaidLeave.days ?? 31));
    setHoursDay(String(row.overtime.hoursPerDay));
    setProblem(null);
    setEditing(row);
  };
  const close = () => setEditing(null);

  const clean = (value: string) => value.trim().replace(/^RM\s*/i, '').replace(/,/g, '');
  const save = () => {
    const amounts = { clinicOvertimeHourly: clean(hourly), clinicPublicHolidayShift: clean(holiday), clinicRestDayShift: clean(restDay), clinicSessionRate: clean(session) };
    if (name.trim().length < 2) {
      setProblem('Give the rule set a name.');
      return;
    }
    if (mode === 'CLINIC_RATE') {
      for (const value of Object.values(amounts)) {
        if (value !== '' && (!/^\d{1,10}(\.\d{1,2})?$/.test(value) || Number(value) <= 0)) {
          setProblem('Enter each amount as a number above zero, with at most two decimal places, or leave it blank.');
          return;
        }
      }
      if (Object.values(amounts).every((value) => value === '')) {
        setProblem('A clinic-rate rule set needs at least one amount.');
        return;
      }
    }
    /*
     * THE DIVISORS, CHECKED HERE AND AGAIN BY THE ACT.
     *
     * The server bounds them (1-31 days, 0.5-24 hours) and the RUN refuses a
     * divisor above 26 under s.60I(2), because a bigger divisor makes each day
     * worth less and underpays every hour of overtime. Saying it here means the
     * clinic finds out while typing rather than on the morning they try to run
     * payroll.
     */
    const otDaysNum = Number(otDays);
    const ulDaysNum = Number(ulDays);
    const hoursNum = Number(hoursDay);
    if (!Number.isInteger(otDaysNum) || otDaysNum < 1 || otDaysNum > 31) {
      setProblem('The overtime divisor is a whole number of days between 1 and 31.');
      return;
    }
    if (otDaysNum > 26) {
      setProblem(
        `An overtime divisor of ${otDaysNum} makes a day worth less than section 60I(1A) allows, which underpays ` +
          'every hour of overtime, every rest day and every public holiday. Payroll will refuse to calculate. Use 26 or fewer.',
      );
      return;
    }
    if (!Number.isInteger(ulDaysNum) || ulDaysNum < 1 || ulDaysNum > 31) {
      setProblem('The unpaid leave divisor is a whole number of days between 1 and 31.');
      return;
    }
    if (!Number.isFinite(hoursNum) || hoursNum < 0.5 || hoursNum > 8) {
      setProblem('Normal hours are between 0.5 and 8 a day. Section 60A(1) of the Employment Act caps them at 8.');
      return;
    }
    const existing = editing !== 'new' && editing ? editing : null;
    // THE BASES ARE CARRIED THROUGH UNCHANGED. The server replaces every
    // field it is not sent with its default, so an edit that only touched
    // the mode must resend what the rule set already has.
    upsert.mutate(
      {
        ...(existing ? { id: existing.id } : {}),
        name: name.trim(),
        ...(existing
          ? {
              legalEmployerId: existing.legalEmployerId,
              salaryProrationBasis: existing.salaryProration.basis,
              salaryProrationDays: existing.salaryProration.days ?? undefined,
              overtimeBasis: existing.overtime.basis,
              unpaidLeaveBasis: existing.unpaidLeave.basis,
              leavePayBasis: existing.leavePay.basis,
              leavePayDays: existing.leavePay.days ?? undefined,
              terminationBasis: existing.termination.basis,
              terminationDays: existing.termination.days ?? undefined,
            }
          : {}),
        // The three the clinic just answered, on a new rule set as well as an
        // edited one — a rule set created without them would price its people
        // from the schema's defaults and nobody would know which they got.
        overtimeDays: otDaysNum,
        unpaidLeaveDays: ulDaysNum,
        overtimeHoursPerDay: hoursNum,
        overtimeMode: mode,
        ...(mode === 'CLINIC_RATE'
          ? Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, value === '' ? null : value]))
          : {}),
        workforceCategory: appliesTo.startsWith('__') ? null : appliesTo,
        isDefault: appliesTo === '__default',
      },
      {
        onSuccess: () => {
          message.success(existing ? 'Rule set updated' : 'Rule set added');
          close();
        },
        onError: (mutationError: Error) => setProblem(mutationError.message),
      },
    );
  };

  const floorGuide = actFloorAt4000(editing !== 'new' && editing ? editing.overtime.hoursPerDay : 7.5);
  const underpaying = (policies.data?.policies ?? []).filter((row) => (row.floor?.below.length ?? 0) > 0);

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/settings">Settings</Link> &nbsp;/&nbsp; Payroll policies
        </>
      }
      title="Payroll policies"
      sub="Who may approve a run, and how a day and an hour of pay are worked out."
      error={error instanceof Error ? error.message : null}
    >

      <Panel>
        <PanelHead
          title="Who can approve payroll"
          sub="Approving a run locks it and is the moment money is committed. This is who may do it."
          actions={
            approval.data?.updatedAt ? (
              <span className="hr-eff">Changed {dayjs(approval.data.updatedAt).format('D MMM YYYY')}</span>
            ) : null
          }
        />
        {approval.data ? (
          <>
            {CHOICES.map((choice) => {
              const on = approval.data?.mode === choice.value;
              return (
                <label key={choice.value} className={`hr-choice${on ? ' hr-choice--on' : ''}`}>
                  <input
                    type="radio"
                    name="approval-mode"
                    value={choice.value}
                    checked={on}
                    disabled={setApproval.isPending}
                    onChange={() => choose({ mode: choice.value })}
                    style={{ marginTop: 4, accentColor: 'var(--hr-teal)' }}
                  />
                  <span>
                    <span className="hr-choice__title">{choice.title}</span>
                    <span className="hr-choice__detail">{choice.detail}</span>
                  </span>
                </label>
              );
            })}

            {approval.data.mode === 'STANDARD' ? null : (
              <div className="hr-fld">
                <span className="hr-fld__k">Account holders may approve their own runs</span>
                <span style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <Switch
                    checked={approval.data.allowOwnerSelfApproval}
                    loading={setApproval.isPending}
                    aria-label="Account holders may approve their own runs"
                    onChange={(checked) => choose({ allowOwnerSelfApproval: checked })}
                  />
                  <span className="hr-small hr-muted">
                    A clinic with one account holder has nobody else to ask. Leave this on and they can approve their own
                    payroll; turn it off and the rule above applies to everybody, so somebody could be left unable to pay
                    anyone.
                  </span>
                </span>
              </div>
            )}

            {/*
              * A RULE THAT CANNOT TAKE EFFECT is worse than no rule: the clinic
              * believes two people are checking payroll and one is. Said out
              * loud rather than left for pay day.
              */}
            {approval.data.inert.length > 0 ? (
              <div className="hr-notice hr-notice--attn">
                <strong>This rule will not change anything yet.</strong>
                <ul>
                  {approval.data.inert.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="hr-panelNote">
              <div>{approval.data.description}</div>
              <div>
                {approval.data.approvers.total} {approval.data.approvers.total === 1 ? 'person' : 'people'} in this clinic can approve
                payroll{approval.data.approvers.names.length > 0 ? `: ${approval.data.approvers.names.join(', ')}.` : '.'}
              </div>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {approval.data.limits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </Panel>

      <Panel className="hr-mt">
        <PanelHead
          title="How pay is worked out"
          sub="Which rule set prices overtime, rest days and public holidays for each group, and what a day and an hour are. Frozen into each run, so a later change cannot reprice a past month."
          actions={
            <>
              {policies.data?.policies.length ? (
                <span className="hr-eff">
                  Changed {dayjs([...policies.data.policies.map((row) => row.updatedAt)].sort().reverse()[0]).format('D MMM YYYY')}
                </span>
              ) : null}
              {mayManage ? (
                <button type="button" className="hr-btn hr-btn--sm hr-btn--primary" onClick={openNew}>
                  <IconPlus />
                  Add rule set
                </button>
              ) : null}
            </>
          }
        />
        <Table<PayrollPolicyRow>
          rowKey="id"
          loading={policies.isLoading}
          rows={policies.data?.policies}
          emptyText="No rule sets are recorded."
          emptyHint="Everybody is priced by the Employment Act until a rule set is added."
          columns={[
            {
              title: 'Rule set',
              dataIndex: 'name',
              render: (value: string, row) => (
                <span className="hr-strong">
                  {value} {row.isDefault ? <StatusChip tone="muted">Default</StatusChip> : null}
                </span>
              ),
            },
            {
              title: 'Applies to',
              key: 'applies',
              render: (_: unknown, row) => (
                <span title={row.employeeNames.join(', ')}>
                  {row.appliesTo}
                  {row.employeeCount > 0 ? (
                    <span className="hr-faint"> · {row.employeeCount} {row.employeeCount === 1 ? 'employee' : 'employees'}</span>
                  ) : null}
                </span>
              ),
            },
            {
              title: 'Overtime and holidays',
              key: 'ot',
              render: (_: unknown, row) => (
                <span>
                  {pricingLine(row)}
                  {row.floor && row.floor.below.length > 0 ? (
                    <>
                      {' '}
                      <StatusChip tone="attn">Below the Act for {row.floor.below.length}</StatusChip>
                    </>
                  ) : null}
                </span>
              ),
            },
            {
              /*
               * THE ONE BASIS THIS SCREEN SHOWS, and it prices nothing. The
               * run deducts unpaid leave from the days it computed itself; the
               * rule set's unpaid-leave basis is stored, resent unchanged on
               * every edit above, and read by no calculation. The column stays
               * because the answer is real and a clinic recorded it — it just
               * stops presenting itself as the one in force.
               */
              title: 'Unpaid leave',
              key: 'ul',
              width: 200,
              render: (_: unknown, row) => (
                <span>
                  {basisLabel(row.unpaidLeave.basis, row.unpaidLeave.days)}{' '}
                  <NotApplied>The run uses the days it computed.</NotApplied>
                </span>
              ),
            },
            ...(mayManage
              ? [
                  {
                    title: '',
                    key: 'edit',
                    width: 90,
                    render: (_: unknown, row: PayrollPolicyRow) => (
                      <button type="button" className="hr-btn hr-btn--sm" onClick={() => openEdit(row)}>
                        <IconEdit />
                        Edit
                      </button>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {/*
          * THE FLOOR, IN GOLD. Worked out by the server against the employees
          * each clinic-rate rule set actually prices, on their salary today.
          * Payroll blocks the same people on the month's real days, so this
          * is the same fact a month early.
          */}
        {underpaying.map((row) => (
          <div key={row.id} className="hr-notice hr-notice--attn" style={{ margin: '12px 22px 0' }}>
            <strong>
              {row.name} pays below the Employment Act for {row.floor?.below.length}{' '}
              {row.floor?.below.length === 1 ? 'employee' : 'employees'} on RM4,000 or less.
            </strong>
            <ul>
              {row.floor?.below.map((employee) => (
                <li key={employee.staffId}>
                  <Link className="hr-link" to={`/admin/hr/employees/${employee.staffId}`}>
                    {employee.name}
                  </Link>{' '}
                  ({employee.wages} a month): {employee.shortfalls.join(' ')}
                </li>
              ))}
            </ul>
            <div>Payroll will block these employees until the rate is raised or they are moved to a rule set on the Act.</div>
          </div>
        ))}
        {policies.data?.notice ? <div className="hr-panelNote">{policies.data.notice}</div> : null}
      </Panel>

      <Drawer
        open={editing !== null}
        title={editing === 'new' ? 'Add rule set' : 'Edit rule set'}
        sub="How a group's extra hours are priced. Applies from the next calculation; approved months keep the figures they were approved with."
        onClose={close}
        footer={
          <>
            <button type="button" className="hr-btn" onClick={close}>
              Cancel
            </button>
            <button type="button" className="hr-btn hr-btn--primary" disabled={upsert.isPending} onClick={save}>
              {editing === 'new' ? 'Add rule set' : 'Save changes'}
            </button>
          </>
        }
      >
        {problem ? <div className="hr-notice hr-notice--attn">{problem}</div> : null}
        <div className="hr-form">
          <div>
            <label htmlFor="ruleset-name">Name</label>
            <Input id="ruleset-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Doctors, Clinical staff…" />
          </div>
          <div>
            <label htmlFor="ruleset-applies">Applies to</label>
            <Select
              id="ruleset-applies"
              value={appliesTo}
              onChange={setAppliesTo}
              style={{ width: '100%' }}
              options={[
                { value: '__default', label: 'Everyone no other rule set covers (the default)' },
                ...(policies.data?.categories ?? []).map((category) => ({ value: category.key, label: category.label })),
                { value: '__hand', label: 'Only employees assigned to it by hand' },
              ]}
            />
            <div className="hr-form__help">
              An employee assigned a rule set on their record is on that one. Otherwise the rule set for their group applies, then the default.
            </div>
          </div>
          {/*
            * HOW A MONTHLY SALARY BECOMES A DAY AND AN HOUR.
            *
            * These three have been on the rule set since it shipped and the run
            * never read them — every payroll in the system used 26 / 31 / 7.5
            * because that is what the run's own columns default to, while the
            * report printed "clinic policy" over them. They are the clinic's
            * answer now, frozen onto each run as it is created.
            */}
          <div>
            <label>A day and an hour</label>
            <div className="hr-grid3">
              <div>
                <label htmlFor="orp-ot-days" className="hr-form__sub">Overtime divisor</label>
                <Input
                  id="orp-ot-days"
                  value={otDays}
                  onChange={(e) => setOtDays(e.target.value)}
                  addonAfter="days"
                  inputMode="numeric"
                />
              </div>
              <div>
                <label htmlFor="orp-hours" className="hr-form__sub">Normal hours</label>
                <Input
                  id="orp-hours"
                  value={hoursDay}
                  onChange={(e) => setHoursDay(e.target.value)}
                  addonAfter="a day"
                  inputMode="decimal"
                />
              </div>
              <div>
                <label htmlFor="orp-ul-days" className="hr-form__sub">Unpaid leave divisor</label>
                <Input
                  id="orp-ul-days"
                  value={ulDays}
                  onChange={(e) => setUlDays(e.target.value)}
                  addonAfter="days"
                  inputMode="numeric"
                />
              </div>
            </div>
            <div className="hr-form__help">
              The ordinary rate is the monthly salary over the overtime divisor, and an hour is that over the normal
              hours. Overtime, rest days and public holidays are all priced from it. Section 60I(1A) sets 26; above it
              every hour of overtime is worth less, and the run refuses to calculate. A day of unpaid leave is the
              salary over its own divisor, which is calendar days for most clinics.
            </div>
          </div>
          <div>
            <label>Overtime, rest days and public holidays</label>
            <div className="hr-form__choices">
            {MODES.map((choice) => {
              const on = mode === choice.value;
              return (
                <label key={choice.value} className={`hr-choice${on ? ' hr-choice--on' : ''}`}>
                  <input
                    type="radio"
                    name="overtime-mode"
                    value={choice.value}
                    checked={on}
                    onChange={() => setMode(choice.value)}
                    style={{ marginTop: 4, accentColor: 'var(--hr-teal)' }}
                  />
                  <span>
                    <span className="hr-choice__title">{choice.title}</span>
                    <span className="hr-choice__detail">{choice.detail}</span>
                  </span>
                </label>
              );
            })}
            </div>
          </div>
          {mode === 'CLINIC_RATE' ? (
            <div className="hr-form">
              <div className="hr-form__row">
                <div>
                  <label htmlFor="ruleset-hourly">Per hour of overtime</label>
                  <Input id="ruleset-hourly" prefix="RM" inputMode="decimal" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="Blank: the Act" />
                </div>
                <div>
                  <label htmlFor="ruleset-holiday">Per public holiday shift</label>
                  <Input id="ruleset-holiday" prefix="RM" inputMode="decimal" value={holiday} onChange={(e) => setHoliday(e.target.value)} placeholder="Blank: the Act" />
                </div>
              </div>
              <div className="hr-form__row">
                <div>
                  <label htmlFor="ruleset-restday">Per rest day shift</label>
                  <Input id="ruleset-restday" prefix="RM" inputMode="decimal" value={restDay} onChange={(e) => setRestDay(e.target.value)} placeholder="Blank: the Act" />
                </div>
                <div>
                  <label htmlFor="ruleset-session">Per session</label>
                  <Input id="ruleset-session" prefix="RM" inputMode="decimal" value={session} onChange={(e) => setSession(e.target.value)} placeholder="Blank: shift rate" />
                </div>
              </div>
              <div className="hr-form__help">
                A session is a rest day or public holiday worked for at most half the normal hours. For an employee on RM4,000 the Act’s figures are{' '}
                {floorGuide.hour} an hour, {floorGuide.holiday} a public holiday and {floorGuide.restDay} a rest day; a clinic rate below them is not applied to anybody on RM4,000 or less.
              </div>
            </div>
          ) : null}
        </div>
      </Drawer>

      <Panel className="hr-mt">
        <PanelHead title="Also decided in Settings" sub="Each of these has one home. Payroll reads them; it does not set them." />
        <div className="hr-kv">
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/statutory">
              Statutory rates
            </Link>{' '}
            — what Kuwick deducts and what the clinic pays on top
          </span>
          <span className="hr-kv__v">
            {check ? (
              <StatusChip tone={check.current ? 'done' : 'attn'}>Checked {dayjs(check.checkedAt).format('D MMM YYYY')}</StatusChip>
            ) : (
              <StatusChip tone="attn">Not checked</StatusChip>
            )}
          </span>
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/attendance-leave">
              Attendance &amp; leave policies
            </Link>{' '}
            — the grace period, what counts as a full day
          </span>
          <span />
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/payroll-items">
              Payroll items
            </Link>{' '}
            — what each item counts towards
          </span>
          <span />
          <span className="hr-kv__k">
            <Link className="hr-link" to="/admin/hr/settings/company">
              Company &amp; statutory
            </Link>{' '}
            — the employer's registration, EPF, SOCSO and LHDN numbers
          </span>
          <span />
        </div>
      </Panel>
    </HrPage>
  );
}
