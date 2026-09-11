import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Button, Segmented } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, ringgit } from '../components/DataTable';
import { Panel, DefinitionList, PanelList, PanelRow, EmptyState, PanelLink } from '../components/Panel';
import { PersonAvatar } from '../components/Person';
import { StatusChip, employmentTone, humanise } from '../components/Chip';
import { ReadinessList, ReadinessMeter } from '../components/ReadinessList';
import { useEmployeeRecord } from '../hooks/useAdmin';
import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';
import { EpfBasisPanel } from './EpfBasisPanel';
import { EmployeeTaxPanel } from './EmployeeTaxPanel';
import { StatutoryStandingManager } from './StatutoryStandingManager';
import type { EmployeeRecord } from '../types';

/**
 * THE EMPLOYEE PROFILE — six tabs, because there are six subjects.
 *
 * It had nine: Overview, Employment, Salary, Attendance, Leave, Claims,
 * Payroll, Tax and Documents. Salary, Tax and Payroll are one subject — what
 * this person is paid — split three ways because they are three API reads.
 * Leave and Claims are one subject: what they have asked for. The reference
 * sheet's six are the honest count, and they are what the record is made of:
 *
 *   Overview · Employment · Pay · Attendance · Leave & Claims · Documents
 *
 * NOTHING WAS DROPPED. Every panel that lived on the nine is on the six, and
 * the tab it moved to is the one somebody would have looked in first.
 *
 * IT IS NOT A FOURTEENTH PLACE ANY OF THIS IS STORED. Every tab reads the
 * module that owns its facts; attendance is corrected on the timesheet, leave
 * on the leave record, a claim on the claim.
 */

type TabKey = 'overview' | 'employment' | 'pay' | 'attendance' | 'leaveClaims' | 'documents';

const TABS: { key: TabKey; label: string }[] = [
  // "Overview" is a word for a screen, not for work — the same reason it left
  // the HR rail. The key and the `?tab=overview` links are untouched.
  { key: 'overview', label: 'Summary' },
  { key: 'employment', label: 'Employment' },
  { key: 'pay', label: 'Pay' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leaveClaims', label: 'Leave & Claims' },
  { key: 'documents', label: 'Documents' },
];

// The nine tabs' URLs still work: a payroll exception linking to ?tab=salary
// lands on Pay rather than on a default it did not ask for.
const TAB_ALIASES: Record<string, TabKey> = {
  salary: 'pay',
  tax: 'pay',
  payroll: 'pay',
  leave: 'leaveClaims',
  claims: 'leaveClaims',
};

export function EmployeeWorkspacePage() {
  const { staffId } = useParams<{ staffId: string }>();
  const record = useEmployeeRecord(staffId);
  const [search, setSearch] = useSearchParams();
  const requested = search.get('tab') ?? '';
  const initial = (TABS.find((entry) => entry.key === requested)?.key ?? TAB_ALIASES[requested] ?? 'overview') as TabKey;
  const [tab, setTab] = useState<TabKey>(initial);
  const data = record.data;

  const select = (value: TabKey) => {
    setTab(value);
    // The tab is in the URL, so a link to somebody's pay history is a link.
    const next = new URLSearchParams(search);
    next.set('tab', value);
    setSearch(next, { replace: true });
  };

  return (
    <AdminShell
      error={firstError(record)}
      title={data?.identity.fullName ?? 'Employee'}
      subtitle={
        data
          ? [data.employment.position, data.employment.department].filter(Boolean).join(' · ') || undefined
          : undefined
      }
      actions={
        <Link to="/admin/hr/employees">
          <Button size="small">← All people</Button>
        </Link>
      }
    >
      {data ? (
        <>
          <EmployeeHeader data={data} />

          <Segmented
            className="kw-workAreaTabs"
            value={tab}
            onChange={(value) => select(value as TabKey)}
            options={TABS.map((entry) => ({ label: entry.label, value: entry.key }))}
          />

          {tab === 'overview' ? <OverviewTab data={data} onOpen={select} /> : null}
          {tab === 'employment' ? <EmploymentTab data={data} /> : null}
          {tab === 'pay' ? <PayTab data={data} staffId={staffId!} /> : null}
          {tab === 'attendance' ? <AttendanceTab data={data} /> : null}
          {tab === 'leaveClaims' ? <LeaveClaimsTab data={data} /> : null}
          {tab === 'documents' ? <DocumentsTab data={data} /> : null}
        </>
      ) : null}
    </AdminShell>
  );
}

/**
 * WHO EMPLOYS THEM IS NOT WHERE THEY WORK.
 *
 * A group with two companies files EPF under one of them and rosters the
 * person at a branch of the other. The header states both, labelled, because
 * getting them the wrong way round means filing for somebody under a company
 * that does not employ them.
 *
 * THE SCORE CARRIES ITS MEANING. It used to read "5 of 8" and stop, which
 * tells somebody they have a problem and nothing about what it is. It now says
 * what is outstanding beside the bar.
 */
function EmployeeHeader({ data }: { data: EmployeeRecord }) {
  const readiness = data.payrollReadiness;
  const outstanding = readiness?.items.filter((item) => !item.done) ?? [];
  return (
    <div className="kw-employeeHead">
      <PersonAvatar name={data.identity.fullName} size={52} />
      <div className="kw-employeeHead__body">
        <div className="kw-employeeHead__nameRow">
          <span className="kw-employeeHead__name">{data.identity.fullName}</span>
          <StatusChip tone={employmentTone(data.employment.employmentStatus)} dot>
            {humanise(data.employment.employmentStatus)}
          </StatusChip>
          {data.engagement === 'CONTRACTOR' ? (
            <StatusChip tone="info">Contractor — not on payroll</StatusChip>
          ) : null}
        </div>
        <div className="kw-employeeHead__facts">
          <Fact label="WORKS AT" value={data.employment.clinicName ?? 'All branches'} />
          <Fact label="EMPLOYED BY" value={data.employment.legalEmployerName ?? 'Not set'} />
          <Fact
            label="STARTED"
            value={data.employment.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : '—'}
          />
          <Fact label="EMPLOYEE NO" value={data.employment.employeeNo ?? '—'} />
        </div>
      </div>
      {readiness ? (
        <div className="kw-employeeHead__readiness">
          <span className="kw-employeeHead__readinessLabel">PAYROLL READINESS</span>
          <ReadinessMeter done={readiness.done} total={readiness.total} ready={readiness.ready} />
          <span className="kw-employeeHead__readinessNote">
            {outstanding.length === 0
              ? 'Nothing outstanding'
              : outstanding.length === 1
                ? outstanding[0].label
                : `${outstanding[0].label} + ${outstanding.length - 1} more`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="kw-employeeHead__fact">
      <span className="kw-employeeHead__factLabel">{label}</span>
      <span className="kw-employeeHead__factValue">{value}</span>
    </div>
  );
}

/**
 * OVERVIEW — the five panels the reference sheet asks for: Personal
 * Information, Employment, Payroll Readiness, Salary Information and Recent
 * Activity.
 *
 * The old Overview was a readiness checklist and four counters. It answered
 * "can this person be paid" and nothing else, so anybody opening a colleague's
 * record to find a phone number went straight past it into Employment.
 */
function OverviewTab({ data, onOpen }: { data: EmployeeRecord; onOpen: (tab: TabKey) => void }) {
  const activity = useRecentActivity(data);
  const current = data.salaryPeriods?.find((period) => period.current);
  const upcoming = data.salaryPeriods?.find((period) => period.upcoming);

  return (
    <div className="kw-hrGrid">
      <Panel title="Personal information" action={<button className="kw-panel__link" onClick={() => onOpen('employment')} type="button">Edit →</button>}>
        <DefinitionList
          items={[
            { label: 'Full name', value: data.identity.fullName },
            { label: 'Legal name', value: data.identity.legalName },
            {
              label: 'Date of birth',
              value: data.identity.dateOfBirth ? dayjs(data.identity.dateOfBirth).format('D MMM YYYY') : null,
            },
            { label: 'Gender', value: humanise(data.identity.gender) },
            { label: 'Nationality', value: data.identity.nationality },
            { label: 'Marital status', value: humanise(data.identity.maritalStatus) },
            { label: 'Phone', value: data.identity.phone },
            { label: 'Email', value: data.identity.email },
            { label: 'Address', value: data.identity.address, span: true },
            {
              label: 'Emergency contact',
              value: data.identity.emergencyContactName
                ? `${data.identity.emergencyContactName}${
                    data.identity.emergencyContactRelation ? ` (${data.identity.emergencyContactRelation})` : ''
                  }${data.identity.emergencyContactPhone ? ` · ${data.identity.emergencyContactPhone}` : ''}`
                : null,
              span: true,
            },
          ]}
        />
      </Panel>

      <Panel title="Employment">
        <DefinitionList
          items={[
            { label: 'Position', value: data.employment.position },
            { label: 'Department', value: data.employment.department },
            { label: 'Type', value: humanise(data.employment.employmentType) },
            { label: 'Status', value: humanise(data.employment.employmentStatus) },
            { label: 'Manager', value: data.employment.manager },
            { label: 'Branch', value: data.employment.clinicName },
            {
              label: 'Started',
              value: data.employment.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : null,
            },
            {
              label: 'Confirmed',
              value: data.employment.confirmedDate ? dayjs(data.employment.confirmedDate).format('D MMM YYYY') : null,
            },
            { label: 'Employed by', value: data.employment.legalEmployerName },
            { label: 'Leave policy', value: data.leavePolicy?.name },
          ]}
        />
      </Panel>

      <Panel
        title="Payroll readiness"
        tone={data.payrollReadiness?.ready === false ? 'attention' : undefined}
        hint={
          data.payrollReadiness
            ? undefined
            : 'A contractor is paid professional fees rather than a salary, so payroll readiness does not apply.'
        }
      >
        {data.payrollReadiness ? (
          <ReadinessList items={data.payrollReadiness.items} />
        ) : (
          <EmptyState
            title="Engaged as a contractor"
            hint="Their sessions are paid as professional fees."
            action={<Link to="/admin/hr/locum">Open locum sessions →</Link>}
          />
        )}
      </Panel>

      <Panel
        title="Salary information"
        action={<button className="kw-panel__link" onClick={() => onOpen('pay')} type="button">Pay history →</button>}
      >
        {!data.payVisible || data.salaryPeriods === null ? (
          <EmptyState
            title="Pay is not visible to you"
            hint="This is a different statement from “no salary is recorded”."
          />
        ) : (
          <>
            <DefinitionList
              items={[
                { label: 'Basic salary', value: current ? <strong>{ringgit(current.amount)}</strong> : null },
                { label: 'Basis', value: current ? humanise(current.basis) : null },
                {
                  label: 'In force since',
                  value: current ? dayjs(current.from).format('D MMM YYYY') : null,
                },
                { label: 'Bank', value: data.pay?.bankAccountOnFile ? (data.pay.bankName ?? 'On file') : null },
              ]}
            />
            {upcoming ? (
              <p className="kw-panelNote">
                A change to <strong>{ringgit(upcoming.amount)}</strong> takes effect{' '}
                {dayjs(upcoming.from).format('D MMMM YYYY')}.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel title="Recent activity" action={<PanelLink to="/admin/hr/reports">Reports</PanelLink>}>
        {activity.length === 0 ? (
          <EmptyState title="Nothing recorded yet" />
        ) : (
          <PanelList>
            {activity.map((row) => (
              <PanelRow
                key={row.key}
                title={row.title}
                meta={row.meta}
                right={<span className="kw-muted">{dayjs(row.at).format('D MMM')}</span>}
              />
            ))}
          </PanelList>
        )}
      </Panel>
    </div>
  );
}

/**
 * RECENT ACTIVITY, assembled from the facts already on the record.
 *
 * There is no activity log for an employee and this does not invent one: every
 * row here is a dated thing that happened to this person and is already stored
 * — a salary that took effect, a claim that was decided, a month they were
 * paid, a day that was corrected. Ordered newest first and capped at six,
 * because a feed longer than a panel is a table.
 */
function useRecentActivity(data: EmployeeRecord) {
  return useMemo(() => {
    const rows: { key: string; at: string; title: string; meta?: string }[] = [];

    for (const period of data.salaryPeriods ?? []) {
      rows.push({
        key: `salary-${period.id}`,
        at: period.from,
        title: period.upcoming ? `Salary change to ${ringgit(period.amount)} recorded` : `Salary set to ${ringgit(period.amount)}`,
        meta: period.reason ?? undefined,
      });
    }
    for (const claim of data.claims.slice(0, 6)) {
      rows.push({
        key: `claim-${claim.id}`,
        at: claim.claimDate,
        title: `${humanise(claim.category)} claim ${claim.status.toLowerCase()}`,
        meta: `${ringgit(claim.amountClaimed)}${claim.decidedBy ? ` · ${claim.decidedBy}` : ''}`,
      });
    }
    for (const run of data.payrollHistory.slice(0, 4)) {
      if (run.runStatus !== 'APPROVED' && run.runStatus !== 'PAID') continue;
      rows.push({
        key: `pay-${run.id}`,
        at: run.period,
        title: `Paid for ${dayjs(run.period).format('MMMM YYYY')}`,
        meta: run.net === null ? undefined : ringgit(run.net.toFixed(2)),
      });
    }

    return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  }, [data]);
}

function EmploymentTab({ data }: { data: EmployeeRecord }) {
  return (
    <>
      <AdminSection title="Employment terms">
        <DefinitionList
          columns={3}
          items={[
            { label: 'Position', value: data.employment.position },
            { label: 'Department', value: data.employment.department },
            { label: 'Type', value: humanise(data.employment.employmentType) },
            { label: 'Engagement', value: data.engagement === 'CONTRACTOR' ? 'Contractor' : 'Employee' },
            { label: 'Manager', value: data.employment.manager },
            { label: 'Leave policy', value: data.leavePolicy?.name },
            {
              label: 'Started',
              value: data.employment.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : null,
            },
            {
              label: 'Confirmed',
              value: data.employment.confirmedDate ? dayjs(data.employment.confirmedDate).format('D MMM YYYY') : null,
            },
            {
              label: 'Ended',
              value: data.employment.endDate
                ? `${dayjs(data.employment.endDate).format('D MMM YYYY')}${
                    data.employment.endReason ? ` · ${data.employment.endReason}` : ''
                  }`
                : null,
            },
            { label: 'Notes', value: data.employment.notes, span: true },
          ]}
        />
      </AdminSection>

      <AdminSection
        title="Statutory reference numbers"
        description="Held so a filing can be prepared. The numbers themselves are never shown back."
      >
        <DefinitionList
          columns={3}
          items={[
            {
              label: 'EPF / KWSP',
              value: <StatusChip tone={data.statutory.epfNumberOnFile ? 'ok' : 'attention'} dot>{data.statutory.epfNumberOnFile ? 'On file' : 'Missing'}</StatusChip>,
            },
            {
              label: 'SOCSO / PERKESO',
              value: <StatusChip tone={data.statutory.socsoNumberOnFile ? 'ok' : 'attention'} dot>{data.statutory.socsoNumberOnFile ? 'On file' : 'Missing'}</StatusChip>,
            },
            {
              label: 'Income tax number',
              value: <StatusChip tone={data.statutory.taxNumberOnFile ? 'ok' : 'attention'} dot>{data.statutory.taxNumberOnFile ? 'On file' : 'Missing'}</StatusChip>,
            },
          ]}
        />
      </AdminSection>

      <StatutoryStandingManager data={data} />
    </>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * The standing's stored codes, in the words the editor uses. A screen that
 * prints MALAYSIAN_CITIZEN is talking to a developer; the reader is a clinic
 * manager, and the same value must read the same on the form and the record.
 */
const STANDING_LABELS: Record<string, string> = {
  MALAYSIAN_CITIZEN: 'Malaysian citizen',
  PERMANENT_RESIDENT: 'Permanent resident',
  NON_CITIZEN_ELECTED_PRE_1998: 'Non-citizen, elected before 1 Aug 1998',
  NON_CITIZEN: 'Non-citizen',
  NOT_PARTICIPATING: 'Not participating',
  VOLUNTARY_OPTED_IN: 'Joined voluntarily',
  MANDATORY_FOREIGN_WORKER: 'Mandatory — foreign worker',
  RESIDENT: 'Resident',
  NON_RESIDENT: 'Non-resident',
  CATEGORY_1: 'Category 1 — single',
  CATEGORY_2: 'Category 2 — married, spouse not working',
  CATEGORY_3: 'Category 3 — married, spouse working',
};

/**
 * STATUTORY STANDING — a record with a date on it, shown as one.
 *
 * These were columns on the employee form, so editing one changed what every
 * unapproved period computed. They are versions now, and this says WHICH
 * version this month resolves to: an unknown that is displayed as "Not
 * recorded" is a payroll that will block, and it is better read here than
 * discovered on run day.
 */
export function StatutoryStandingSection({ data, actions }: { data: EmployeeRecord; actions?: ReactNode }) {
  const s = data.statutory;
  const resolved = s.classificationState === 'RESOLVED';
  const since = s.classificationEffectiveFrom ? dayjs(s.classificationEffectiveFrom).format('D MMM YYYY') : null;
  // An unresolved standing has no values to show — showing the fallbacks as
  // though they were answers is exactly the overstatement dating this removed.
  const value = (v: string | null | undefined) => (resolved && v ? (STANDING_LABELS[v] ?? v) : 'Not recorded');

  return (
    <AdminSection
      title="Statutory standing"
      actions={actions}
      description={
        resolved && since
          ? `In force since ${since}. Changing any of it opens a new dated version, so an earlier month keeps what was true then.`
          : 'Recorded from the date it takes effect, so an earlier month keeps what was true then.'
      }
    >
      {resolved ? null : (
        <p className="kw-muted" style={{ marginTop: 0, marginBottom: 12, fontSize: 12 }}>
          {s.classificationNote}
        </p>
      )}
      <div className="kw-factGrid">
        <Fact label="EPF THIRD SCHEDULE PART" value={value(s.epfMembership)} />
        <Fact label="LINDUNG 24 JAM" value={value(s.lindungParticipation)} />
        <Fact label="TAX RESIDENCE" value={value(s.taxResidence)} />
        <Fact label="MTD CATEGORY" value={value(s.pcbCategory)} />
        <Fact
          label="REST DAY"
          value={resolved && s.restDayOfWeek !== null ? DAY_NAMES[s.restDayOfWeek] : 'Not recorded'}
        />
        <Fact label="QUALIFYING CHILDREN" value={resolved ? String(s.qualifyingChildren) : 'Not recorded'} />
      </div>
    </AdminSection>
  );
}

/**
 * PAY — one subject, one tab.
 *
 * Salary, EPF basis, monthly-tax reliefs and payroll history were four tabs
 * because they are four API reads. To the reader they are one question: what
 * is this person paid, on what basis, and what have they actually received.
 */
function PayTab({ data, staffId }: { data: EmployeeRecord; staffId: string }) {
  if (!data.payVisible || data.salaryPeriods === null) {
    return (
      <AdminNotice tone="info">
        You do not have permission to see pay. That is a different statement from "no salary is recorded", and Kuwick will not imply the other.
      </AdminNotice>
    );
  }

  const upcoming = data.salaryPeriods.find((period) => period.upcoming);

  return (
    <>
      {upcoming ? (
        <AdminNotice tone="info">
          A change to <strong>{ringgit(upcoming.amount)}</strong> is already recorded, taking effect on{' '}
          {dayjs(upcoming.from).format('D MMMM YYYY')}. Payroll will use it from that period and not before.
        </AdminNotice>
      ) : null}

      <EmployeeSalaryPanel staffId={staffId} canSeePay={data.payVisible} />
      {/* THE EPF BASIS LIVES BESIDE THE SALARY IT PRICES: what the employee is
          paid, then which of it the employer contributes EPF on. */}
      <EpfBasisPanel staffId={staffId} canSeePay={data.payVisible} />
      <EmployeeTaxPanel staffId={staffId} />

      <AdminSection title="Payroll history" description="One row per payroll run this employee was on." padded={false}>
        <DataTable
          rowKey="id"
          rows={data.payrollHistory}
          emptyText="This employee has not been on a payroll run."
          columns={[
            {
              title: 'Period',
              dataIndex: 'period',
              width: 150,
              render: (value: string) => dayjs(value).format('MMMM YYYY'),
            },
            {
              title: 'Status',
              width: 170,
              render: (_: unknown, row: EmployeeRecord['payrollHistory'][number]) =>
                row.statutoryStatus !== 'CONFIGURED' ? (
                  <StatusChip tone="attention" dot>
                    {humanise(row.runStatus)} · provisional
                  </StatusChip>
                ) : (
                  <StatusChip tone={row.runStatus === 'PAID' ? 'ok' : 'neutral'} dot>
                    {humanise(row.runStatus)}
                  </StatusChip>
                ),
            },
            {
              title: 'Earnings',
              dataIndex: 'gross',
              width: 130,
              align: 'right' as const,
              // toFixed(2), because the API sends a NUMBER here and
              // String(3200.5) is "3200.5" — which printed take-homes with one
              // decimal for any amount ending in a whole ten sen.
              render: (value: number | null) => (value === null ? '—' : ringgit(value.toFixed(2))),
            },
            {
              title: 'Take-home',
              dataIndex: 'net',
              width: 130,
              align: 'right' as const,
              render: (value: number | null) => (value === null ? '—' : <strong>{ringgit(value.toFixed(2))}</strong>),
            },
            {
              title: '',
              width: 110,
              noExport: true,
              render: (_: unknown, row: EmployeeRecord['payrollHistory'][number]) => (
                <Link to={`/admin/hr/payroll/${row.runId}?step=review`}>
                  <Button size="small">Open run</Button>
                </Link>
              ),
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

function AttendanceTab({ data }: { data: EmployeeRecord }) {
  return (
    <AdminSection
      title={`Attendance — ${data.year}`}
      description="From the timesheet. Corrections are made there; payroll never holds a second copy of somebody's hours."
      actions={
        <Link to={`/admin/hr/attendance?staffId=${data.staffId}`}>
          <Button size="small">Open timesheet</Button>
        </Link>
      }
      padded={false}
    >
      <div className="kw-adminSection__body">
        <div className="kw-factGrid">
          <Fact label="DAYS RECORDED" value={String(data.attendance.daysRecorded)} />
          <Fact label="DAYS WORKED" value={String(data.attendance.daysWorked)} />
          <Fact label="ABSENT" value={String(data.attendance.absent)} />
          <Fact label="LATE" value={String(data.attendance.lateDays)} />
          <Fact label="APPROVED OVERTIME" value={`${data.attendance.approvedOvertimeHours} hrs`} />
          <Fact label="CORRECTED" value={String(data.attendance.corrected)} />
        </div>
      </div>
      <DataTable
        rowKey="id"
        rows={data.attendance.recent}
        emptyText="No attendance recorded this year."
        columns={[
          {
            title: 'Date',
            dataIndex: 'workDate',
            width: 130,
            render: (value: string) => dayjs(value).format('ddd D MMM'),
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            render: (value: string) => (
              <StatusChip tone={value === 'PRESENT' ? 'ok' : value === 'ABSENT' ? 'blocked' : 'neutral'} dot>
                {humanise(value)}
              </StatusChip>
            ),
          },
          {
            title: 'Worked',
            dataIndex: 'workedMinutes',
            width: 110,
            align: 'right' as const,
            render: (value: number | null) => (value === null ? '—' : `${(value / 60).toFixed(1)} hrs`),
          },
          {
            title: 'Overtime',
            width: 180,
            render: (_: unknown, row: EmployeeRecord['attendance']['recent'][number]) =>
              row.overtimeMinutes > 0 ? (
                <StatusChip tone={row.overtimeApproved ? 'ok' : 'attention'} dot>
                  {(row.overtimeMinutes / 60).toFixed(1)} hrs {row.overtimeApproved ? 'approved' : 'not approved'}
                </StatusChip>
              ) : (
                <span className="kw-muted">—</span>
              ),
          },
        ]}
      />
    </AdminSection>
  );
}

/**
 * LEAVE & CLAIMS — one subject: what this person has asked the clinic for.
 */
function LeaveClaimsTab({ data }: { data: EmployeeRecord }) {
  return (
    <>
      <AdminSection
        title="Leave"
        description="Entitlement comes from the leave policy this employee is on. Requests and approvals live on the leave screen."
        actions={
          <Link to="/admin/hr/leave">
            <Button size="small">Open leave</Button>
          </Link>
        }
      >
        <div className="kw-factGrid">
          <Fact label="LEAVE POLICY" value={data.leavePolicy?.name ?? 'Not assigned'} />
          <Fact label="ON LEAVE THIS YEAR" value={`${data.attendance.onLeave} day(s)`} />
        </div>
        <p className="kw-muted" style={{ marginTop: 14, marginBottom: 0, fontSize: 12 }}>
          Approved unpaid leave reduces pay automatically and shows on the payroll run with a link back to the request.
        </p>
      </AdminSection>

      <AdminSection
        title="Claims"
        description="Every approved claim is paid once, by one route."
        actions={
          <Link to={`/admin/hr/claims?staffId=${data.staffId}`}>
            <Button size="small">Open claims</Button>
          </Link>
        }
        padded={false}
      >
        <DataTable
          rowKey="id"
          rows={data.claims}
          emptyText="No claims from this employee."
          columns={[
            {
              title: 'Date',
              dataIndex: 'claimDate',
              width: 120,
              render: (value: string) => dayjs(value).format('D MMM YYYY'),
            },
            { title: 'Category', dataIndex: 'category', width: 140, render: (value: string) => humanise(value) },
            { title: 'What for', dataIndex: 'description' },
            {
              title: 'Claimed',
              dataIndex: 'amountClaimed',
              width: 120,
              align: 'right' as const,
              render: (value: string) => ringgit(value),
            },
            {
              title: 'Approved',
              dataIndex: 'amountApproved',
              width: 120,
              align: 'right' as const,
              render: (value: string | null) =>
                value ? <strong>{ringgit(value)}</strong> : <span className="kw-muted">—</span>,
            },
            {
              title: 'Paid from',
              width: 190,
              render: (_: unknown, row: EmployeeRecord['claims'][number]) =>
                row.status !== 'APPROVED' ? (
                  <StatusChip tone={row.status === 'SUBMITTED' ? 'attention' : 'neutral'} dot>
                    {row.status === 'SUBMITTED' ? 'Awaiting a decision' : humanise(row.status)}
                  </StatusChip>
                ) : row.paymentRoute === 'PAYROLL' ? (
                  <StatusChip tone="info" dot>
                    With salary
                  </StatusChip>
                ) : (
                  <StatusChip tone={row.payoutStatus === 'PAID' ? 'ok' : 'attention'} dot>
                    Finance{row.payoutStatus === 'PAID' ? '' : ', not yet paid'}
                  </StatusChip>
                ),
            },
          ]}
        />
      </AdminSection>
    </>
  );
}

/**
 * DOCUMENTS — honest about a capability that does not exist.
 *
 * Kuwick stores no employee document files: there is no column and no file
 * store behind this tab. An empty list would read as "nothing uploaded", which
 * is a different claim and a false one. What IS on record is which identity
 * and statutory documents have been sighted well enough to record a number
 * from, so the tab shows that and says plainly where the line is.
 */
function DocumentsTab({ data }: { data: EmployeeRecord }) {
  const onRecord = [
    { label: 'IC or passport', present: Boolean(data.identity.dateOfBirth), detail: 'Date of birth recorded' },
    { label: 'EPF / KWSP number', present: data.statutory.epfNumberOnFile, detail: 'Needed for the EPF return' },
    { label: 'SOCSO / PERKESO number', present: data.statutory.socsoNumberOnFile, detail: 'Needed for the SOCSO return' },
    { label: 'Income tax number', present: data.statutory.taxNumberOnFile, detail: 'Needed for the monthly-tax return' },
    { label: 'Bank account', present: Boolean(data.pay?.bankAccountOnFile), detail: 'Needed before anybody can be paid' },
  ];

  return (
    <>
      <AdminNotice tone="warn">
        <strong>Document files are not stored in Kuwick.</strong> {data.documents.note} What is listed below is which
        documents have been sighted well enough to record a number from — not copies of them.
      </AdminNotice>

      <AdminSection title="On record">
        <ul className="kw-readiness">
          {onRecord.map((row) => (
            <li
              key={row.label}
              className={`kw-readinessItem kw-readinessItem--${row.present ? 'done' : 'advisory'}`}
            >
              <span className="kw-readinessItem__mark" aria-hidden>
                {row.present ? '✓' : '!'}
              </span>
              <span className="kw-readinessItem__text">
                <span className="kw-readinessItem__label">{row.label}</span>
                <span className="kw-readinessItem__detail">{row.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </AdminSection>
    </>
  );
}
