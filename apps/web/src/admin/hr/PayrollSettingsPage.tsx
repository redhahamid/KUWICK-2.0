import { Link } from 'react-router-dom';
import { App, Switch } from 'antd';
import dayjs from 'dayjs';
import {
  usePayrollApprovalPolicy,
  usePayrollPolicies,
  useSetPayrollApprovalPolicy,
  useStatutoryRates,
} from '../hooks/useAdmin';
import { HrPage, Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import type { PayrollPolicyRow } from '../types';

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
 * The overtime and public-holiday pricing modes — statutory versus clinic rate
 * — are a later piece of work and arrive on this page when they do.
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
          sub="What a day and an hour are, per rule set. Frozen into each run, so a later change cannot reprice a past month."
          actions={
            policies.data?.policies.length ? (
              <span className="hr-eff">
                Changed {dayjs([...policies.data.policies.map((row) => row.updatedAt)].sort().reverse()[0]).format('D MMM YYYY')}
              </span>
            ) : null
          }
        />
        <Table<PayrollPolicyRow>
          rowKey="id"
          loading={policies.isLoading}
          rows={policies.data?.policies}
          emptyText="No pay rules are recorded."
          emptyHint="Kuwick's defaults apply until a rule set is added."
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
            { title: 'Salary proration', key: 'sp', render: (_: unknown, row) => basisLabel(row.salaryProration.basis, row.salaryProration.days) },
            {
              title: 'Overtime',
              key: 'ot',
              render: (_: unknown, row) => `${basisLabel(row.overtime.basis, row.overtime.days)} · ${row.overtime.hoursPerDay} h/day`,
            },
            { title: 'Unpaid leave', key: 'ul', render: (_: unknown, row) => basisLabel(row.unpaidLeave.basis, row.unpaidLeave.days) },
            { title: 'Employees', dataIndex: 'employeeCount', num: true, width: 110 },
          ]}
        />
        {policies.data?.notice ? <div className="hr-panelNote">{policies.data.notice}</div> : null}
      </Panel>

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
