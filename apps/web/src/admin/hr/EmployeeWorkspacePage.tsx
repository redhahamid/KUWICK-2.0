import { useEffect, useMemo, useState } from 'react';
import { addressTail } from './malaysianStates';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Dropdown, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useEmployeeRecord, usePayrollPolicies } from '../hooks/useAdmin';
import { initialsOf } from './ui/who';
import { humanise } from '../components/Chip';
import { ringgit } from '../components/DataTable';
import { useCan } from '../../core/hooks/useCan';
import { Drawer, HrPage, Panel, PanelHead, StatusChip } from './ui';
import { Table } from './ui/Table';
import { IconDoc, IconEdit, IconMore } from './ui/icons';
import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';
import { RecurringItemsPanel } from './RecurringItemsPanel';
import { EpfBasisPanel } from './EpfBasisPanel';
import { EmployeeTaxPanel } from './EmployeeTaxPanel';
import { DAY_NAMES, StatutoryStandingManager } from './StatutoryStandingManager';
import { accountLabel, annualLeaveLabel, taxCategoryLabel } from './recordLabels';
import { EmployeeEditDrawer, type EditSection } from './EmployeeEditDrawer';
import { MarkResignedModal } from './MarkResignedModal';
import { DeleteEmployeeModal } from './DeleteEmployeeModal';
import type { EmployeeRecord } from '../types';
import { leftLabel } from './leftLabel';

/**
 * THE EMPLOYEE RECORD — four tabs, as the mockup draws them.
 *
 *   Profile · Employment & salary · Statutory · Bank
 *
 * They were six (Summary · Employment · Pay · Attendance · Leave & Claims ·
 * Documents). NOTHING WAS DROPPED; each panel moved to the tab a person
 * would look in first. Identity, contact and the documents sighted are
 * Profile. Salary, recurring items, the employment terms and this year's
 * attendance, leave and claims are Employment & salary. The statutory
 * standing, the EPF basis and the TP1/TP3 forms are Statutory. The account
 * pay goes to is Bank. Payroll history is behind the Payslips button, where
 * the mockup puts it.
 *
 * IT IS NOT A FOURTEENTH PLACE ANY OF THIS IS STORED. Every tab reads the
 * module that owns its facts; attendance is corrected on the timesheet,
 * leave on the leave record, a claim on the claim — the tab links there.
 */
type TabKey = 'profile' | 'employment' | 'statutory' | 'bank';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: 'Profile' },
  { key: 'employment', label: 'Employment & salary' },
  { key: 'statutory', label: 'Statutory' },
  { key: 'bank', label: 'Bank' },
];

// Every older ?tab= still lands somewhere sensible: a payroll exception
// linking to ?tab=salary opens Employment & salary rather than a default.
const TAB_ALIASES: Record<string, TabKey> = {
  overview: 'profile',
  summary: 'profile',
  documents: 'profile',
  pay: 'employment',
  salary: 'employment',
  payroll: 'employment',
  attendance: 'employment',
  leave: 'employment',
  claims: 'employment',
  leaveClaims: 'employment',
  tax: 'statutory',
};

const TYPE_LABEL: Record<string, string> = { PERMANENT: 'Permanent', CONTRACT: 'Contract', PART_TIME: 'Part-time', LOCUM: 'Locum', INTERN: 'Intern' };
const GONE = new Set(['RESIGNED', 'TERMINATED']);

const date = (value: string | null | undefined) => (value ? dayjs(value).format('D MMM YYYY') : null);

export function EmployeeWorkspacePage() {
  const { staffId } = useParams<{ staffId: string }>();
  const record = useEmployeeRecord(staffId);
  const mayManage = useCan('hr.employee.manage');
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab') ?? '';
  const focus = search.get('focus');
  const initial = (TABS.find((entry) => entry.key === requested)?.key ?? TAB_ALIASES[requested] ?? 'profile') as TabKey;
  const [tab, setTab] = useState<TabKey>(initial);
  const [editing, setEditing] = useState<EditSection | null>(null);
  const [payslips, setPayslips] = useState(false);
  const [resigning, setResigning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const navigate = useNavigate();
  const data = record.data;

  // ?edit=1 from the directory's Edit button opens the profile form at once.
  useEffect(() => {
    if (search.get('edit') === '1' && data && mayManage) {
      setEditing('profile');
      const next = new URLSearchParams(search);
      next.delete('edit');
      setSearch(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /*
   * ?focus=<panel> FROM A FIX LINK. The payroll screens link to the thing
   * that is wrong — a salary, the standing, the bank account — not to the
   * top of the record. The tab is already chosen from ?tab=; this scrolls
   * the named panel into view once it has rendered and rings it for a
   * moment, then leaves the address alone so a refresh does it again.
   */
  useEffect(() => {
    if (!data || !focus) return;
    const target = focus === 'employment' ? 'employer' : focus;
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(`[data-focus="${target}"]`);
      if (!element) return;
      element.scrollIntoView({ block: 'start' });
      element.classList.add('is-focused');
      window.setTimeout(() => element.classList.remove('is-focused'), 2500);
    }, 60);
    return () => window.clearTimeout(timer);
  }, [data, focus, tab]);

  const select = (value: TabKey) => {
    setTab(value);
    const next = new URLSearchParams(search);
    next.set('tab', value);
    setSearch(next, { replace: true });
  };

  const outstanding = data?.payrollReadiness?.items.filter((item) => !item.done && item.severity === 'BLOCKING') ?? [];
  const noBank = data?.payrollReadiness?.items.some((item) => item.key === 'bank' && !item.done) ?? false;
  const name = data?.identity.fullName ?? 'Employee';
  const gone = GONE.has(data?.employment.employmentStatus ?? '');

  return (
    <HrPage
      crumb={
        <>
          <Link to="/admin/hr/employees">Employees</Link> &nbsp;/&nbsp; {name}
        </>
      }
      title={
        <span className="hr-who hr-who--head">
          <span className="hr-who__avatar hr-who__avatar--lg">{initialsOf(name)}</span>
          <span>
            {name}
            {data ? (
              <span className="hr-facts" style={{ display: 'block', fontWeight: 400, marginTop: 2 }}>
                {[
                  data.employment.position,
                  gone ? leftLabel(data.employment.endDate) : TYPE_LABEL[data.employment.employmentType] ?? humanise(data.employment.employmentType),
                  data.employment.employeeNo,
                  data.employment.startDate ? `Joined ${date(data.employment.startDate)}` : null,
                  data.employment.clinicName ?? 'All branches',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            ) : null}
          </span>
        </span>
      }
      error={record.error instanceof Error ? record.error.message : null}
      actions={
        data ? (
          <>
            {data.engagement === 'CONTRACTOR' ? (
              <StatusChip tone="info">Contractor, not on payroll</StatusChip>
            ) : outstanding.length === 0 ? (
              noBank ? (
                <StatusChip tone="attn">Record complete — no bank account</StatusChip>
              ) : (
                <StatusChip tone="done">Record complete</StatusChip>
              )
            ) : (
              <Tooltip title={outstanding.map((item) => item.label).join(' · ')}>
                <span>
                  <StatusChip tone="attn">
                    {outstanding.length} {outstanding.length === 1 ? 'thing' : 'things'} outstanding
                  </StatusChip>
                </span>
              </Tooltip>
            )}
            <button type="button" className="hr-btn" onClick={() => setPayslips(true)}>
              <IconDoc />
              Payslips
            </button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'edit', label: 'Edit record', disabled: !mayManage },
                  { type: 'divider' },
                  { key: 'timesheet', label: 'Open timesheet' },
                  { key: 'leave', label: 'Open leave' },
                  { key: 'claims', label: 'Open claims' },
                  { type: 'divider' },
                  { key: 'resign', label: 'Mark as resigned', danger: true, disabled: !mayManage || gone },
                  { key: 'delete', label: 'Delete record', danger: true, disabled: !mayManage },
                ],
                onClick: ({ key }) => {
                  if (key === 'edit') setEditing('profile');
                  if (key === 'timesheet') window.location.assign(`/admin/hr/attendance?staffId=${data.staffId}`);
                  if (key === 'leave') window.location.assign('/admin/hr/leave');
                  if (key === 'claims') window.location.assign(`/admin/hr/claims?staffId=${data.staffId}`);
                  if (key === 'resign') setResigning(true);
                  if (key === 'delete') setDeleting(true);
                },
              }}
            >
              <button type="button" className="hr-btn hr-btn--icon" aria-label="More">
                <IconMore />
              </button>
            </Dropdown>
          </>
        ) : null
      }
    >
      {data ? (
        <>
          <EmployeeEditDrawer staffId={data.staffId} data={data} section={editing} onClose={() => setEditing(null)} />
          <MarkResignedModal staffId={data.staffId} fullName={name} open={resigning} onClose={() => setResigning(false)} />
          <DeleteEmployeeModal
            staffId={data.staffId}
            fullName={name}
            open={deleting}
            onClose={() => setDeleting(false)}
            onDeleted={() => navigate('/admin/hr/employees')}
          />
          <PayslipsDrawer data={data} open={payslips} onClose={() => setPayslips(false)} />

          <Panel>
            <div className="hr-tabs" role="tablist" aria-label="Employee record">
              {TABS.map((entry) => (
                <button
                  key={entry.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === entry.key}
                  className={tab === entry.key ? 'is-active' : ''}
                  onClick={() => select(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {tab === 'profile' ? <ProfileTab data={data} onEdit={mayManage ? () => setEditing('profile') : undefined} /> : null}
            {tab === 'employment' ? (
              <EmploymentTab data={data} onEdit={mayManage ? () => setEditing('employment') : undefined} onResign={mayManage && !gone ? () => setResigning(true) : undefined} />
            ) : null}
            {tab === 'statutory' ? <StatutoryTab data={data} onEdit={mayManage ? () => setEditing('statutory') : undefined} /> : null}
            {tab === 'bank' ? <BankTab data={data} onEdit={mayManage ? () => setEditing('bank') : undefined} /> : null}
          </Panel>
        </>
      ) : null}
    </HrPage>
  );
}

// ── Profile ─────────────────────────────────────────────────────────────────
function Kv({ pairs }: { pairs: [string, React.ReactNode][] }) {
  return (
    <div className="hr-kv hr-kv--pairs">
      {pairs.map(([key, value]) => (
        <span key={key} style={{ display: 'contents' }}>
          <span className="hr-kv__k">{key}</span>
          <span className="hr-kv__v">{value ?? <span className="hr-faint">Not recorded</span>}</span>
        </span>
      ))}
    </div>
  );
}

const EditButton = ({ onClick }: { onClick?: () => void }) =>
  onClick ? (
    <button type="button" className="hr-btn hr-btn--sm" onClick={onClick}>
      <IconEdit />
      Edit
    </button>
  ) : null;

function ProfileTab({ data, onEdit }: { data: EmployeeRecord; onEdit?: () => void }) {
  const id = data.identity;
  const emergency = id.emergencyContactName
    ? `${id.emergencyContactName}${id.emergencyContactRelation ? ` (${id.emergencyContactRelation})` : ''}${id.emergencyContactPhone ? ` · ${id.emergencyContactPhone}` : ''}`
    : null;
  const sighted = [
    { label: 'IC or passport', present: Boolean(id.dateOfBirth), detail: 'Date of birth recorded' },
    ...(id.passportOnFile || (id.nationality && id.nationality !== 'Malaysian')
      ? [{ label: 'Passport', present: id.passportOnFile, detail: 'A non-citizen’s passport, for the filings' }]
      : []),
    { label: 'EPF / KWSP number', present: data.statutory.epfNumberOnFile, detail: 'Needed for the EPF return' },
    { label: 'SOCSO / PERKESO number', present: data.statutory.socsoNumberOnFile, detail: 'Needed for the SOCSO return' },
    { label: 'Income tax number', present: data.statutory.taxNumberOnFile, detail: 'Needed for the monthly-tax return' },
    { label: 'Bank account', present: Boolean(data.pay?.bankAccountOnFile), detail: 'Needed before anybody can be paid' },
  ];
  return (
    <>
      <PanelHead title="Personal" sub="Who this person is, and how to reach them." actions={<EditButton onClick={onEdit} />} />
      <Kv
        pairs={[
          ['Full name', id.fullName],
          ['Legal name', id.legalName],
          ['Date of birth', date(id.dateOfBirth)],
          ['Gender', id.gender ? humanise(id.gender) : null],
          ['Nationality', id.nationality],
          ['Marital status', id.maritalStatus ? humanise(id.maritalStatus) : null],
          ['Phone', id.phone],
          ['Email', id.email],
          ['Address', [id.address, addressTail(id)].filter(Boolean).join(', ') || null],
          ['Emergency contact', emergency],
        ]}
      />

      <PanelHead rule title="Account" sub="An account, an employment and a clinical credential are three separate facts." />
      <Kv
        pairs={[
          // "Give them a login" off means no account at all (new-clinic UAT #2, item 71).
          ['Account', accountLabel(id)],
          ['Account role', humanise(id.accountRole)],
        ]}
      />

      <PanelHead rule title="On record" sub="Which documents have been sighted well enough to record a number from. Copies are not stored in Kuwick." />
      <Kv
        pairs={sighted.map((row) => [
          row.label,
          <span key={row.label}>
            <StatusChip tone={row.present ? 'done' : 'attn'}>{row.present ? 'On record' : 'Missing'}</StatusChip>{' '}
            <span className="hr-faint hr-small">{row.detail}</span>
          </span>,
        ])}
      />
      <div className="hr-panelNote">{data.documents.note}</div>
    </>
  );
}

// ── Employment & salary ─────────────────────────────────────────────────────
function EmploymentTab({ data, onEdit, onResign }: { data: EmployeeRecord; onEdit?: () => void; onResign?: () => void }) {
  const policies = usePayrollPolicies();
  const canSeePay = data.payVisible && data.salaryPeriods !== null;
  const rules = policies.data?.policies.find((row) => row.isDefault) ?? policies.data?.policies[0];
  const restDay = data.statutory.classificationState === 'RESOLVED' ? data.statutory.restDayOfWeek : null;
  const restDayVaries = data.statutory.classificationState === 'RESOLVED' && data.statutory.restDayVaries;
  const restDayRoster = data.statutory.classificationState === 'RESOLVED' && data.statutory.restDayFollowsRoster === true;
  const daysPerWeek = data.employment.workDaysPerWeek;
  /*
   * WHAT IS RECORDED, not what a six-day span would imply: the days a week
   * off the record, the rest day off the standing, and the divisor off the
   * rule set, each named only when it is known.
   */
  const workingDays = useMemo(() => {
    const parts: string[] = [];
    if (daysPerWeek !== null && daysPerWeek !== undefined) parts.push(`${daysPerWeek}-day week`);
    if (restDayRoster) parts.push('rest day rotates with the roster');
    else if (restDayVaries) parts.push('rest day varies week to week');
    else if (restDay !== null && restDay !== undefined) parts.push(`rest day ${DAY_NAMES[restDay]}`);
    if (parts.length === 0) return null;
    const divisor = rules?.overtime.days ? `, ${rules.overtime.days}-day divisor` : '';
    return `${parts.join(' · ')}${divisor}`;
  }, [daysPerWeek, restDay, restDayVaries, restDayRoster, rules]);
  const employment = data.employment;
  const gone = GONE.has(employment.employmentStatus);

  return (
    <>
      <div data-focus="salary">
        <EmployeeSalaryPanel staffId={data.staffId} canSeePay={canSeePay} />
      </div>
      <RecurringItemsPanel staffId={data.staffId} canSeePay={canSeePay} />

      <div data-focus="employer">
      <PanelHead rule title="Employment" actions={<EditButton onClick={onEdit} />} />
      <Kv
        pairs={[
          ['Type', gone ? `${humanise(employment.employmentStatus)} · was ${TYPE_LABEL[employment.employmentType] ?? humanise(employment.employmentType)}` : TYPE_LABEL[employment.employmentType] ?? humanise(employment.employmentType)],
          ['Working days', workingDays ?? <span className="hr-faint">Days a week and rest day not recorded</span>],
          ['Position', employment.position],
          [
            'Annual leave',
            // The figure the Leave page and My Kuwick show (new-clinic UAT #2 re-check, item 78).
            annualLeaveLabel(data.annualLeave, data.leavePolicy?.name ?? null),
          ],
          ['Branch', employment.clinicName ?? 'All branches'],
          ['Reports to', employment.manager],
          ['Probation until', date(employment.confirmedDate)],
          [
            'Status',
            <span key="status">
              {humanise(employment.employmentStatus)}
              {gone && employment.endDate ? ` · ${date(employment.endDate)}${employment.endReason ? ` · ${employment.endReason}` : ''}` : ''}
              {onResign ? (
                <>
                  {' · '}
                  <a href="#resign" onClick={(event) => { event.preventDefault(); onResign(); }}>
                    Mark as resigned
                  </a>
                </>
              ) : null}
            </span>,
          ],
          ['Employed by', employment.legalEmployerName],
          ['Department', employment.department],
          ['Engagement', data.engagement === 'CONTRACTOR' ? 'Contractor' : 'Employee'],
          ['Notes', employment.notes],
        ]}
      />
      </div>

      <PanelHead
        rule
        title={`This year, ${data.year}`}
        sub="From the timesheet, the leave record and the claims. Corrections are made there; this page holds no second copy."
        actions={
          <>
            <Link className="hr-btn hr-btn--sm" to={`/admin/hr/attendance?staffId=${data.staffId}`}>
              Timesheet
            </Link>
            <Link className="hr-btn hr-btn--sm" to="/admin/hr/leave">
              Leave
            </Link>
            <Link className="hr-btn hr-btn--sm" to={`/admin/hr/claims?staffId=${data.staffId}`}>
              Claims
            </Link>
          </>
        }
      />
      <Kv
        pairs={[
          ['Days worked', `${data.attendance.daysWorked} of ${data.attendance.daysRecorded} recorded`],
          ['Late', `${data.attendance.lateDays} ${data.attendance.lateDays === 1 ? 'day' : 'days'}`],
          ['Absent', `${data.attendance.absent} ${data.attendance.absent === 1 ? 'day' : 'days'}`],
          ['Approved overtime', `${data.attendance.approvedOvertimeHours} h`],
          ['On leave', `${data.attendance.onLeave} ${data.attendance.onLeave === 1 ? 'day' : 'days'}`],
          ['Corrected days', String(data.attendance.corrected)],
          [
            'Claims',
            data.claims.length === 0
              ? 'None'
              : `${data.claims.length} · ${ringgit(data.claims.reduce((sum, claim) => sum + Number(claim.amountClaimed), 0).toFixed(2))} claimed · ${data.claims.filter((claim) => claim.status === 'SUBMITTED').length} awaiting a decision`,
          ],
          ['Leave policy', data.leavePolicy?.name],
        ]}
      />
      <div className="hr-panelNote">Approved unpaid leave reduces pay automatically and shows on that month’s payroll with a link back to the request.</div>
    </>
  );
}

// ── Statutory ───────────────────────────────────────────────────────────────
function StatutoryTab({ data, onEdit }: { data: EmployeeRecord; onEdit?: () => void }) {
  const s = data.statutory;
  const canSeePay = data.payVisible && data.salaryPeriods !== null;
  return (
    <>
      <PanelHead title="Reference numbers" sub="Held so a filing can be prepared. The numbers themselves are never shown back." actions={<EditButton onClick={onEdit} />} />
      <Kv
        pairs={[
          ['EPF / KWSP number', <StatusChip key="epf" tone={s.epfNumberOnFile ? 'done' : 'attn'}>{s.epfNumberOnFile ? 'On file' : 'Missing'}</StatusChip>],
          ['SOCSO / PERKESO number', <StatusChip key="socso" tone={s.socsoNumberOnFile ? 'done' : 'attn'}>{s.socsoNumberOnFile ? 'On file' : 'Missing'}</StatusChip>],
          ['Income tax number', <StatusChip key="tax" tone={s.taxNumberOnFile ? 'done' : 'attn'}>{s.taxNumberOnFile ? 'On file' : 'Missing'}</StatusChip>],
          // The MTD category in force, the one the form below records (new-clinic UAT #2, item 72).
          ['Tax category on file', taxCategoryLabel(s)],
        ]}
      />
      <div data-focus="standing">
        <StatutoryStandingManager data={data} />
      </div>
      {canSeePay ? (
        <div data-focus="epfBasis">
          <EpfBasisPanel staffId={data.staffId} canSeePay={canSeePay} />
        </div>
      ) : null}
      <div data-focus="tax">
        <EmployeeTaxPanel staffId={data.staffId} />
      </div>
    </>
  );
}

// ── Bank ────────────────────────────────────────────────────────────────────
function BankTab({ data, onEdit }: { data: EmployeeRecord; onEdit?: () => void }) {
  return (
    <>
      <PanelHead title="Bank" sub="Where pay goes. The account number is never shown back; it can be replaced." actions={<EditButton onClick={onEdit} />} />
      {data.pay ? (
        <Kv
          pairs={[
            ['Bank', data.pay.bankName],
            ['Account', data.pay.bankAccountOnFile ? <StatusChip key="acct" tone="done">On file</StatusChip> : <StatusChip key="acct" tone="attn">Missing</StatusChip>],
          ]}
        />
      ) : (
        <div className="hr-empty">Bank details need the salary permission, which this account does not have.</div>
      )}
      <div className="hr-panelNote">Payroll pays into this account. A missing account holds up pay for this person alone, never the whole month.</div>
    </>
  );
}

// ── Payslips ────────────────────────────────────────────────────────────────
function PayslipsDrawer({ data, open, onClose }: { data: EmployeeRecord; open: boolean; onClose: () => void }) {
  const rows = data.payrollHistory;
  return (
    <Drawer open={open} onClose={onClose} title="Payslips" sub="One row for each payroll month this employee was in. The payslip PDF is ready once the month reaches its Pay step.">
      <Table<EmployeeRecord['payrollHistory'][number]>
        rowKey="id"
        rows={rows}
        emptyText="This employee has not been through payroll yet."
        columns={[
          { title: 'Month', dataIndex: 'period', width: 130, render: (value: string) => dayjs(value).format('MMM YYYY') },
          {
            title: 'Status',
            key: 'status',
            width: 140,
            render: (_: unknown, row) =>
              row.statutoryStatus !== 'CONFIGURED' ? (
                <StatusChip tone="attn">{humanise(row.runStatus)} · provisional</StatusChip>
              ) : (
                <StatusChip tone={row.runStatus === 'PAID' ? 'done' : 'muted'}>{humanise(row.runStatus)}</StatusChip>
              ),
          },
          { title: 'Gross', dataIndex: 'gross', num: true, width: 110, render: (value: number | null) => (value === null ? '—' : ringgit(value.toFixed(2))) },
          { title: 'Net', dataIndex: 'net', num: true, width: 110, render: (value: number | null) => (value === null ? '—' : <span className="hr-strong">{ringgit(value.toFixed(2))}</span>) },
          {
            title: '',
            key: 'open',
            width: 90,
            render: (_: unknown, row) => (
              <Link className="hr-link" to={`/admin/hr/payroll/${row.runId}?step=review`}>
                Open the month
              </Link>
            ),
          },
        ]}
      />
    </Drawer>
  );
}
