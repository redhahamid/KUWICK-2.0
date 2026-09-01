import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Select, Tag } from 'antd';
import dayjs from 'dayjs';
import { AdminNotice, AdminSection, AdminShell, firstError } from '../components/AdminShell';
import { DataTable, DataTableTotalRow, ringgit } from '../components/DataTable';
import { useClinicFilter } from '../../core/hooks/useClinicFilter';
import {
  usePayrollClaimsReport,
  usePayrollEmployerCostReport,
  usePayrollMonthComparisonReport,
  usePayrollRegisterReport,
  usePayrollReportCatalogue,
  usePayrollRuns,
  usePayrollStatutoryReport,
} from '../hooks/useAdmin';
import type {
  PayrollCostBucket,
  PayrollMonthComparisonReport,
  PayrollRegisterReport,
  PayrollStatutoryReport,
} from '../types';

/**
 * PAYROLL REPORTS.
 *
 * FIVE REPORTS, ONE SOURCE. Every figure here is served by the API from the
 * same `payroll_lines` and `payroll_input_entries` rows the run wrote. This
 * page performs no arithmetic of its own — no sums, no percentages, no
 * derived totals — because a screen that adds up salaries its own way is a
 * second engine and the two disagree in the month somebody finally checks.
 *
 * NULL IS NOT ZERO. A statutory figure the engine could not work out arrives
 * as null and is shown as "Not worked out", never as RM0.00.
 */

type ReportKey = 'PAYROLL_REGISTER' | 'EMPLOYER_COST' | 'STATUTORY_TOTALS' | 'VARIANCE' | 'CLAIMS';

export function PayrollReportsPage() {
  const { clinicId } = useClinicFilter();
  const catalogue = usePayrollReportCatalogue();
  const runs = usePayrollRuns({ clinicId });
  const [report, setReport] = useState<ReportKey>('PAYROLL_REGISTER');
  const [runId, setRunId] = useState<string | undefined>();

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
  const isRunReport = report !== 'CLAIMS';

  const [from, setFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [to, setTo] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));

  return (
    <AdminShell
      error={firstError(catalogue, runs)}
      title="Payroll reports"
      subtitle="Read-only views of runs that have already been calculated. Every figure comes from the run itself."
    >
      <AdminSection title="Choose a report">
        <div className="kw-filterRow">
          <Select
            aria-label="Report"
            style={{ minWidth: 260 }}
            value={report}
            onChange={(value) => setReport(value as ReportKey)}
            options={(catalogue.data?.available ?? []).map((entry) => ({
              value: entry.key,
              label: entry.title,
            }))}
          />
          {isRunReport ? (
            <Select
              aria-label="Payroll run"
              style={{ minWidth: 300 }}
              value={selectedRun}
              onChange={setRunId}
              options={runOptions}
              placeholder="No calculated runs yet"
            />
          ) : (
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
          )}
        </div>
        <p className="kw-muted" style={{ marginTop: 8, marginBottom: 0 }}>
          {catalogue.data?.available.find((entry) => entry.key === report)?.description}
        </p>
      </AdminSection>

      {isRunReport && !selectedRun ? (
        <AdminNotice tone="info">
          <strong>No payroll has been calculated yet.</strong> A report is a view of a run, so there is nothing to
          report on until one exists. <Link to="/admin/hr/payroll">Start this month's payroll</Link>.
        </AdminNotice>
      ) : null}

      {report === 'PAYROLL_REGISTER' && selectedRun ? <RegisterReport runId={selectedRun} /> : null}
      {report === 'EMPLOYER_COST' && selectedRun ? <EmployerCostReport runId={selectedRun} /> : null}
      {report === 'STATUTORY_TOTALS' && selectedRun ? <StatutoryReport runId={selectedRun} /> : null}
      {report === 'VARIANCE' && selectedRun ? <ComparisonReport runId={selectedRun} /> : null}
      {report === 'CLAIMS' ? <ClaimsReport from={from} to={to} /> : null}

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
          { title: 'Allowances', dataIndex: 'allowances', align: 'right' as const, width: 110, render: ringgit },
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
                render: (value: string | null) =>
                  value === null ? <span className="kw-muted">Not worked out</span> : ringgit(value),
              },
              {
                title: 'From the employer',
                dataIndex: 'employer',
                align: 'right' as const,
                width: 170,
                render: (value: string | null) =>
                  value === null ? <span className="kw-muted">—</span> : ringgit(value),
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
