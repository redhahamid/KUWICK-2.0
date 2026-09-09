import { useEffect, useState } from 'react';
import { Avatar, Button, Select, Tag, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { useMemo } from 'react';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmployees, usePayrollReadiness } from '../hooks/useAdmin';
import { AddEmployeeDrawer } from './AddEmployeeDrawer';
import { CompleteProfileDrawer } from './CompleteProfileDrawer';

/**
 * THE EMPLOYEE DIRECTORY.
 *
 * It shows three identities side by side without merging them — the account,
 * the employment and the clinical credential — because a person may be all
 * three and forcing them into one is the mistake the schema was designed to
 * avoid.
 *
 * IT SHOWS NO SALARY in the directory. Not because it is hidden in the UI, but
 * because the endpoint behind it does not return one: pay lives behind a
 * separate permission and a separate read.
 *
 * OPENING A ROW OPENS THAT PERSON'S OWN PAGE. It used to open a drawer, which
 * could not be linked to, left open beside a payroll run, or reached from a
 * payroll exception without landing on this directory first. The workspace is
 * a route now — see EmployeeWorkspacePage — and this screen is a directory
 * again rather than a directory with a record inside it.
 */
/** Initials, for somebody with no photograph — which is everybody. */
function initials(name: string): string {
  return name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter((part) => /^[A-Za-z]/.test(part))
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

export function EmployeesPage() {
  const { clinicId } = useClinicFilter();
  const { data, isLoading, isError, error } = useEmployees({ clinicId });
  /*
   * WHETHER SOMEBODY CAN ACTUALLY BE PAID, on the directory.
   *
   * This screen listed employment facts and said nothing about whether payroll
   * would include the person — which is the single thing an owner is checking
   * for when they open it before a pay run. Readiness is joined in here rather
   * than duplicated: the same read the payroll gate uses, so a person cannot
   * read READY on one screen and hold up approval on the next.
   */
  const readiness = usePayrollReadiness({ period: dayjs().format('YYYY-MM'), clinicId });
  const readinessByStaff = useMemo(() => {
    const map = new Map<string, { done: number; total: number; ready: boolean; missing: string[] }>();
    for (const row of readiness.data?.employees ?? []) {
      map.set(row.staffId, {
        done: row.readiness.done,
        total: row.readiness.total,
        ready: row.readiness.ready,
        missing: row.readiness.items.filter((item) => !item.done).map((item) => item.label),
      });
    }
    return map;
  }, [readiness.data]);
  // ?staffId= OPENS THAT PERSON. Every remedy link on a payroll exception —
  // "no salary is in force", "no date of birth is recorded" — points here, and
  // landing on a directory to search through is not the same as landing on the
  // employee the exception is about.
  const navigate = useNavigate();
  // ?staffId= still redirects to that person, so any link written before the
  // workspace existed still lands on them rather than on a directory.
  const [search] = useSearchParams();
  const legacyStaffId = search.get('staffId');
  useEffect(() => {
    if (legacyStaffId) navigate(`/admin/hr/employees/${legacyStaffId}`, { replace: true });
  }, [legacyStaffId, navigate]);

  const withProfile = data?.filter((row) => row.hasProfile) ?? [];
  const clinicians = data?.filter((row) => row.professionalActive) ?? [];
  const incomplete = data?.filter((row) => !row.hasProfile) ?? [];
  const [adding, setAdding] = useState(false);
  // A staff member with no employment profile cannot be opened on the employee
  // page — that page reads a profile that does not exist yet — so finishing
  // one happens here, where the queue is.
  const [completing, setCompleting] = useState<{ staffId: string; fullName: string } | null>(null);

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="People"
      // WHAT THE OWNER IS HERE FOR, not what the schema is proud of. The old
      // subtitle explained that account, employment and clinical credential
      // are three separate records — true, load-bearing, and none of somebody's
      // business while they are looking for a receptionist's phone number.
      subtitle="Everybody who works here, and whether payroll can pay them."
      actions={
        <Button type="primary" onClick={() => setAdding(true)}>
          + Add employee
        </Button>
      }
    >
      <AddEmployeeDrawer
        open={adding}
        onClose={() => setAdding(false)}
        clinicId={clinicId}
        // The directory re-reads readiness on its own, so the new person shows
        // up with their setup state rather than as a name with nothing beside it.
        onAdded={() => readiness.refetch()}
      />
      <CompleteProfileDrawer
        staffId={completing?.staffId ?? null}
        fullName={completing?.fullName ?? ''}
        onClose={() => setCompleting(null)}
      />
      <StatStrip
        stats={[
          { label: 'People', value: data?.length ?? 0 },
          {
            label: 'Ready for payroll',
            value: readiness.data?.summary.ready ?? 0,
            tone: (readiness.data?.summary.withBlockers ?? 0) > 0 ? 'warn' : 'good',
            hint:
              (readiness.data?.summary.withBlockers ?? 0) > 0
                ? `${readiness.data?.summary.withBlockers} would hold up approval`
                : undefined,
          },
          {
            label: 'Without an employment record',
            value: incomplete.length,
            tone: incomplete.length > 0 ? 'warn' : 'good',
            explain: 'They can sign in and be rostered. Payroll leaves them out rather than refusing.',
          },
          {
            label: 'Active clinicians',
            value: clinicians.length,
            explain: 'A professional identity, verified by the clinic group. Separate from being on the payroll.',
          },
        ]}
      />

      {incomplete.length > 0 ? (
        <AdminNotice tone="warn">
          <strong>
            {incomplete.length} staff record{incomplete.length === 1 ? '' : 's'} without an employment profile.
          </strong>{' '}
          They can sign in and be rostered, but payroll cannot include them until somebody completes their
          profile — they are left out rather than refused, which is much harder to notice. Open each one to
          finish it:{' '}
          {incomplete.slice(0, 6).map((row, index) => (
            <span key={row.staffId}>
              {index > 0 ? ', ' : ''}
              {/* Straight into finishing THAT person's profile. The employee
                  page cannot open them yet, because it reads a profile that
                  does not exist — which is the thing being fixed. */}
              <a onClick={() => setCompleting({ staffId: row.staffId, fullName: row.fullName })}>{row.fullName}</a>
            </span>
          ))}
          {incomplete.length > 6 ? ` and ${incomplete.length - 6} more.` : '.'}
        </AdminNotice>
      ) : null}

      <AdminSection title="Directory" padded={false}>
        <DataTable
          rows={data}
          loading={isLoading}
          rowKey="staffId"
          exportName="employees"
          searchFields={['fullName' as never, 'position' as never, 'employeeNo' as never, 'department' as never]}
          searchPlaceholder="Search name, position or employee number…"
          emptyText="No staff records"
          scrollY={540}
          // OPENING A ROW OPENS THE PERSON'S OWN PAGE. It used to open a
          // drawer, which could not be linked to, left open beside a payroll
          // run, or reached from an exception without landing on the directory
          // first. The drawer is gone; the workspace is a route.
          onRow={(row) => ({
            onClick: () =>
              row.hasProfile
                ? navigate(`/admin/hr/employees/${row.staffId}`)
                : // A row that does nothing when clicked reads as broken. An
                  // incomplete record opens the form that completes it.
                  setCompleting({ staffId: row.staffId, fullName: row.fullName }),
          })}
          columns={[
            {
              // NAME, ROLE AND FACE IN ONE CELL. The directory used to spend
              // three columns on what a person reads as one fact.
              title: 'Employee',
              dataIndex: 'fullName',
              key: 'fullName',
              sorter: (a, b) => a.fullName.localeCompare(b.fullName),
              render: (value: string, row) => (
                <div className="kw-person">
                  <Avatar size={30} className="kw-person__avatar">
                    {initials(value)}
                  </Avatar>
                  <div className="kw-person__text">
                    <span className="kw-person__name">{value}</span>
                    <span className="kw-muted">
                      {row.position ?? 'No position recorded'}
                      {row.employeeNo ? ` · ${row.employeeNo}` : ''}
                    </span>
                  </div>
                </div>
              ),
            },
            {
              // CAN THIS PERSON BE PAID. The question the directory is opened
              // with before a pay run, and the one it never answered.
              title: 'Payroll',
              key: 'payrollReadiness',
              render: (_: unknown, row) => {
                if (!row.hasProfile) return <Tag color="default">No employment record</Tag>;
                const state = readinessByStaff.get(row.staffId);
                if (!state) return <span className="kw-muted">—</span>;
                if (state.ready) return <Tag color="green">Ready</Tag>;
                return (
                  <Tooltip title={`Missing: ${state.missing.join(', ')}`}>
                    <Tag color="gold">
                      Setup {state.done}/{state.total}
                    </Tag>
                  </Tooltip>
                );
              },
            },
            { title: 'Employee no', dataIndex: 'employeeNo', key: 'employeeNo', optional: true },
            { title: 'Position', dataIndex: 'position', key: 'position', optional: true },
            { title: 'Department', dataIndex: 'department', key: 'department', optional: true },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            {
              title: 'Employment',
              dataIndex: 'employmentType',
              key: 'employmentType',
              optional: true,
              render: (value: string | null) => (value ? <Tag>{value}</Tag> : <span className="kw-muted">no profile</span>),
            },
            {
              title: 'Status',
              dataIndex: 'employmentStatus',
              key: 'employmentStatus',
              render: (value: string | null) =>
                value ? (
                  <Tag color={value === 'ACTIVE' ? 'green' : value === 'PROBATION' ? 'gold' : 'default'}>{value}</Tag>
                ) : (
                  '—'
                ),
            },
            {
              title: 'Clinical',
              dataIndex: 'professionalType',
              key: 'professionalType',
              render: (value: string, row) =>
                value === 'MEDICAL_DOCTOR' ? (
                  <Tag color={row.canSignClinicalNotes ? 'green' : 'gold'}>
                    {row.canSignClinicalNotes ? 'Doctor · may sign' : 'Doctor · not cleared to sign'}
                  </Tag>
                ) : (
                  <span className="kw-muted">Non-clinical</span>
                ),
            },
            {
              title: 'Roles',
              dataIndex: 'roles',
              key: 'roles',
              optional: true,
              render: (roles: (string | undefined)[], row) =>
                roles.length > 0 ? roles.join(', ') : <span className="kw-muted">legacy: {row.legacyRole}</span>,
            },
            {
              title: 'Started',
              dataIndex: 'startDate',
              key: 'startDate',
              render: (value: string | null) => (value ? dayjs(value).format('MMM YYYY') : '—'),
            },
            { title: 'Manager', dataIndex: 'manager', key: 'manager', optional: true },
            { title: 'Leave policy', dataIndex: 'leavePolicy', key: 'leavePolicy', optional: true },
            { title: 'Phone', dataIndex: 'phone', key: 'phone', optional: true },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
