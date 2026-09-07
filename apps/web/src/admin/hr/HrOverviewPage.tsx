import dayjs from 'dayjs';
import { clinicDayjs, formatClinicTime } from '../../clinical/clinicTime';
import { Tag } from 'antd';
import { Link } from 'react-router-dom';
import { AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { ExceptionTiles, StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useWorkforceToday } from '../hooks/useAdmin';
import { useNavigate } from 'react-router-dom';

/**
 * HR — the module's first question, in the brief's own words:
 *
 *   "Who is working, absent, pending approval, and what needs payroll
 *    attention?"
 *
 * Four answers, on one screen, before anything else. The directory is a click
 * away; it is not what somebody opens HR to find out at nine in the morning.
 */
export function HrOverviewPage() {
  const navigate = useNavigate();
  const { clinicId } = useClinicFilter();
  const { data, isLoading, isError, error } = useWorkforceToday(clinicId);

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Workforce"
      subtitle={`Who is working, who is absent, and what is waiting for a decision — ${clinicDayjs(`${data?.date ?? ''}T00:00:00`).format('dddd D MMMM')}.`}
    >
      <StatStrip
        stats={[
          { label: 'On duty now', value: data?.onDuty?.length ?? 0, tone: 'good' },
          { label: 'Finished today', value: data?.completed ?? 0 },
          { label: 'Late arrivals', value: data?.late ?? 0, tone: (data?.late ?? 0) > 0 ? 'warn' : 'neutral' },
          { label: 'On leave', value: data?.onLeave?.length ?? 0 },
          { label: 'Rostered today', value: data?.scheduled?.length ?? 0, explain: 'From the roster — the one scheduling domain. Attendance reads it and never writes to it.' },
        ]}
      />

      <AdminSection
        title="Waiting for a decision"
        description="Each of these is somebody blocked until a manager acts. Every tile opens the work."
      >
        {/*
          * EACH ONE GOES SOMEWHERE. A counter that leads nowhere tells a
          * manager they have work and not where it is, which is most of the
          * way to not doing it.
          */}
        <ExceptionTiles
          tiles={[
            {
              key: 'leave',
              label: 'Leave approvals pending',
              count: data?.pendingLeaveApprovals ?? 0,
              tone: 'warn',
              onSelect: () => navigate('/admin/hr/leave'),
            },
            {
              key: 'ot',
              label: 'Overtime claimed, not approved',
              count: data?.unapprovedOvertimeClaims ?? 0,
              tone: 'warn',
              hint: 'Unapproved overtime is NOT paid. A long day is not automatically overtime.',
              onSelect: () => navigate('/admin/hr/attendance'),
            },
            {
              key: 'punch',
              label: 'Missing clock-in or clock-out',
              count: data?.missingPunches ?? 0,
              tone: 'bad',
              hint: 'Somebody was here and the record is incomplete — not the same as absent.',
              onSelect: () => navigate('/admin/hr/attendance'),
            },
            {
              key: 'corrections',
              label: 'Attendance fixes requested',
              count: data?.pendingAttendanceCorrections ?? 0,
              tone: 'warn',
              hint: 'Somebody has asked for a punch to be put right. Nothing changes until you decide.',
              onSelect: () => navigate('/admin/hr/attendance'),
            },
            {
              key: 'claims',
              label: 'Claims awaiting a decision',
              count: data?.pendingClaims ?? 0,
              tone: 'warn',
              hint: 'Approving one also decides whether it is paid with salary or by Finance.',
              onSelect: () => navigate('/admin/hr/claims'),
            },
          ]}
        />
      </AdminSection>

      {/*
        * `data?.notClockedIn?.length`, not `data?.notClockedIn?.length`.
        *
        * Optional chaining stops at the first `?.`: the second form is only
        * safe while the field is guaranteed present, and a web bundle can and
        * does run against an API build that predates a field. It white-screened
        * this page during development for exactly that reason, which is a far
        * worse failure than a missing section.
        */}
      {(data?.notClockedIn?.length ?? 0) > 0 ? (
        <AdminSection
          title="Rostered, not clocked in"
          description="On the roster today, not on leave, and no punch yet. Somebody early is not somebody missing, so this says which."
          padded={false}
        >
          <DataTable
            rows={data?.notClockedIn}
            loading={isLoading}
            rowKey="staffId"
            emptyText="Everybody rostered has clocked in"
            columns={[
              { title: 'Name', dataIndex: 'name', key: 'name' },
              {
                title: 'Due',
                dataIndex: 'dueAt',
                key: 'dueAt',
                render: (value: string) => formatClinicTime(value),
              },
              {
                title: '',
                key: 'state',
                render: (_: unknown, row) =>
                  row.overdue ? <Tag color="red">Shift has started</Tag> : <Tag>Not due yet</Tag>,
              },
            ]}
          />
        </AdminSection>
      ) : null}

      <div className="kw-adminGrid kw-adminGrid--2">
        <AdminSection title="On duty" padded={false}>
          <DataTable
            rows={data?.onDuty}
            loading={isLoading}
            rowKey="staffId"
            emptyText="Nobody is clocked in"
            columns={[
              { title: 'Name', dataIndex: 'name', key: 'name' },
              {
                title: 'Since',
                dataIndex: 'since',
                key: 'since',
                render: (value: string) => `${formatClinicTime(value)} (${dayjs().diff(dayjs(value), 'hour')}h)`,
              },
            ]}
          />
        </AdminSection>

        <AdminSection title="Away today" padded={false}>
          <DataTable
            rows={data?.onLeave}
            loading={isLoading}
            rowKey="staffId"
            emptyText="Nobody is on leave"
            columns={[
              { title: 'Name', dataIndex: 'name', key: 'name' },
              {
                title: 'Leave',
                dataIndex: 'leaveType',
                key: 'leaveType',
                render: (value: string) => <Tag>{value}</Tag>,
              },
            ]}
          />
        </AdminSection>
      </div>

      <AdminSection title="Rostered today" description="Read from the provider roster. Changing a shift happens there, not here." padded={false}>
        <DataTable
          rows={data?.scheduled}
          loading={isLoading}
          rowKey={(row) => `${row.staffId}-${row.startAt}`}
          emptyText="Nobody is rostered"
          columns={[
            { title: 'Name', dataIndex: 'name', key: 'name' },
            { title: 'From', dataIndex: 'startAt', key: 'startAt', render: (value: string) => formatClinicTime(value) },
            { title: 'To', dataIndex: 'endAt', key: 'endAt', render: (value: string) => formatClinicTime(value) },
          ]}
        />
      </AdminSection>

      <p className="kw-adminSection__desc">
        <Link to="/admin/hr/employees">Employee directory →</Link> · <Link to="/admin/hr/attendance">Timesheets →</Link>{' '}
        · <Link to="/admin/hr/payroll">Payroll →</Link>
      </p>
    </AdminShell>
  );
}
