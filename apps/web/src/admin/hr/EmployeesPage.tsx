import { useState } from 'react';
import { Drawer, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { StatStrip } from '../components/StatStrip';
import { DataTable, money } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import { useSearchParams } from 'react-router-dom';
import { useEmployeeRecord, useEmployees } from '../hooks/useAdmin';
import { EmployeeSalaryPanel } from './EmployeeSalaryPanel';
import type { EmployeeRecord } from '../types';

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
 * OPENING A ROW OPENS THE RECORD. The owner's finding was that an employee had
 * nowhere obvious to hold employment terms, pay basis, statutory identifiers,
 * leave, attendance and payroll history — thirteen facts spread over five
 * screens. The drawer below is one read (`/workforce/employees/:id/record`)
 * composed from the tables that own each of them, so it can show all thirteen
 * without becoming a fourteenth place any of them is stored.
 */
export function EmployeesPage() {
  const { clinicId } = useClinicFilter();
  const { data, isLoading, isError, error } = useEmployees({ clinicId });
  // ?staffId= OPENS THAT PERSON. Every remedy link on a payroll exception —
  // "no salary is in force", "no date of birth is recorded" — points here, and
  // landing on a directory to search through is not the same as landing on the
  // employee the exception is about.
  const [search] = useSearchParams();
  const [openStaffId, setOpenStaffId] = useState<string | undefined>(search.get('staffId') ?? undefined);
  const record = useEmployeeRecord(openStaffId);

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
          onRow={(row) => ({ onClick: () => row.hasProfile && setOpenStaffId(row.staffId) })}
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

      <Drawer
        width={760}
        open={Boolean(openStaffId)}
        onClose={() => setOpenStaffId(undefined)}
        title={record.data?.identity.fullName ?? 'Employee record'}
        destroyOnHidden
      >
        {record.isError ? (
          <AdminNotice tone="warn">This employee record could not be loaded.</AdminNotice>
        ) : record.data ? (
          <EmployeeRecordPanes record={record.data} staffId={openStaffId!} />
        ) : (
          <p className="kw-muted">Loading…</p>
        )}
      </Drawer>
    </AdminShell>
  );
}

/**
 * THE RECORD, in the order somebody actually asks about a person: who they are,
 * what their employment is, what they are paid on, what the statutory position
 * is, what leave and attendance say, and what they have been paid.
 *
 * Every block that cannot answer says so in words. "—" against a salary and
 * "you may not see salaries" are different facts, and a screen that renders
 * them identically has told the reader nothing.
 */
function EmployeeRecordPanes({ record, staffId }: { record: EmployeeRecord; staffId: string }) {
  const { identity, employment, pay, statutory, attendance } = record;

  return (
    <div className="kw-record">
      <RecordBlock title="Employment">
        <Facts
          rows={[
            ['Employee no', employment.employeeNo],
            ['Position', employment.position],
            ['Department', employment.department],
            // TWO DIFFERENT FACTS, next to each other on purpose: the employer
            // files for them, the branch is where the work happens.
            ['Legal employer', employment.legalEmployerName],
            ['Branch', employment.clinicName],
            ['Employment type', employment.employmentType],
            ['Status', employment.employmentStatus],
            ['Manager', employment.manager],
            ['Started', employment.startDate ? dayjs(employment.startDate).format('D MMM YYYY') : null],
            ['Confirmed', employment.confirmedDate ? dayjs(employment.confirmedDate).format('D MMM YYYY') : null],
            ['Ended', employment.endDate ? `${dayjs(employment.endDate).format('D MMM YYYY')}${employment.endReason ? ` · ${employment.endReason}` : ''}` : null],
          ]}
        />
      </RecordBlock>

      <RecordBlock title="Person">
        <Facts
          rows={[
            ['Legal name', identity.legalName],
            ['Date of birth', identity.dateOfBirth ? dayjs(identity.dateOfBirth).format('D MMM YYYY') : null],
            ['Gender', identity.gender],
            ['Nationality', identity.nationality],
            ['Marital status', identity.maritalStatus],
            ['Phone', identity.phone],
            ['Email', identity.email],
            ['Address', identity.address],
            [
              'Emergency contact',
              identity.emergencyContactName
                ? `${identity.emergencyContactName}${identity.emergencyContactRelation ? ` (${identity.emergencyContactRelation})` : ''}${identity.emergencyContactPhone ? ` · ${identity.emergencyContactPhone}` : ''}`
                : null,
            ],
            ['Login account', identity.accountActive ? `Active · ${identity.accountRole}` : `Disabled · ${identity.accountRole}`],
          ]}
        />
      </RecordBlock>

      <RecordBlock title="Pay basis">
        {record.payVisible && pay ? (
          <Facts
            rows={[
              ['Pay basis', pay.payBasis === 'MONTHLY' ? 'Monthly salary' : pay.payBasis === 'HOURLY' ? 'Hourly rate' : null],
              ['Basic salary', pay.basicSalary === null ? null : money(pay.basicSalary)],
              ['Hourly rate', pay.hourlyRate === null ? null : money(pay.hourlyRate)],
              ['Bank', pay.bankName],
              ['Bank account', pay.bankAccountOnFile ? 'On file' : null],
            ]}
          />
        ) : (
          <p className="kw-muted" style={{ margin: 0 }}>
            Salary and bank details need the payroll permission. They are not hidden on this screen — the server does
            not send them to this account.
          </p>
        )}
        {record.payVisible ? (
          <p className="kw-muted" style={{ margin: '6px 0 0', fontSize: 11.5 }}>
            The bank account number itself is never returned by this endpoint, and there is no screen in this
            release that edits it — the employee write endpoint exists, the form for it does not.
          </p>
        ) : null}
      </RecordBlock>

      {/*
        SALARY HISTORY sits directly under the pay basis, because the block
        above answers "what are they on?" and this one answers "since when, and
        what before that?" — the second question every pay dispute turns into.
      */}
      <RecordBlock title="Salary history">
        <EmployeeSalaryPanel staffId={staffId} canSeePay={record.payVisible} />
      </RecordBlock>

      <RecordBlock title="Statutory">
        <Facts
          rows={[
            ['EPF / KWSP number', statutory.epfNumberOnFile ? 'On file' : 'Not on file'],
            ['SOCSO / PERKESO number', statutory.socsoNumberOnFile ? 'On file' : 'Not on file'],
            ['Income tax number', statutory.taxNumberOnFile ? 'On file' : 'Not on file'],
            ['PCB category', statutory.taxCategory],
            [
              'Applies to',
              [
                statutory.epfApplicable ? 'EPF' : null,
                statutory.socsoApplicable ? 'SOCSO' : null,
                statutory.eisApplicable ? 'EIS' : null,
                statutory.pcbApplicable ? 'PCB' : null,
              ]
                .filter(Boolean)
                .join(', ') || 'None',
            ],
          ]}
        />
        <AdminNotice tone="warn">{statutory.note}</AdminNotice>
      </RecordBlock>

      <RecordBlock title={`Attendance · ${record.year}`}>
        <Facts
          rows={[
            ['Days recorded', String(attendance.daysRecorded)],
            ['Days worked', String(attendance.daysWorked)],
            ['Absent', String(attendance.absent)],
            ['On leave', String(attendance.onLeave)],
            ['Late on', `${attendance.lateDays} day(s)`],
            ['Approved overtime', `${attendance.approvedOvertimeHours} h`],
            ['Corrected punches', attendance.corrected > 0 ? `${attendance.corrected} — see Timesheets` : '0'],
          ]}
        />
        <p className="kw-muted" style={{ margin: '6px 0 0', fontSize: 11.5 }}>
          Leave entitlement and balances are maintained in HR ▸ Leave, which owns them.
          {record.leavePolicy ? ` Policy: ${record.leavePolicy.name}.` : ' No leave policy is assigned to this person.'}
        </p>
      </RecordBlock>

      <RecordBlock title="Payroll history">
        {record.payrollHistory.length === 0 ? (
          <p className="kw-muted" style={{ margin: 0 }}>This person has not appeared on a payroll run.</p>
        ) : (
          <table className="kw-recordTable">
            <thead>
              <tr>
                <th>Period</th>
                <th>Run</th>
                <th className="kw-num">Gross</th>
                <th className="kw-num">Net</th>
                <th>Statutory</th>
              </tr>
            </thead>
            <tbody>
              {record.payrollHistory.map((line) => (
                <tr key={line.id}>
                  <td>{line.period}</td>
                  <td>
                    <Tag>{line.runStatus}</Tag>
                  </td>
                  <td className="kw-num">{line.gross === null ? '—' : money(line.gross)}</td>
                  <td className="kw-num">{line.net === null ? '—' : money(line.net)}</td>
                  <td>
                    {line.statutoryStatus === 'CONFIGURED' ? (
                      <span className="kw-good">computed</span>
                    ) : (
                      <span className="kw-bad">not computed</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </RecordBlock>

      <RecordBlock title="Documents">
        <AdminNotice tone="warn">{record.documents.note}</AdminNotice>
      </RecordBlock>
    </div>
  );
}

function RecordBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="kw-recordBlock">
      <h4 className="kw-recordBlock__title">{title}</h4>
      {children}
    </section>
  );
}

/**
 * A definition list where an ABSENT value stays visible.
 *
 * A field dropped because it is null is a field nobody knows is missing. An
 * employee with no start date on record is an HR task, and the only way that
 * surfaces is if the row is there saying "not recorded".
 */
function Facts({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="kw-facts">
      {rows.map(([label, value]) => (
        <div key={label} className="kw-facts__row">
          <dt>{label}</dt>
          <dd>{value ? value : <span className="kw-muted">not recorded</span>}</dd>
        </div>
      ))}
    </dl>
  );
}
