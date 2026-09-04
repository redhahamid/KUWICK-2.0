import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button, Segmented, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, ringgit } from '../components/DataTable';
import { useEmployeeRecord } from '../hooks/useAdmin';
import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';
import { EmployeeTaxPanel } from './EmployeeTaxPanel';
import type { EmployeeRecord } from '../types';

type TabKey = 'overview' | 'employment' | 'salary' | 'attendance' | 'leave' | 'claims' | 'payroll' | 'tax' | 'documents';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'employment', label: 'Employment' },
  { key: 'salary', label: 'Salary' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'leave', label: 'Leave' },
  { key: 'claims', label: 'Claims' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'tax', label: 'Tax (TP1/TP3)' },
  { key: 'documents', label: 'Documents' },
];

/**
 * THE EMPLOYEE WORKSPACE.
 *
 * The owner's finding was that an employee had nowhere to live: employment
 * terms, pay, statutory identifiers, attendance, leave, claims and payroll
 * history were spread across five screens, and the one place that gathered them
 * was a drawer you could not link to or leave open.
 *
 * TWO THINGS THIS DELIBERATELY IS NOT.
 *
 * It is not a database inspector. Salary is shown as PERIODS somebody worked
 * under — "5 Mar 2026 to 30 Sep 2026, RM3,200 a month" — rather than as
 * effective-dated rows, because the first is a fact about their employment and
 * the second is a fact about a table.
 *
 * It is not a fourteenth place any of this is stored. Every tab reads the
 * module that owns its facts; attendance is corrected on the timesheet, leave
 * on the leave record, a claim on the claim.
 */
export function EmployeeWorkspacePage() {
  const { staffId } = useParams<{ staffId: string }>();
  const record = useEmployeeRecord(staffId);
  const [tab, setTab] = useState<TabKey>('overview');
  const data = record.data;

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
          <Button size="small">All employees</Button>
        </Link>
      }
    >
      {data ? (
        <>
          <EmployeeHeader data={data} />

          <Segmented
            block
            value={tab}
            onChange={(value) => setTab(value as TabKey)}
            options={TABS.map((entry) => ({ label: entry.label, value: entry.key }))}
            style={{ marginBottom: 16 }}
          />

          {tab === 'overview' ? <OverviewTab data={data} /> : null}
          {tab === 'employment' ? <EmploymentTab data={data} /> : null}
          {tab === 'salary' ? <SalaryTab data={data} staffId={staffId!} /> : null}
          {tab === 'attendance' ? <AttendanceTab data={data} /> : null}
          {tab === 'leave' ? <LeaveTab data={data} /> : null}
          {tab === 'claims' ? <ClaimsTab data={data} /> : null}
          {tab === 'payroll' ? <PayrollTab data={data} /> : null}
          {tab === 'tax' ? (
            data.payVisible ? (
              <EmployeeTaxPanel staffId={staffId!} />
            ) : (
              <AdminNotice tone="info">
                Tax records ride with pay visibility. You do not have permission to see pay.
              </AdminNotice>
            )
          ) : null}
          {tab === 'documents' ? <DocumentsTab data={data} /> : null}
        </>
      ) : null}
    </AdminShell>
  );
}

/**
 * WHO EMPLOYS THEM IS NOT WHERE THEY WORK.
 *
 * A group with two companies files EPF under one of them and rosters the person
 * at a branch of the other. The header states both, labelled, because getting
 * them the wrong way round means filing for somebody under a company that does
 * not employ them.
 */
function EmployeeHeader({ data }: { data: EmployeeRecord }) {
  return (
    <div className="kw-employeeHead">
      <div className="kw-employeeHead__avatar">
        {data.identity.fullName
          .split(/\s+/)
          .filter((part) => !/^(dr|mr|mrs|ms|puan|encik)$/i.test(part))
          .slice(0, 2)
          .map((part) => part[0]?.toUpperCase() ?? '')
          .join('')}
      </div>
      <div className="kw-employeeHead__body">
        <div className="kw-employeeHead__nameRow">
          <span className="kw-employeeHead__name">{data.identity.fullName}</span>
          <Tag color={data.employment.employmentStatus === 'ACTIVE' ? 'success' : 'warning'}>
            {data.employment.employmentStatus}
          </Tag>
          {data.engagement === 'CONTRACTOR' ? (
            <Tag color="processing">Contractor — not on payroll</Tag>
          ) : null}
        </div>
        <div className="kw-employeeHead__facts">
          <Fact label="WORKS AT" value={data.employment.clinicName ?? '—'} />
          <Fact label="EMPLOYED BY" value={data.employment.legalEmployerName ?? 'Not set'} />
          <Fact label="STARTED" value={data.employment.startDate ? dayjs(data.employment.startDate).format('D MMM YYYY') : '—'} />
          <Fact label="EMPLOYEE NO" value={data.employment.employeeNo ?? '—'} />
        </div>
      </div>
      {data.payrollReadiness ? (
        <div className="kw-employeeHead__readiness">
          <span className="kw-employeeHead__readinessLabel">PAYROLL SETUP</span>
          <span
            className={`kw-employeeHead__readinessValue${
              data.payrollReadiness.done === data.payrollReadiness.total ? '' : ' kw-employeeHead__readinessValue--warn'
            }`}
          >
            {data.payrollReadiness.done} of {data.payrollReadiness.total}
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

function OverviewTab({ data }: { data: EmployeeRecord }) {
  return (
    <>
      {data.payrollReadiness ? (
        <AdminSection
          title={`Payroll setup — ${data.payrollReadiness.done} of ${data.payrollReadiness.total} complete`}
          description="What payroll needs from this person before they can be paid. Each item says what is missing, not just that something is."
        >
          <div className="kw-setupList">
            {data.payrollReadiness.items.map((item) => (
              <div key={item.key} className="kw-setupList__row">
                <span className={`kw-setupList__mark kw-setupList__mark--${item.done ? 'done' : 'todo'}`}>
                  {item.done ? '✓' : '!'}
                </span>
                <div className="kw-setupList__body">
                  <div className="kw-setupList__title">
                    {item.label}
                    {/* BLOCKING mirrors the run's own refusals; an advisory item
                        is real work that does not stop this person being paid. */}
                    {!item.done ? (
                      <span className={`kw-sev kw-sev--${item.severity === 'BLOCKING' ? 'blocking' : 'warning'}`}>
                        {item.severity === 'BLOCKING' ? 'Blocks payroll' : 'Advisory'}
                      </span>
                    ) : null}
                  </div>
                  <div className="kw-setupList__detail">{item.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </AdminSection>
      ) : (
        <AdminNotice tone="info">
          This person is engaged as a <strong>contractor</strong>, so they are not on payroll and payroll readiness does
          not apply to them. Their sessions are paid as professional fees.{' '}
          <Link to="/admin/hr/locum">Open locum sessions</Link>
        </AdminNotice>
      )}

      <AdminSection title="This month">
        <div className="kw-factGrid">
          <Fact label="DAYS WORKED" value={String(data.attendance.daysWorked)} />
          <Fact label="APPROVED OVERTIME" value={`${data.attendance.approvedOvertimeHours} hrs`} />
          <Fact label="LATE DAYS" value={String(data.attendance.lateDays)} />
          <Fact
            label="LAST PAID"
            value={
              data.payrollHistory[0]?.net !== null && data.payrollHistory[0]
                ? `${ringgit(String(data.payrollHistory[0].net))} · ${dayjs(data.payrollHistory[0].period).format('MMM YYYY')}`
                : '—'
            }
          />
        </div>
      </AdminSection>
    </>
  );
}

function EmploymentTab({ data }: { data: EmployeeRecord }) {
  return (
    <>
      <AdminSection title="Employment">
        <div className="kw-factGrid">
          <Fact label="POSITION" value={data.employment.position ?? '—'} />
          <Fact label="DEPARTMENT" value={data.employment.department ?? '—'} />
          <Fact label="TYPE" value={data.employment.employmentType} />
          <Fact label="ENGAGEMENT" value={data.engagement === 'CONTRACTOR' ? 'Contractor' : 'Employee'} />
          <Fact label="MANAGER" value={data.employment.manager ?? '—'} />
          <Fact label="CONFIRMED" value={data.employment.confirmedDate ? dayjs(data.employment.confirmedDate).format('D MMM YYYY') : '—'} />
        </div>
      </AdminSection>

      <AdminSection title="Person">
        <div className="kw-factGrid">
          <Fact label="DATE OF BIRTH" value={data.identity.dateOfBirth ? dayjs(data.identity.dateOfBirth).format('D MMM YYYY') : 'Not recorded'} />
          <Fact label="PHONE" value={data.identity.phone ?? '—'} />
          <Fact label="EMAIL" value={data.identity.email ?? '—'} />
          <Fact label="LEAVE POLICY" value={data.leavePolicy?.name ?? '—'} />
        </div>
      </AdminSection>

      <AdminSection
        title="Statutory numbers"
        description="Held so a filing can be prepared. Only people with the payroll permission can see whether they are on file, and nobody sees the numbers here."
      >
        <div className="kw-factGrid">
          <Fact label="EPF / KWSP" value={data.statutory.epfNumberOnFile ? 'On file' : 'Missing'} />
          <Fact label="SOCSO / PERKESO" value={data.statutory.socsoNumberOnFile ? 'On file' : 'Missing'} />
          <Fact label="INCOME TAX NUMBER" value={data.statutory.taxNumberOnFile ? 'On file' : 'Missing'} />
        </div>
        <p className="kw-muted" style={{ marginTop: 12, marginBottom: 0, fontSize: 12 }}>
          {data.statutory.note}
        </p>
      </AdminSection>

      <StatutoryStandingSection data={data} />
    </>
  );
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * STATUTORY STANDING — a record with a date on it, shown as one.
 *
 * These were columns on the employee form, so editing one changed what every
 * unapproved period computed. They are versions now, and this says WHICH
 * version this month resolves to: an unknown that is displayed as "Not
 * recorded" is a payroll that will block, and it is better read here than
 * discovered on run day.
 */
export function StatutoryStandingSection({ data }: { data: EmployeeRecord }) {
  const s = data.statutory;
  const resolved = s.classificationState === 'RESOLVED';
  const since = s.classificationEffectiveFrom ? dayjs(s.classificationEffectiveFrom).format('D MMM YYYY') : null;
  // An unresolved standing has no values to show — showing the fallbacks as
  // though they were answers is exactly the overstatement dating this removed.
  const value = (v: string | null | undefined) => (resolved && v ? v : 'Not recorded');

  return (
    <AdminSection
      title="Statutory standing"
      description={
        resolved && since
          ? `What applies to this employee, in force since ${since}. Changing any of it is a new dated version, so an earlier month keeps what was true then.`
          : 'What applies to this employee. Recorded from the date it takes effect, so an earlier month keeps what was true then.'
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
 * SALARY AS PERIODS.
 *
 * "5 Mar 2026 → 30 Sep 2026 · RM3,200 a month" is a fact about somebody's
 * employment. "effective_from / effective_to" is a fact about a table, and the
 * owner rejected a product that made them read the second to learn the first.
 */
function SalaryTab({ data, staffId }: { data: EmployeeRecord; staffId: string }) {
  if (!data.payVisible || data.salaryPeriods === null) {
    return (
      <AdminNotice tone="info">
        You do not have permission to see pay. This is a different statement from "no salary is recorded" — Kuwick will
        not show you one and will not imply the other.
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

      {/*
        ONE SALARY SURFACE, not two. This page briefly carried its own history
        table above the panel, which showed the same periods twice — and two
        renderings of one fact are two things to keep in step. The panel already
        presents salary as periods somebody worked under, with the reason and
        the person who recorded each, and it owns the action that adds one.
      */}
      <EmployeeSalaryPanel staffId={staffId} canSeePay={data.payVisible} />
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
    >
      <div className="kw-factGrid" style={{ marginBottom: 16 }}>
        <Fact label="DAYS RECORDED" value={String(data.attendance.daysRecorded)} />
        <Fact label="DAYS WORKED" value={String(data.attendance.daysWorked)} />
        <Fact label="ABSENT" value={String(data.attendance.absent)} />
        <Fact label="LATE" value={String(data.attendance.lateDays)} />
        <Fact label="APPROVED OVERTIME" value={`${data.attendance.approvedOvertimeHours} hrs`} />
        <Fact label="CORRECTED" value={String(data.attendance.corrected)} />
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
          { title: 'Status', dataIndex: 'status', width: 120 },
          {
            title: 'Worked',
            dataIndex: 'workedMinutes',
            width: 110,
            align: 'right' as const,
            render: (value: number | null) => (value === null ? '—' : `${(value / 60).toFixed(1)} hrs`),
          },
          {
            title: 'Overtime',
            width: 160,
            render: (_: unknown, row: EmployeeRecord['attendance']['recent'][number]) =>
              row.overtimeMinutes > 0
                ? `${(row.overtimeMinutes / 60).toFixed(1)} hrs ${row.overtimeApproved ? 'approved' : '· not approved'}`
                : '—',
          },
        ]}
      />
    </AdminSection>
  );
}

function LeaveTab({ data }: { data: EmployeeRecord }) {
  return (
    <AdminSection
      title="Leave"
      description="Entitlement and balances come from the leave policy this employee is on. Requests and approvals live on the leave screen."
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
      <p className="kw-muted" style={{ marginTop: 14, marginBottom: 0 }}>
        Approved unpaid leave reduces pay automatically and shows on the payroll run's attendance step with a link back
        to the request. Nobody re-keys the days into payroll.
      </p>
    </AdminSection>
  );
}

function ClaimsTab({ data }: { data: EmployeeRecord }) {
  return (
    <AdminSection
      title="Claims"
      description="What this person spent that the clinic agreed to give back. Every approved claim is paid once, by one route."
      actions={
        <Link to={`/admin/hr/claims?staffId=${data.staffId}`}>
          <Button size="small">Open claims</Button>
        </Link>
      }
    >
      <DataTable
        rowKey="id"
        rows={data.claims}
        emptyText="No claims from this employee."
        columns={[
          { title: 'Date', dataIndex: 'claimDate', width: 120 },
          { title: 'Category', dataIndex: 'category', width: 140 },
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
            render: (value: string | null) => (value ? <strong>{ringgit(value)}</strong> : <span className="kw-muted">—</span>),
          },
          {
            title: 'Paid from',
            width: 180,
            render: (_: unknown, row: EmployeeRecord['claims'][number]) =>
              row.status !== 'APPROVED' ? (
                <Tag>{row.status === 'SUBMITTED' ? 'Awaiting a decision' : row.status}</Tag>
              ) : row.paymentRoute === 'PAYROLL' ? (
                <Tag color="processing">With salary</Tag>
              ) : (
                <Tag color={row.payoutStatus === 'PAID' ? 'success' : 'warning'}>
                  Finance{row.payoutStatus === 'PAID' ? '' : ', not yet paid'}
                </Tag>
              ),
          },
        ]}
      />
    </AdminSection>
  );
}

function PayrollTab({ data }: { data: EmployeeRecord }) {
  if (!data.payVisible) {
    return (
      <AdminNotice tone="info">
        You do not have permission to see pay. The runs this employee was on are listed without amounts.
      </AdminNotice>
    );
  }
  return (
    <AdminSection title="Recent pay" description="One row per payroll run this employee was on.">
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
            width: 160,
            render: (_: unknown, row: EmployeeRecord['payrollHistory'][number]) =>
              row.statutoryStatus !== 'CONFIGURED' ? (
                <Tag color="warning">{row.runStatus} · Provisional</Tag>
              ) : (
                <Tag>{row.runStatus}</Tag>
              ),
          },
          {
            title: 'Earnings',
            dataIndex: 'gross',
            width: 130,
            align: 'right' as const,
            render: (value: number | null) => (value === null ? '—' : ringgit(String(value))),
          },
          {
            title: 'Take-home',
            dataIndex: 'net',
            width: 130,
            align: 'right' as const,
            render: (value: number | null) => (value === null ? '—' : <strong>{ringgit(String(value))}</strong>),
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
  );
}

function DocumentsTab({ data }: { data: EmployeeRecord }) {
  return (
    <AdminNotice tone="warn">
      <strong>Employee documents are not implemented.</strong> {data.documents.note} This tab says so rather than
      showing an empty list, because an empty list reads as "nothing uploaded" and that is a different claim.
    </AdminNotice>
  );
}
