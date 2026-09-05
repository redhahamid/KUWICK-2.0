import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, DataTableTotalRow, ringgit } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import {
  useEmployees,
  useLegalEmployers,
  usePayrollClaimsReport,
  usePayrollEmployerCostReport,
  usePayrollExceptionsReport,
  usePayrollHistoryReport,
  usePayrollIncentivesReport,
  usePayrollMonthComparisonReport,
  usePayrollOvertimeReport,
  usePayrollPaymentStatusReport,
  usePayrollPcbSummaryReport,
  usePayrollRegisterReport,
  usePayrollReportCatalogue,
  usePayrollRuns,
  usePayrollStatutoryReport,
  usePayrollUnpaidLeaveReport,
  usePayrollYtdReport,
} from '../hooks/useAdmin';
import type {
  PayrollCostBucket,
  PayrollExceptionsReport,
  PayrollHistoryReport,
  PayrollIncentivesReport,
  PayrollMonthComparisonReport,
  PayrollOvertimeReport,
  PayrollPaymentStatusReport,
  PayrollPcbSummaryReport,
  PayrollRegisterReport,
  PayrollStatutoryReport,
  PayrollUnpaidLeaveReport,
  PayrollYtdReport,
} from '../types';

/**
 * PAYROLL REPORTS.
 *
 * THIRTEEN REPORTS, ONE SOURCE. Every figure here is served by the API from
 * the same `payroll_lines`, `payroll_input_entries` and year-to-date rows the
 * run wrote. This page performs no arithmetic of its own — no sums, no
 * percentages, no derived totals — because a screen that adds up salaries its
 * own way is a second engine and the two disagree in the month somebody
 * finally checks.
 *
 * NULL IS NOT ZERO. A statutory figure the engine could not work out arrives
 * as null and is shown as "Not worked out", never as RM0.00.
 *
 * EACH REPORT NAMES ITS SCOPE — a run, a date range, an employee or a tax
 * year — and the picker row follows the API's own catalogue rather than a
 * duplicate list kept here.
 */

type ReportKey =
  | 'PAYROLL_REGISTER'
  | 'EMPLOYER_COST'
  | 'STATUTORY_TOTALS'
  | 'VARIANCE'
  | 'CLAIMS'
  | 'PAYROLL_HISTORY'
  | 'PCB_SUMMARY'
  | 'YTD'
  | 'OVERTIME'
  | 'UNPAID_LEAVE'
  | 'INCENTIVES'
  | 'EXCEPTIONS'
  | 'PAYMENT_STATUS';

export function PayrollReportsPage() {
  const { clinicId } = useClinicFilter();
  const catalogue = usePayrollReportCatalogue();
  const runs = usePayrollRuns({ clinicId });
  const employees = useEmployees({ clinicId, status: 'ACTIVE' });
  const employers = useLegalEmployers();
  const [report, setReport] = useState<ReportKey>('PAYROLL_REGISTER');
  const [runId, setRunId] = useState<string | undefined>();
  const [staffId, setStaffId] = useState<string | undefined>();
  const [year, setYear] = useState<number>(dayjs().year());
  const [employerId, setEmployerId] = useState<string | undefined>();

  // The most recent calculated run, so the page opens on something rather than
  // on an empty selector the reader has to fill in before seeing anything.
  const runOptions = useMemo(
    () =>
      (runs.data ?? [])
        .filter((run) => run.status !== 'DRAFT' && run.status !== 'CANCELLED')
        .map((run) => ({
          value: run.id,
          label: `${dayjs(run.period).format('MMMM YYYY')} · ${run.clinicName}`,
        })),
    [runs.data],
  );
  const selectedRun = runId ?? runOptions[0]?.value;
  const employeeOptions = useMemo(
    () =>
      (employees.data ?? [])
        .filter((row) => row.hasProfile)
        .map((row) => ({ value: row.staffId, label: row.fullName })),
    [employees.data],
  );
  const yearOptions = useMemo(() => {
    const current = dayjs().year();
    return [current + 1, current, current - 1, current - 2].map((value) => ({ value, label: String(value) }));
  }, []);
  // THE SCOPE COMES FROM THE CATALOGUE — the API says what each report is a
  // view of, and the picker row follows it rather than a second list here.
  const scope = catalogue.data?.available.find((entry) => entry.key === report)?.scope ?? 'RUN';

  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));

  return (
    <AdminShell
      error={firstError(catalogue, runs)}
      title="Payroll reports"
      subtitle="Read-only views of what payroll has already recorded. Every figure comes from the run itself."
    >
      <AdminSection title="Choose a report">
        <div className="kw-filterRow">
          <Select
            aria-label="Report"
            style={{ minWidth: 260 }}
            value={report}
            onChange={(value) => setReport(value as ReportKey)}
            // Thirteen options: without this the list virtualises and the ones
            // below the fold are not even in the DOM for a reader (or a UAT
            // script) to find.
            virtual={false}
            listHeight={420}
            options={(catalogue.data?.available ?? []).map((entry) => ({
              value: entry.key,
              label: entry.title,
            }))}
          />
          {scope === 'RUN' ? (
            <Select
              aria-label="Payroll run"
              style={{ minWidth: 300 }}
              value={selectedRun}
              onChange={setRunId}
              options={runOptions}
              placeholder="No calculated runs yet"
            />
          ) : null}
          {scope === 'DATE_RANGE' ? (
            <>
              <input
                aria-label="From"
                className="kw-dateInput"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
              <input
                aria-label="To"
                className="kw-dateInput"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </>
          ) : null}
          {scope === 'EMPLOYEE' ? (
            <>
              <Select
                aria-label="Employee"
                showSearch
                optionFilterProp="label"
                style={{ minWidth: 280 }}
                value={staffId}
                onChange={setStaffId}
                options={employeeOptions}
                placeholder="Choose an employee"
              />
              <Select
                aria-label="Year"
                style={{ minWidth: 110 }}
                value={year}
                onChange={setYear}
                options={yearOptions}
              />
            </>
          ) : null}
          {scope === 'YEAR' ? (
            <>
              <Select
                aria-label="Year"
                style={{ minWidth: 110 }}
                value={year}
                onChange={setYear}
                options={yearOptions}
              />
              <Select
                aria-label="Legal employer"
                allowClear
                style={{ minWidth: 260 }}
                value={employerId}
                onChange={setEmployerId}
                options={(employers.data ?? []).map((row) => ({ value: row.id, label: row.name }))}
                placeholder="Every employer"
              />
            </>
          ) : null}
        </div>
        <p className="kw-muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {catalogue.data?.available.find((entry) => entry.key === report)?.description}
        </p>
      </AdminSection>

      {scope === 'RUN' && !selectedRun ? (
        <AdminNotice tone="info">
          <strong>No payroll has been calculated yet.</strong> A report is a view of a run, so there is nothing to
          report on until one exists. <Link to="/admin/hr/payroll">Start this month's payroll</Link>.
        </AdminNotice>
      ) : null}
      {scope === 'EMPLOYEE' && !staffId ? (
        <AdminNotice tone="info">Choose an employee to see their payroll history.</AdminNotice>
      ) : null}

      {report === 'PAYROLL_REGISTER' && selectedRun ? <RegisterReport runId={selectedRun} /> : null}
      {report === 'EMPLOYER_COST' && selectedRun ? <EmployerCostReport runId={selectedRun} /> : null}
      {report === 'STATUTORY_TOTALS' && selectedRun ? <StatutoryReport runId={selectedRun} /> : null}
      {report === 'VARIANCE' && selectedRun ? <ComparisonReport runId={selectedRun} /> : null}
      {report === 'CLAIMS' ? <ClaimsReport from={from} to={to} /> : null}
      {report === 'PAYROLL_HISTORY' && staffId ? <HistoryReport staffId={staffId} year={year} /> : null}
      {report === 'PCB_SUMMARY' && selectedRun ? <PcbSummaryReport runId={selectedRun} /> : null}
      {report === 'YTD' ? <YtdReport year={year} legalEmployerId={employerId} /> : null}
      {report === 'OVERTIME' && selectedRun ? <OvertimeReport runId={selectedRun} /> : null}
      {report === 'UNPAID_LEAVE' && selectedRun ? <UnpaidLeaveReport runId={selectedRun} /> : null}
      {report === 'INCENTIVES' && selectedRun ? <IncentivesReport runId={selectedRun} /> : null}
      {report === 'EXCEPTIONS' && selectedRun ? <ExceptionsReport runId={selectedRun} /> : null}
      {report === 'PAYMENT_STATUS' && selectedRun ? <PaymentStatusReport runId={selectedRun} /> : null}

      {/*
        * WHAT DOES NOT EXIST, listed rather than left to be discovered on the
        * day a clinic needs it. Each carries the reason it cannot be built
        * yet, not a promise about when it will be.
        */}
      {catalogue.data && catalogue.data.notAvailableYet.length > 0 ? (
        <AdminSection
          title="Not available yet"
          description="Reports the payroll specification names that this build does not serve, and why."
        >
          <div className="kw-setupList">
            {catalogue.data.notAvailableYet.map((entry) => (
              <div key={entry.key} className="kw-setupList__row">
                <span className="kw-setupList__mark kw-setupList__mark--todo">—</span>
                <div className="kw-setupList__body">
                  <div className="kw-setupList__title">{entry.title}</div>
                  <div className="kw-setupList__detail">{entry.why}</div>
                </div>
                <div />
              </div>
            ))}
          </div>
        </AdminSection>
      ) : null}
    </AdminShell>
  );
}

/** The provisional warning travels WITH the figures, on every report. */
function ReportHeader({ header }: { header: { periodLabel: string; clinicName: string; status: string; provisional: boolean; provisionalNote: string | null } }) {
  return (
    <>
      <div className="kw-reportHeader">
        <div>
          <div className="kw-reportHeader__title">{header.periodLabel}</div>
          <div className="kw-muted">{header.clinicName}</div>
        </div>
        <div>
          {header.provisional ? <Tag color="warning">Provisional</Tag> : null}
          <Tag>{header.status}</Tag>
        </div>
      </div>
      {header.provisional && header.provisionalNote ? (
        <AdminNotice tone="warn">{header.provisionalNote}</AdminNotice>
      ) : null}
    </>
  );
}

function RegisterReport({ runId }: { runId: string }) {
  const query = usePayrollRegisterReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollRegisterReport['rows'][number];

  return (
    <AdminSection title="Payroll register" description="Every employee on this run. Open a row to see what made it up.">
      <ReportHeader header={data} />
      <DataTable<Row>
        rowKey="staffId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="Nobody was paid on this run."
        expandable={{
          rowExpandable: (row: Row) => row.components.length > 0,
          expandedRowRender: (row: Row) => (
            <DataTable
              rowKey="code"
              rows={row.components}
              columns={[
                { title: 'Component', dataIndex: 'label' },
                { title: 'Amount', dataIndex: 'amount', align: 'right' as const, width: 120, render: ringgit },
                { title: 'Where it came from', dataIndex: 'reason' },
                { title: 'Source', dataIndex: 'source', width: 120 },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          { title: 'Salary', dataIndex: 'basicSalary', align: 'right' as const, width: 110, render: ringgit },
          {
            // Allowances AND any other earning without a column of its own — a
            // claim reimbursed with salary lands here, so the row keeps adding
            // up left to right.
            title: 'Allowances / other',
            dataIndex: 'allowances',
            align: 'right' as const,
            width: 130,
            render: ringgit,
          },
          { title: 'Overtime', dataIndex: 'overtimePay', align: 'right' as const, width: 100, render: ringgit },
          /*
           * EVERY EARNING THE GROSS CONTAINS GETS A COLUMN.
           *
           * Two were missing and the row stopped adding up: a RM4,200 salary
           * beside a RM4,064.52 gross with the unpaid day off screen, and a
           * RM9,500 salary beside a RM9,760 gross with the incentive off
           * screen. Both numbers are individually right in each case and the
           * row is still wrong — which is the only kind of error nobody finds
           * by looking. A column that is all zeroes costs a reader nothing; a
           * missing one costs them the ability to check.
           */
          { title: 'Incentive', dataIndex: 'incentives', align: 'right' as const, width: 110, render: ringgit },
          { title: 'Bonus', dataIndex: 'bonus', align: 'right' as const, width: 100, render: ringgit },
          {
            title: 'Unpaid leave',
            dataIndex: 'unpaidLeaveDeduction',
            align: 'right' as const,
            width: 120,
            render: (value: string) =>
              Number(value) === 0 ? <span className="kw-muted">—</span> : <span>−{ringgit(value)}</span>,
          },
          { title: 'Gross', dataIndex: 'grossPay', align: 'right' as const, width: 110, render: ringgit },
          {
            title: 'Statutory',
            dataIndex: 'statutoryEmployee',
            align: 'right' as const,
            width: 120,
            // NULL IS NOT ZERO. A figure nobody worked out and a figure of nil
            // are different facts, and a report that shows both as RM0.00 is
            // how a clinic files a return for less than it owes.
            render: (value: string | null) =>
              value === null ? <span className="kw-muted">Not worked out</span> : ringgit(value),
          },
          { title: 'Take-home', dataIndex: 'netPay', align: 'right' as const, width: 120, render: ringgit },
          { title: 'Cost to clinic', dataIndex: 'employerCost', align: 'right' as const, width: 130, render: ringgit },
        ]}
        /*
         * THE TOTALS ARE THE API'S, placed here rather than computed here.
         * The expand-icon column has no header but does have a cell, so the
         * row starts one to its left or every figure lands under the wrong
         * heading.
         */
        summary={() => (
          <DataTableTotalRow
            cells={[
              { value: '', colSpan: 1, align: 'left' },
              { value: `${data.totals.employees} employee${data.totals.employees === 1 ? '' : 's'}`, align: 'left' },
              { value: ringgit(data.totals.basicSalary) },
              { value: ringgit(data.totals.allowances) },
              { value: ringgit(data.totals.overtimePay) },
              { value: ringgit(data.totals.incentives) },
              { value: ringgit(data.totals.bonus) },
              { value: `−${ringgit(data.totals.unpaidLeaveDeduction)}` },
              { value: ringgit(data.totals.grossPay) },
              // Deliberately no statutory total: a column carrying "Not worked
              // out" for some rows has no honest sum.
              { value: '' },
              { value: ringgit(data.totals.netPay), strong: true },
              { value: ringgit(data.totals.employerCost) },
            ]}
          />
        )}
      />
    </AdminSection>
  );
}

function EmployerCostReport({ runId }: { runId: string }) {
  const query = usePayrollEmployerCostReport(runId);
  if (!query.data) return null;
  const data = query.data;

  const columns = [
    { title: 'Name', dataIndex: 'label' },
    { title: 'Employees', dataIndex: 'employees', align: 'right' as const, width: 110 },
    { title: 'Wages', dataIndex: 'gross', align: 'right' as const, width: 130, render: ringgit },
    {
      title: 'Employer contributions',
      dataIndex: 'employerContributions',
      align: 'right' as const,
      width: 190,
      render: (value: string | null) =>
        value === null ? <span className="kw-muted">Not worked out</span> : ringgit(value),
    },
    { title: 'Total cost', dataIndex: 'employerCost', align: 'right' as const, width: 140, render: ringgit },
  ];

  return (
    <>
      <AdminSection
        title="Cost to the clinic"
        description="What the month cost the employer — wages plus what the employer contributes on top. This is not what staff receive."
      >
        <ReportHeader header={data} />
        <DataTable<PayrollCostBucket>
          rowKey="key"
          loading={query.isLoading}
          rows={data.byBranch}
          emptyText="No cost recorded on this run."
          columns={columns}
        />
        {data.byBranch.some((bucket) => bucket.note) ? (
          <AdminNotice tone="warn">
            {data.byBranch.filter((bucket) => bucket.note).map((bucket) => (
              <div key={bucket.key}>
                <strong>{bucket.label}:</strong> {bucket.note}
              </div>
            ))}
          </AdminNotice>
        ) : null}
      </AdminSection>

      <AdminSection
        title="By the employer who pays"
        description="A branch is where the work happens. The legal employer is who pays and files, and the same branch can hold staff of two employers."
      >
        <DataTable<PayrollCostBucket>
          rowKey="key"
          rows={data.byLegalEmployer}
          emptyText="No employer recorded on this run."
          columns={columns}
        />
      </AdminSection>
    </>
  );
}

function StatutoryReport({ runId }: { runId: string }) {
  const query = usePayrollStatutoryReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Scheme = PayrollStatutoryReport['byEmployer'][number]['schemes'][number];

  return (
    <>
      {/* SAID ONCE, PLAINLY, AT THE TOP. Not a footnote under a table of totals. */}
      <AdminNotice tone="info">{data.notASubmission}</AdminNotice>

      {data.byEmployer.map((employer) => (
        <AdminSection
          key={employer.employerId}
          title={employer.employerName}
          description={`${employer.employees} employee${employer.employees === 1 ? '' : 's'} on this run.`}
        >
          <ReportHeader header={data} />
          <DataTable<Scheme>
            rowKey="scheme"
            loading={query.isLoading}
            rows={employer.schemes}
            columns={[
              { title: 'Scheme', dataIndex: 'scheme', width: 110 },
              {
                title: 'From the employee',
                dataIndex: 'employee',
                align: 'right' as const,
                width: 170,
                // A null means two different things by scheme: the HRD levy
                // HAS no employee share (—), while a missing figure on any
                // other scheme is one nobody worked out.
                render: (value: string | null, row: Scheme) =>
                  value === null ? (
                    <span className="kw-muted">{row.scheme === 'HRD' ? '—' : 'Not worked out'}</span>
                  ) : (
                    ringgit(value)
                  ),
              },
              {
                title: 'From the employer',
                dataIndex: 'employer',
                align: 'right' as const,
                width: 170,
                // Mirror image: PCB has no employer share (—); an HRD null
                // here means the registration is unrecorded — unknown, not nil.
                render: (value: string | null, row: Scheme) =>
                  value === null ? (
                    <span className="kw-muted">{row.scheme === 'PCB' ? '—' : 'Not worked out'}</span>
                  ) : (
                    ringgit(value)
                  ),
              },
              {
                title: 'Total',
                dataIndex: 'total',
                align: 'right' as const,
                width: 140,
                render: (value: string | null) =>
                  value === null ? <span className="kw-muted">No total</span> : ringgit(value),
              },
              { title: 'Note', dataIndex: 'note', render: (value: string | null) => value ?? '' },
            ]}
          />
          {!employer.canFile.epf || !employer.canFile.socso || !employer.canFile.lhdn ? (
            <AdminNotice tone="warn">
              <strong>This employer cannot file.</strong> Missing{' '}
              {[
                !employer.canFile.epf ? 'an EPF number' : null,
                !employer.canFile.socso ? 'a SOCSO number' : null,
                !employer.canFile.lhdn ? 'an LHDN number' : null,
              ]
                .filter(Boolean)
                .join(', ')}
              . <Link to="/admin/hr/employers">Add the missing numbers</Link>.
            </AdminNotice>
          ) : null}
        </AdminSection>
      ))}
    </>
  );
}

function ComparisonReport({ runId }: { runId: string }) {
  const query = usePayrollMonthComparisonReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollMonthComparisonReport['rows'][number];

  if (!data.comparedWith) {
    return (
      <AdminSection title="This month against last">
        <ReportHeader header={data} />
        <AdminNotice tone="info">{data.note}</AdminNotice>
      </AdminSection>
    );
  }

  return (
    <AdminSection
      title={`${data.periodLabel} against ${data.comparedWith.periodLabel}`}
      description="Every movement is this month's figure minus last month's. Nobody who was paid last month disappears from this list."
    >
      <ReportHeader header={data} />
      <DataTable<Row>
        rowKey="staffId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="Nothing to compare."
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          {
            title: '',
            dataIndex: 'state',
            width: 110,
            render: (value: Row['state']) =>
              value === 'JOINED' ? (
                <Tag color="processing">Joined</Tag>
              ) : value === 'LEFT' ? (
                <Tag color="warning">Left</Tag>
              ) : null,
          },
          {
            title: data.comparedWith.periodLabel,
            dataIndex: 'previous',
            align: 'right' as const,
            width: 150,
            render: (value: string | null) => (value === null ? <span className="kw-muted">—</span> : ringgit(value)),
          },
          {
            title: data.periodLabel,
            dataIndex: 'current',
            align: 'right' as const,
            width: 150,
            render: (value: string | null) => (value === null ? <span className="kw-muted">—</span> : ringgit(value)),
          },
          {
            title: 'Movement',
            dataIndex: 'movement',
            align: 'right' as const,
            width: 140,
            render: (value: string) => (
              <span style={{ color: Number(value) < 0 ? '#b42318' : Number(value) > 0 ? '#166534' : undefined }}>
                {Number(value) > 0 ? '+' : ''}
                {ringgit(value)}
              </span>
            ),
          },
        ]}
        summary={() =>
          data.totals ? (
            <DataTableTotalRow
              cells={[
                { value: `${data.totals.joined} joined · ${data.totals.left} left`, colSpan: 2, align: 'left' },
                { value: ringgit(data.totals.previous) },
                { value: ringgit(data.totals.current) },
                {
                  value: `${Number(data.totals.movement) > 0 ? '+' : ''}${ringgit(data.totals.movement)}`,
                  strong: true,
                },
              ]}
            />
          ) : null
        }
      />
    </AdminSection>
  );
}

function ClaimsReport({ from, to }: { from: string; to: string }) {
  const query = usePayrollClaimsReport({ from, to });
  if (!query.data) return null;
  const data = query.data;
  type Row = (typeof data.rows)[number];

  return (
    <AdminSection title="Claims and reimbursements" description={data.periodMeans}>
      <DataTable<Row>
        rowKey="id"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="No decided claims in this period."
        columns={[
          { title: 'Date', dataIndex: 'claimDate', width: 120, render: (value: string) => dayjs(value).format('D MMM YYYY') },
          { title: 'Employee', dataIndex: 'name' },
          { title: 'What for', dataIndex: 'description' },
          { title: 'Claimed', dataIndex: 'claimed', align: 'right' as const, width: 110, render: ringgit },
          {
            title: 'Approved',
            dataIndex: 'approved',
            align: 'right' as const,
            width: 110,
            render: (value: string | null) => (value === null ? <span className="kw-muted">—</span> : ringgit(value)),
          },
          {
            title: 'Paid by',
            width: 200,
            render: (_: unknown, row: Row) =>
              row.status !== 'APPROVED' ? (
                <Tag>Rejected</Tag>
              ) : row.route === 'PAYROLL' ? (
                <Tag color={row.settled ? 'success' : 'processing'}>
                  {row.settled ? 'Paid with salary' : 'Due with salary'}
                </Tag>
              ) : (
                <Tag color={row.settled ? 'success' : 'processing'}>
                  {row.settled ? 'Reimbursed by Finance' : 'Due from Finance'}
                </Tag>
              ),
          },
        ]}
        summary={() => (
          <DataTableTotalRow
            cells={[
              {
                value: `${data.totals.approved} approved · ${data.totals.rejected} rejected`,
                colSpan: 3,
                align: 'left',
              },
              { value: '' },
              { value: '' },
              {
                value: `With salary ${ringgit(data.totals.throughPayroll)} · By Finance ${ringgit(data.totals.throughFinance)}`,
                align: 'left',
                strong: true,
              },
            ]}
          />
        )}
      />
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.doublePaymentCheck}
        {data.totals.awaitingPayment > 0
          ? ` ${data.totals.awaitingPayment} approved claim${data.totals.awaitingPayment === 1 ? ' is' : 's are'} still waiting to be paid.`
          : ''}
      </p>
    </AdminSection>
  );
}

/** Shared "Not worked out" cell for figures the engine refused to guess. */
const orNotWorkedOut = (value: string | null) =>
  value === null ? <span className="kw-muted">Not worked out</span> : ringgit(value);

function HistoryReport({ staffId, year }: { staffId: string; year: number }) {
  const query = usePayrollHistoryReport(staffId, year);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollHistoryReport['rows'][number];

  return (
    <AdminSection
      title={`${data.name} — payroll history`}
      description="Every run that has ever paid them, corrections included. A corrected month keeps every approved version."
    >
      <DataTable<Row>
        rowKey="runId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText={`No payroll runs for ${data.year ?? 'this year'}.`}
        columns={[
          {
            title: 'Month',
            dataIndex: 'periodLabel',
            render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link>,
          },
          { title: 'Branch', dataIndex: 'clinicName' },
          {
            title: 'Run',
            width: 140,
            render: (_: unknown, row: Row) => `${row.runType}${row.sequence > 1 ? ` #${row.sequence}` : ''}`,
          },
          {
            title: 'Status',
            dataIndex: 'status',
            width: 120,
            render: (value: string) => (
              <Tag color={value === 'PAID' ? 'success' : value === 'APPROVED' ? 'processing' : undefined}>{value}</Tag>
            ),
          },
          { title: 'Gross', dataIndex: 'gross', align: 'right' as const, width: 110, render: ringgit },
          {
            title: 'Statutory',
            dataIndex: 'statutoryEmployee',
            align: 'right' as const,
            width: 120,
            render: orNotWorkedOut,
          },
          { title: 'Take-home', dataIndex: 'net', align: 'right' as const, width: 120, render: ringgit },
          {
            title: 'Versions',
            dataIndex: 'approvedVersions',
            align: 'right' as const,
            width: 90,
            render: (value: number) => (value === 0 ? <span className="kw-muted">—</span> : value),
          },
        ]}
        expandable={{
          rowExpandable: (row: Row) => row.note !== null,
          expandedRowRender: (row: Row) => <span className="kw-muted">{row.note}</span>,
        }}
        summary={() => (
          <DataTableTotalRow
            cells={[
              {
                value: `${data.totals.approvedRuns} of ${data.totals.runs} runs approved`,
                colSpan: 5,
                align: 'left',
              },
              { value: ringgit(data.totals.approvedGross) },
              { value: '' },
              { value: ringgit(data.totals.approvedNet), strong: true },
              { value: '' },
            ]}
          />
        )}
      />
      {/* What the totals row counts, in the API's words: approved money only. */}
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.totals.totalsMean}
      </p>
    </AdminSection>
  );
}

function PcbSummaryReport({ runId }: { runId: string }) {
  const query = usePayrollPcbSummaryReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollPcbSummaryReport['rows'][number];

  return (
    <AdminSection
      title="Monthly tax (PCB) summary"
      description="The month's tax per employee, with zakat and TP1 beside it — the two things that lawfully change it."
    >
      <ReportHeader header={data} />
      <AdminNotice tone={data.totals.missing > 0 ? 'warn' : 'info'}>{data.note}</AdminNotice>
      <DataTable<Row>
        rowKey="staffId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="Nobody was paid on this run."
        expandable={{
          rowExpandable: (row: Row) => row.note !== null || row.tp1 !== null,
          expandedRowRender: (row: Row) => (
            <div>
              {row.note ? <p style={{ margin: 0 }}>{row.note}</p> : null}
              {row.tp1 ? (
                <p className="kw-muted" style={{ margin: row.note ? '6px 0 0' : 0 }}>
                  TP1 for this month: {ringgit(row.tp1.deductions)} of approved deductions
                  {Number(row.tp1.zakatSelfPaid) > 0 ? `, ${ringgit(row.tp1.zakatSelfPaid)} of self-paid zakat` : ''}
                  {row.tp1.receivedDate ? ` — received ${dayjs(row.tp1.receivedDate).format('D MMM YYYY')}` : ''}.
                </p>
              ) : null}
            </div>
          ),
        }}
        columns={[
          {
            title: 'Employee',
            dataIndex: 'name',
            render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link>,
          },
          { title: 'Tax no.', dataIndex: 'taxNumber', width: 140, render: (value: string | null) => value ?? <span className="kw-muted">—</span> },
          { title: 'PCB', dataIndex: 'pcb', align: 'right' as const, width: 110, render: orNotWorkedOut },
          {
            title: 'How',
            dataIndex: 'source',
            width: 150,
            render: (value: Row['source']) =>
              value === 'CALCULATED' ? (
                <Tag color="processing">Calculated</Tag>
              ) : value === 'ENTERED' ? (
                <Tag color="warning">Entered by hand</Tag>
              ) : (
                <Tag color="error">Missing</Tag>
              ),
          },
          {
            title: 'Zakat via payroll',
            dataIndex: 'zakatViaPayroll',
            align: 'right' as const,
            width: 140,
            render: (value: string) => (Number(value) === 0 ? <span className="kw-muted">—</span> : ringgit(value)),
          },
          {
            title: 'TP1 applied',
            width: 130,
            align: 'right' as const,
            render: (_: unknown, row: Row) =>
              row.tp1 === null ? <span className="kw-muted">—</span> : ringgit(row.tp1.deductions),
          },
        ]}
        summary={() => (
          <DataTableTotalRow
            cells={[
              {
                value: `${data.totals.calculated} calculated · ${data.totals.entered} entered · ${data.totals.missing} missing`,
                colSpan: 3,
                align: 'left',
              },
              { value: data.totals.pcb === null ? 'No total' : ringgit(data.totals.pcb), strong: true },
              { value: '' },
              { value: ringgit(data.totals.zakatViaPayroll) },
              { value: `${data.totals.tp1Applied} TP1` },
            ]}
          />
        )}
      />
    </AdminSection>
  );
}

function YtdReport({ year, legalEmployerId }: { year: number; legalEmployerId?: string }) {
  const query = usePayrollYtdReport(year, legalEmployerId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollYtdReport['rows'][number];

  return (
    <>
      <AdminSection
        title={`Year to date — ${data.taxYear}`}
        description="The cumulative ledger approved runs write and next month's tax reads."
      >
        <AdminNotice tone="info">{data.note}</AdminNotice>
        <DataTable<Row>
          rowKey={(row: Row) => `${row.legalEmployerId}:${row.staffId}`}
          loading={query.isLoading}
          rows={data.rows}
          emptyText={`Nothing recorded for ${data.taxYear} yet — the ledger fills as runs are approved.`}
          expandable={{
            rowExpandable: (row: Row) => row.note !== null,
            expandedRowRender: (row: Row) => <span className="kw-muted">{row.note}</span>,
          }}
          columns={[
            {
              title: 'Employee',
              dataIndex: 'name',
              render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link>,
            },
            { title: 'Employer', dataIndex: 'employerName' },
            {
              title: 'Months',
              dataIndex: 'monthsRecorded',
              align: 'right' as const,
              width: 90,
              render: (value: number, row: Row) => (row.note ? <span>{value}*</span> : value),
            },
            { title: 'Gross', dataIndex: 'gross', align: 'right' as const, width: 110, render: ringgit },
            { title: 'PCB', dataIndex: 'pcb', align: 'right' as const, width: 100, render: ringgit },
            { title: 'EPF (staff)', dataIndex: 'epfEmployee', align: 'right' as const, width: 110, render: ringgit },
            { title: 'EPF (employer)', dataIndex: 'epfEmployer', align: 'right' as const, width: 130, render: ringgit },
            { title: 'SOCSO', dataIndex: 'socsoEmployee', align: 'right' as const, width: 100, render: ringgit },
            { title: 'EIS', dataIndex: 'eisEmployee', align: 'right' as const, width: 90, render: ringgit },
            { title: 'LINDUNG', dataIndex: 'lindungEmployee', align: 'right' as const, width: 100, render: ringgit },
            { title: 'TP1 applied', dataIndex: 'deductionsApplied', align: 'right' as const, width: 110, render: ringgit },
          ]}
          summary={() => (
            <DataTableTotalRow
              cells={[
                { value: `${data.totals.employees} employee${data.totals.employees === 1 ? '' : 's'}`, colSpan: 3, align: 'left' },
                { value: '' },
                { value: ringgit(data.totals.gross), strong: true },
                { value: ringgit(data.totals.pcb) },
                { value: ringgit(data.totals.epfEmployee) },
                { value: ringgit(data.totals.epfEmployer) },
                { value: ringgit(data.totals.socsoEmployee) },
                { value: ringgit(data.totals.eisEmployee) },
                { value: ringgit(data.totals.lindungEmployee) },
                { value: '' },
              ]}
            />
          )}
        />
      </AdminSection>

      {data.previousEmployment.length > 0 ? (
        <AdminSection
          title="Previous employment this year (Form TP3)"
          description="Declared figures from a previous employer. They enter the tax calculation, but they are not this employer's money and are not in the totals above."
        >
          <DataTable
            rowKey={(row: PayrollYtdReport['previousEmployment'][number]) => `${row.staffId}:${row.previousEmployerName}`}
            rows={data.previousEmployment}
            columns={[
              { title: 'Employee', dataIndex: 'name' },
              { title: 'Previous employer', dataIndex: 'previousEmployerName' },
              { title: 'Gross there', dataIndex: 'gross', align: 'right' as const, width: 120, render: ringgit },
              { title: 'EPF there', dataIndex: 'epf', align: 'right' as const, width: 110, render: ringgit },
              { title: 'Tax paid there', dataIndex: 'mtdPaid', align: 'right' as const, width: 120, render: ringgit },
              { title: 'Declared on', dataIndex: 'source' },
            ]}
          />
        </AdminSection>
      ) : null}
    </>
  );
}

function OvertimeReport({ runId }: { runId: string }) {
  const query = usePayrollOvertimeReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollOvertimeReport['rows'][number];

  return (
    <AdminSection
      title="Overtime"
      description="Each tier row names the Employment Act provision that priced it. Rest days and public holidays are paid in days, not multiplied hours."
    >
      <ReportHeader header={data} />
      <DataTable<Row>
        rowKey="staffId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText={data.note}
        expandable={{
          rowExpandable: (row: Row) => row.tiers.length > 0,
          expandedRowRender: (row: Row) => (
            <DataTable
              rowKey="label"
              rows={row.tiers}
              columns={[
                { title: 'Day', dataIndex: 'label' },
                {
                  title: 'Hours beyond the day',
                  dataIndex: 'hours',
                  align: 'right' as const,
                  width: 160,
                  render: (value: number) => (value === 0 ? <span className="kw-muted">—</span> : value.toFixed(2)),
                },
                {
                  title: 'Days at ordinary rate',
                  dataIndex: 'ordinaryRateDays',
                  align: 'right' as const,
                  width: 160,
                  render: (value: number) => (value === 0 ? <span className="kw-muted">—</span> : value),
                },
                {
                  title: 'Paid',
                  dataIndex: 'total',
                  align: 'right' as const,
                  width: 110,
                  render: (value: number) => ringgit(value.toFixed(2)),
                },
                { title: 'Provision', dataIndex: 'provision' },
              ]}
            />
          ),
        }}
        columns={[
          { title: 'Employee', dataIndex: 'name', render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link> },
          {
            title: 'Approved OT hours',
            dataIndex: 'hours',
            align: 'right' as const,
            width: 150,
            render: (value: number) => (value === 0 ? <span className="kw-muted">—</span> : value.toFixed(2)),
          },
          { title: 'Overtime pay', dataIndex: 'pay', align: 'right' as const, width: 130, render: ringgit },
        ]}
        summary={() =>
          data.rows.length > 0 ? (
            <DataTableTotalRow
              cells={[
                { value: '', colSpan: 1, align: 'left' },
                { value: `${data.totals.employees} employee${data.totals.employees === 1 ? '' : 's'}`, align: 'left' },
                { value: data.totals.hours === 0 ? '—' : data.totals.hours.toFixed(2) },
                { value: ringgit(data.totals.pay), strong: true },
              ]}
            />
          ) : null
        }
      />
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.orp.meaning}
      </p>
    </AdminSection>
  );
}

function UnpaidLeaveReport({ runId }: { runId: string }) {
  const query = usePayrollUnpaidLeaveReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollUnpaidLeaveReport['rows'][number];

  return (
    <AdminSection
      title="Unpaid leave"
      description="Days not worked and the wages the month never included."
    >
      <ReportHeader header={data} />
      {/* The s.18A framing IS the report: a reduction of wages earned, not a
        * deduction from wages — which is why no deductions column exists. */}
      <AdminNotice tone="info">{data.note}</AdminNotice>
      <DataTable<Row>
        rowKey="staffId"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="No unpaid leave on this run."
        columns={[
          { title: 'Employee', dataIndex: 'name', render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link> },
          { title: 'Days', dataIndex: 'days', align: 'right' as const, width: 90 },
          {
            title: 'Daily rate',
            dataIndex: 'dailyRate',
            align: 'right' as const,
            width: 110,
            render: (value: number | null) =>
              value === null ? <span className="kw-muted">—</span> : ringgit(value.toFixed(2)),
          },
          {
            title: 'Wages reduced by',
            dataIndex: 'reduction',
            align: 'right' as const,
            width: 150,
            render: (value: string) => <span>−{ringgit(value)}</span>,
          },
          { title: 'Gross after', dataIndex: 'grossAfter', align: 'right' as const, width: 120, render: ringgit },
        ]}
        summary={() =>
          data.rows.length > 0 ? (
            <DataTableTotalRow
              cells={[
                { value: `${data.totals.employees} employee${data.totals.employees === 1 ? '' : 's'}`, align: 'left' },
                { value: String(data.totals.days) },
                { value: '' },
                { value: `−${ringgit(data.totals.reduction)}`, strong: true },
                { value: '' },
              ]}
            />
          ) : null
        }
      />
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.divisor.meaning}
      </p>
    </AdminSection>
  );
}

function IncentivesReport({ runId }: { runId: string }) {
  const query = usePayrollIncentivesReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollIncentivesReport['rows'][number];

  return (
    <AdminSection
      title="Incentives and bonuses"
      description="What was paid on top of salary this month, each row naming the record it came from."
    >
      <ReportHeader header={data} />
      <DataTable<Row>
        rowKey={(row: Row) => `${row.staffId}:${row.component}:${row.label}`}
        loading={query.isLoading}
        rows={data.rows}
        emptyText="No incentives or bonuses on this run."
        columns={[
          { title: 'Employee', dataIndex: 'name', render: (value: string, row: Row) => <Link to={row.drill}>{value}</Link> },
          {
            title: 'What',
            dataIndex: 'component',
            width: 110,
            render: (value: string) => <Tag color={value === 'BONUS' ? 'processing' : undefined}>{value}</Tag>,
          },
          { title: 'Label', dataIndex: 'label' },
          { title: 'Amount', dataIndex: 'amount', align: 'right' as const, width: 110, render: ringgit },
          {
            title: 'Earned in',
            dataIndex: 'earnedPeriod',
            width: 110,
            render: (value: string | null) =>
              value === null ? <span className="kw-muted">this month</span> : dayjs(value).format('MMM YYYY'),
          },
          {
            title: 'Where it came from',
            render: (_: unknown, row: Row) => (
              <span>
                {row.source}
                {row.reason ? <span className="kw-muted"> · {row.reason}</span> : null}
              </span>
            ),
          },
        ]}
        summary={() =>
          data.rows.length > 0 ? (
            <DataTableTotalRow
              cells={[
                {
                  value: `${data.totals.employees} employee${data.totals.employees === 1 ? '' : 's'}`,
                  colSpan: 3,
                  align: 'left',
                },
                {
                  value: `Incentives ${ringgit(data.totals.incentives)} · Bonus ${ringgit(data.totals.bonus)}`,
                  colSpan: 3,
                  align: 'right',
                  strong: true,
                },
              ]}
            />
          ) : null
        }
      />
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.note}
      </p>
    </AdminSection>
  );
}

function ExceptionsReport({ runId }: { runId: string }) {
  const query = usePayrollExceptionsReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Row = PayrollExceptionsReport['rows'][number];

  return (
    <AdminSection
      title="Exceptions and overrides"
      description="What the run raised, and what somebody waved through — the record an approval was given over."
    >
      <ReportHeader header={data} />
      <AdminNotice tone={data.totals.blockingOpen > 0 ? 'warn' : 'info'}>{data.note}</AdminNotice>
      <DataTable<Row>
        rowKey="id"
        loading={query.isLoading}
        rows={data.rows}
        emptyText="The run raised no exceptions."
        expandable={{
          rowExpandable: () => true,
          expandedRowRender: (row: Row) => (
            <div>
              <p style={{ margin: 0 }}>{row.consequence}</p>
              <p className="kw-muted" style={{ margin: '6px 0 0' }}>
                To fix: {row.remediation}
              </p>
              {row.overridden ? (
                <p style={{ margin: '6px 0 0' }}>
                  <strong>Passed with a reason</strong> by {row.overriddenBy ?? 'somebody'}
                  {row.overriddenAt ? ` on ${dayjs(row.overriddenAt).format('D MMM YYYY')}` : ''}: “
                  {row.overrideReason}”
                </p>
              ) : null}
            </div>
          ),
        }}
        columns={[
          {
            title: 'Severity',
            dataIndex: 'severity',
            width: 110,
            render: (value: string) => (
              <Tag color={value === 'BLOCKING' ? 'error' : value === 'WARNING' ? 'warning' : undefined}>{value}</Tag>
            ),
          },
          {
            title: 'Employee',
            dataIndex: 'name',
            width: 180,
            render: (value: string | null) => value ?? <span className="kw-muted">Whole run</span>,
          },
          { title: 'What', dataIndex: 'cause' },
          {
            title: 'Standing',
            width: 170,
            render: (_: unknown, row: Row) =>
              row.overridden ? (
                <Tag color="warning">Passed with a reason</Tag>
              ) : row.severity === 'BLOCKING' ? (
                <Tag color="error">Open — blocks approval</Tag>
              ) : (
                <Tag>Open</Tag>
              ),
          },
        ]}
      />
      <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
        {data.totals.blocking} blocking ({data.totals.blockingOpen} open) · {data.totals.warnings} warnings ·{' '}
        {data.totals.overridden} passed with a reason
      </p>
    </AdminSection>
  );
}

function PaymentStatusReport({ runId }: { runId: string }) {
  const query = usePayrollPaymentStatusReport(runId);
  if (!query.data) return null;
  const data = query.data;
  type Line = NonNullable<PayrollPaymentStatusReport['current']>['lines'][number];

  if (!data.current) {
    return (
      <AdminSection title="Payment status">
        <ReportHeader header={data} />
        <AdminNotice tone="info">{data.note}</AdminNotice>
      </AdminSection>
    );
  }
  const current = data.current;

  return (
    <AdminSection
      title="Payment status"
      description="Where the money stands, in the language of the evidence — a downloaded listing is not a payment."
    >
      <ReportHeader header={data} />
      <AdminNotice tone={current.status === 'RECORDED_PAID' ? 'info' : 'warn'}>
        <strong>
          {current.status === 'RECORDED_PAID'
            ? 'Recorded paid.'
            : current.status === 'DOWNLOADED'
              ? 'Listing downloaded.'
              : 'Listing prepared.'}
        </strong>{' '}
        {current.statusMeans}
      </AdminNotice>
      <dl className="kw-facts" style={{ marginBottom: 12 }}>
        <div className="kw-facts__row">
          <dt>Prepared</dt>
          <dd>
            {dayjs(current.preparedAt).format('D MMM YYYY')}
            {current.preparedBy ? ` by ${current.preparedBy}` : ''}
          </dd>
        </div>
        <div className="kw-facts__row">
          <dt>Downloaded</dt>
          <dd>
            {current.downloadedAt
              ? `${dayjs(current.downloadedAt).format('D MMM YYYY')}${current.downloadedBy ? ` by ${current.downloadedBy}` : ''}`
              : 'Not yet'}
          </dd>
        </div>
        <div className="kw-facts__row">
          <dt>Recorded paid</dt>
          <dd>
            {current.paidRecordedAt
              ? `${dayjs(current.paymentDate ?? current.paidRecordedAt).format('D MMM YYYY')}${current.paidRecordedBy ? ` by ${current.paidRecordedBy}` : ''}${current.paymentReference ? ` · ref ${current.paymentReference}` : ''}`
              : 'Not yet — and nothing here will claim otherwise'}
          </dd>
        </div>
        <div className="kw-facts__row">
          <dt>From approved record</dt>
          <dd>version {current.snapshotVersion}</dd>
        </div>
      </dl>
      <DataTable<Line>
        rowKey="staffId"
        rows={current.lines}
        columns={[
          { title: 'Employee', dataIndex: 'name' },
          {
            title: 'Bank',
            render: (_: unknown, row: Line) =>
              row.bankName ? `${row.bankName}${row.accountEnding ? ` · ···${row.accountEnding}` : ''}` : '—',
          },
          { title: 'Amount', dataIndex: 'amount', align: 'right' as const, width: 120, render: ringgit },
          {
            title: 'On the listing',
            width: 220,
            render: (_: unknown, row: Line) =>
              row.included ? (
                <Tag color="success">Included</Tag>
              ) : (
                <span>
                  <Tag color="warning">Left out</Tag>
                  <span className="kw-muted">{row.exclusionReason}</span>
                </span>
              ),
          },
        ]}
        summary={() => (
          <DataTableTotalRow
            cells={[
              {
                value: `${current.includedCount} included · ${current.excludedCount} left out`,
                colSpan: 2,
                align: 'left',
              },
              { value: ringgit(current.total), strong: true },
              { value: '' },
            ]}
          />
        )}
      />
      {data.supersededBatches.length > 0 ? (
        <p className="kw-muted" style={{ marginTop: 10, marginBottom: 0 }}>
          {data.supersededBatches.length} earlier listing{data.supersededBatches.length === 1 ? ' was' : 's were'}{' '}
          superseded when the run changed; every version is kept.
        </p>
      ) : null}
    </AdminSection>
  );
}
