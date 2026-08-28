import { Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useEmployees } from '../hooks/useAdmin';

/**
 * THE EMPLOYEE DIRECTORY.
 *
 * It shows three identities side by side without merging them — the account,
 * the employment and the clinical credential — because a person may be all
 * three and forcing them into one is the mistake the schema was designed to
 * avoid.
 *
 * IT SHOWS NO SALARY. Not because it is hidden in the UI, but because the
 * endpoint behind it does not return one: pay lives behind a separate
 * permission and a separate read.
 */
export function EmployeesPage() {
  const { clinicId } = useClinicFilter();
  const { data, isLoading, isError, error } = useEmployees({ clinicId });

  const withProfile = data?.filter((row) => row.hasProfile) ?? [];
  const clinicians = data?.filter((row) => row.professionalActive) ?? [];

  return (
    <AdminShell error={firstError({ isError, error })} title="Employees" subtitle="Account, employment and clinical credential are three separate facts about one person.">
      <StatStrip
        stats={[
          { label: 'Staff records', value: data?.length ?? 0 },
          {
            label: 'With an employee profile',
            value: withProfile.length,
            tone: withProfile.length < (data?.length ?? 0) ? 'warn' : 'good',
            hint: `${(data?.length ?? 0) - withProfile.length} without one`,
          },
          {
            label: 'Active clinicians',
            value: clinicians.length,
            explain: 'A professional identity, verified by the clinic group. Separate from being on the payroll.',
          },
          { label: 'Active accounts', value: data?.filter((row) => row.active).length ?? 0 },
        ]}
      />

      {withProfile.length < (data?.length ?? 0) ? (
        <AdminNotice tone="warn">
          {(data?.length ?? 0) - withProfile.length} staff member(s) have no employee profile. They cannot appear in a
          payroll run until one exists — a payroll that silently skipped them would be worse.
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
          columns={[
            { title: 'Name', dataIndex: 'fullName', key: 'fullName', sorter: (a, b) => a.fullName.localeCompare(b.fullName) },
            { title: 'Employee no', dataIndex: 'employeeNo', key: 'employeeNo' },
            { title: 'Position', dataIndex: 'position', key: 'position' },
            { title: 'Department', dataIndex: 'department', key: 'department', optional: true },
            { title: 'Branch', dataIndex: 'clinicName', key: 'clinicName' },
            {
              title: 'Employment',
              dataIndex: 'employmentType',
              key: 'employmentType',
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
