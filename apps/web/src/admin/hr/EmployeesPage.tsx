import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Select, Tooltip } from 'antd';
import dayjs from 'dayjs';
import { AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { FilterBar, Filter } from '../components/FilterBar';
import { PersonCell } from '../components/Person';
import { StatusChip, employmentTone, humanise } from '../components/Chip';
import { readinessSummary } from '../components/ReadinessList';
import { PEOPLE_VIEWS, WorkAreaTabs } from '../components/WorkAreaTabs';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useEmployees, usePayrollReadiness, useWorkforceToday } from '../hooks/useAdmin';
import { CompleteProfileDrawer } from './CompleteProfileDrawer';
import type { EmployeeRow } from '../types';

/**
 * PEOPLE — the directory, as the seven questions somebody opens it with.
 *
 * The reference sheet is explicit about what a directory row must answer:
 * who, what role, which branch, employment status, payroll readiness, current
 * status, and what can I do. Every column here is one of those. What went is
 * everything that was a column because it was a database field — the legacy
 * role enum, the leave policy name, the professional-type discriminator —
 * which are still available from the column picker and no longer the first
 * thing the eye lands on.
 *
 * CURRENT STATUS IS TODAY'S FACT, not the employment one. "Active" and "on
 * duty" are different answers and the directory used to give only the first,
 * so somebody looking for who is in the building had to go to Attendance.
 */

type Presence = 'ON_DUTY' | 'ON_LEAVE' | 'ROSTERED' | 'OFF';

export function EmployeesPage() {
  const { clinicId } = useClinicFilter();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useEmployees({ clinicId });
  const readiness = usePayrollReadiness({ period: dayjs().format('YYYY-MM'), clinicId });
  const today = useWorkforceToday(clinicId);

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<string>('ALL');

  /*
   * WHETHER SOMEBODY CAN ACTUALLY BE PAID, on the directory — the same read
   * the payroll gate uses, so a person cannot read READY here and hold up
   * approval on the next screen.
   */
  const readinessByStaff = useMemo(() => {
    const map = new Map<string, ReturnType<typeof readinessSummary>>();
    for (const row of readiness.data?.employees ?? []) map.set(row.staffId, readinessSummary(row.readiness));
    return map;
  }, [readiness.data]);

  const presenceByStaff = useMemo(() => {
    const map = new Map<string, Presence>();
    for (const row of today.data?.scheduled ?? []) map.set(row.staffId, 'ROSTERED');
    for (const row of today.data?.onLeave ?? []) map.set(row.staffId, 'ON_LEAVE');
    // On duty wins: a punch is a stronger fact than a roster line.
    for (const row of today.data?.onDuty ?? []) map.set(row.staffId, 'ON_DUTY');
    return map;
  }, [today.data]);

  // ?staffId= still redirects to that person, so links written before the
  // employee workspace was a route still land on them.
  const [search] = useSearchParams();
  const legacyStaffId = search.get('staffId');
  useEffect(() => {
    if (legacyStaffId) navigate(`/admin/hr/employees/${legacyStaffId}`, { replace: true });
  }, [legacyStaffId, navigate]);

  const incomplete = data?.filter((row) => !row.hasProfile) ?? [];
  const [completing, setCompleting] = useState<{ staffId: string; fullName: string } | null>(null);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? []).filter((row) => {
      if (status === 'ACTIVE' && row.employmentStatus !== 'ACTIVE') return false;
      if (status === 'PROBATION' && row.employmentStatus !== 'PROBATION') return false;
      if (status === 'NO_PROFILE' && row.hasProfile) return false;
      if (status === 'NOT_READY' && (readinessByStaff.get(row.staffId)?.tone ?? 'ok') === 'ok') return false;
      if (!needle) return true;
      return [row.fullName, row.position, row.employeeNo, row.department, row.clinicName]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(needle));
    });
  }, [data, query, status, readinessByStaff]);

  return (
    <AdminShell
      error={firstError({ isError, error })}
      title="Employees"
      subtitle="Everybody who works here, and whether payroll can pay them."
      actions={
        <Button type="primary" onClick={() => navigate('/admin/hr/people/new')}>
          + Add employee
        </Button>
      }
    >
      <WorkAreaTabs views={PEOPLE_VIEWS} />
      <CompleteProfileDrawer
        staffId={completing?.staffId ?? null}
        fullName={completing?.fullName ?? ''}
        onClose={() => setCompleting(null)}
      />

      <StatStrip
        stats={[
          { label: 'Total staff', value: data?.length ?? 0 },
          {
            label: 'Ready for payroll',
            value: readiness.data?.summary.ready ?? 0,
            tone: (readiness.data?.summary.withBlockers ?? 0) > 0 ? 'warn' : 'good',
            hint:
              (readiness.data?.summary.withBlockers ?? 0) > 0
                ? `${readiness.data?.summary.withBlockers} would hold up approval`
                : 'Nobody is holding up approval',
          },
          {
            label: 'On duty now',
            value: today.data?.onDuty?.length ?? 0,
            hint: `${today.data?.onLeave?.length ?? 0} on leave`,
          },
          {
            label: 'No employment record',
            value: incomplete.length,
            tone: incomplete.length > 0 ? 'warn' : 'good',
            explain: 'They can sign in and be rostered. Payroll leaves them out rather than refusing.',
          },
        ]}
      />

      <FilterBar
        right={
          incomplete.length > 0 ? (
            <Button size="small" onClick={() => setStatus('NO_PROFILE')}>
              {incomplete.length} to finish
            </Button>
          ) : null
        }
      >
        <Filter label="Search">
          <Input
            allowClear
            size="small"
            style={{ width: 260 }}
            placeholder="Name, position, employee number…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </Filter>
        <Filter label="Show">
          <Select
            size="small"
            style={{ width: 190 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'ALL', label: 'Everybody' },
              { value: 'ACTIVE', label: 'Active only' },
              { value: 'PROBATION', label: 'On probation' },
              { value: 'NOT_READY', label: 'Not payroll-ready' },
              { value: 'NO_PROFILE', label: 'No employment record' },
            ]}
          />
        </Filter>
      </FilterBar>

      <AdminSection padded={false}>
        <DataTable<EmployeeRow>
          rows={rows}
          loading={isLoading}
          rowKey="staffId"
          exportName="employees"
          emptyText={query || status !== 'ALL' ? 'Nobody matches that filter' : 'No staff records'}
          scrollY={560}
          onRow={(row) => ({
            onClick: () =>
              row.hasProfile
                ? navigate(`/admin/hr/employees/${row.staffId}`)
                : setCompleting({ staffId: row.staffId, fullName: row.fullName }),
          })}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'fullName',
              key: 'fullName',
              width: 240,
              sorter: (a, b) => a.fullName.localeCompare(b.fullName),
              render: (value: string, row) => (
                <PersonCell name={value} meta={row.employeeNo ?? row.email ?? 'No employee number'} />
              ),
            },
            {
              title: 'Role',
              key: 'role',
              width: 200,
              render: (_: unknown, row) => (
                <span>
                  {row.position ?? <span className="kw-muted">Not recorded</span>}
                  {/*
                    * A DOCTOR IS AN EMPLOYEE **AND** A CREDENTIALED CLINICIAN.
                    *
                    * The reference sheet's directory has no clinical column, and
                    * it is right that a receptionist's phone number should not be
                    * behind one. But collapsing "has a clinical job title" into
                    * "may sign a prescription" is how the wrong person signs one,
                    * so the credential rides on the ROLE — where it is a fact
                    * about the job rather than a column of its own.
                    */}
                  {row.professionalType === 'MEDICAL_DOCTOR' ? (
                    <span className="kw-cellMeta">
                      <StatusChip tone={row.canSignClinicalNotes ? 'ok' : 'attention'} dot>
                        {row.canSignClinicalNotes ? 'Doctor · may sign' : 'Doctor · not cleared to sign'}
                      </StatusChip>
                    </span>
                  ) : (
                    // NOT A CLINICIAN IS ALSO A FACT, and one worth stating: a
                    // department alone ("Pharmacy") does not say whether this
                    // person may sign anything.
                    // "Not a clinician" rather than "Non-clinical": one record
                    // has the DEPARTMENT "Clinical", and "Clinical ·
                    // Non-clinical" reads as a contradiction rather than as two
                    // facts. This wording cannot collide with a department name.
                    <span className="kw-cellMeta">
                      {row.department ? `${row.department} · Not a clinician` : 'Not a clinician'}
                    </span>
                  )}
                </span>
              ),
            },
            {
              title: 'Branch',
              dataIndex: 'clinicName',
              key: 'clinicName',
              width: 150,
              render: (value: string | null) => value ?? <span className="kw-muted">All branches</span>,
            },
            {
              title: 'Employment',
              key: 'employmentStatus',
              width: 150,
              render: (_: unknown, row) =>
                row.hasProfile ? (
                  <span>
                    <StatusChip tone={employmentTone(row.employmentStatus)} dot>
                      {humanise(row.employmentStatus)}
                    </StatusChip>
                    <span className="kw-cellMeta">
                      {humanise(row.employmentType)}
                      {row.startDate ? ` · since ${dayjs(row.startDate).format('MMM YYYY')}` : ''}
                    </span>
                  </span>
                ) : (
                  <StatusChip tone="neutral">No record</StatusChip>
                ),
            },
            {
              // WHAT IS MISSING, NAMED. A bare "5/8" tells somebody they have a
              // problem and nothing about what it is.
              title: 'Payroll',
              key: 'payrollReadiness',
              width: 170,
              render: (_: unknown, row) => {
                if (!row.hasProfile) return <span className="kw-muted">—</span>;
                const state = readinessByStaff.get(row.staffId);
                if (!state) return <span className="kw-muted">—</span>;
                return (
                  <Tooltip title={state.missing.length ? `Outstanding: ${state.missing.join(', ')}` : undefined}>
                    <span>
                      <StatusChip tone={state.tone} dot>
                        {state.label}
                      </StatusChip>
                    </span>
                  </Tooltip>
                );
              },
            },
            {
              title: 'Today',
              key: 'presence',
              width: 130,
              render: (_: unknown, row) => {
                const presence = presenceByStaff.get(row.staffId) ?? 'OFF';
                if (presence === 'ON_DUTY') return <StatusChip tone="ok" dot>On duty</StatusChip>;
                if (presence === 'ON_LEAVE') return <StatusChip tone="info" dot>On leave</StatusChip>;
                if (presence === 'ROSTERED') return <StatusChip tone="neutral" dot>Rostered</StatusChip>;
                return <span className="kw-muted">Off</span>;
              },
            },
            {
              title: '',
              key: 'action',
              width: 96,
              noExport: true,
              render: (_: unknown, row) =>
                row.hasProfile ? (
                  <Button size="small" type="text" className="kw-rowAction">
                    View →
                  </Button>
                ) : (
                  <Button
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      setCompleting({ staffId: row.staffId, fullName: row.fullName });
                    }}
                  >
                    Finish
                  </Button>
                ),
            },
            { title: 'Department', dataIndex: 'department', key: 'department', optional: true },
            { title: 'Manager', dataIndex: 'manager', key: 'manager', optional: true },
            { title: 'Leave policy', dataIndex: 'leavePolicy', key: 'leavePolicy', optional: true },
            { title: 'Phone', dataIndex: 'phone', key: 'phone', optional: true },
            { title: 'Email', dataIndex: 'email', key: 'email', optional: true },
          ]}
        />
      </AdminSection>
    </AdminShell>
  );
}
